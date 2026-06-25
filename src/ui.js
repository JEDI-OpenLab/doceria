// Rendu DOM et helpers d'affichage. Aucune logique métier ici :
// les actions (sélection, envoi, etc.) sont passées en callbacks depuis main.js.

import { state } from './state.js';

export const $ = (id) => document.getElementById(id);

/* ---------- Console / état de connexion ---------- */
export function setEndpoint(url) {
  $('cEndpoint').textContent = (url || '').replace(/^https?:\/\//, '') || '—';
}
export function setStatus(text, kind) {
  $('cStatus').textContent = text;
  $('cDot').className = 'dot' + (kind === 'on' ? ' on' : kind === 'err' ? ' err' : '');
}
export function setConsoleModel(m) {
  $('cModel').textContent = m || '';
  $('cModelSep').style.display = m ? 'inline' : 'none';
}

/* ---------- Modèles ---------- */
export function fillModels(list, current) {
  const sel = $('modelSelect');
  sel.innerHTML = '';
  list.forEach((id) => {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = id;
    sel.appendChild(o);
  });
  sel.disabled = false;
  sel.value = current && list.includes(current) ? current : list[0];
  setConsoleModel(sel.value);
}

export function enableChat(on) {
  $('prompt').disabled = !on;
  $('sendBtn').disabled = !on;
  if (on) $('prompt').focus();
}

/* ---------- Profils ---------- */
export function renderProfiles() {
  const sel = $('profileSelect');
  sel.innerHTML = '';
  const has = state.profiles.length > 0;
  $('profileEdit').disabled = !has;
  $('profileDelete').disabled = !has;
  $('loadModelsBtn').disabled = !has;
  if (!has) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '— aucun profil —';
    o.disabled = true;
    o.selected = true;
    sel.appendChild(o);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  for (const p of state.profiles) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name + (p.hasLlmKey ? '' : ' — clé manquante');
    sel.appendChild(o);
  }
  sel.value = state.activeId || state.profiles[0].id;
}

/* ---------- Bibliothèque RAG ---------- */
export function renderCollections() {
  const sel = $('collectionSelect');
  sel.innerHTML = '';
  if (!state.collections.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '— aucune collection —';
    o.disabled = true;
    o.selected = true;
    sel.appendChild(o);
    return;
  }
  for (const c of state.collections) {
    const o = document.createElement('option');
    o.value = String(c.id);
    const count = typeof c.documents === 'number' ? ' (' + c.documents + ' doc.)' : '';
    o.textContent = (c.name || '#' + c.id) + count;
    sel.appendChild(o);
  }
  sel.value =
    state.activeCollectionId != null ? String(state.activeCollectionId) : String(state.collections[0].id);
}

/* ---------- Rendu Markdown léger ---------- */
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// INVARIANT DE SÛRETÉ : escapeHtml DOIT rester appelé en premier. Toute future règle qui
// réinsérerait des attributs HTML (ex. liens [txte](url) → <a href="…">) devra ré-échapper
// les guillemets et valider le schéma d'URL (http/https/mailto), sinon risque XSS.
export function format(text) {
  let t = escapeHtml(text);
  // blocs de code ```...```
  t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => '<pre><code>' + code.replace(/\n$/, '') + '</code></pre>');
  // code en ligne `...`
  t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // gras **...**
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  return t;
}

/* ---------- Fil de conversation ---------- */
function threadInner() {
  return $('threadInner');
}
export function scrollDown() {
  const t = $('thread');
  t.scrollTop = t.scrollHeight;
}

export function renderThread(conv) {
  const inner = threadInner();
  inner.innerHTML = '';
  if (!conv || !conv.messages.length) {
    inner.innerHTML =
      '<div class="empty" id="empty">' +
      '<img class="hero-logo" src="/logo.png" alt="Doceria" width="84" height="84">' +
      '<div class="big">Prêt à interroger un modèle souverain</div>' +
      '<div>Choisissez un profil, chargez les modèles, puis écrivez ci-dessous.</div></div>';
    return;
  }
  for (const m of conv.messages) {
    const bubble = appendMessage(m.role, '');
    if (m.role === 'assistant') bubble.innerHTML = format(m.content);
    else bubble.textContent = m.content;
  }
  scrollDown();
}

export function appendMessage(role, text) {
  $('empty')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;
  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = role === 'user' ? 'Vous' : 'Modèle';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (text) {
    if (role === 'assistant') bubble.innerHTML = format(text);
    else bubble.textContent = text;
  }
  wrap.appendChild(who);
  wrap.appendChild(bubble);
  threadInner().appendChild(wrap);
  scrollDown();
  return bubble;
}

// Pendant le streaming : texte brut (rapide, sans re-parsing Markdown).
export function streamInto(bubble, text) {
  bubble.textContent = text;
}
export function setBubbleTyping(bubble) {
  bubble.innerHTML = "<span class='typing'>génération…</span>";
}
// À la fin : on applique le rendu Markdown.
export function finalizeBubble(bubble, text) {
  bubble.innerHTML = format(text || '(réponse vide)');
}
export function removeBubble(bubble) {
  bubble.parentNode?.remove();
}

// Affiche les sources RAG sous une réponse : [n] nom du document — extrait.
export function appendSources(bubble, sources) {
  if (!sources || !sources.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'sources';
  const title = document.createElement('div');
  title.className = 'sources-title';
  title.textContent = 'Sources (' + sources.length + ')';
  wrap.appendChild(title);
  for (const s of sources) {
    const item = document.createElement('div');
    item.className = 'source-item';
    const snippet = (s.content || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const more = s.content && s.content.replace(/\s+/g, ' ').trim().length > 160 ? '…' : '';
    item.textContent = '[' + s.n + '] ' + (s.name || 'document #' + s.documentId) + ' — « ' + snippet + more + ' »';
    wrap.appendChild(item);
  }
  bubble.parentNode?.appendChild(wrap);
  scrollDown();
}

/* ---------- Bannière d'erreur ---------- */
export function showError(msg) {
  clearError();
  const b = document.createElement('div');
  b.className = 'banner err';
  b.id = 'banner';
  b.textContent = msg;
  threadInner().prepend(b);
}
export function clearError() {
  $('banner')?.remove();
}

/* ---------- Composer ---------- */
export function setComposerMeta(text) {
  $('composerMeta').textContent = text || '';
}
export function updateComposerMeta(extra) {
  const bits = [];
  if (state.doc.name) bits.push('contexte : ' + state.doc.name);
  if (extra) bits.push(extra);
  $('composerMeta').textContent = bits.join('  ·  ');
}
export function resizePrompt() {
  const p = $('prompt');
  p.style.height = 'auto';
  p.style.height = Math.min(p.scrollHeight, 200) + 'px';
}
export function setSending(on) {
  const btn = $('sendBtn');
  btn.textContent = on ? 'Stop' : 'Envoyer';
  btn.classList.toggle('stop', on);
  btn.disabled = false;
  $('prompt').disabled = on;
}

/* ---------- Document de contexte ---------- */
export function setDocLoading(name) {
  $('docEmpty').style.display = 'none';
  $('docLoaded').style.display = 'block';
  $('docName').textContent = 'lecture de ' + name + '…';
  $('docMeta').textContent = '';
}
export function setDocLoaded(info) {
  $('docName').textContent = info.name;
  $('docMeta').textContent =
    info.charCount.toLocaleString('fr-FR') + ' caractères' + (info.truncated ? ' (tronqué)' : '') + ' ajoutés au contexte';
  $('docBox').classList.add('loaded');
  updateComposerMeta();
}
export function setDocError(message) {
  $('docName').textContent = 'échec de lecture';
  $('docMeta').textContent = message;
  $('docBox').classList.remove('loaded');
}
export function setDocCleared() {
  $('docEmpty').style.display = 'block';
  $('docLoaded').style.display = 'none';
  $('docBox').classList.remove('loaded');
  updateComposerMeta();
}

/* ---------- Liste des conversations ---------- */
export function renderConversationList(handlers) {
  const wrap = $('convList');
  wrap.innerHTML = '';
  if (!state.conversations.length) {
    const e = document.createElement('div');
    e.className = 'conv-empty';
    e.textContent = 'Aucune conversation.';
    wrap.appendChild(e);
    return;
  }
  for (const conv of state.conversations) {
    const item = document.createElement('div');
    item.className = 'conv-item' + (conv.id === state.currentId ? ' active' : '');
    item.dataset.id = conv.id;

    const title = document.createElement('button');
    title.className = 'conv-title';
    title.type = 'button';
    title.textContent = conv.title || 'Sans titre';
    title.title = conv.title || '';
    title.addEventListener('click', () => handlers.onSelect(conv.id));

    const actions = document.createElement('div');
    actions.className = 'conv-actions';
    actions.appendChild(iconBtn('Renommer', '✎', () => handlers.onRename(conv.id)));
    actions.appendChild(iconBtn('Exporter en Markdown', '↧', () => handlers.onExport(conv.id)));
    actions.appendChild(iconBtn('Supprimer', '✕', () => handlers.onDelete(conv.id), 'danger'));

    item.appendChild(title);
    item.appendChild(actions);
    wrap.appendChild(item);
  }
}

// Renommage inline d'une conversation (window.prompt n'est pas géré par la webview Tauri).
// Remplace le titre par un champ ; Entrée/clic-ailleurs valide, Échap annule.
export function startRename(id, onCommit) {
  const item = document.querySelector('.conv-item[data-id="' + id + '"]');
  const titleEl = item && item.querySelector('.conv-title');
  if (!titleEl) { onCommit(null); return; }
  const current = titleEl.textContent || '';
  const input = document.createElement('input');
  input.className = 'conv-rename';
  input.value = current === 'Sans titre' ? '' : current;
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = (save) => {
    if (done) return;
    done = true;
    onCommit(save ? input.value : null);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
  input.addEventListener('blur', () => commit(true));
}

function iconBtn(label, glyph, onClick, extra) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'conv-icon' + (extra ? ' ' + extra : '');
  b.title = label;
  b.setAttribute('aria-label', label);
  b.textContent = glyph;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}
