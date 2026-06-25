// Client de l'API ILaaS — version NATIVE (Tauri).
// Les appels réseau partent du Rust (pas de fetch, pas de CORS) : on passe par
// les commandes `invoke('list_models')` et `invoke('chat')`. Le streaming arrive
// via l'event Tauri `chat://delta` ; le « Stop » appelle `invoke('cancel_chat')`.
//
// Les signatures publiques (listModels, streamChat, describeError) sont inchangées
// pour que le reste du frontend (main.js) ne bouge pas.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { state } from './state.js';

const base = () => state.baseUrl.trim().replace(/\/+$/, '');

// Renvoie un message lisible ; '__ABORT__' signale une interruption volontaire.
// Les erreurs réseau/HTTP arrivent déjà sous forme de chaînes lisibles (mappées côté Rust).
export function describeError(err) {
  if (err && err.name === 'AbortError') return '__ABORT__';
  if (typeof err === 'string') return err;
  return (err && err.message) || 'Erreur inconnue.';
}

export async function listModels() {
  return await invoke('list_models', { baseUrl: base(), apiKey: state.apiKey });
}

// Envoie une requête de chat en streaming. Appelle onDelta(chunk) au fil de l'eau.
// Renvoie { text, usage }. Lance une erreur (AbortError si le signal est annulé).
export async function streamChat({ messages, signal, onDelta }) {
  const requestId =
    (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) ||
    String(Date.now()) + Math.random().toString(16).slice(2);

  // Reçoit les fragments émis par le Rust ; ignore ceux d'un autre échange.
  const unlisten = await listen('chat://delta', (event) => {
    const p = event.payload;
    if (p && p.requestId === requestId) onDelta(p.content);
  });

  const abort = () => {
    invoke('cancel_chat').catch(() => {});
  };
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }

  try {
    const res = await invoke('chat', {
      req: {
        baseUrl: base(),
        apiKey: state.apiKey,
        model: state.model,
        temperature: state.temp,
        maxTokens: state.maxTokens,
        messages,
        requestId,
      },
    });
    return { text: res.text, usage: res.usage };
  } catch (err) {
    // Interruption volontaire : on normalise en AbortError (cf. describeError).
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
