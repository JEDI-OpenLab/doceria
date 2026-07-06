// Fenêtre Réglages (refonte « Continuité », lot 1 : squelette + preuve de synchro).
// Règles : cette fenêtre réutilise les services/état existants ; le SIGNAL inter-fenêtres
// passe par src/bus.js (events Tauri), les DONNÉES par la persistance (cf. doctrine bus.js).

import './tokens.css'; // première utilisation des tokens « Continuité »
import { applyTheme, initTheme, themeMode, setThemeMode } from './theme.js';
import { annoncerReglage, surReglage } from './bus.js';

// Thème appliqué au plus tôt (évite le flash), + suivi du mode auto système.
initTheme(null);

/* ---------- Apparence (preuve de bout en bout du bus, lot 1) ---------- */
const choix = document.getElementById('themeChoice');

function refleterTheme() {
  const mode = themeMode();
  choix.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-pressed', b.dataset.mode === mode ? 'true' : 'false');
  });
}

choix.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  setThemeMode(btn.dataset.mode); // persiste (doceria_theme) + applique ICI
  refleterTheme();
  annoncerReglage('theme'); // signale aux autres fenêtres (elles relisent)
});

// Changement venu d'une AUTRE fenêtre (ex. bouton thème de la principale) :
// on relit la persistance et on met l'UI à niveau.
surReglage((champ) => {
  if (champ === 'theme') {
    applyTheme();
    refleterTheme();
  }
});

refleterTheme();
