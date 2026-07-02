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
  // Connexions Moodle (miroir du backend — jeton au trousseau, jamais ici)
  moodleProfiles: [], // [{ id, name, moodleBaseUrl, courseIds, hasMoodleToken }]
  activeMoodleId: null,
  // Bibliothèque RAG (collections gérées ILaaS du profil actif ; brut du backend)
  collections: [],
  activeCollectionId: null,
  ragOwner: null, // email du propriétaire RAG (filtrage « mes collections »)
  useLibrary: false, // interrupteur « Utiliser la bibliothèque » dans le chat
  ragMode: 'chat', // mode RAG : 'chat' (extraits + connaissances) | 'requete' (extraits seuls)
  ragMethod: 'hybrid', // méthode de recherche RAG : 'semantic' | 'lexical' | 'hybrid'
  ragTopK: 5, // nombre d'extraits récupérés (limit de /search)
  ragThreshold: 0, // seuil de similarité (score_threshold) ; 0 = désactivé
  ragRerank: true, // réordonner les extraits par pertinence (bge-reranker) après la recherche
  ragRefusal: 'Je ne trouve pas la réponse dans la bibliothèque.', // mode Requête : phrase renvoyée quand rien n'est trouvé
  ragAutoSync: false, // synchroniser les collections liées à un dossier à l'ouverture du profil
  memoryTurns: 0, // tours d'historique envoyés à chaque message ; 0 = illimité
  // Modèles
  models: [],
  model: '',
  compareMode: false, // « comparer deux modèles côte à côte » (transitoire, non persisté)
  compareModelB: '', // second modèle de comparaison (le premier = state.model) ; persisté
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

export function activeMoodleProfile() {
  return state.moodleProfiles.find((p) => p.id === state.activeMoodleId) || null;
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
      if (typeof d.compareModelB === 'string') state.compareModelB = d.compareModelB;
      if (d.ragMode === 'chat' || d.ragMode === 'requete') state.ragMode = d.ragMode;
      if (d.ragMethod === 'hybrid' || d.ragMethod === 'semantic' || d.ragMethod === 'lexical') state.ragMethod = d.ragMethod;
      if (typeof d.ragTopK === 'number') state.ragTopK = d.ragTopK;
      if (typeof d.ragThreshold === 'number') state.ragThreshold = d.ragThreshold;
      if (typeof d.ragRerank === 'boolean') state.ragRerank = d.ragRerank;
      if (typeof d.ragRefusal === 'string' && d.ragRefusal.trim()) state.ragRefusal = d.ragRefusal;
      if (typeof d.ragAutoSync === 'boolean') state.ragAutoSync = d.ragAutoSync;
      if (typeof d.memoryTurns === 'number') state.memoryTurns = d.memoryTurns;
    }
  } catch { /* stockage illisible : on ignore */ }
}

export function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        temp: state.temp,
        maxTokens: state.maxTokens,
        sys: state.sys,
        model: state.model,
        compareModelB: state.compareModelB,
        ragMode: state.ragMode,
        ragMethod: state.ragMethod,
        ragTopK: state.ragTopK,
        ragThreshold: state.ragThreshold,
        ragRerank: state.ragRerank,
        ragRefusal: state.ragRefusal,
        ragAutoSync: state.ragAutoSync,
        memoryTurns: state.memoryTurns,
      })
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
