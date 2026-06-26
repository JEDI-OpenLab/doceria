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

// Icônes monochromes (héritent la couleur du bouton via currentColor).
const ICONS = {
  light:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  auto:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/></svg>',
};

function updateButton(btn) {
  const m = stored();
  btn.innerHTML = ICONS[m];
  const label = 'Thème : ' + LABELS[m] + ' (cliquer pour changer)';
  btn.setAttribute('aria-label', label);
  btn.setAttribute('title', label);
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
