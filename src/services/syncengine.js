// Service de synchro dossier ↔ collection — logique métier SANS DOM (lot 1.5 de la refonte UI).
//
// Mêmes règles que services/profiles.js : aucun import de ui.js, aucun accès à
// document / $() ; les effets d'interface ($('ragStatus'), barre de progression)
// passent par des callbacks fournis par l'appelant (main.js) ou par la valeur de
// retour / les exceptions.
//
// Index local (localStorage) : pour chaque collection liée à un dossier, on mémorise le
// dossier et, par fichier, son document_id côté ILaaS + taille/mtime (détection des
// changements). Clé = « profil::collection » (les id de collection sont propres au RAG).
// FORMAT INTOUCHÉ (clé `doceria_sync_v1`) — le lot 1.5 ne change RIEN à la persistance.

import { state } from '../state.js';
import { ragApi, describeError } from '../api.js';
import { readDocument } from '../documents.js';

const SYNC_KEY = 'doceria_sync_v1';

// Verrou global anti-concurrence : UNE seule synchro (manuelle ou automatique) à la
// fois. main.js le consulte via estOccupe() partout où « syncing » était testé.
let syncing = false;

export function estOccupe() {
  return syncing;
}

function loadSyncMap() {
  try { return JSON.parse(localStorage.getItem(SYNC_KEY) || '{}') || {}; } catch { return {}; }
}
function saveSyncMap(m) {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}
function syncMapKey(collectionId, profileId = state.activeId) { return profileId + '::' + collectionId; }

// Enregistrement de liaison de la collection ({ collectionId, folder, files }), ou null.
export function liaisonDossier(collectionId, profileId = state.activeId) {
  return loadSyncMap()[syncMapKey(collectionId, profileId)] || null;
}

// Lie un dossier à une collection (profil actif) : les fichiers déjà suivis sont
// conservés (re-lier le même dossier ne ré-importe pas tout).
export function lier(dossier, collectionId) {
  const map = loadSyncMap();
  const key = syncMapKey(collectionId);
  map[key] = { collectionId: Number(collectionId), folder: dossier, files: (map[key] && map[key].files) || {} };
  saveSyncMap(map);
}

// Délie le dossier de la collection : supprime l'entrée d'index. Les documents déjà
// importés restent dans la collection (ils ne seront simplement plus synchronisés).
export function delier(collectionId, profileId = state.activeId) {
  const map = loadSyncMap();
  delete map[syncMapKey(collectionId, profileId)];
  saveSyncMap(map);
}

// Retire un document de l'index de synchro (s'il y figure) après une suppression manuelle,
// pour ne pas re-tenter sa suppression ; si le fichier est encore sur le disque, une future
// synchro le considérera comme nouveau et le ré-importera (le dossier reste la référence).
export function purgerDocumentSuivi(collectionId, documentId, profileId = state.activeId) {
  const map = loadSyncMap();
  const rec = map[syncMapKey(collectionId, profileId)];
  if (!rec || !rec.files) return;
  let changed = false;
  for (const p of Object.keys(rec.files)) {
    if (Number(rec.files[p].documentId) === documentId) { delete rec.files[p]; changed = true; }
  }
  if (changed) saveSyncMap(map);
}

// Extrait l'id du document créé, en tolérant les variantes de schéma OpenGateLLM
// (id / document_id, éventuellement imbriqué sous data / data.document).
export function extraireIdDocument(created) {
  if (created == null) return null;
  if (typeof created === 'number') return created;
  const d = created.data || {};
  return (
    created.id ?? created.document_id ??
    d.id ?? d.document_id ?? (d.document && d.document.id) ?? null
  );
}

// Téléverse un fichier vers une collection. PDF/DOCX : extraction du texte EN LOCAL
// (pdf.js/mammoth) puis envoi en .md — contourne le parser PDF d'ILaaS (502). Les formats
// texte partent en direct. Un PDF scanné (sans couche texte) n'est pas importable pour
// l'instant (pas de modèle OCR chez ILaaS — voir roadmap).
export async function televerserFichier(collectionId, path, profileId) {
  const name = String(path).split(/[\\/]/).pop() || 'document';
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf' || ext === 'docx') {
    const raw = await ragApi.readFile(path); // IPC binaire (ArrayBuffer ou Uint8Array)
    const part = raw instanceof ArrayBuffer || ArrayBuffer.isView(raw) ? raw : new Uint8Array(raw);
    const file = new File([part], name);
    let text;
    try {
      text = (await readDocument(file, undefined, { noTruncate: true })).text; // RAG = texte complet
    } catch (e) {
      if (ext === 'pdf') {
        throw new Error('PDF scanné « ' + name + ' » : aucun texte extractible (OCR pas encore disponible).');
      }
      throw e;
    }
    const mdName = name.replace(/\.(pdf|docx)$/i, '') + '.md';
    return await ragApi.uploadText(collectionId, mdName, text, profileId);
  }
  return await ragApi.uploadDocument(collectionId, path, null, profileId);
}

// Compare le dossier lié à l'index et applique les différences (ajout / maj / suppression).
// `profileId` est FIGÉ par l'appelant : toutes les écritures d'index et tous les appels
// réseau ciblent ce profil, même si l'utilisateur change de profil pendant la synchro.
// Callbacks (tous optionnels — la synchro automatique n'en passe aucun = mode silencieux) :
//   onStatus(texte)          — textes d'étape et bilan final (ex-$('ragStatus')) ;
//   onProgress(fait, total)  — avancement fichier par fichier (barre de progression, lot 2) ;
//   onError(texte)           — dossier illisible (le bilan renvoie aussi { error }).
async function syncCollection(collectionId, profileId, { onStatus, onProgress, onError } = {}) {
  const map = loadSyncMap();
  const key = syncMapKey(collectionId, profileId);
  const rec = map[key];
  if (!rec || !rec.folder) return { skipped: true };
  const status = (t) => { if (onStatus) onStatus(t); };

  let entries;
  try {
    status('Analyse du dossier…');
    entries = await ragApi.listDirEntries(rec.folder);
  } catch (e) {
    if (onError) onError('✗ Dossier illisible : ' + describeError(e));
    return { error: describeError(e) };
  }
  // On rattache `files` à l'enregistrement et on sauvegarde APRÈS CHAQUE opération : si
  // l'app se ferme en cours de synchro, les document_id déjà obtenus ne sont pas perdus.
  const files = rec.files || {};
  rec.files = files;
  map[key] = rec;
  const persist = () => saveSyncMap(map);
  const current = new Map(entries.map((e) => [e.path, e]));
  let added = 0, updated = 0, removed = 0, failed = 0;

  // 1) Suppressions : connu de l'index mais disparu du disque → retirer de la collection.
  for (const p of Object.keys(files)) {
    if (current.has(p)) continue;
    const docId = files[p] && files[p].documentId;
    if (docId != null) {
      try { await ragApi.deleteDocument(Number(docId), profileId); } catch { /* déjà absent : on nettoie l'index */ }
    }
    delete files[p];
    removed++;
    persist();
  }

  // 2) Ajouts / modifications (taille ou date changée → suppr + ré-upload).
  const list = [...current.values()];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const known = files[e.path];
    const changed = known && (known.size !== e.size || known.mtime !== e.mtime);
    if (known && !changed) continue; // inchangé → on saute
    status('Synchronisation ' + (i + 1) + '/' + list.length + '…');
    if (onProgress) onProgress(i + 1, list.length);
    try {
      if (changed && known.documentId != null) {
        try { await ragApi.deleteDocument(Number(known.documentId), profileId); } catch { /* ignore */ }
      }
      const created = await televerserFichier(collectionId, e.path, profileId);
      const docId = extraireIdDocument(created);
      files[e.path] = { documentId: docId, size: e.size, mtime: e.mtime };
      persist();
      if (changed) updated++; else added++;
    } catch {
      failed++;
    }
  }

  persist();
  status(
    '✓ Sync : ' + added + ' ajout(s), ' + updated + ' maj, ' + removed + ' retiré(s)' +
    (failed ? ', ' + failed + ' échec(s)' : '') + '.'
  );
  return { added, updated, removed, failed };
}

// Synchronise UNE collection liée (bouton « Synchroniser » / import initial après liaison).
// Verrou global anti-concurrence (partagé avec synchroniserProfil) ; profil FIGÉ au début :
// si l'utilisateur change de profil pendant la synchro, onDone n'est PAS appelé (l'appelant
// ne rafraîchit pas les collections d'un autre profil). Callbacks : ceux de syncCollection
// + onDone(bilan), appelé — verrou encore posé — quand la synchro s'est déroulée sur le
// profil toujours actif (bilan pouvant contenir { skipped } ou { error }, comme avant).
export async function synchroniser(collectionId, { onStatus, onProgress, onDone, onError } = {}) {
  if (syncing) return;
  syncing = true;
  const pid = state.activeId; // profil figé pour toute la synchro
  try {
    const bilan = await syncCollection(collectionId, pid, { onStatus, onProgress, onError });
    if (state.activeId === pid && onDone) await onDone(bilan);
    return bilan;
  } finally {
    syncing = false;
  }
}

// Synchronise en arrière-plan toutes les collections liées du profil actif (option
// « synchro auto »). On abandonne proprement (sans onDone) si l'utilisateur change de
// profil entre-temps. Chaque collection est synchronisée en mode silencieux (aucun
// callback de progression, comme l'ancien opts.silent). Callbacks :
//   onStatus(texte) — annonce de départ (« ↻ Synchronisation automatique… ») ;
//   onDone(touched) — fin sur le même profil ; touched = au moins un ajout/maj/retrait.
export async function synchroniserProfil({ onStatus, onDone } = {}) {
  if (syncing) return; // une synchro (manuelle ou auto) est déjà en cours
  const pid = state.activeId;
  const map = loadSyncMap();
  const prefix = pid + '::';
  const recs = Object.keys(map)
    .filter((k) => k.startsWith(prefix) && map[k] && map[k].folder && map[k].collectionId != null)
    .map((k) => map[k]);
  if (!recs.length) return;
  syncing = true;
  if (onStatus) onStatus('↻ Synchronisation automatique…');
  let touched = false;
  try {
    for (const rec of recs) {
      if (state.activeId !== pid) return; // profil changé : on abandonne
      try {
        const r = await syncCollection(Number(rec.collectionId), pid);
        if (r && (r.added || r.updated || r.removed)) touched = true;
      } catch { /* on continue avec les autres collections */ }
    }
    if (state.activeId !== pid) return;
    if (onDone) await onDone(touched);
  } finally {
    syncing = false;
  }
}
