// Gestion des conversations : création, sélection, renommage, suppression,
// ajout de messages, export Markdown. Persistance déléguée à state.js.

import { state, saveConversations } from './state.js';

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

const NEW_TITLE = 'Nouvelle conversation';

export function currentConversation() {
  return state.conversations.find((c) => c.id === state.currentId) || null;
}

export function newConversation() {
  const conv = {
    id: uid(),
    title: NEW_TITLE,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.conversations.unshift(conv);
  state.currentId = conv.id;
  saveConversations();
  return conv;
}

// Garantit qu'une conversation courante existe (en crée une au besoin).
export function ensureConversation() {
  return currentConversation() || newConversation();
}

export function selectConversation(id) {
  if (state.conversations.some((c) => c.id === id)) {
    state.currentId = id;
    saveConversations();
  }
}

export function renameConversation(id, title) {
  const c = state.conversations.find((x) => x.id === id);
  if (!c) return;
  const t = (title || '').trim();
  if (t) {
    c.title = t;
    c.updatedAt = Date.now();
    saveConversations();
  }
}

export function deleteConversation(id) {
  state.conversations = state.conversations.filter((c) => c.id !== id);
  if (state.currentId === id) {
    state.currentId = state.conversations[0]?.id ?? null;
  }
  saveConversations();
}

export function addMessage(conv, role, content) {
  conv.messages.push({ role, content });
  conv.updatedAt = Date.now();
  // Titre automatique à partir du premier message utilisateur.
  if (role === 'user' && (!conv.title || conv.title === NEW_TITLE)) {
    const t = content.replace(/\s+/g, ' ').trim();
    conv.title = t.slice(0, 48) + (t.length > 48 ? '…' : '');
  }
  saveConversations();
}

// Remplace le contenu du dernier message (utile pour figer la réponse en streaming).
export function setLastMessageContent(conv, content) {
  const last = conv.messages[conv.messages.length - 1];
  if (last) {
    last.content = content;
    conv.updatedAt = Date.now();
    saveConversations();
  }
}

// Retire le dernier message (ex. : slot assistant abandonné après une erreur).
export function removeLastMessage(conv) {
  conv.messages.pop();
  conv.updatedAt = Date.now();
  saveConversations();
}

export function conversationToMarkdown(conv) {
  const date = new Date(conv.updatedAt || Date.now()).toLocaleString('fr-FR');
  let md = `# ${conv.title}\n\n*Doceria — exporté le ${date}*\n\n`;
  for (const m of conv.messages) {
    md += (m.role === 'user' ? '## Vous\n\n' : '## Modèle\n\n') + (m.content || '').trim() + '\n\n';
  }
  return md.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function downloadMarkdown(conv) {
  const md = conversationToMarkdown(conv);
  const slug =
    (conv.title || 'conversation')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'conversation';
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = slug + '.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
