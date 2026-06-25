import { defineConfig } from 'vite';

// Configuration Vite pour Tauri.
// Vite ne sert plus que de bundler du frontend : plus de proxy `/ilaas` (les appels
// réseau partent du Rust, sans CORS) ni de plugin « Quitter » (fermer la fenêtre suffit).
//
// Tauri attend un serveur de dev sur un port fixe (cf. devUrl de tauri.conf.json).
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: 'localhost',
  },
  // Empêche Vite d'embarquer des variables sensibles : seules VITE_*/TAURI_* sont exposées.
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2021',
    minify: 'esbuild',
    sourcemap: false,
  },
});
