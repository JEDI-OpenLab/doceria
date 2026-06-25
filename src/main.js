import './styles.css';

import { state, activeProfile, loadSettings, saveSettings, loadConversations } from './state.js';
import {
  currentConversation,
  newConversation,
  ensureConversation,
  selectConversation,
  renameConversation,
  deleteConversation,
  addMessage,
  setLastMessageContent,
  removeLastMessage,
  downloadMarkdown,
} from './conversations.js';
import { listModels, streamChat, describeError, profilesApi, ragApi } from './api.js';
import { readDocument } from './documents.js';
import * as ui from './ui.js';

const $ = ui.$;
let abortController = null;
let editingId = null; // id du profil en cours d'édition (null = création)

/* ---------- Initialisation ---------- */
async function init() {
  loadSettings();
  loadConversations();
  ensureConversation();
  hydrateGen();
  wireEvents();
  await refreshProfiles();
  refreshConversation();
}

function hydrateGen() {
  $('temp').value = state.temp;
  $('tempVal').textContent = Number(state.temp).toFixed(2);
  $('maxTokens').value = state.maxTokens;
  $('sysPrompt').value = state.sys;
}

function refreshConversation() {
  ui.renderConversationList(convHandlers);
  ui.renderThread(currentConversation());
  ui.updateComposerMeta();
}

/* ---------- Profils ---------- */
async function refreshProfiles() {
  try {
    const payload = await profilesApi.list();
    state.profiles = payload.profiles || [];
    state.activeId = payload.activeId || state.profiles[0]?.id || null;
    ui.renderProfiles();
    applyActiveProfile();
    // Charge les modèles automatiquement si le profil actif a sa clé LLM.
    const p = activeProfile();
    if (p && p.hasLlmKey) loadModels();
  } catch (err) {
    ui.showError(describeError(err));
  }
}

function applyActiveProfile() {
  const p = activeProfile();
  ui.setEndpoint(p ? p.llmBaseUrl : '');
  if (p && !state.model) state.model = p.llmModel || '';
  if (!p) {
    ui.setStatus('aucun profil', 'err');
    ui.enableChat(false);
  } else if (!p.hasLlmKey) {
    ui.setStatus('clé LLM manquante', 'err');
    ui.enableChat(false);
  } else {
    ui.setStatus('prêt');
  }
  refreshRag();
}

/* ---------- Bibliothèque RAG ---------- */
function ragEnabled() {
  const p = activeProfile();
  return !!(p && p.ragBaseUrl && p.hasRagKey);
}

function collectionsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}

function refreshRag() {
  const enabled = ragEnabled();
  for (const id of ['collectionSelect', 'collectionName', 'collectionNew', 'collectionDelete', 'ragAddFiles', 'ragAddFolder']) {
    $(id).disabled = !enabled;
  }
  if (!enabled) {
    state.collections = [];
    state.activeCollectionId = null;
    ui.renderCollections();
    $('ragHint').textContent = 'Ajoute une URL + clé RAG au profil pour activer la bibliothèque.';
    $('ragStatus').textContent = '';
    return;
  }
  $('ragHint').textContent = 'Collections privées hébergées chez ILaaS (RAG géré).';
  loadCollections();
}

async function loadCollections() {
  try {
    const payload = await ragApi.listCollections();
    state.collections = collectionsFrom(payload);
    if (!state.collections.some((c) => String(c.id) === String(state.activeCollectionId))) {
      state.activeCollectionId = state.collections[0] ? state.collections[0].id : null;
    }
    ui.renderCollections();
  } catch (err) {
    $('ragStatus').textContent = '✗ ' + describeError(err);
  }
}

async function onNewCollection() {
  // window.prompt() n'est pas géré par la webview Tauri → champ texte inline.
  const input = $('collectionName');
  const name = input.value.trim();
  if (!name) {
    input.focus();
    return;
  }
  try {
    const created = await ragApi.createCollection(name);
    const id = created && (created.id ?? (created.data && created.data.id));
    input.value = '';
    await loadCollections();
    if (id != null) {
      state.activeCollectionId = id;
      ui.renderCollections();
    }
    $('ragStatus').textContent = '✓ collection « ' + name + ' » créée.';
  } catch (err) {
    $('ragStatus').textContent = '✗ ' + describeError(err);
  }
}

async function onDeleteCollection() {
  if (state.activeCollectionId == null) return;
  const c = state.collections.find((x) => String(x.id) === String(state.activeCollectionId));
  if (!window.confirm('Supprimer la collection « ' + (c?.name || state.activeCollectionId) + ' » et ses documents chez ILaaS ? Action définitive.')) return;
  try {
    await ragApi.deleteCollection(Number(state.activeCollectionId));
    state.activeCollectionId = null;
    await loadCollections();
    $('ragStatus').textContent = '✓ collection supprimée.';
  } catch (err) {
    $('ragStatus').textContent = '✗ ' + describeError(err);
  }
}

async function uploadPaths(paths) {
  if (state.activeCollectionId == null) {
    $('ragStatus').textContent = 'Sélectionne ou crée une collection d’abord.';
    return;
  }
  const cid = Number(state.activeCollectionId);
  let ok = 0;
  let fail = 0;
  let lastErr = '';
  for (let i = 0; i < paths.length; i++) {
    $('ragStatus').textContent = 'Téléversement ' + (i + 1) + '/' + paths.length + '…';
    try {
      await ragApi.uploadDocument(cid, paths[i]);
      ok++;
    } catch (e) {
      fail++;
      lastErr = describeError(e);
    }
  }
  $('ragStatus').textContent =
    '✓ ' + ok + ' ajouté(s)' + (fail ? ', ' + fail + ' échec(s) [coll #' + cid + '] — ' + lastErr : '') + '.';
  await loadCollections(); // rafraîchit le nombre de documents
}

async function onAddFiles() {
  try {
    const sel = await ragApi.pickFiles();
    if (!sel) return;
    await uploadPaths(Array.isArray(sel) ? sel : [sel]);
  } catch (err) {
    $('ragStatus').textContent = '✗ ' + describeError(err);
  }
}

async function onAddFolder() {
  try {
    const dir = await ragApi.pickFolder();
    if (!dir) return;
    $('ragStatus').textContent = 'Lecture du dossier…';
    const paths = await ragApi.listDirFiles(dir);
    if (!paths.length) {
      $('ragStatus').textContent = 'Aucun fichier supporté dans ce dossier.';
      return;
    }
    await uploadPaths(paths);
  } catch (err) {
    $('ragStatus').textContent = '✗ ' + describeError(err);
  }
}

async function loadModels() {
  const p = activeProfile();
  if (!p) { ui.showError('Crée un profil d’abord.'); return; }
  if (!p.hasLlmKey) { ui.showError('Ce profil n’a pas de clé LLM. Modifie-le pour l’ajouter.'); return; }
  ui.clearError();
  ui.setStatus('chargement…');
  $('loadModelsBtn').disabled = true;
  try {
    const list = await listModels();
    state.models = list;
    ui.fillModels(list, state.model || p.llmModel);
    state.model = $('modelSelect').value;
    saveSettings();
    ui.setStatus('connecté', 'on');
    ui.enableChat(true);
  } catch (err) {
    ui.setStatus('échec', 'err');
    ui.showError(describeError(err));
  } finally {
    $('loadModelsBtn').disabled = false;
  }
}

async function switchProfile(id) {
  if (state.busy || id === state.activeId) return;
  try {
    const payload = await profilesApi.setActive(id);
    state.profiles = payload.profiles;
    state.activeId = payload.activeId;
    state.model = '';
    state.models = [];
    ui.fillModels([], '');
    ui.enableChat(false);
    ui.clearError();
    ui.renderProfiles();
    applyActiveProfile();
    const p = activeProfile();
    if (p && p.hasLlmKey) loadModels();
  } catch (err) {
    ui.showError(describeError(err));
  }
}

function newId() {
  return globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : 'p' + Date.now();
}

// Remplit le menu « Modèle par défaut » du profil (liste récupérée au test de la clé).
// Conserve la valeur sélectionnée si elle existe, sinon prend la 1ʳᵉ ; garde toujours
// au moins une option pour que l'enregistrement fonctionne sans avoir testé.
function setProfileModelOptions(list, selected) {
  const sel = $('pfLlmModel');
  sel.innerHTML = '';
  const opts = Array.isArray(list) ? list.slice() : [];
  if (selected && !opts.includes(selected)) opts.unshift(selected);
  if (!opts.length) opts.push('mistral-medium-latest');
  for (const id of opts) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = id;
    sel.appendChild(o);
  }
  sel.value = selected && opts.includes(selected) ? selected : opts[0];
}

function openEditor(forNew) {
  const p = forNew ? null : activeProfile();
  editingId = forNew ? null : (p ? p.id : null);
  $('pfName').value = p ? p.name : '';
  $('pfLlmUrl').value = p ? p.llmBaseUrl : 'https://llm.ilaas.fr/v1';
  setProfileModelOptions([], p ? p.llmModel : 'mistral-medium-latest');
  $('pfRagUrl').value = p && p.ragBaseUrl ? p.ragBaseUrl : 'https://rag-api.ilaas.fr/v1';
  $('pfLlmKey').value = '';
  $('pfRagKey').value = '';
  $('pfLlmKeyHint').textContent =
    (p && p.hasLlmKey ? 'clé définie — laisser vide pour la conserver. ' : 'aucune clé enregistrée. ') +
    'Teste pour récupérer les modèles.';
  $('pfRagKeyHint').textContent = p && p.hasRagKey ? 'clé définie — laisser vide pour la conserver' : 'aucune clé enregistrée';
  $('profileEditor').hidden = false;
}

function closeEditor() {
  // Ne jamais laisser une clé saisie traîner dans le DOM après fermeture/annulation.
  $('pfLlmKey').value = '';
  $('pfRagKey').value = '';
  $('profileEditor').hidden = true;
  editingId = null;
}

// Persiste le profil (métadonnées) + les clés saisies (write-only). Renvoie l'id.
// Les champs clé sont vidés dans tous les cas (finally), même en cas d'échec.
async function saveProfileFromEditor() {
  const id = editingId || newId();
  const ragUrl = $('pfRagUrl').value.trim();
  const profile = {
    id,
    name: $('pfName').value.trim() || 'Profil',
    llmBaseUrl: $('pfLlmUrl').value.trim() || 'https://llm.ilaas.fr/v1',
    llmModel: $('pfLlmModel').value.trim() || 'mistral-medium-latest',
    ragBaseUrl: ragUrl || null,
  };
  let llmKey = $('pfLlmKey').value.trim();
  let ragKey = $('pfRagKey').value.trim();
  try {
    await profilesApi.upsert(profile);
    editingId = id;
    if (llmKey) await profilesApi.setKey(id, 'llm', llmKey);
    if (ragKey) await profilesApi.setKey(id, 'rag', ragKey);
    return id;
  } finally {
    $('pfLlmKey').value = '';
    $('pfRagKey').value = '';
    llmKey = ragKey = null;
  }
}

async function onSaveProfile() {
  try {
    const id = await saveProfileFromEditor();
    // setActive renvoie déjà le payload complet (profils + activeId) : pas de list() en plus.
    const payload = await profilesApi.setActive(id);
    state.profiles = payload.profiles;
    state.activeId = payload.activeId;
    state.model = '';
    state.models = [];
    closeEditor();
    ui.renderProfiles();
    applyActiveProfile();
    const p = activeProfile();
    if (p && p.hasLlmKey) loadModels();
  } catch (err) {
    ui.showError(describeError(err));
  }
}

// Teste SANS persister : valide l'URL + la clé saisies (commande éphémère). Si aucune
// clé n'est saisie mais que le profil édité en a déjà une, teste le profil enregistré.
async function onTestProfile(target) {
  const hint = target === 'llm' ? $('pfLlmKeyHint') : $('pfRagKeyHint');
  const url = (target === 'llm' ? $('pfLlmUrl').value : $('pfRagUrl').value).trim();
  const key = (target === 'llm' ? $('pfLlmKey').value : $('pfRagKey').value).trim();
  if (!url) { hint.textContent = '✗ URL manquante.'; return; }
  hint.textContent = 'test en cours…';
  try {
    let models;
    if (key) {
      models = await profilesApi.testEphemeral(url, key); // rien n'est écrit
    } else if (editingId) {
      models = await profilesApi.test(editingId, target); // profil déjà enregistré
    } else {
      hint.textContent = '✗ Saisis une clé pour tester.';
      return;
    }
    hint.textContent = '✓ connexion OK — ' + models.length + ' modèles disponibles';
    // Pour l'inférence : on alimente le menu déroulant des modèles.
    if (target === 'llm') setProfileModelOptions(models, $('pfLlmModel').value);
  } catch (err) {
    hint.textContent = '✗ ' + describeError(err);
  }
}

async function onDeleteProfile() {
  const p = activeProfile();
  if (!p) return;
  if (!window.confirm('Supprimer le profil « ' + p.name + ' » et ses clés du trousseau ? Action définitive.')) return;
  try {
    const payload = await profilesApi.remove(p.id);
    state.profiles = payload.profiles;
    state.activeId = payload.activeId;
    state.model = '';
    state.models = [];
    ui.fillModels([], '');
    ui.enableChat(false);
    ui.clearError();
    closeEditor();
    ui.renderProfiles();
    applyActiveProfile();
    const np = activeProfile();
    if (np && np.hasLlmKey) loadModels();
  } catch (err) {
    ui.showError(describeError(err));
  }
}

/* ---------- Construction de la requête ---------- */
function readGenerationFromInputs() {
  state.model = $('modelSelect').value || state.model;
  state.temp = parseFloat($('temp').value);
  state.maxTokens = parseInt($('maxTokens').value, 10) || 1024;
  state.sys = $('sysPrompt').value;
  saveSettings();
}

function buildMessages(conv) {
  const msgs = [];
  let sys = $('sysPrompt').value.trim();
  if (state.doc.text) {
    const ctx = 'Document de contexte « ' + state.doc.name + ' » :\n\n' + state.doc.text;
    sys = sys ? sys + '\n\n' + ctx : ctx;
  }
  if (sys) msgs.push({ role: 'system', content: sys });
  msgs.push(...conv.messages);
  return msgs;
}

/* ---------- Envoi (streaming) ---------- */
function onSendOrStop() {
  if (state.busy) {
    abortController?.abort();
    return;
  }
  send();
}

async function send() {
  if (state.busy) return; // garde anti double-soumission
  const text = $('prompt').value.trim();
  if (!text) return;
  if (!state.activeId) {
    ui.showError('Sélectionne ou crée un profil avec sa clé.');
    return;
  }
  readGenerationFromInputs();
  if (!state.model) {
    ui.showError('Sélectionnez un modèle (chargez les modèles d’abord).');
    return;
  }

  const conv = ensureConversation();
  addMessage(conv, 'user', text);
  ui.appendMessage('user', text);
  $('prompt').value = '';
  ui.resizePrompt();
  ui.clearError();

  // On capture les messages envoyés AVANT d'ajouter le slot assistant (sinon on enverrait
  // un tour assistant vide à l'API).
  const apiMessages = buildMessages(conv);
  addMessage(conv, 'assistant', ''); // slot persisté, rempli au fil du streaming
  ui.renderConversationList(convHandlers);

  const bubble = ui.appendMessage('assistant', '');
  ui.setBubbleTyping(bubble);

  let acc = '';
  let firstDelta = true;
  let lastSave = 0;
  state.busy = true;
  ui.setSending(true);
  abortController = new AbortController();

  try {
    const { text: full, usage } = await streamChat({
      messages: apiMessages,
      signal: abortController.signal,
      onDelta: (d) => {
        if (firstDelta) {
          bubble.textContent = '';
          firstDelta = false;
        }
        acc += d;
        ui.streamInto(bubble, acc);
        ui.scrollDown();
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (now - lastSave > 500) {
          setLastMessageContent(conv, acc);
          lastSave = now;
        }
      },
    });
    const finalText = (full || acc).trim();
    ui.finalizeBubble(bubble, finalText);
    setLastMessageContent(conv, finalText || '(réponse vide)');
    if (usage) {
      ui.setComposerMeta(
        'tokens : ' + (usage.prompt_tokens ?? '?') + ' entrée + ' + (usage.completion_tokens ?? '?') + ' sortie'
      );
    }
  } catch (err) {
    const d = describeError(err);
    if (d === '__ABORT__') {
      if (acc.trim()) {
        const interrupted = acc.trim() + '\n\n*(interrompu)*';
        ui.finalizeBubble(bubble, interrupted);
        setLastMessageContent(conv, interrupted);
      } else {
        removeLastMessage(conv); // retire le slot assistant vide
        ui.removeBubble(bubble);
      }
    } else {
      removeLastMessage(conv);
      ui.removeBubble(bubble);
      ui.showError(d);
    }
  } finally {
    state.busy = false;
    abortController = null;
    ui.setSending(false);
    ui.renderConversationList(convHandlers);
    ui.scrollDown();
    $('prompt').focus();
  }
}

/* ---------- Document de contexte ---------- */
async function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  ui.setDocLoading(file.name);
  try {
    const info = await readDocument(file, (page, total) => {
      $('docMeta').textContent = 'PDF : page ' + page + ' / ' + total + '…';
    });
    state.doc = { name: info.name, text: info.text };
    ui.setDocLoaded(info);
  } catch (err) {
    state.doc = { name: '', text: '' };
    ui.setDocError((err && err.message) || String(err));
  } finally {
    e.target.value = '';
  }
}

function clearDoc() {
  state.doc = { name: '', text: '' };
  ui.setDocCleared();
}

/* ---------- Conversations ---------- */
const convHandlers = {
  onSelect(id) {
    if (state.busy) return;
    selectConversation(id);
    refreshConversation();
    $('prompt').focus();
  },
  onNew() {
    if (state.busy) return;
    newConversation();
    refreshConversation();
    $('prompt').focus();
  },
  onRename(id) {
    if (state.busy) return;
    const conv = state.conversations.find((c) => c.id === id);
    const name = window.prompt('Renommer la conversation :', conv?.title || '');
    if (name != null) {
      renameConversation(id, name);
      ui.renderConversationList(convHandlers);
    }
  },
  onDelete(id) {
    if (state.busy) return;
    const conv = state.conversations.find((c) => c.id === id);
    if (window.confirm('Supprimer « ' + (conv?.title || 'cette conversation') + ' » ? Action définitive.')) {
      deleteConversation(id);
      if (!currentConversation()) newConversation();
      refreshConversation();
    }
  },
  onExport(id) {
    if (state.busy) return;
    const conv = state.conversations.find((c) => c.id === id);
    if (conv && conv.messages.length) downloadMarkdown(conv);
    else window.alert('Cette conversation est vide.');
  },
};

/* ---------- Branchement des événements ---------- */
function wireEvents() {
  $('convNew').addEventListener('click', convHandlers.onNew);

  // Profils
  $('profileSelect').addEventListener('change', (e) => switchProfile(e.target.value));
  $('profileNew').addEventListener('click', () => openEditor(true));
  $('profileEdit').addEventListener('click', () => openEditor(false));
  $('profileDelete').addEventListener('click', onDeleteProfile);
  $('loadModelsBtn').addEventListener('click', loadModels);
  $('pfSave').addEventListener('click', onSaveProfile);
  $('pfCancel').addEventListener('click', closeEditor);
  $('pfLlmTest').addEventListener('click', () => onTestProfile('llm'));
  $('pfRagTest').addEventListener('click', () => onTestProfile('rag'));
  // Coller la clé LLM puis quitter le champ récupère automatiquement les modèles.
  $('pfLlmKey').addEventListener('change', () => {
    if ($('pfLlmKey').value.trim()) onTestProfile('llm');
  });

  // Bibliothèque RAG
  $('collectionSelect').addEventListener('change', (e) => {
    state.activeCollectionId = e.target.value ? Number(e.target.value) : null;
  });
  $('collectionNew').addEventListener('click', onNewCollection);
  $('collectionDelete').addEventListener('click', onDeleteCollection);
  $('ragAddFiles').addEventListener('click', onAddFiles);
  $('ragAddFolder').addEventListener('click', onAddFolder);

  // Génération
  $('modelSelect').addEventListener('change', (e) => {
    state.model = e.target.value;
    ui.setConsoleModel(state.model);
    saveSettings();
  });
  $('temp').addEventListener('input', (e) => {
    state.temp = parseFloat(e.target.value);
    $('tempVal').textContent = state.temp.toFixed(2);
  });
  $('temp').addEventListener('change', saveSettings);
  $('maxTokens').addEventListener('change', (e) => {
    state.maxTokens = parseInt(e.target.value, 10) || 1024;
    saveSettings();
  });
  $('sysPrompt').addEventListener('change', (e) => {
    state.sys = e.target.value;
    saveSettings();
  });

  // Bouton fichier (activable au clavier puisque c'est un vrai <button>).
  $('docPick').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', handleFile);
  $('docClear').addEventListener('click', clearDoc);

  $('sendBtn').addEventListener('click', onSendOrStop);
  $('prompt').addEventListener('input', ui.resizePrompt);
  $('prompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!state.busy) send();
    }
  });
}

init();
