// État global de l'application + persistance légère.
// La clé API est sensible (nominative, facturée) : si l'utilisateur demande de la
// mémoriser, elle est mise en sessionStorage (effacée à la fermeture de l'onglet),
// jamais en localStorage. Les réglages non sensibles vont, eux, en localStorage.

const SETTINGS_KEY = 'ilaas_portal'; // réglages non sensibles (localStorage)
const KEY_STORE = 'ilaas_key'; // clé API (sessionStorage uniquement)
const CONVOS_KEY = 'ilaas_conversations';

export const state = {
  // Connexion — URL réelle d'ILaaS en dur (les appels partent du Rust, pas de proxy).
  // Pas d'override par variable d'env de build : ça éviterait qu'un .env de dev (ex.
  // « /ilaas ») se retrouve figé dans le bundle. L'URL reste modifiable dans l'UI et persistée.
  baseUrl: 'https://llm.ilaas.fr/v1',
  apiKey: '',
  remember: false,
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

export function loadSettings() {
  try {
    const d = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (d) {
      if (d.baseUrl) state.baseUrl = d.baseUrl;
      if (typeof d.temp === 'number') state.temp = d.temp;
      if (typeof d.maxTokens === 'number') state.maxTokens = d.maxTokens;
      if (typeof d.sys === 'string') state.sys = d.sys;
    }
  } catch { /* stockage illisible : on ignore */ }
  // Clé : uniquement sessionStorage (durée de vie de l'onglet).
  try {
    const k = sessionStorage.getItem(KEY_STORE);
    if (k) {
      state.apiKey = k;
      state.remember = true;
    }
  } catch {}
}

export function saveSettings() {
  // Réglages non sensibles dans localStorage (la clé n'y figure jamais).
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ baseUrl: state.baseUrl, temp: state.temp, maxTokens: state.maxTokens, sys: state.sys })
    );
  } catch {}
  // Clé : en sessionStorage seulement si l'utilisateur l'a demandé.
  try {
    if (state.remember && state.apiKey) sessionStorage.setItem(KEY_STORE, state.apiKey);
    else sessionStorage.removeItem(KEY_STORE);
  } catch {}
}

// Efface toute trace de la clé mémorisée.
export function forgetKey() {
  state.remember = false;
  try { sessionStorage.removeItem(KEY_STORE); } catch {}
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
