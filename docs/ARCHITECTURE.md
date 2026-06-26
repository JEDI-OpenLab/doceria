# Doceria — Architecture technique (cible Tauri)

> Document de passation. Détaille les choix techniques et la migration depuis l'app web existante.
>
> **⚠️ Doc de cadrage (historique).** L'application est réalisée ; le **RAG géré ILaaS** est implémenté (le RAG local est resté optionnel). État courant : `../README.md` + site (section « Mode d'emploi »).

## 1. Pourquoi Tauri
- App **légère** (~10–15 Mo) et **démarrage quasi instantané** → ressenti premium.
- **Webview système** (WKWebView macOS / WebKitGTK Linux) au lieu d'embarquer Chromium.
- **Accès natif à l'OS** : trousseau, menus, notifications, dialogues de fichiers, glisser-déposer,
  vibrance/translucidité macOS, détection du thème système, accès système de fichiers.
- **Multiplateforme** macOS + Linux (+ Windows plus tard) **sans refonte**.
- **Réutilise Vite** comme outil de build du frontend → on garde l'UI HTML/CSS/JS existante.

Alternatives écartées : **Electron** (lourd, moins natif), **SwiftUI** (macOS uniquement + réécriture totale de l'UI).

## 2. Structure cible du dépôt
Tauri se greffe **autour du projet Vite existant** :
```
doceria/
├── index.html              # (existant) frontend Tauri — conservé
├── src/                    # (existant) UI JS/CSS — conservé, adapté (couche réseau)
│   ├── main.js  state.js  conversations.js  documents.js  ui.js  styles.css
│   └── api.js              # ADAPTÉ : appelle les commandes Tauri natives au lieu de fetch(/ilaas)
│   └── rag.js              # NOUVEAU (front) : pilote l'indexation/recherche via commandes Tauri
├── src-tauri/              # NOUVEAU : la coquille Rust
│   ├── Cargo.toml
│   ├── tauri.conf.json     # config app (nom, icône, fenêtre, permissions, vibrance…)
│   ├── build.rs
│   └── src/
│       ├── main.rs         # point d'entrée, enregistre les commandes
│       ├── ilaas.rs        # appels HTTP natifs à ILaaS (chat streaming, models)
│       ├── keychain.rs     # lecture/écriture des clés au trousseau
│       ├── rag/            # moteur RAG LOCAL (parse, chunk, embeddings, vector store, retrieval)
│       └── library.rs      # scan dossier, indexation incrémentale, watch
│                           # (V2 : rag_ilaas.rs — client passerelle gérée, voir docs/RAG-V2-ilaas.md)
├── package.json            # scripts vite + tauri
├── docs/                   # cette passation
└── (à retirer pendant la migration) vite.config.js:proxy, server.js, bouton Quitter
```

## 3. Réutilisé vs remplacé
**Réutilisé tel quel** (le frontend) : `index.html`, `styles.css`, `state.js`, `conversations.js`,
`documents.js`, `ui.js`, et la logique de chat/streaming/conversations.

**Remplacé / supprimé** :
- `vite.config.js` → on **retire le proxy `/ilaas`** (plus besoin : appels natifs). Vite reste comme bundler frontend de Tauri.
- `server.js` → **supprimé** (c'était le backend de prod web ; Tauri fait office d'hôte natif).
- **Bouton « Quitter »** + endpoint `/__quit` → **supprimés** (fermer la fenêtre arrête tout).
- `src/api.js` → **réécrit** pour appeler des **commandes Tauri** (`invoke('chat', …)`, `invoke('list_models', …)`)
  au lieu de `fetch('/ilaas/...')`. Le streaming passe par des **events Tauri** (emit/listen) plutôt que SSE-fetch.
- Stockage de la clé : `localStorage`/`sessionStorage` → **trousseau OS** via la coquille Rust.

## 4. Couche réseau (ILaaS, natif)
- Les requêtes ILaaS partent du **Rust** (crate `reqwest`), donc **pas de CORS**.
- La **clé est lue dans le trousseau côté Rust** et ajoutée à l'en-tête `Authorization` — elle ne
  transite jamais par le JS/webview.
- **Streaming** : la commande Rust lit le flux SSE et **émet des events Tauri** (`chat://delta`,
  `chat://done`, `chat://error`) ; le frontend `listen()` et affiche au fil de l'eau. **Stop** = annuler
  la requête côté Rust (token d'annulation).
- `list_models` : GET `/v1/models` natif.
- **Conso (V1)** : pas d'endpoint usage côté inférence (`/me/usage` → 404) → on lit le champ `usage` des
  réponses chat. *(V2 : endpoints RAG + `/v1/me/usage` via Rust — voir `RAG-V2-ilaas.md`.)*

## 5. Trousseau (clés)
- Crate `keyring` (multiplateforme : Keychain macOS, Secret Service Linux).
- Une entrée par clé nommée. Le frontend ne voit jamais la valeur ; il manipule des **identifiants/labels**.
- Profil par clé (nom, **URL de base**, **modèle par défaut**) : la valeur secrète au trousseau, les
  métadonnées non sensibles dans le store de préférences (fichier app data).

## 6. RAG — local, géré par l'app (cœur V1)
> **V1 = 100 % local** (le RAG géré ILaaS exige un **jeton RAG séparé**, demandé/en attente — V2).

Pipeline : **dossier → scan → parse → chunk → embeddings (LOCAL) → base vectorielle locale → retrieval → génération ILaaS**.

- **Sélection du dossier** : dialogue natif Tauri ; permission persistée (bookmark macOS, chemin sous Linux).
- **Parse** : pdf/docx/txt/md/csv/json… Recommandation : **côté Rust** (perf, hors-webview, multithread).
- **Chunking** : par paragraphes/tokens avec léger chevauchement ; conserver `source` (fichier + page/offset).
- **Embeddings — LOCAL** : crate Rust **`fastembed`** (ONNX), modèle **`bge-m3`** (multilingue, le même qu'ILaaS).
  Garder une abstraction `Embedder` pour brancher l'embeddings ILaaS en V2 **sans refonte**.
- **Base vectorielle locale** : **LanceDB** (native Rust) ou `sqlite-vec`, dans le dossier de données.
- **Indexation incrémentale** : table `files(path, hash, mtime, chunks)` ; ne (ré)indexer que le nouveau/modifié.
- **Scan** : commande Rust en tâche de fond, émet la progression ; bouton manuel + **auto au lancement**. Watch = P1.
- **Retrieval** : embed de la requête → **top-k** cosinus → injection + **citations** (fichier, page).
- **PDF scannés** : OCR local optionnel (tesseract) ou journalisés/ignorés.

> **V2 — RAG géré ILaaS** (si jeton RAG) : bascule de l'`Embedder` + du store local vers la passerelle
> OpenGateLLM (collections, documents, search, rerank, OCR serveur, `/me/usage`). Contrat d'API **vérifié**,
> procédure d'accès et **brouillon de demande** : **`RAG-V2-ilaas.md`**.

## 7. Thème & fenêtre
- **Dark auto** : écouter le thème système (Tauri `window.theme()` + `prefers-color-scheme` côté CSS) ;
  toggle manuel clair/sombre/auto. Le CSS existant gère déjà des variables — ajouter un jeu sombre.
- **Vibrance macOS** : `tauri.conf.json` (effet `under-window`/`sidebar`) pour le rendu translucide premium.
- **Fenêtre** : taille mémorisée ; **fermer = quitter**.

## 8. Persistance
- **Préférences** + **métadonnées de clés** + **conversations** : fichiers JSON dans le **dossier de données
  de l'app** (Tauri `appDataDir`), plus robuste que le `localStorage` web.
- **Secrets** (valeurs de clés) : **trousseau** uniquement.
- **Index vectoriel (V1)** : base **locale** (LanceDB / `sqlite-vec`) dans le dossier de données + table
  `files(path, hash, mtime, chunks)` pour l'indexation incrémentale.

## 9. Prérequis & build
Voir `SETUP.md`. En bref : chaîne Rust + dépendances système, `npm run tauri dev` (dev),
`npm run tauri build` (produit .app/.dmg et AppImage non signés).

## 10. Risques & points de vigilance
- **1ʳᵉ indexation longue** (gros dossier) → progression + tâche de fond obligatoires.
- **Taille de l'app** avec l'embedder local (`bge-m3`, ~100–400 Mo) → acceptable, à mesurer.
- **Permissions FS macOS** (sandbox/bookmarks) → tester la persistance de l'autorisation au redémarrage.
- **PDF scannés** (sans couche texte) → OCR local optionnel, sinon journaliser/ignorer.
- **Souveraineté (V1)** : embeddings et index **restent locaux** ; seule la génération sort vers ILaaS.
- **V2 (RAG géré)** : conditionné à l'obtention d'un **jeton RAG** séparé — voir `RAG-V2-ilaas.md`.
