import './styles.css';

import { state, loadSettings, saveSettings, loadConversations, forgetKey } from './state.js';
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
import { listModels, streamChat, describeError } from './api.js';
import { readDocument } from './documents.js';
import * as ui from './ui.js';

const $ = ui.$;
let abortController = null;

/* ---------- Initialisation ---------- */
function init() {
  loadSettings();
  loadConversations();
  ensureConversation();
  hydrate();
  refreshConversation();
  wireEvents();
}

function hydrate() {
  $('baseUrl').value = state.baseUrl;
  $('apiKey').value = state.apiKey;
  $('remember').checked = state.remember;
  $('temp').value = state.temp;
  $('tempVal').textContent = Number(state.temp).toFixed(2);
  $('maxTokens').value = state.maxTokens;
  $('sysPrompt').value = state.sys;
  ui.setEndpoint(state.baseUrl);
}

function refreshConversation() {
  ui.renderConversationList(convHandlers);
  ui.renderThread(currentConversation());
  ui.updateComposerMeta();
}

/* ---------- Connexion + modèles ---------- */
async function connect() {
  state.baseUrl = $('baseUrl').value.trim().replace(/\/+$/, '');
  state.apiKey = $('apiKey').value.trim();
  ui.setEndpoint(state.baseUrl);
  ui.clearError();
  ui.setStatus('connexion…');
  $('connectBtn').disabled = true;
  try {
    const list = await listModels();
    state.models = list;
    ui.fillModels(list, state.model);
    state.model = $('modelSelect').value;
    ui.setStatus('connecté', 'on');
    ui.enableChat(true);
    saveSettings();
  } catch (err) {
    ui.setStatus('échec', 'err');
    ui.showError(describeError(err));
  } finally {
    $('connectBtn').disabled = false;
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
  $('connectBtn').addEventListener('click', connect);
  $('convNew').addEventListener('click', convHandlers.onNew);

  $('modelSelect').addEventListener('change', (e) => {
    state.model = e.target.value;
    ui.setConsoleModel(state.model);
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
  $('baseUrl').addEventListener('input', (e) => {
    state.baseUrl = e.target.value;
  });
  $('apiKey').addEventListener('input', (e) => {
    state.apiKey = e.target.value;
  });
  $('remember').addEventListener('change', (e) => {
    state.remember = e.target.checked;
    if (!state.remember) forgetKey();
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
