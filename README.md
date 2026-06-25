# Doceria

> **Enseigner avec l'IA.**

Application de bureau **native** (macOS + Linux) pour interroger l'**API ILaaS** — la
fédération d'inférence souveraine de l'enseignement supérieur et de la recherche français
(API compatible OpenAI ; modèle de chat `mistral-medium-latest`). Doceria fera aussi du
**RAG** sur une bibliothèque de documents (indexation **locale** en V1).

Double-clic pour lancer : pas de terminal, pas de CORS, clés au trousseau du système.

Fonctionnalités (reprises du portail web) : connexion + liste des modèles, **chat en
streaming** avec Stop, réglages de génération (température, longueur, consigne système),
**multi-conversations** (créer / renommer / supprimer + export Markdown), chargement de
documents de contexte (txt, md, csv, json, pdf, docx).

## Stack

- **Frontend** : Vite + JavaScript vanilla (l'UI HTML/CSS/JS du portail web, réutilisée telle quelle).
- **Coquille native** : **Tauri v2** (Rust + webview système). La couche réseau ILaaS
  (liste des modèles, chat streaming) est en Rust (`reqwest`) → appels natifs, **sans CORS**,
  la clé ne transite pas par le webview.

Voir `docs/ARCHITECTURE.md` pour le détail, `docs/ROADMAP.md` pour le phasage.

## Prérequis

Chaîne Rust + dépendances système (et Node 18+). Procédure complète : **`docs/SETUP.md`**.
En bref : `rustup` (cargo/rustc), Xcode (macOS) ou `libwebkit2gtk-4.1-dev` & co (Linux), Node.

## Développement

```bash
npm install
npm run tauri dev      # ouvre la fenêtre native, rechargement à chaud du frontend
```

La clé API se saisit dans le champ **« Clé API »** de l'interface (transmise au cœur Rust via
`invoke`). L'URL de base par défaut est `https://llm.ilaas.fr/v1`, modifiable dans l'UI.
Aucune variable d'environnement n'est requise (cf. `.env.example`).

## Build (application distribuable, non signée)

```bash
npm run tauri build
```

- **macOS** : `Doceria.app` + `Doceria_<version>_aarch64.dmg`
  (`src-tauri/target/release/bundle/`). Build **non signé** → au 1ᵉʳ lancement :
  clic droit sur l'app → **Ouvrir**, ou Réglages Système → Confidentialité et sécurité →
  « Ouvrir quand même ». À faire une seule fois.
- **Linux** (à builder sur une machine Linux) : `.AppImage` (+ `.deb`/`.rpm`).

## Structure du dépôt

```
doceria/
├── index.html              # point d'entrée du frontend (Vite)
├── vite.config.js          # bundler frontend de Tauri (port 1420 ; plus de proxy)
├── public/logo.png         # logo affiché dans l'UI
├── branding/               # source du logo (icônes générées via « tauri icon »)
├── src/                    # UI réutilisée
│   ├── main.js             # orchestration et événements
│   ├── api.js              # appels natifs : invoke(list_models|chat) + listen('chat://delta')
│   ├── state.js  ui.js  conversations.js  documents.js  styles.css
├── src-tauri/              # coquille Rust (Tauri v2)
│   ├── src/ilaas.rs        # couche réseau ILaaS : list_models, chat streaming, cancel_chat
│   ├── src/lib.rs  main.rs # entrée, commandes, fenêtre (fermer = quitter)
│   ├── tauri.conf.json     # config app (nom, fenêtre, identifiant, bundle)
│   ├── capabilities/  icons/  Cargo.toml
└── docs/                   # SPEC, ARCHITECTURE, ROADMAP, SETUP, RAG-V2-ilaas, KICKOFF
```

## Sécurité de la clé

La clé ILaaS est **nominative** et **facturée**. En V1, elle est saisie dans l'UI puis passée
au cœur Rust qui l'ajoute à l'en-tête `Authorization` (elle ne circule pas hors du process).
La **Phase 2** la déplacera dans le **trousseau du système** (Keychain macOS / Secret Service
Linux). Ne placez jamais de clé en clair dans un fichier versionné ; `.env` est gitignore.

## Licence

Projet interne JEDI-OpenLab. L'API ILaaS, les modèles et les bibliothèques tierces
(pdf.js, mammoth, Tauri) conservent leurs licences propres.
