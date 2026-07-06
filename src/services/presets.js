// Service Modèles de consigne système (presets) — logique métier SANS DOM (lot 1.5).
//
// Règles du module : aucun import de ui.js, aucun accès à document / $() ; les
// effets d'interface (rendu du sélecteur, flash « ✓ … ») restent dans main.js.
// Persistance : même clé localStorage qu'avant l'extraction, format intouché
// ([{ name, text }]). L'application d'un preset met à jour l'état (state.sys)
// et persiste les réglages — l'état reste la seule source de vérité de l'envoi.

import { state, saveSettings } from '../state.js';

const SYS_PRESETS_KEY = 'doceria_sys_presets';

// Liste des presets enregistrés (tableau vide si stockage absent/illisible).
export function chargerPresets() {
  try {
    const a = JSON.parse(localStorage.getItem(SYS_PRESETS_KEY) || '[]');
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}

function sauverPresets(a) {
  try { localStorage.setItem(SYS_PRESETS_KEY, JSON.stringify(a)); } catch { /* ignore */ }
}

// Crée ou met à jour (même nom) un preset. Renvoie la liste à jour.
export function enregistrerPreset(name, text) {
  const presets = chargerPresets();
  const i = presets.findIndex((p) => p.name === name);
  if (i >= 0) presets[i].text = text;
  else presets.push({ name, text });
  sauverPresets(presets);
  return presets;
}

// Applique un preset : consigne système dans l'état + persistance des réglages.
// Renvoie le preset appliqué, ou null s'il est introuvable (l'appelant n'affiche
// alors rien — même comportement qu'avant l'extraction).
export function appliquerPreset(name) {
  const p = chargerPresets().find((x) => x.name === name);
  if (!p) return null;
  state.sys = p.text;
  saveSettings();
  return p;
}

// Supprime un preset par son nom (sans effet s'il n'existe pas).
export function supprimerPreset(name) {
  sauverPresets(chargerPresets().filter((p) => p.name !== name));
}
