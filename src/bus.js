// Bus inter-fenêtres (refonte, lot 1).
//
// DOCTRINE (cf. docs/REFONTE-UI-ROADMAP.md §2) :
//  - le SIGNAL passe par les events Tauri (emit/listen), fiables entre fenêtres ;
//  - les DONNÉES passent par la persistance (localStorage, partagé entre les
//    webviews d'une même app sur macOS) : le récepteur RELIT à réception.
//  - On ne dépend JAMAIS de l'événement DOM « storage » (non fiable inter-WKWebViews,
//    bug WebKit #225344).
//
// Régime d'écriture du blob `ilaas_portal` (tranché au lot 1) : RELECTURE-AVANT-ÉCRITURE.
// Toute fenêtre qui reçoit « réglage changé » doit relire la persistance (loadSettings())
// AVANT sa prochaine écriture, pour ne jamais écraser la valeur d'une autre fenêtre avec
// une copie mémoire périmée. (Le thème utilise sa propre clé `doceria_theme`, relue par
// applyTheme() — même principe.)

import { emit, listen } from '@tauri-apps/api/event';

const EVT_REGLAGE = 'doceria://reglage';

/** Annonce aux autres fenêtres qu'un réglage a changé (la valeur est déjà persistée). */
export function annoncerReglage(champ) {
  return emit(EVT_REGLAGE, { champ }).catch(() => { /* silencieux hors Tauri */ });
}

/** Écoute les annonces de réglages des autres fenêtres. cb(champ). */
export function surReglage(cb) {
  return listen(EVT_REGLAGE, (e) => {
    const champ = e && e.payload && e.payload.champ;
    if (champ) cb(champ);
  });
}
