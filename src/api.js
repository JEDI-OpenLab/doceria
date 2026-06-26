// Client de l'API ILaaS — version NATIVE (Tauri), avec profils au trousseau.
//
// Le frontend ne manipule plus aucune clé : il passe un identifiant de profil
// (`state.activeId`) aux commandes Rust, qui résolvent l'URL (métadonnées du
// profil) et la clé (trousseau OS). Le streaming arrive via l'event `chat://delta`.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { state } from './state.js';

// Renvoie un message lisible ; '__ABORT__' signale une interruption volontaire.
export function describeError(err) {
  if (err && err.name === 'AbortError') return '__ABORT__';
  if (typeof err === 'string') return err;
  return (err && err.message) || 'Erreur inconnue.';
}

/* ---------- Profils (secrets gérés côté Rust / trousseau) ---------- */
// Toutes renvoient le payload { profiles:[{id,name,llmBaseUrl,llmModel,ragBaseUrl,
// hasLlmKey,hasRagKey}], activeId } — jamais la valeur d'une clé.
export const profilesApi = {
  list: () => invoke('list_profiles'),
  upsert: (profile) => invoke('upsert_profile', { profile }),
  remove: (profileId) => invoke('delete_profile', { profileId }),
  setActive: (profileId) => invoke('set_active_profile', { profileId }),
  // Write-only : définit (secret non vide) ou efface (secret vide) la clé d'un rôle.
  setKey: (profileId, role, secret) => invoke('set_profile_key', { profileId, role, secret }),
  // Teste une cible ("llm" | "rag") d'un profil enregistré (clé au trousseau).
  test: (profileId, target) => invoke('test_connection', { profileId, target }),
  // Teste une URL + clé saisies SANS rien persister (validation avant enregistrement).
  testEphemeral: (baseUrl, secret) => invoke('test_connection_ephemeral', { baseUrl, secret }),
};

/* ---------- RAG géré ILaaS (collections + documents + recherche) ---------- */
// Toutes les commandes résolvent l'URL + la clé RAG du profil actif côté Rust.
export const ragApi = {
  me: () => invoke('rag_me', { profileId: state.activeId }),
  listCollections: () => invoke('rag_list_collections', { profileId: state.activeId }),
  createCollection: (name, description) =>
    invoke('rag_create_collection', { profileId: state.activeId, name, description: description || null }),
  deleteCollection: (collectionId) =>
    invoke('rag_delete_collection', { profileId: state.activeId, collectionId }),
  // profileId optionnel : la synchro le fige pour ne jamais cibler le mauvais profil si
  // l'utilisateur change de profil pendant une tâche de fond.
  uploadDocument: (collectionId, filePath, name, profileId) =>
    invoke('rag_upload_document', { profileId: profileId || state.activeId, collectionId, filePath, name: name || null }),
  // Téléverse du texte déjà extrait (PDF/DOCX → texte local → .md), contourne le parser ILaaS.
  uploadText: (collectionId, name, content, profileId) =>
    invoke('rag_upload_text', { profileId: profileId || state.activeId, collectionId, name, content }),
  // Octets bruts d'un fichier local (ArrayBuffer) → pour l'extraction locale PDF/DOCX.
  readFile: (path) => invoke('read_file', { path }),
  getDocument: (documentId) => invoke('rag_get_document', { profileId: state.activeId, documentId }),
  listDocuments: (collectionId) => invoke('rag_list_documents', { profileId: state.activeId, collectionId }),
  deleteDocument: (documentId, profileId) =>
    invoke('rag_delete_document', { profileId: profileId || state.activeId, documentId }),
  search: (collectionIds, query, limit, method, scoreThreshold) =>
    invoke('rag_search', {
      profileId: state.activeId,
      collectionIds,
      query,
      limit: limit || null,
      method: method || null,
      scoreThreshold: typeof scoreThreshold === 'number' && scoreThreshold > 0 ? scoreThreshold : null,
    }),
  rerank: (query, documents, topN) =>
    invoke('rag_rerank', {
      profileId: state.activeId,
      query,
      documents,
      topN: typeof topN === 'number' && topN > 0 ? topN : null,
    }),
  listDirFiles: (dirPath) => invoke('list_dir_files', { dirPath }),
  listDirEntries: (dirPath) => invoke('list_dir_entries', { dirPath }),
  // Dialogues natifs (renvoient des chemins, jamais le contenu).
  pickFiles: () => open({ multiple: true, directory: false }),
  pickFolder: () => open({ multiple: false, directory: true }),
};

// Glisser-déposer natif de fichiers sur la fenêtre (events cœur Tauri v2).
// Les payloads « drag » fournissent des CHEMINS (paths), jamais le contenu.
export const dragDrop = {
  onEnter: (cb) => listen('tauri://drag-enter', cb),
  onOver: (cb) => listen('tauri://drag-over', cb),
  onLeave: (cb) => listen('tauri://drag-leave', cb),
  onDrop: (cb) => listen('tauri://drag-drop', cb),
};

// Mise à jour : vérifie la dernière release GitHub (réseau en Rust). openUrl ouvre le .dmg.
export const updater = {
  check: () => invoke('check_update'),
  openUrl: (url) => invoke('open_url', { url }),
};

// Consommation / coût : agrège GET /me/usage côté Rust pour un rôle (« llm » | « rag »).
export const usageApi = {
  fetch: (role) => invoke('fetch_usage', { profileId: state.activeId, role }),
};

export async function listModels() {
  if (!state.activeId) throw 'Aucun profil actif.';
  return await invoke('list_models', { profileId: state.activeId });
}

// Envoie une requête de chat en streaming. Appelle onDelta(chunk) au fil de l'eau.
// Renvoie { text, usage }. Lance une erreur (AbortError si le signal est annulé).
export async function streamChat({ messages, signal, onDelta, model }) {
  if (!state.activeId) throw 'Aucun profil actif.';
  const requestId =
    (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) ||
    String(Date.now()) + Math.random().toString(16).slice(2);

  const unlisten = await listen('chat://delta', (event) => {
    const p = event.payload;
    if (p && p.requestId === requestId) onDelta(p.content);
  });

  const abort = () => {
    invoke('cancel_chat', { requestId }).catch(() => {});
  };
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }

  try {
    const res = await invoke('chat', {
      req: {
        profileId: state.activeId,
        model: model || state.model,
        temperature: state.temp,
        maxTokens: state.maxTokens,
        messages,
        requestId,
      },
    });
    return { text: res.text, usage: res.usage };
  } catch (err) {
    if (signal && signal.aborted) {
      const e = new Error('Interrompu');
      e.name = 'AbortError';
      throw e;
    }
    throw err;
  } finally {
    unlisten();
    if (signal) signal.removeEventListener('abort', abort);
  }
}
