// État global de l'application + persistance légère.
//
// Aucune clé API ne vit côté JS : les secrets sont au trousseau OS (gérés par le
// Rust). Le front ne garde que des métadonnées de profils (miroir du backend) et
// l'identifiant du profil actif. Les réglages de génération non sensibles vont
// en localStorage ; les conversations aussi (migration vers appData en Phase 3).

const SETTINGS_KEY = 'ilaas_portal'; // réglages de génération (localStorage)
const CONVOS_KEY = 'ilaas_conversations';

export const state = {
  // Profils (miroir du backend — AUCUNE clé ici, seulement métadonnées + présence)
  // [{ id, name, llmBaseUrl, llmModel, ragBaseUrl, hasLlmKey, hasRagKey }]
  profiles: [],
  activeId: null,
  // Bibliothèque RAG (collections gérées ILaaS du profil actif ; brut du backend)
  collections: [],
  activeCollectionId: null,
  // Modèles
  models: [],
  model: '',
  // Génération
  temp: 0.3,
  maxTokens: 1024,
  sys: '',
  // Document de contexte (en mémoire uniquement, non persisté)
  doc: { name: '', text: '' },
  // Conversations
  conversations: [], // [{ id, title, messages: [{role, content}], createdAt, updatedAt }]
  currentId: null,
  // Runtime
  busy: false,
};

export function activeProfile() {
  return state.profiles.find((p) => p.id === state.activeId) || null;
}

export function loadSettings() {
  // Migration Phase 1 → 2 : purge toute clé éventuellement laissée par l'ancienne
  // version dans le stockage du webview (la clé vit désormais au trousseau OS).
  try { sessionStorage.removeItem('ilaas_key'); } catch { /* ignore */ }
  try {
    const d = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (d) {
      if (typeof d.temp === 'number') state.temp = d.temp;
      if (typeof d.maxTokens === 'number') state.maxTokens = d.maxTokens;
      if (typeof d.sys === 'string') state.sys = d.sys;
      if (typeof d.model === 'string') state.model = d.model;
    }
  } catch { /* stockage illisible : on ignore */ }
}

export function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ temp: state.temp, maxTokens: state.maxTokens, sys: state.sys, model: state.model })
    );
  } catch { /* on ignore */ }
}

export function loadConversations() {
  try {
    const d = JSON.parse(localStorage.getItem(CONVOS_KEY) || 'null');
    if (d && Array.isArray(d.conversations)) {
      state.conversations = d.conversations.filter(
        (c) => c && typeof c.id === 'string' && Array.isArray(c.messages)
      );
      state.currentId =
        d.currentId && state.conversations.some((c) => c.id === d.currentId)
          ? d.currentId
          : state.conversations[0]?.id ?? null;
    }
  } catch { /* on ignore */ }
}

export function saveConversations() {
  try {
    localStorage.setItem(
      CONVOS_KEY,
      JSON.stringify({ conversations: state.conversations, currentId: state.currentId })
    );
  } catch { /* quota dépassé : on ignore silencieusement */ }
}
