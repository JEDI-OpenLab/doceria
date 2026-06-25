# Doceria

> **Enseigner avec l'IA.**

Application de bureau **native** (macOS + Linux) pour interroger l'**API ILaaS** — la
fédération d'inférence souveraine de l'enseignement supérieur et de la recherche français
(API compatible OpenAI ; modèle de chat `mistral-medium-latest`). Doceria fait aussi du
**RAG** sur une bibliothèque de documents via le **service RAG géré ILaaS** (collections
privées OpenGateLLM ; le RAG local reste une option différée).

Double-clic pour lancer : pas de terminal, pas de CORS, clés au trousseau du système.

Fonctionnalités : **profils de connexion** multiples (chaque profil porte ses clés LLM + RAG
au trousseau, son URL et son modèle), **chat en streaming** avec Stop, réglages de génération
(température, longueur, consigne système + **modèles de consigne** enregistrables), **mémoire
ajustable** (nombre de tours d'historique envoyés), **multi-conversations** (créer / renommer /
supprimer + export Markdown), **bibliothèque RAG** (collections + ajout de documents/dossier)
avec **modes Chat ⇄ Requête** (réponse strictement fondée sur les documents, sinon « non trouvé »)
et **réglages de récupération** (méthode `hybrid`/`semantic`/`lexical`, nombre d'extraits, seuil
de similarité), chargement de documents de contexte ponctuels (txt, md, csv, json, pdf, docx).
Interface soignée : **thème clair/sombre/auto**, **vibrance macOS**, **colonnes et sections
pliables**, aides contextuelles.

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

Dans l'app : crée un **profil** (rail « Connexion » → **+ Nouveau**), colle ta **clé d'inférence**
(URL `https://llm.ilaas.fr/v1` par défaut), **Tester** récupère les modèles ; ajoute si besoin
l'**URL + clé RAG** (`https://rag-api.ilaas.fr/v1`) pour activer la bibliothèque. Les clés vont
au trousseau du système — aucune variable d'environnement requise (cf. `.env.example`).

## Build (application distribuable, non signée)

```bash
npm run tauri build
```

- **macOS — Apple Silicon (arm64) uniquement** : `Doceria.app` + `Doceria_<version>_aarch64.dmg`
  (`src-tauri/target/release/bundle/`). Le build se fait sur un Mac Apple Silicon → app **arm64**
  native (pas d'Intel — cible arm64 conforme au matériel Apple Silicon visé). Build **non signé** → au 1ᵉʳ lancement :
  clic droit → **Ouvrir**, ou Réglages Système → Confidentialité et sécurité → « Ouvrir quand même ».
  Guide utilisateur pas-à-pas : [`INSTALLATION-macOS.md`](INSTALLATION-macOS.md).
- **Linux** (à builder sur une machine Linux) : `.AppImage` (+ `.deb`/`.rpm`).

## Structure du dépôt

```
doceria/
├── index.html              # point d'entrée du frontend (Vite)
├── vite.config.js          # bundler frontend de Tauri (port 1420 ; plus de proxy)
├── public/logo.png         # logo affiché dans l'UI
├── branding/               # source du logo (icônes générées via « tauri icon »)
├── src/                    # UI réutilisée
│   ├── main.js             # orchestration : profils, modèles, chat, bibliothèque RAG
│   ├── api.js              # invoke(...) : chat, profils, RAG (+ listen('chat://delta'))
│   ├── state.js  ui.js  conversations.js  documents.js  styles.css
├── src-tauri/              # coquille Rust (Tauri v2)
│   ├── src/ilaas.rs        # réseau ILaaS : list_models, chat streaming, cancel, test
│   ├── src/keychain.rs     # secrets au trousseau OS (write-only)
│   ├── src/settings.rs     # profils (métadonnées non sensibles, appData)
│   ├── src/rag.rs          # RAG géré : collections, upload, search, rerank
│   ├── src/lib.rs  main.rs # entrée, commandes, fenêtre (fermer = quitter)
│   ├── tauri.conf.json     # config app (nom, fenêtre, identifiant, bundle)
│   ├── capabilities/  icons/  Cargo.toml
└── docs/                   # SPEC, ARCHITECTURE, ROADMAP, SETUP, RAG-V2-ilaas, KICKOFF
```

## Sécurité de la clé

Les clés ILaaS (inférence **et** RAG) sont **nominatives** et **facturées**. Elles vivent dans
le **trousseau du système** (Keychain macOS / Secret Service Linux), rattachées à un profil ;
elles ne transitent jamais par le webview ni par un fichier (la résolution clé → requête se
fait dans le cœur Rust). Ne placez jamais de clé en clair dans un fichier versionné.

> ⚠️ **macOS, app non signée** : au premier accès au trousseau, macOS peut afficher
> « Doceria souhaite utiliser le trousseau » — c'est attendu. L'app n'étant pas signée
> (signature ad-hoc), l'autorisation peut être redemandée après une reconstruction ; une
> signature/notarisation (hors V1) la rendrait stable.

## Licence

Doceria est publié sous **double licence** (voir [`LICENSE`](LICENSE)) :
- **Code source** : licence **MIT**.
- **Contenus originaux JEDI-OpenLab** (documentation, ressources) : **CC BY 4.0**.

L'API ILaaS, les modèles et les bibliothèques tierces (pdf.js, mammoth, Tauri) conservent
leurs licences propres.
