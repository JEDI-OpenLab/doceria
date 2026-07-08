// Fenêtre Réglages (refonte « Continuité »).
//  - Lot 1  : squelette + preuve de synchro (thème).
//  - Lot 2a-i : onglet Connexion (profils ILaaS) — pilote la MÊME logique que le rail
//    via les services extraits (services/profiles.js) + le bus (src/bus.js).
//
// Doctrine (cf. bus.js) : cette fenêtre exécute ses mutations elle-même (backend Rust
// autoritaire, clés → invoke direct vers le trousseau) puis ANNONCE ; la fenêtre
// principale rejoue la cascade (chargement des modèles, RAG, explorateur) dans SON DOM.
// Les verrous (chat/synchro) naissent dans la principale et arrivent par le bus.

import './tokens.css';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { applyTheme, initTheme, themeMode, setThemeMode } from './theme.js';
import {
  annoncerReglage, surReglage, surVerrou, signalerReglagesPret,
} from './bus.js';
import { state, activeProfile, activeMoodleProfile, loadSettings, saveSettings } from './state.js';
import { profilesApi, moodleApi, usageApi, updater, describeError } from './api.js';
import {
  sauvegarderProfil, testerConnexion, supprimerProfil, activerProfil,
} from './services/profiles.js';
import {
  sauvegarderConnexionMoodle, testerConnexionMoodle, supprimerConnexionMoodle, activerConnexionMoodle,
} from './services/moodleconf.js';
import {
  chargerPresets, enregistrerPreset, appliquerPreset, supprimerPreset,
} from './services/presets.js';

const $ = (id) => document.getElementById(id);

// Thème appliqué au plus tôt (évite le flash), + suivi du mode auto système.
initTheme(null);

// Charge les réglages persistés (blob localStorage `ilaas_portal`, partagé entre fenêtres)
// dans NOTRE miroir state AVANT toute hydratation/écriture. Indispensable : sinon les champs
// Avancé afficheraient les défauts et une écriture écraserait les vrais réglages (relecture-
// avant-écriture, cf. bus.js). Réappelé à chaque annonce 'gen'.
loadSettings();

let editingId = null; // id du profil en cours d'édition (null = création)
let lock = { busy: false, moodleSyncing: false }; // verrous diffusés par la principale

/* ===================== Onglets ===================== */
function selectTab(name) {
  document.querySelectorAll('.tab').forEach((t) => {
    t.setAttribute('aria-selected', t.dataset.tab === name ? 'true' : 'false');
  });
  document.querySelectorAll('.tabpane').forEach((p) => {
    p.classList.toggle('on', p.id === 'tab-' + name);
  });
}
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => selectTab(t.dataset.tab));
});

/* ===================== Apparence (thème) ===================== */
const choix = $('themeChoice');
function reflectTheme() {
  const mode = themeMode();
  choix.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-pressed', b.dataset.mode === mode ? 'true' : 'false');
  });
}
choix.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  setThemeMode(btn.dataset.mode); // persiste (doceria_theme) + applique ICI
  reflectTheme();
  annoncerReglage('theme', 'settings'); // la principale relit + resynchronise son bouton
});
reflectTheme();

/* ===================== Connexion — profils ILaaS ===================== */
const locked = () => lock.busy || lock.moodleSyncing;
function setStatus(msg) { $('rgConnStatus').textContent = msg || ''; }

// Recharge le miroir des profils depuis le backend (source de vérité) puis rend.
async function refetchProfiles() {
  try {
    const payload = await profilesApi.list();
    state.profiles = payload.profiles || [];
    state.activeId = payload.activeId || state.profiles[0]?.id || null;
    // Si l'éditeur est ouvert sur un profil EXISTANT qui vient de disparaître (supprimé
    // depuis le rail), on le referme : « Enregistrer » recréerait sinon un profil fantôme
    // sans clé (upsert.push). editingId=null (création d'un nouveau profil) n'est pas concerné.
    if (editingId && !state.profiles.some((p) => p.id === editingId)) {
      closeEditor();
      setStatus('Le profil en cours d’édition a été supprimé ailleurs — éditeur fermé.');
    }
    renderProfiles();
    resetUsage(); // la conso affichée dépend du profil (parité : applyActiveProfile au rail)
  } catch (err) {
    setStatus('✗ ' + describeError(err));
  }
}

function renderProfiles() {
  const sel = $('rgProfileSelect');
  sel.innerHTML = '';
  const has = state.profiles.length > 0;
  const dis = locked();
  $('rgProfileNew').disabled = dis;
  $('rgProfileEdit').disabled = !has || dis;
  $('rgProfileDelete').disabled = !has || dis;
  $('rgLoadModels').disabled = !has || dis;
  // Conso : grisé si aucun profil (contrat #101) OU récupération en vol (renderProfiles est
  // rappelé par renderLock à chaque verrou publié — il ne doit pas ré-armer le bouton).
  $('rgUsageRefresh').disabled = !has || usageBusy;
  if (!has) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = '— aucun profil —'; o.disabled = true; o.selected = true;
    sel.appendChild(o);
    sel.disabled = true;
    return;
  }
  sel.disabled = dis;
  for (const p of state.profiles) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name + (p.hasLlmKey ? '' : ' — clé manquante');
    sel.appendChild(o);
  }
  sel.value = state.activeId || state.profiles[0].id;
}

// Remplit le menu « Modèle par défaut » (liste récupérée au test de la clé) — garde
// toujours au moins une option pour que l'enregistrement marche sans avoir testé.
function setProfileModelOptions(list, selected) {
  const sel = $('rgPfLlmModel');
  sel.innerHTML = '';
  const opts = Array.isArray(list) ? list.slice() : [];
  if (selected && !opts.includes(selected)) opts.unshift(selected);
  if (!opts.length) opts.push('mistral-medium-latest');
  for (const id of opts) {
    const o = document.createElement('option');
    o.value = id; o.textContent = id;
    sel.appendChild(o);
  }
  sel.value = selected && opts.includes(selected) ? selected : opts[0];
}

function openEditor(forNew) {
  const p = forNew ? null : activeProfile();
  editingId = forNew ? null : (p ? p.id : null);
  $('rgPfName').value = p ? p.name : '';
  $('rgPfLlmUrl').value = p ? p.llmBaseUrl : 'https://llm.ilaas.fr/v1';
  setProfileModelOptions([], p ? p.llmModel : 'mistral-medium-latest');
  $('rgPfRagUrl').value = p && p.ragBaseUrl ? p.ragBaseUrl : 'https://rag-api.ilaas.fr/v1';
  $('rgPfLlmKey').value = '';
  $('rgPfRagKey').value = '';
  $('rgPfLlmKeyHint').textContent =
    (p && p.hasLlmKey ? 'clé définie — laisser vide pour la conserver. ' : 'aucune clé enregistrée. ') +
    'Teste pour récupérer les modèles.';
  $('rgPfRagKeyHint').textContent = p && p.hasRagKey ? 'clé définie — laisser vide pour la conserver' : 'aucune clé enregistrée';
  $('rgProfileEditor').hidden = false;
}

function closeEditor() {
  // Ne jamais laisser une clé saisie traîner dans le DOM après fermeture/annulation.
  $('rgPfLlmKey').value = '';
  $('rgPfRagKey').value = '';
  $('rgProfileEditor').hidden = true;
  editingId = null;
}

// Persiste le profil (métadonnées) + les clés saisies (write-only, trousseau). Renvoie
// l'id. Les champs clé sont vidés dans tous les cas (finally), même en cas d'échec.
async function saveProfileFromEditor() {
  try {
    const profil = await sauvegarderProfil(
      {
        id: editingId,
        name: $('rgPfName').value,
        llmUrl: $('rgPfLlmUrl').value,
        model: $('rgPfLlmModel').value,
        ragUrl: $('rgPfRagUrl').value,
        llmKey: $('rgPfLlmKey').value,
        ragKey: $('rgPfRagKey').value,
      },
      { onUpsert: (id) => { editingId = id; } }
    );
    return profil.id;
  } finally {
    $('rgPfLlmKey').value = '';
    $('rgPfRagKey').value = '';
  }
}

async function onSaveProfile() {
  if (locked()) return;
  try {
    const id = await saveProfileFromEditor();
    await activerProfil(id); // setActive : renvoie le payload complet
    closeEditor();
    renderProfiles();
    resetUsage();
    setStatus('✓ profil enregistré.');
    annoncerReglage('profils', 'settings'); // la principale rejoue la cascade (modèles, RAG…)
  } catch (err) {
    setStatus('✗ ' + describeError(err));
  }
}

// Teste SANS persister : URL + clé saisies (éphémère) ; sinon teste le profil enregistré.
async function onTestProfile(target) {
  const hint = target === 'llm' ? $('rgPfLlmKeyHint') : $('rgPfRagKeyHint');
  const url = (target === 'llm' ? $('rgPfLlmUrl') : $('rgPfRagUrl')).value.trim();
  const key = (target === 'llm' ? $('rgPfLlmKey') : $('rgPfRagKey')).value.trim();
  if (!url) { hint.textContent = '✗ URL manquante.'; return; }
  hint.textContent = 'test en cours…';
  try {
    const models = await testerConnexion({ url, key, profileId: editingId, target });
    if (!models) { hint.textContent = '✗ Saisis une clé pour tester.'; return; }
    hint.textContent = '✓ connexion OK — ' + models.length + ' modèles disponibles';
    if (target === 'llm') setProfileModelOptions(models, $('rgPfLlmModel').value);
  } catch (err) {
    hint.textContent = '✗ ' + describeError(err);
  }
}

async function onDeleteProfile() {
  if (locked()) return;
  const p = activeProfile();
  if (!p) return;
  if (!window.confirm('Supprimer le profil « ' + p.name + ' » et ses clés du trousseau ? Action définitive.')) return;
  try {
    await supprimerProfil(p.id);
    closeEditor();
    renderProfiles();
    resetUsage();
    setStatus('✓ profil supprimé.');
    annoncerReglage('profils', 'settings');
  } catch (err) {
    setStatus('✗ ' + describeError(err));
  }
}

async function onSwitchProfile(id) {
  if (locked() || !id || id === state.activeId) { renderProfiles(); return; }
  try {
    await activerProfil(id);
    renderProfiles();
    resetUsage();
    setStatus('');
    annoncerReglage('profils', 'settings');
  } catch (err) {
    setStatus('✗ ' + describeError(err));
  }
}

// « Charger les modèles » : l'effet (sélecteurs + statut de connexion) vit dans la
// principale ; on lui délègue l'action via le bus.
function onLoadModels() {
  if (locked()) return;
  annoncerReglage('modeles', 'settings');
  setStatus('↻ Chargement des modèles demandé…');
}

/* ---- Câblage des contrôles Connexion ---- */
$('rgProfileSelect').addEventListener('change', (e) => onSwitchProfile(e.target.value));
$('rgProfileNew').addEventListener('click', () => { if (!locked()) openEditor(true); });
$('rgProfileEdit').addEventListener('click', () => { if (!locked()) openEditor(false); });
$('rgProfileDelete').addEventListener('click', onDeleteProfile);
$('rgLoadModels').addEventListener('click', onLoadModels);
$('rgPfSave').addEventListener('click', onSaveProfile);
$('rgPfCancel').addEventListener('click', closeEditor);
$('rgPfLlmTest').addEventListener('click', () => onTestProfile('llm'));
$('rgPfRagTest').addEventListener('click', () => onTestProfile('rag'));
// Auto-test au collage de la clé LLM (convenience, contrat #24) — sans écraser une saisie vide.
$('rgPfLlmKey').addEventListener('change', () => { if ($('rgPfLlmKey').value.trim()) onTestProfile('llm'); });

/* ===================== Moodle — connexions ===================== */
// Jumeau structurel de la Connexion : mutations via services/moodleconf.js (jeton → invoke
// direct trousseau, jamais sur le bus) + annonce ; la principale rejoue via refreshMoodleProfiles.
let moodleEditingId = null;
function setMoodleStatus(msg) { $('rgMoodleStatus').textContent = msg || ''; }

async function refetchMoodle() {
  try {
    const payload = await moodleApi.list();
    state.moodleProfiles = payload.profiles || [];
    state.activeMoodleId = payload.activeId || state.moodleProfiles[0]?.id || null;
    // Anti-résurrection : si l'éditeur porte une connexion EXISTANTE disparue ailleurs, on ferme.
    if (moodleEditingId && !state.moodleProfiles.some((p) => p.id === moodleEditingId)) {
      closeMoodleEditor();
      setMoodleStatus('La connexion en cours d’édition a été supprimée ailleurs — éditeur fermé.');
    }
    renderMoodle();
  } catch (err) {
    setMoodleStatus('✗ ' + describeError(err));
  }
}

function renderMoodle() {
  const sel = $('rgMoodleSelect');
  sel.innerHTML = '';
  const has = state.moodleProfiles.length > 0;
  const dis = locked();
  $('rgMoodleNew').disabled = dis;
  $('rgMoodleEdit').disabled = !has || dis;
  $('rgMoodleDelete').disabled = !has || dis;
  if (!has) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = '— aucune connexion —'; o.disabled = true; o.selected = true;
    sel.appendChild(o);
    sel.disabled = true;
  } else {
    sel.disabled = dis;
    for (const p of state.moodleProfiles) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name + (p.hasMoodleToken ? '' : ' — jeton manquant');
      sel.appendChild(o);
    }
    sel.value = state.activeMoodleId || state.moodleProfiles[0].id;
  }
  $('rgMoodleHint').hidden = has;
  renderMoodleCoursesBox();
}

// Affiche/masque la zone « cours à indexer » + son résumé (compte lu depuis les métadonnées
// de la connexion active — aucune requête réseau ici).
function renderMoodleCoursesBox() {
  const p = activeMoodleProfile();
  const box = $('rgMoodleCoursesBox');
  if (p && p.hasMoodleToken) {
    box.hidden = false;
    const n = (p.courseIds || []).length;
    $('rgMoodleCoursesHint').textContent = n
      ? n + ' cours sélectionné' + (n > 1 ? 's' : '') + '. « Gérer les cours… » pour modifier.'
      : 'Aucun cours sélectionné. « Gérer les cours… » pour choisir.';
    $('rgMoodleOpenExplorer').disabled = locked();
  } else {
    box.hidden = true;
  }
}

function openMoodleEditor(forNew) {
  const p = forNew ? null : activeMoodleProfile();
  moodleEditingId = forNew ? null : (p ? p.id : null);
  $('rgMoName').value = p ? p.name : '';
  $('rgMoUrl').value = p ? p.moodleBaseUrl : '';
  $('rgMoToken').value = '';
  $('rgMoTokenHint').textContent = p && p.hasMoodleToken
    ? 'jeton défini — laisser vide pour le conserver.'
    : 'stocké au trousseau du système — jamais en clair, jamais affiché.';
  $('rgMoTestHint').textContent = '';
  $('rgMoodleEditor').hidden = false;
}

function closeMoodleEditor() {
  // Ne jamais laisser le jeton saisi traîner dans le DOM après fermeture/annulation.
  $('rgMoToken').value = '';
  $('rgMoTestHint').textContent = '';
  $('rgMoodleEditor').hidden = true;
  moodleEditingId = null;
}

async function saveMoodleFromEditor() {
  try {
    const profil = await sauvegarderConnexionMoodle(
      { id: moodleEditingId, name: $('rgMoName').value, url: $('rgMoUrl').value, token: $('rgMoToken').value },
      { onUpsert: (id) => { moodleEditingId = id; } }
    );
    return profil.id;
  } finally {
    $('rgMoToken').value = '';
  }
}

async function onSaveMoodle() {
  if (locked()) return;
  const url = $('rgMoUrl').value.trim();
  if (!/^https?:\/\//.test(url)) { setMoodleStatus('✗ L’URL Moodle doit commencer par http:// ou https://.'); return; }
  try {
    const id = await saveMoodleFromEditor();
    await activerConnexionMoodle(id);
    closeMoodleEditor();
    renderMoodle();
    setMoodleStatus('✓ connexion enregistrée.');
    annoncerReglage('moodle', 'settings');
  } catch (err) {
    setMoodleStatus('✗ ' + describeError(err));
  }
}

// Test de connexion Moodle : diagnostic complet (site, compte, version, téléchargement, fonctions).
async function onTestMoodle() {
  const hint = $('rgMoTestHint');
  const url = $('rgMoUrl').value.trim();
  const token = $('rgMoToken').value.trim();
  if (!url) { hint.textContent = '✗ URL manquante.'; return; }
  hint.textContent = 'test en cours…';
  try {
    const { info, testeSurProfil } = await testerConnexionMoodle({ url, token, profileId: moodleEditingId });
    if (testeSurProfil) { hint.textContent = '✗ Colle le jeton pour tester.'; return; }
    if (!info) { hint.textContent = '✗ Colle le jeton pour tester.'; return; }
    const dl = info.downloadFiles ? 'téléchargement fichiers OK' : '⚠ télécharg. fichiers désactivé';
    const fx = (info.missingFunctions && info.missingFunctions.length)
      ? '⚠ fonctions manquantes : ' + info.missingFunctions.join(', ')
      : '8 fonctions OK';
    hint.textContent = '✓ ' + (info.sitename || 'Moodle') + ' — ' + info.username
      + ' · Moodle ' + info.release + ' · ' + dl + ' · ' + fx;
  } catch (err) {
    hint.textContent = '✗ ' + describeError(err);
  }
}

async function onDeleteMoodle() {
  if (locked()) return;
  const p = activeMoodleProfile();
  if (!p) return;
  if (!window.confirm('Supprimer la connexion Moodle « ' + p.name + ' » et son jeton du trousseau ? Action définitive.')) return;
  try {
    await supprimerConnexionMoodle(p.id);
    closeMoodleEditor();
    renderMoodle();
    setMoodleStatus('✓ connexion supprimée.');
    annoncerReglage('moodle', 'settings');
  } catch (err) {
    setMoodleStatus('✗ ' + describeError(err));
  }
}

async function onSwitchMoodle(id) {
  if (locked() || !id || id === state.activeMoodleId) { renderMoodle(); return; }
  try {
    await activerConnexionMoodle(id);
    renderMoodle();
    setMoodleStatus('');
    annoncerReglage('moodle', 'settings');
  } catch (err) {
    setMoodleStatus('✗ ' + describeError(err));
  }
}

// « Gérer les cours… » : l'explorateur central vit dans la fenêtre principale ; on lui délègue
// l'ouverture via le bus (elle se met au premier plan).
function onOpenExplorer() {
  if (locked()) return;
  const p = activeMoodleProfile();
  if (!p || !p.hasMoodleToken) { setMoodleStatus('Ajoute d’abord une connexion avec un jeton valide.'); return; }
  annoncerReglage('moodle-explorer', 'settings');
}

/* ---- Câblage des contrôles Moodle ---- */
$('rgMoodleSelect').addEventListener('change', (e) => onSwitchMoodle(e.target.value));
$('rgMoodleNew').addEventListener('click', () => { if (!locked()) openMoodleEditor(true); });
$('rgMoodleEdit').addEventListener('click', () => { if (!locked()) openMoodleEditor(false); });
$('rgMoodleDelete').addEventListener('click', onDeleteMoodle);
$('rgMoSave').addEventListener('click', onSaveMoodle);
$('rgMoCancel').addEventListener('click', closeMoodleEditor);
$('rgMoTest').addEventListener('click', onTestMoodle);
$('rgMoodleOpenExplorer').addEventListener('click', onOpenExplorer);

/* ===================== Avancé — génération + consigne système ===================== */
// Réglages PERSISTÉS dans le blob partagé : input → met à jour l'état (+ affichage) ; change →
// persiste ET annonce 'gen' ; la principale relit le blob et ré-hydrate ses champs (et inversement).
let sysHintTimer = null;

// N'écrit la valeur QUE si le champ n'a pas le focus : une ré-hydratation déclenchée par l'autre
// fenêtre ne doit pas écraser une saisie en cours (revue lot 2b-i — deux WKWebViews = deux
// documents, changer de fenêtre ne déclenche PAS le blur/change du champ dans l'autre).
// Revue 2b-ii : un <input type=range> ne PREND PAS le focus au clic/drag sous WKWebView
// (activeElement reste body) → on suit aussi le drag en cours (pointerdown → pointerup),
// sinon une annonce 'gen' asynchrone (ex. fin de « Charger les modèles ») écraserait le drag.
let rangeEnCours = null;
document.addEventListener('pointerdown', (e) => {
  if (e.target && e.target.matches && e.target.matches('input[type="range"]')) rangeEnCours = e.target;
}, true);
window.addEventListener('pointerup', () => { rangeEnCours = null; }, true);
window.addEventListener('pointercancel', () => { rangeEnCours = null; }, true);

function setFieldValue(id, value) {
  const el = $(id);
  if (el && el !== document.activeElement && el !== rangeEnCours) el.value = value;
}
function setCheckValue(id, value) {
  const el = $(id);
  if (el && el !== document.activeElement) el.checked = value;
}

function hydrateAvance() {
  setFieldValue('rgTemp', state.temp);
  $('rgTempVal').textContent = Number(state.temp).toFixed(2);
  setFieldValue('rgMaxTokens', state.maxTokens);
  setFieldValue('rgMemoryTurns', state.memoryTurns);
  setFieldValue('rgSysPrompt', state.sys);
}

function flashSysHint(msg) {
  const h = $('rgSysHint');
  h.textContent = msg;
  clearTimeout(sysHintTimer);
  sysHintTimer = setTimeout(() => {
    h.textContent = 'Appliquée automatiquement à chaque message envoyé.';
  }, 2600);
}

function renderSysPresets() {
  const sel = $('rgSysPresetSelect');
  const prev = sel.value; // préserve la sélection (une annonce 'presets' ne doit pas la vider → Suppr. no-op)
  const presets = chargerPresets();
  sel.innerHTML = '';
  const o0 = document.createElement('option');
  o0.value = '';
  o0.textContent = presets.length ? '— charger un modèle —' : '— aucun modèle enregistré —';
  sel.appendChild(o0);
  for (const p of presets) {
    const o = document.createElement('option');
    o.value = p.name; o.textContent = p.name;
    sel.appendChild(o);
  }
  if (prev && presets.some((p) => p.name === prev)) sel.value = prev;
}

// RELECTURE-AVANT-ÉCRITURE (revue lot 2b-i, clobber HIGH). Le blob `ilaas_portal` contient AUSSI
// des champs que seule la principale édite (RAG, modèle, consentement moodleEnrolledOnly) et qui
// n'annoncent PAS 'gen'. Écrire tout le blob depuis un miroir périmé les ferait régresser. On
// relit donc le blob JUSTE avant d'écrire, puis on ré-applique le seul réglage Avancé modifié ici.
function commitGen(apply) {
  loadSettings();  // récupère les changements des autres fenêtres (RAG, modèle, moodleEnrolledOnly…)
  apply();         // ré-applique le réglage Avancé modifié ICI (relit le DOM, pas le miroir périmé)
  saveSettings();  // écrit le blob complet SANS écraser les champs non-Avancé
  annoncerReglage('gen', 'settings');
}

$('rgTemp').addEventListener('input', (e) => {
  state.temp = parseFloat(e.target.value);
  $('rgTempVal').textContent = state.temp.toFixed(2);
});
$('rgTemp').addEventListener('change', () => commitGen(() => { state.temp = parseFloat($('rgTemp').value); }));
$('rgMaxTokens').addEventListener('input', (e) => { state.maxTokens = parseInt(e.target.value, 10) || 1024; });
$('rgMaxTokens').addEventListener('change', () => commitGen(() => { state.maxTokens = parseInt($('rgMaxTokens').value, 10) || 1024; }));
$('rgMemoryTurns').addEventListener('input', (e) => { state.memoryTurns = Math.max(0, parseInt(e.target.value, 10) || 0); });
$('rgMemoryTurns').addEventListener('change', () => commitGen(() => { state.memoryTurns = Math.max(0, parseInt($('rgMemoryTurns').value, 10) || 0); }));
$('rgSysPrompt').addEventListener('input', (e) => { state.sys = e.target.value; });
$('rgSysPrompt').addEventListener('change', () => { commitGen(() => { state.sys = $('rgSysPrompt').value; }); flashSysHint('✓ consigne enregistrée et appliquée.'); });

$('rgSysPresetSelect').addEventListener('change', (e) => {
  const name = e.target.value;
  if (!name) return;
  loadSettings();                  // relecture-avant-écriture : appliquerPreset va persister le blob
  const p = appliquerPreset(name); // met state.sys + saveSettings (blob)
  if (!p) return;
  $('rgSysPrompt').value = p.text;
  annoncerReglage('gen', 'settings'); // la consigne a changé → la principale ré-hydrate
  flashSysHint('✓ « ' + name + ' » chargée et appliquée.');
});
$('rgSysPresetSave').addEventListener('click', () => {
  const name = $('rgSysPresetName').value.trim();
  if (!name) { $('rgSysPresetName').focus(); return; }
  enregistrerPreset(name, $('rgSysPrompt').value);
  $('rgSysPresetName').value = '';
  renderSysPresets();
  $('rgSysPresetSelect').value = name;
  annoncerReglage('presets', 'settings'); // la LISTE des modèles a changé
  flashSysHint('✓ modèle « ' + name + ' » enregistré.');
});
$('rgSysPresetDelete').addEventListener('click', () => {
  const name = $('rgSysPresetSelect').value;
  if (!name) return;
  supprimerPreset(name);
  renderSysPresets();
  annoncerReglage('presets', 'settings');
  flashSysHint('Modèle supprimé.');
});

/* ===================== Bibliothèque — réglages RAG (blob partagé) ===================== */
// Mêmes réglages que le rail (double surface) : chaque change → commitGen (relecture-avant-
// écriture) → annonce 'gen' → le rail relit et ré-hydrate ses contrôles (et inversement).
const RAG_REFUSAL_DEFAUT = 'Je ne trouve pas la réponse dans la bibliothèque.';

function hydrateBiblio() {
  setFieldValue('rgRagMethod', state.ragMethod);
  setFieldValue('rgRagTopK', state.ragTopK);
  $('rgRagTopKVal').textContent = state.ragTopK;
  setFieldValue('rgRagThreshold', state.ragThreshold);
  $('rgRagThresholdVal').textContent =
    state.ragThreshold > 0 ? Number(state.ragThreshold).toFixed(2) : 'désactivé';
  setCheckValue('rgRagRerank', state.ragRerank);
  setFieldValue('rgRagRefusal', state.ragRefusal);
  setCheckValue('rgRagAutoSync', state.ragAutoSync);
}

$('rgRagMethod').addEventListener('change', () =>
  commitGen(() => { state.ragMethod = $('rgRagMethod').value; }));
$('rgRagTopK').addEventListener('input', (e) => {
  state.ragTopK = parseInt(e.target.value, 10) || 5;
  $('rgRagTopKVal').textContent = state.ragTopK;
});
$('rgRagTopK').addEventListener('change', () =>
  commitGen(() => { state.ragTopK = parseInt($('rgRagTopK').value, 10) || 5; }));
$('rgRagThreshold').addEventListener('input', (e) => {
  state.ragThreshold = parseFloat(e.target.value) || 0;
  $('rgRagThresholdVal').textContent =
    state.ragThreshold > 0 ? state.ragThreshold.toFixed(2) : 'désactivé';
});
$('rgRagThreshold').addEventListener('change', () =>
  commitGen(() => { state.ragThreshold = parseFloat($('rgRagThreshold').value) || 0; }));
$('rgRagRerank').addEventListener('change', () =>
  commitGen(() => { state.ragRerank = $('rgRagRerank').checked; }));
$('rgRagRefusal').addEventListener('change', () =>
  commitGen(() => {
    // Champ vidé → texte par défaut (le mode Requête a toujours un refus) — parité rail.
    let v = $('rgRagRefusal').value;
    if (!v.trim()) { v = RAG_REFUSAL_DEFAUT; $('rgRagRefusal').value = v; }
    state.ragRefusal = v;
  }));
$('rgRagAutoSync').addEventListener('change', () =>
  commitGen(() => { state.ragAutoSync = $('rgRagAutoSync').checked; }));

/* ===================== Général — consommation & mises à jour ===================== */
function resetUsage() {
  const box = $('rgUsageOut');
  box.hidden = true;
  box.innerHTML = '';
  $('rgUsageHint').textContent = 'Inférence (+ RAG si configuré). Clique pour récupérer.';
}

// Affiche l'agrégat (même calcul/format que ui.renderUsage de la principale).
function renderUsageRows(parts) {
  const box = $('rgUsageOut');
  box.innerHTML = '';
  const sum = (k) => parts.reduce((a, p) => a + (Number(p[k]) || 0), 0);
  const tin = sum('promptTokens');
  const tout = sum('completionTokens');
  const ttot = sum('totalTokens') || tin + tout;
  const n = (x) => Number(x).toLocaleString('fr-FR');
  const money = (x) => Number(x).toLocaleString('fr-FR', { maximumFractionDigits: 4 });
  const co2 = sum('co2g');
  const co2fmt = (g) => (g >= 1000
    ? (g / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' kg'
    : Math.round(g).toLocaleString('fr-FR') + ' g');
  const row = (label, val, cls) => {
    const r = document.createElement('div');
    r.className = 'usage-row' + (cls ? ' ' + cls : '');
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('span');
    v.textContent = val;
    r.appendChild(l); r.appendChild(v);
    box.appendChild(r);
  };
  row('Requêtes', n(sum('requests')));
  row('Tokens entrée', n(tin));
  row('Tokens sortie', n(tout));
  row('Tokens total', n(ttot));
  row('Coût cumulé', money(sum('cost')), 'u-total');
  if (co2 > 0) row('CO₂ estimé', co2fmt(co2));
  if (parts.length > 1) {
    const sub = document.createElement('div');
    sub.className = 'usage-sub';
    sub.textContent = parts
      .map((p) => (p.role === 'rag' ? 'RAG' : 'Inférence') + ' : '
        + n(Number(p.totalTokens) || (Number(p.promptTokens) + Number(p.completionTokens))) + ' tok · ' + money(p.cost))
      .join('  ·  ');
    box.appendChild(sub);
  }
  box.hidden = false;
}

let usageBusy = false; // récupération en vol (protège le bouton des re-rendus de renderProfiles)

async function onUsageRefresh() {
  if (usageBusy) return;
  const p = activeProfile();
  if (!p) { $('rgUsageHint').textContent = 'Sélectionne d’abord un profil.'; return; }
  const pid = state.activeId; // si le profil change pendant la requête, le résultat est périmé
  usageBusy = true;
  $('rgUsageRefresh').disabled = true;
  $('rgUsageHint').textContent = 'Récupération…';
  try {
    const parts = [];
    const llm = await usageApi.fetch('llm').catch(() => null);
    if (llm) parts.push(llm);
    if (p.ragBaseUrl && p.hasRagKey) {
      const rag = await usageApi.fetch('rag').catch(() => null);
      if (rag) parts.push(rag);
    }
    if (state.activeId !== pid) return; // profil changé en vol : on jette (resetUsage a déjà nettoyé)
    if (!parts.length) {
      $('rgUsageHint').textContent = '✗ Consommation indisponible (l’endpoint /me/usage a peut-être échoué).';
      return;
    }
    renderUsageRows(parts);
    $('rgUsageHint').textContent = '≈ 30 derniers jours · coût cumulé (l’API n’expose pas de quota restant).';
  } catch (e) {
    if (state.activeId === pid) $('rgUsageHint').textContent = '✗ ' + describeError(e);
  } finally {
    usageBusy = false;
    $('rgUsageRefresh').disabled = state.profiles.length === 0;
  }
}
$('rgUsageRefresh').addEventListener('click', onUsageRefresh);

// Compare deux versions « x.y.z » : > 0 si a est plus récente que b (copie de main.js).
function compareVersions(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

// « Vérifier les mises à jour » : vérification MANUELLE (contrat #44 — EN PLUS du bandeau
// automatique de la fenêtre principale, jamais à sa place). Affiche aussi « à jour ».
async function onUpdateCheck() {
  const btn = $('rgUpdateCheck');
  const hint = $('rgUpdateHint');
  btn.disabled = true;
  $('rgUpdateRow').hidden = true;
  hint.textContent = 'Vérification…';
  try {
    const info = await updater.check();
    if (!info || !info.latest || !info.current) {
      hint.textContent = '✗ Vérification indisponible (hors-ligne ou pas de version publiée).';
      return;
    }
    if (compareVersions(info.latest, info.current) <= 0) {
      hint.textContent = '✓ Doceria est à jour (version ' + info.current + ').';
      return;
    }
    hint.textContent = 'Nouvelle version ' + info.latest + ' disponible (vous avez ' + info.current + ').';
    const url = info.dmgUrl || info.htmlUrl;
    if (url) {
      $('rgUpdateGet').onclick = () => updater.openUrl(url);
      $('rgUpdateRow').hidden = false;
    }
  } catch (e) {
    hint.textContent = '✗ ' + describeError(e);
  } finally {
    btn.disabled = false;
  }
}
$('rgUpdateCheck').addEventListener('click', onUpdateCheck);

/* ---- Bannière de verrou (Connexion + Moodle) ---- */
function lockBannerText() {
  if (lock.moodleSyncing) return 'Synchronisation Moodle en cours — les réglages de connexion sont momentanément verrouillés.';
  if (lock.busy) return 'Génération en cours — les réglages de connexion sont momentanément verrouillés.';
  return '';
}
function renderLock() {
  const txt = lockBannerText();
  for (const id of ['rgLockBanner', 'rgMoodleLockBanner']) {
    const b = $(id);
    if (!b) continue;
    b.textContent = txt;
    b.classList.toggle('on', !!txt);
  }
  renderProfiles(); // reflète l'état grisé (Connexion)
  renderMoodle();   // reflète l'état grisé (Moodle)
}

/* ===================== Bus inter-fenêtres ===================== */
surReglage((champ) => {
  if (champ === 'theme') { applyTheme(); reflectTheme(); }
  else if (champ === 'profils') { refetchProfiles(); } // le rail a modifié un profil
  else if (champ === 'moodle') { refetchMoodle(); }    // le rail (ou l'explorateur) a modifié Moodle
  else if (champ === 'gen') { loadSettings(); hydrateAvance(); hydrateBiblio(); } // relit le blob + ré-hydrate
  else if (champ === 'presets') { renderSysPresets(); } // la liste des modèles de consigne a changé
  // 'modeles' / 'moodle-explorer' sont traités par la principale uniquement
}, 'settings');

surVerrou((v) => {
  lock = { busy: !!v.busy, moodleSyncing: !!v.moodleSyncing };
  renderLock();
});

// Sécurité des secrets : la fenêtre Réglages n'est jamais détruite (Rust : prevent_close +
// hide), donc son DOM survit à la « fermeture ». À chaque fermeture (⌘W / bouton rouge), on
// vide les champs clé de l'éditeur (closeEditor) — le contrat exige le vidage sur TOUS les
// chemins, « fermer » compris.
getCurrentWindow().onCloseRequested(() => { closeEditor(); closeMoodleEditor(); });

// Poignée de main : demande à la principale l'état de verrou courant (course au démarrage).
signalerReglagesPret();

// Chargement initial.
refetchProfiles();
refetchMoodle();
hydrateAvance();     // depuis le blob déjà chargé (loadSettings en tête de module)
hydrateBiblio();
renderSysPresets();
