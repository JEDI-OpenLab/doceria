# Doceria : Prérequis & installation (Tauri)

> À faire **une fois** sur la machine de développement pour compiler l'application.
> La version publiée est **20260706.1.0** (macOS arm64, non signée).

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
La webview (WKWebView) est fournie par macOS, rien à installer de plus.

macOS arm64 est la **seule** plateforme livrée. Windows et Linux sont sur la feuille de route
(ordre acté : **Moodle avant Linux**), voir la section « Linux » plus bas.

## CLI Tauri (dans le projet)
La CLI et l'API Tauri sont **déjà déclarées** dans `package.json`
(`@tauri-apps/cli` ^2.11.3 en devDependency, `@tauri-apps/api` en dependency). Le scaffolding
est fait. Il suffit d'installer les dépendances du projet :
```bash
npm install
```

## Commandes de développement
```bash
npm run tauri dev      # lance l'app en développement (rechargement à chaud du frontend)
npm run tauri build    # produit l'app (.app/.dmg sur Mac), NON signée
```

## Note « ouvrir une app non signée » (macOS)
Le build est **non signé** (pas encore de signature ni de notarisation Apple). Au 1ᵉʳ lancement :
**clic droit sur l'app → Ouvrir** (puis confirmer), ou **Réglages Système → Confidentialité et
sécurité → « Ouvrir quand même »**. À faire une seule fois.

> Sur la feuille de route : **signature / notarisation** (levée de la quarantaine macOS ; côté
> Windows, signature Authenticode + SmartScreen) lorsque le portage multiplateforme avancera.

## Secrets & données privées
- Les secrets (jetons ILaaS, **jetons Moodle**, mots de passe) vivent **uniquement dans le
  trousseau du système d'exploitation**, jamais dans un fichier versionné.
- Aucune donnée privée (IP, jeton, chemin personnel, nom d'hôte) dans un fichier suivi par git :
  utiliser des placeholders. Les vraies valeurs de test Moodle vivent dans `MOODLE-LOCAL.md`
  (gitignoré).

## Connecteur Moodle (guides)
Le connecteur Moodle (lecture seule) est **publié et disponible dans la version 20260706.1.0
(2026-07-06)**.
- `docs/MOODLE-TEST-PLAN.md` : plan de test **public** (configuration admin, validation, mapping).
- `MOODLE-LOCAL.md` : valeurs réelles de l'environnement de test (**gitignoré**, jamais committé).
- Référence de vérité : `docs/MOODLE-IMPLEMENTATION-ROADMAP.md` et `src-tauri/src/moodle.rs`.

## Linux (Debian/Ubuntu), *à venir*
Le build Linux (AppImage) **n'est pas livré** : il fait partie de la feuille de route, **après**
le connecteur Moodle. Pour référence, les dépendances système Tauri sont :
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
*(Autres distributions : équivalents de `webkit2gtk` et `appindicator`, à adapter.)*

## État des prérequis (vérifié le 2026-06-25, machine macOS de l'auteur)
- [x] **Rust OK** : `rustup` (installé via Homebrew) + toolchain `stable-aarch64-apple-darwin`, `cargo`/`rustc` **1.96.0**.
- [x] **Xcode présent** (`/Applications/Xcode.app`), outils de build OK.
- [x] **Node** v22 (le projet web tourne déjà).
- [ ] (Linux) paquets webkit2gtk + build, à faire le jour où le build Linux sera engagé (après Moodle).

> ⚠️ **Particularité rustup Homebrew** : la version Homebrew n'avait pas créé `~/.cargo/bin`. Les raccourcis
> `cargo`/`rustc`/… y ont été recréés (symlinks vers `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/`).
> **Il faut que `~/.cargo/bin` soit dans le PATH**, ajouter à `~/.zshrc` :
> ```bash
> export PATH="$HOME/.cargo/bin:$PATH"
> ```
> Sinon `cargo` est « command not found » dans un nouveau terminal (alors que `rustup` répond).
</content>
</invoke>
