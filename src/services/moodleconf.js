// Services Connexions Moodle — logique métier SANS DOM (lot 1.5 de la refonte UI).
//
// Mêmes règles que services/profiles.js : aucun import de ui.js, aucun accès à
// document / $() ; les effets UI passent par des callbacks ou par la valeur de
// retour / les exceptions. Le jeton n'est JAMAIS conservé ni journalisé ici :
// il transite vers le trousseau OS (commandes Rust) puis est oublié.

import { state } from '../state.js';
import { moodleApi } from '../api.js';
import { newId } from './profiles.js';

// Persiste une connexion Moodle (métadonnées) + le jeton saisi (write-only).
// Les courseIds existants sont préservés (le choix des cours se fait dans
// l'explorateur). L'appelant vide le champ jeton de l'éditeur (dans son finally).
// onUpsert(id) est appelé dès les métadonnées enregistrées (avant la pose du
// jeton) : main.js y fige l'id d'édition, exactement comme avant.
// Renvoie le profil persisté (métadonnées uniquement, jamais le jeton).
export async function sauvegarderConnexionMoodle({ id, name, url, token }, { onUpsert } = {}) {
  const pid = id || newId();
  const existing = state.moodleProfiles.find((p) => p.id === pid);
  const profil = {
    id: pid,
    name: (name || '').trim() || 'Moodle',
    moodleBaseUrl: (url || '').trim().replace(/\/+$/, ''),
    courseIds: existing ? existing.courseIds || [] : [], // préservés (choix des cours = explorateur)
  };
  let jeton = (token || '').trim();
  try {
    await moodleApi.upsert(profil);
    if (onUpsert) onUpsert(pid);
    if (jeton) await moodleApi.setKey(pid, jeton);
    return profil;
  } finally {
    jeton = null; // hygiène : ne pas garder le jeton en portée
  }
}

// Test de connexion Moodle : éphémère (URL + jeton saisis — rien n'est écrit) si
// un jeton est fourni, sinon test du profil enregistré (jeton au trousseau, l'URL
// affichée prime). Renvoie { info, testeSurProfil } : info = diagnostic
// core_webservice_get_site_info, undefined si rien n'était testable (l'appelant
// gère ce cas exactement comme avant l'extraction).
export async function testerConnexionMoodle({ url, token, profileId }) {
  if (token) return { info: await moodleApi.testEphemeral(url, token), testeSurProfil: false };
  if (profileId) return { info: await moodleApi.test(profileId, url), testeSurProfil: true };
  return { info: undefined, testeSurProfil: false };
}

// Supprime une connexion Moodle (+ jeton au trousseau côté Rust) et met l'état à
// jour (miroir du backend). Les retombées UI restent à la charge de l'appelant.
export async function supprimerConnexionMoodle(profileId) {
  const payload = await moodleApi.remove(profileId);
  state.moodleProfiles = payload.profiles;
  state.activeMoodleId = payload.activeId;
  return payload;
}

// Active une connexion Moodle et met l'état à jour (miroir du backend).
export async function activerConnexionMoodle(profileId) {
  const payload = await moodleApi.setActive(profileId);
  state.moodleProfiles = payload.profiles;
  state.activeMoodleId = payload.activeId;
  return payload;
}
