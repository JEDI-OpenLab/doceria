// Thème clair / sombre / auto (suit le système), persisté en localStorage.
// On pilote l'attribut data-theme sur <html> ; le CSS définit :root (clair) et
// :root[data-theme="dark"]. En mode « auto », on recalcule selon le système et on
// écoute ses changements.

const THEME_KEY = 'doceria_theme';
const LABELS = { auto: 'Auto', light: 'Clair', dark: 'Sombre' };
const ORDER = ['auto', 'light', 'dark'];
const mq = window.matchMedia('(prefers-color-scheme: dark)');

function stored() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' || v === 'auto' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function effective(mode) {
  return mode === 'auto' ? (mq.matches ? 'dark' : 'light') : mode;
}

// Applique le thème effectif au document. Appelable très tôt (avant le 1er rendu).
export function applyTheme() {
  document.documentElement.dataset.theme = effective(stored());
}

function updateButton(btn) {
  const m = stored();
  btn.textContent = LABELS[m];
  btn.setAttribute('aria-label', 'Thème : ' + LABELS[m] + ' — cliquer pour changer');
}

export function initTheme(btn) {
  applyTheme();
  if (btn) {
    updateButton(btn);
    btn.addEventListener('click', () => {
      const next = ORDER[(ORDER.indexOf(stored()) + 1) % ORDER.length];
      try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
      applyTheme();
      updateButton(btn);
    });
  }
  // En mode « auto », suivre les changements de thème système en direct.
  mq.addEventListener('change', () => {
    if (stored() === 'auto') applyTheme();
  });
}
