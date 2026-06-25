# Doceria — Prérequis & installation (Tauri)

> À faire **une fois** sur la machine de développement, avant la Phase 1.

## macOS
```bash
# 1. Outils de compilation Apple (si absents)
xcode-select --install

# 2. Chaîne Rust (installeur officiel)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
#    → choisir l'installation par défaut, puis ouvrir un NOUVEAU terminal (ou: source ~/.cargo/env)

# 3. Vérifier
rustc --version && cargo --version
node -v        # Node 18+ déjà installé pour le projet web
```
La webview (WKWebView) est fournie par macOS — rien à installer de plus.

## Linux (Debian/Ubuntu)
```bash
# Dépendances système de Tauri (webview + build)
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Chaîne Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
rustc --version && cargo --version
```
*(Autres distributions : équivalents de `webkit2gtk` et `appindicator` — à adapter.)*

## CLI Tauri (dans le projet)
Sera ajouté au `package.json` pendant la Phase 1 :
```bash
npm install -D @tauri-apps/cli
npm install @tauri-apps/api
```

## Commandes de développement (après scaffolding)
```bash
npm run tauri dev      # lance l'app en développement (rechargement à chaud du frontend)
npm run tauri build    # produit l'app (.app/.dmg sur Mac, AppImage sur Linux), NON signée
```

## Note « ouvrir une app non signée » (macOS)
Au 1ᵉʳ lancement d'un build non signé : **clic droit sur l'app → Ouvrir** (puis confirmer), ou
**Réglages Système → Confidentialité et sécurité → « Ouvrir quand même »**. À faire une seule fois.

## État des prérequis (vérifié le 2026-06-25 — machine macOS de l'auteur)
- [x] **Rust OK** — `rustup` (installé via Homebrew) + toolchain `stable-aarch64-apple-darwin`, `cargo`/`rustc` **1.96.0**.
- [x] **Xcode présent** (`/Applications/Xcode.app`) — outils de build OK.
- [x] **Node** v22 (le projet web tourne déjà).
- [ ] (Linux) paquets webkit2gtk + build — à faire le jour où on build sous Linux.

> ⚠️ **Particularité rustup Homebrew** : la version Homebrew n'avait pas créé `~/.cargo/bin`. Les raccourcis
> `cargo`/`rustc`/… y ont été recréés (symlinks vers `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/`).
> **Il faut que `~/.cargo/bin` soit dans le PATH** — ajouter à `~/.zshrc` :
> ```bash
> export PATH="$HOME/.cargo/bin:$PATH"
> ```
> Sinon `cargo` est « command not found » dans un nouveau terminal (alors que `rustup` répond).
