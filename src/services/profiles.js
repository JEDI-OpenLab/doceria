// Services Profils ILaaS — logique métier SANS DOM (lot 1.5 de la refonte UI).
//
// Règles du module : aucun import de ui.js, aucun accès à document / $() ; les
// effets d'interface passent par des callbacks fournis par l'appelant (main.js)
// ou par la valeur de retour / les exceptions. L'état (state.js) reste la seule
// source de vérité : les fonctions le tiennent à jour elles-mêmes.
// Les clés API ne sont JAMAIS conservées ni journalisées ici : elles transitent
// vers le trousseau OS (commandes Rust) puis sont oubliées.

import { state, activeProfile, saveSettings } from '../state.js';
import { profilesApi, listModels, describeError } from '../api.js';

export function newId() {
  return globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : 'p' + Date.now();
}

// Persiste un profil (métadonnées) + les clés saisies (write-only, trousseau OS).
// Reçoit des valeurs déjà lues par l'appelant — AUCUNE lecture DOM ici ; c'est
// aussi l'appelant qui vide les champs clé de l'éditeur (dans son finally).
// onUpsert(id) est appelé dès que les métadonnées sont enregistrées (avant la
// pose des clés) : main.js y fige l'id d'édition, exactement comme avant.
// Renvoie le profil persisté (métadonnées uniquement, jamais les clés).
export async function sauvegarderProfil({ id, name, llmUrl, model, ragUrl, llmKey, ragKey }, { onUpsert } = {}) {
  const pid = id || newId();
  const ragBase = (ragUrl || '').trim();
  const profil = {
    id: pid,
    name: (name || '').trim() || 'Profil',
    llmBaseUrl: (llmUrl || '').trim() || 'https://llm.ilaas.fr/v1',
    llmModel: (model || '').trim() || 'mistral-medium-latest',
    ragBaseUrl: ragBase || null,
  };
  let cleLlm = (llmKey || '').trim();
  let cleRag = (ragKey || '').trim();
  try {
    await profilesApi.upsert(profil);
    if (onUpsert) onUpsert(pid);
    if (cleLlm) await profilesApi.setKey(pid, 'llm', cleLlm);
    if (cleRag) await profilesApi.setKey(pid, 'rag', cleRag);
    return profil;
  } finally {
    cleLlm = cleRag = null; // hygiène : ne pas garder les clés en portée
  }
}

// Test de connexion : éphémère (URL + clé saisies — rien n'est écrit) si une clé
// est fournie, sinon test du profil enregistré (clé au trousseau). Renvoie la
// liste des modèles, ou null si rien n'est testable (ni clé saisie, ni profil
// enregistré) — l'appelant affiche alors son invite « Saisis une clé… ».
export async function testerConnexion({ url, key, profileId, target }) {
  if (key) return await profilesApi.testEphemeral(url, key);
  if (profileId) return await profilesApi.test(profileId, target);
  return null;
}

// Supprime un profil (métadonnées + clés au trousseau côté Rust) et met l'état à
// jour : miroir des profils + réinitialisation des modèles. Les retombées UI
// (sélecteurs, chat, rendu) restent à la charge de l'appelant.
export async function supprimerProfil(profileId) {
  const payload = await profilesApi.remove(profileId);
  state.profiles = payload.profiles;
  state.activeId = payload.activeId;
  state.model = '';
  state.models = [];
  return payload;
}

// Active un profil et déroule la cascade d'état commune : setActive → miroir des
// profils → réinitialisation des modèles. Les effets UI s'insèrent via callbacks,
// dans le MÊME ordre qu'avant l'extraction :
//   onProfilsMisAJour(payload) — juste après le miroir (ex. resets Moodle) ;
//   onModelesReinitialises()   — juste après la réinitialisation des modèles
//                                (ex. vider les sélecteurs, désactiver le chat).
// La suite de la cascade (applyActiveProfile → refreshRag, puis loadModels si le
// profil a sa clé) reste orchestrée par main.js après le retour de cette fonction.
export async function activerProfil(profileId, { onProfilsMisAJour, onModelesReinitialises } = {}) {
  const payload = await profilesApi.setActive(profileId);
  state.profiles = payload.profiles;
  state.activeId = payload.activeId;
  if (onProfilsMisAJour) onProfilsMisAJour(payload);
  state.model = '';
  state.models = [];
  if (onModelesReinitialises) onModelesReinitialises();
  return payload;
}

// Charge les modèles du profil actif. Gardes (profil présent, clé LLM) incluses.
// Callbacks UI (tous optionnels) :
//   onBusy()                   — début du chargement (les gardes ne le déclenchent pas) ;
//   onModeles(list, choix)     — liste reçue ; doit renvoyer le modèle retenu par
//                                le sélecteur (l'UI peut normaliser le choix) ;
//   onSucces()                 — état mis à jour + persisté, connexion confirmée ;
//   onError(msg, apresRequete) — message lisible ; apresRequete=false pour les
//                                gardes (avant onBusy), true pour l'échec réseau ;
//   onDone()                   — finally (uniquement si onBusy a eu lieu).
export async function chargerModeles({ onBusy, onModeles, onSucces, onError, onDone } = {}) {
  const p = activeProfile();
  if (!p) { if (onError) onError('Crée un profil d’abord.', false); return; }
  if (!p.hasLlmKey) { if (onError) onError('Ce profil n’a pas de clé LLM. Modifie-le pour l’ajouter.', false); return; }
  if (onBusy) onBusy();
  try {
    const list = await listModels();
    state.models = list;
    state.model = onModeles ? onModeles(list, state.model || p.llmModel) : (state.model || p.llmModel);
    saveSettings();
    if (onSucces) onSucces();
  } catch (err) {
    if (onError) onError(describeError(err), true);
  } finally {
    if (onDone) onDone();
  }
}
