# Doceria — Point de reprise (handoff)

> **But : permettre à une NOUVELLE conversation de reprendre exactement ici.**
> À lire en premier, puis `SPEC.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `RAG-V2-ilaas.md`.
> Mis à jour : 2026-06-25.

## 1. Ce qu'est Doceria
App de bureau **Tauri v2** (macOS Apple Silicon ; Linux à venir), « Enseigner avec l'IA ».
Interroge l'**API ILaaS** (fédération d'inférence souveraine ESR, compatible OpenAI) : **chat
en streaming** + **RAG géré ILaaS** (OpenGateLLM). Frontend web réutilisé (Vite + JS vanilla)
dans une coquille Rust.

## 2. État global
- **macOS : fonctionnellement complet et soigné.** Reste 1 validation utilisateur (CSP + pdf/docx, voir §8).
- **Linux : non commencé** (build AppImage via SSH Ubuntu prévu).
- **Distribution** : app **non signée** (pas de compte Apple), **Apple Silicon arm64 uniquement**. Guide : `INSTALLATION-macOS.md`.

## 3. Fait, par domaine
**Socle (Phase 1)** — fenêtre native (fermer = quitter), chat streaming SSE (events `chat://delta`) + Stop, couche réseau Rust (reqwest rustls, sans CORS), timeouts.
**Clés & profils (Phase 2)** — trousseau OS (`keyring`). Multi-profils nommés à **deux jetons** (LLM + RAG) + URL + modèle. Clé **jamais** dans le webview (résolue en Rust). `test_connection` (+ version éphémère sans persistance). Choix du modèle par menu (rempli au test de la clé).
**RAG géré ILaaS** — `rag.rs` : `rag_me`, collections (créer/lister **filtré « mes collections »**/supprimer), upload multipart (+ MIME), get/delete document, `search` hybride, `rerank`, `list_dir_files` (récursif, ignore symlinks). Plugin **dialog** natif. UI « Bibliothèque (RAG) » : collection active, création **inline**, ajout fichiers/dossier avec progression, garde-fou « crée une collection d'abord ». Chat : interrupteur **« Utiliser la bibliothèque »** → `search` → injection des extraits (balisés `<<<EXTRAIT>>>`, **anti prompt-injection**) + **citations [n]** + bloc **Sources** (nom de doc résolu).
**DA & thème (Phase 3) — FAIT** — charte **« Atelier »** (papier chaud, pétrole, or) en variables CSS, **claire + sombre**. Thème **clair/sombre/auto** (suit le système), bouton dans la barre, persisté (`theme.js`). **Vibrance macOS** (fenêtre `transparent` + `windowEffects` sidebar, `macOSPrivateApi` ; colonnes translucides `--panel-bg`, centre opaque). **Mémorisation fenêtre** (`tauri-plugin-window-state`). **Colonnes pliables** (chevrons ❮/❯ dans la barre, persisté). Aide **« ? »** (gras, infobulle en `position:fixed` calculée en JS → jamais rognée). **Modèles de consigne système** (presets) + feedback « appliquée ».
**Finitions macOS** — **renommage de conversation inline** (le `window.prompt` n'est pas géré par la webview Tauri — règle générale : toujours des champs inline). **CSP** stricte (à valider, §8). `INSTALLATION-macOS.md`.

**Réglages avancés chat & RAG (inspiré AnythingLLM) — FAIT** — **Mode Chat ⇄ Requête** : contrôle segmenté près de l'interrupteur « Utiliser la bibliothèque » ; « Requête » répond strictement depuis les extraits, avec **garde-fou « Query »** (si la recherche aboutit sans aucun extrait → refus direct *« Je ne trouve pas la réponse dans la bibliothèque. »* sans appel LLM, en distinguant 0 résultat d'une erreur réseau via `ragSearched`). La consigne RAG bascule dans `buildMessages`. **Réglages de récupération** (section Bibliothèque) : **méthode** (`hybrid`/`semantic`/`lexical`), **top-k** (1–20), **seuil de similarité** (`score_threshold`, 0 = off ; param ajouté à `rag_search`, envoyé si > 0). **Reranking** (état de l'art) : pipeline `retrieveFromLibrary` = recherche (vivier élargi `min(20, max(topK*3,10))`) → `rag_rerank` (`bge-reranker-v2-m3`, `top_n` n'est envoyé que si demandé) → tri par `relevance_score` → `slice(0, topK)` ; interrupteur `ragRerank` (défaut **activé**), repli silencieux si indispo. **Mémoire** (section Génération) : nombre de tours d'historique renvoyés (0 = illimité ; bornage `slice(-(N*2+1))`). Tout est **persisté** (localStorage) et hydraté au chargement. **Sections du rail droit pliables** : chevron par titre (`data-section`), clic/clavier, état mémorisé (`doceria_sections`), **pliage non destructif** (ne réaffiche pas `#profileEditor` masqué par ailleurs).

**Synchro dossier ↔ collection — FAIT** — « Lier un dossier » à la collection active → import + suivi ; bouton **« ↻ Synchroniser »** = diff incrémental (ajout / maj sur taille+mtime ms / **retrait** de ce qui a disparu du disque) ; option **`ragAutoSync`** (« synchroniser à l'ouverture du profil »). Index local `localStorage doceria_sync_v1`, clé `profil::collection` → `{collectionId, folder, files:{path:{documentId,size,mtime}}}`. Commande Rust **`list_dir_entries`** (taille+mtime ms ; factorise `walk_supported` avec `list_dir_files`). Ne touche **jamais** aux documents ajoutés à la main (hors index). **Durci après revue adversariale (2 agents)** : profil **figé** passé à `syncCollection`/`ragApi.upload|deleteDocument` (jamais d'écriture sur le mauvais profil), **verrou global `syncing`** (couvre `runSync` ET `autoSyncProfile`), **`saveSyncMap` incrémental** (robuste à une fermeture en cours), **`extractDocId`** tolérant aux variantes de schéma, **purge de l'index** dans `onDeleteCollection`, garde anti-suppression-collection-pendant-sync. *(Détaillé : voir backlog ROADMAP.)*

**Positionnement « Ce qui distingue Doceria » — FAIT** — section sur le site (`docs/index.html`, `#distinction`) + `README.md`, **cadrage positif** (cite AnythingLLM sans tableau frontal), claims **vérifiés par recherche web** (juin 2026) : AnythingLLM = synchro **mono-fichier** (pas de dossier — *« cannot watch an entire directory »*), **Electron**, clés chiffrées en **SQLite**, **télémétrie anonyme par défaut** (désactivable). Doceria = souverain ESR natif, dossier↔collection, Tauri, trousseau OS, zéro télémétrie. Caveat honnête conservé (AnythingLLM plus riche : agents, connecteurs, multi-utilisateur).

**Site web (GitHub Pages) — FAIT** — site premium dans **`docs/`** (Fraunces + IBM Plex Sans + Bootstrap + Font Awesome, palette Atelier), publié via Pages « Deploy from a branch → `main` `/docs` » (`.nojekyll`). **En ligne : https://jedi-openlab.github.io/doceria/**. Sources : `docs/index.html`, `docs/style.css`, `docs/assets/`. *(À FAIRE par l'utilisateur : déposer `screen-1.png`/`screen-2.png`/`screen-3.png` dans `docs/assets/` pour la section « Aperçu » ; créer une Release GitHub avec le `.dmg` pour le bouton « Télécharger ».)*

## 4. Carte du code
**Front** (`src/`) : `main.js` (orchestration), `api.js` (invoke : chat/profils/RAG + dialog), `state.js`, `ui.js`, `theme.js`, `conversations.js`, `documents.js` (pdf.js/mammoth), `styles.css` (variables Atelier clair+sombre).
**Rust** (`src-tauri/src/`) : `lib.rs` (commandes, plugins, fenêtre, charge les profils), `ilaas.rs` (chat/list_models/test + helpers HTTP `pub(crate)` : client/send_error/http_error/normalize_base), `keychain.rs` (secrets, write-only), `settings.rs` (profils en `appDataDir/settings.json` + `resolve(profil, "llm"|"rag")`), `rag.rs` (client OpenGateLLM).
**Config** : `Cargo.toml` (reqwest rustls+multipart ; keyring par plateforme : apple-native macOS / async-secret-service+crypto-rust Linux / windows-native ; plugins dialog + window-state ; `tauri` feature `macos-private-api`). `tauri.conf.json` (identifiant `fr.jedi-openlab.doceria`, vibrance, CSP, bundle « all »). `capabilities/default.json` (`core:default` + `dialog:default`).

## 5. API ILaaS (vérifié en live)
- **Inférence** : `https://llm.ilaas.fr/v1`, modèle de chat **`mistral-medium-latest`**. *(Catalogue maj : `gpt-oss-120b`/llama retirés le 2026-10-01 ; nouveaux `qwen-3.6-35b-instruct`, `gemma-4-31b`, `mistral-small-4-119b`.)*
- **RAG** : `https://rag-api.ilaas.fr/v1` (OpenGateLLM, ex-Albert). **DEUX clés distinctes** (jamais réutiliser la clé d'inférence sur le RAG). Contrat complet : `docs/RAG-V2-ilaas.md`.
  - Collections : `visibility` `private`/`public`, champ `owner` (email). On ne liste que `private` || owned.
  - `POST /search` : `{collection_ids, query, method:semantic|lexical|hybrid, limit, score_threshold, rff_k}` → `data:[{score, chunk:{content, document_id, metadata}}]`.
  - `GET /me/usage` (conso, cost+tokens) ; `GET /me/info` (id, email, permissions, limits).
  - ⚠️ **`POST /documents` renvoie 502 sur les PDF** (parser PDF d'ILaaS cassé/instable — constaté en live 2026-06) ; le **texte brut** (`.md`) passe. **Contournement en place** : l'app **extrait le texte des PDF/DOCX EN LOCAL** (pdf.js/mammoth, `documents.js`) puis l'envoie en `.md` via `rag_upload_text` (commande Rust `read_file` lit les octets → IPC binaire → extraction → upload texte). Centralisé dans `uploadFileSmart()` (utilisé par `uploadPaths` ET la synchro). **PDF scanné** = extraction vide → relève de l'**OCR** (le seul cas restant). **Feedback** : toast d'upload global `#uploadToast` (progression + erreur, visible même rail replié / en glisser-déposer).

## 6. Conventions de travail (IMPORTANT — à respecter dès la reprise)
- **Versionnage** : schéma **`AAAAMMJJ.ii.0`** (date du jour · itération du jour · 0), p. ex. `20260626.1.0` puis `20260626.2.0`, lendemain `20260627.1.0`. **Doit rester du semver valide** (3 parties, sans zéro initial) → mis dans `tauri.conf.json` ET `Cargo.toml`. La vérif de mise à jour compare ce numéro au tag de release GitHub (taguer `vAAAAMMJJ.ii.0`).
- **Git** : **l'utilisateur pousse LUI-MÊME via SourceTree**, jamais l'assistant. **AUCUN trailer `Co-Authored-By: Claude`.** Donner un **message de commit court** à chaque jalon. **Cocher les NOUVEAUX fichiers** dans SourceTree (piège récurrent : ils ne sont pas cochés par défaut → build cassé). Identité : compte **JEDI-OpenLab** (jamais DrJohn).
- **Build (outil Bash)** : préfixer `export PATH="$HOME/.cargo/bin:$PATH"` (cargo absent du shell non-interactif). **Frontend modifié → rechargement à chaud** (`npm run tauri dev` déjà lancé par l'utilisateur). **Rust/config modifié → REDÉMARRER** `tauri dev`. Réseau/build → `dangerouslyDisableSandbox: true`.
- **Clés API** : **ne jamais persister** (ni mémoire, ni fichier). L'utilisateur les colle dans l'app (trousseau). Pour un test live de l'API, usage transitoire uniquement, puis effacer.
- **SSH Linux** : alias `lcn-ubuntu` (`jean@192.168.1.171`, clé `~/.ssh/id_ed25519_lcn`) **déjà autorisé** sur l'Ubuntu Studio 24.04 (Apple… non, Ubuntu). Mais **demander un feu vert explicite « connecte-toi »** avant chaque connexion (le garde-fou bloque sinon). Pas de mot de passe (clé only).
- **Revue** : lancer un **workflow adversarial** (Workflow tool) avant de clore les phases lourdes (fait : clés, RAG, macOS).
- **Webview Tauri** : `window.prompt()` **ne marche pas** → toujours des champs inline.

## 7. Prochaines étapes (demandées par l'utilisateur, AVANT Linux)
1. **Mode Chat ⇄ Requête** (façon AnythingLLM) : contrôle segmenté. *Requête* = consigne « réponds **uniquement** à partir des extraits, sinon dis ‘non trouvé’ » (ajuster `buildMessages`/`ragContext` dans `main.js`). *Chat* = comportement actuel.
2. **Réglages de récupération** : exposer **top-k** (`rag_search` limit, figé à 5), **seuil de similarité** (`score_threshold`), **méthode** (`semantic`/`lexical`/`hybrid`). + **Mémoire** : limiter le nombre de tours envoyés (tronquer `conv.messages` dans `buildMessages`).
3. **Chevrons de SECTIONS du rail droit** : envelopper chaque section (`<h2>` + contenu) dans un bloc **pliable**, chevron sur le titre, état persisté (comme les colonnes).
4. **Linux** : build AppImage sur Ubuntu (SSH), valider trousseau `async-secret-service`, `webkit2gtk-4.1`, pdf/docx, et la CSP.
- **Backlog** : mode Agent (function-calling), **sync dossier↔collection** incrémentale (hash/mtime), **site GitHub Pages** (présentation + limites), signature/notarisation (si distribution).

## 8. En attente de validation
- **Test utilisateur (macOS)** après redémarrage : l'app **se lance** (CSP ne casse pas l'écran), **chat + RAG** OK, et **charger un PDF puis un DOCX** (« Document de contexte ») fonctionne (point sensible de la CSP). Si écran blanc / PDF KO → ajuster/retirer la CSP (`tauri.conf.json` `security.csp`).
- **Vérif macOS** : faite (1 medium « app endommagée » → corrigé dans `INSTALLATION-macOS.md` ; reste des confirmations ; aucun blocker).
- **Site web** : en ligne. À faire par l'utilisateur — déposer `screen-1.png`/`screen-2.png`/`screen-3.png` dans `docs/assets/` (section « Aperçu ») + créer une **Release** GitHub avec le `.dmg` (bouton « Télécharger »).
- **Vibrance** : validée par l'utilisateur (« ça rend super bien »). Alpha réglable via `--panel-bg` (2 valeurs clair/sombre).
