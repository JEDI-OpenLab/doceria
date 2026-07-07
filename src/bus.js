// Bus inter-fenêtres (refonte — lot 1, étendu au lot 2a).
//
// DOCTRINE (cf. docs/REFONTE-UI-ROADMAP.md §0) :
//  - le SIGNAL passe par les events Tauri (emit/listen), fiables entre fenêtres ;
//  - les DONNÉES ne transitent PAS par le bus : le récepteur relit la source de
//    vérité (backend Rust pour les profils/Moodle ; localStorage pour le thème et
//    les réglages de génération). On ne dépend JAMAIS de l'événement DOM « storage »
//    (non fiable inter-WKWebViews, bug WebKit #225344).
//  - Les CLÉS/JETONS ne transitent JAMAIS par le bus : chaque fenêtre les envoie
//    elle-même au trousseau via un invoke Rust direct (write-only), puis les oublie.
//
// ⚠️ Tauri `emit` revient AUSSI à la fenêtre émettrice. Pour l'annonce de réglage
// (écoutée par les DEUX fenêtres, thème compris), on étiquette l'émetteur (`from`)
// et chaque fenêtre ignore ses propres annonces (`self`). Les canaux « verrou » et
// « prêt » sont dirigés par construction (un seul émetteur, un seul abonné).

import { emit, listen } from '@tauri-apps/api/event';

const EVT_REGLAGE = 'doceria://reglage'; // { champ, from } — « relis tel réglage »
const EVT_VERROU = 'doceria://verrou'; // { busy, moodleSyncing } — principale → Réglages
const EVT_PRET = 'doceria://reglages-pret'; // Réglages signale sa présence → principale rediffuse le verrou

/* ------------------------- Annonces de réglage ------------------------- */
// champ ∈ 'theme' | 'profils' | 'modeles' | 'moodle'. `from` = label de l'émetteur.
export function annoncerReglage(champ, from) {
  return emit(EVT_REGLAGE, { champ, from }).catch(() => { /* silencieux hors Tauri */ });
}
// cb(champ) pour les annonces des AUTRES fenêtres. `self` = mon label (annonces ignorées si from === self).
export function surReglage(cb, self) {
  return listen(EVT_REGLAGE, (e) => {
    const p = e && e.payload;
    if (!p || !p.champ) return;
    if (p.from && p.from === self) return; // ne pas réagir à ses propres annonces (emit revient à l'émetteur)
    cb(p.champ);
  });
}

/* --------------------------- Verrous (busy) --------------------------- */
// Diffusé par la fenêtre principale (seule origine des verrous chat/synchro).
export function publierVerrou(etat) {
  return emit(EVT_VERROU, etat || {}).catch(() => { /* silencieux hors Tauri */ });
}
// Écouté par la fenêtre Réglages, qui grise ses contrôles en conséquence.
export function surVerrou(cb) {
  return listen(EVT_VERROU, (e) => cb((e && e.payload) || {}));
}

/* ----------------- Poignée de main au démarrage Réglages ----------------- */
// La fenêtre Réglages (persistante mais cachée au lancement) signale qu'elle est
// prête : la principale rediffuse alors l'état de verrou courant, pour éviter la
// course « Réglages ouverte avant la première transition de verrou ».
export function signalerReglagesPret() {
  return emit(EVT_PRET, {}).catch(() => { /* silencieux hors Tauri */ });
}
export function surReglagesPret(cb) {
  return listen(EVT_PRET, () => cb());
}
