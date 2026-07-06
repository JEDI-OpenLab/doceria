# Doceria : Architecture technique (Tauri)

> Document de passation. Décrit l'architecture réelle de l'application de bureau (coquille Rust
> Tauri + frontend Vite) telle qu'elle est livrée, et résume la feuille de route.
>
> **État courant.** Version publiée : **20260706.1.0** (macOS arm64, **non signée**). Le **RAG livré
> est le RAG géré par l'infrastructure ESR (OpenGateLLM / ILaaS)** ; l'ancien design d'un RAG
> « 100 % local » a été **abandonné** (voir §6). Le **connecteur Moodle** (§7) est **publié / disponible
> dans la version 20260706.1.0 (2026-07-06)**.
> Références de vérité : `../README.md`, `MOODLE-IMPLEMENTATION-ROADMAP.md`, `RAG-V2-ilaas.md`, le site
> (section « Mode d'emploi »), et le code (`src/`, `src-tauri/src/`).

## 1. Pourquoi Tauri
- App **légère** (~15 Mo) et **démarrage quasi instantané**.
- **Webview système** (WKWebView macOS) au lieu d'embarquer Chromium.
- **Accès natif à l'OS** : trousseau, menus, notifications, dialogues de fichiers, glisser-déposer,
  vibrance/translucidité macOS, détection du thème système, accès système de fichiers.
- **Portage prévu** vers Windows puis Linux **sans refonte** (feuille de route, §10).
- **Réutilise Vite** comme outil de build du frontend → UI HTML/CSS/JS conservée.

Alternatives écartées : **Electron** (lourd, moins natif), **SwiftUI** (macOS uniquement + réécriture
totale de l'UI).

> **Plateformes.** Seul **macOS arm64** est livré aujourd'hui. Windows et Linux sont de la feuille de
> route (ordre acté : **Moodle avant Linux**).

## 2. Structure réelle du dépôt
Tauri se greffe autour du projet Vite existant :
```
doceria/
├── index.html              # frontend (fenêtre Tauri)
├── src/                    # UI JS/CSS — couche réseau via commandes Tauri
│   ├── main.js             # orchestrateur : chat, RAG (recherche/rerank/top-k),
│   │                       #   comparaison de modèles, synchro Moodle, usage
│   ├── api.js              # façade IPC : invoke() vers les commandes Rust (pas de fetch)
│   ├── state.js            # état global + persistance légère (localStorage, aucune clé)
│   ├── conversations.js  documents.js  ui.js  theme.js  styles.css
│   └── (pas de rag.js — le RAG est piloté depuis main.js via ragApi dans api.js)
├── src-tauri/              # coquille Rust
│   ├── Cargo.toml  build.rs  tauri.conf.json
│   └── src/
│       ├── lib.rs          # point d'entrée : menu natif, enregistrement des commandes
│       ├── main.rs         # bootstrap (appelle lib::run)
│       ├── ilaas.rs        # inférence ILaaS (chat streaming SSE, list_models, usage)
│       ├── rag.rs          # client du RAG GÉRÉ (OpenGateLLM / rag-api.ilaas.fr)
│       ├── moodle.rs       # connecteur Moodle REST (lecture seule) + HTML→Markdown maison
│       ├── settings.rs     # profils (métadonnées non sensibles), profils Moodle
│       ├── keychain.rs     # secrets au trousseau OS (rôles llm / rag / moodle)
│       └── update.rs       # vérification de mise à jour, ouverture d'URL
├── package.json            # scripts vite + tauri
└── docs/                   # passation
```

## 3. Frontend ⇄ coquille native
- **Aucun secret côté JS.** Le front manipule des **identifiants/labels** de profils ; les clés vivent
  au trousseau, résolues côté Rust.
- **`src/api.js`** est une façade fine : chaque fonction fait `invoke('<commande>', …)`. Le streaming du
  chat passe par des **events Tauri** (`chat://delta`, `chat://done`, `chat://error`), écoutés côté JS.
- **`src/main.js`** orchestre : construction de la requête, pipeline RAG (recherche → rerank → top-k),
  comparaison multi-modèles, synchro Moodle, affichage conso/coût.

## 4. Couche réseau (ILaaS, natif)
- Les requêtes d'inférence partent du **Rust** (`reqwest`), donc **pas de CORS**.
- La **clé est lue au trousseau côté Rust** (rôle `llm`) et ajoutée à l'en-tête `Authorization` : elle ne
  transite jamais par le JS/webview.
- **Streaming** : la commande `chat` lit le flux SSE `POST /chat/completions` (avec
  `stream_options.include_usage`) et **émet** `chat://delta`. **Stop** = annuler la requête côté Rust.
- `list_models` : `GET /models`.
- **Conso/coût** : commande `fetch_usage`, agrège `GET /me/usage` (paginé, fenêtre serveur ~30 jours)
  par rôle (`llm` ou `rag`) : nombre de requêtes, tokens (entrée/sortie/total), **coût** et **CO₂**
  best-effort (`impacts.gwp`). Le champ `usage` des réponses chat sert d'affichage immédiat.

## 5. Trousseau & profils
- Crate `keyring` (Keychain macOS). Un profil porte **deux jetons distincts** : clé **LLM**
  (`llm.ilaas.fr`, rôle `llm`) et clé **RAG** (`rag-api.ilaas.fr`, rôle `rag`), stockées séparément.
- Les **métadonnées non sensibles** (nom, URL LLM, modèle par défaut, URL RAG optionnelle, profil actif)
  vont dans `settings.json` (dossier de données de l'app) ; le front n'obtient que la **présence** des
  clés (`hasLlmKey`, `hasRagKey`), jamais leur valeur.
- **URLs LLM/RAG en `https://` uniquement** (refus du clair, `upsert_profile`).

## 6. RAG : géré par l'infrastructure ESR (livré)
> **Le RAG livré est le RAG GÉRÉ** (passerelle **OpenGateLLM**, `rag-api.ilaas.fr`), implémenté dans
> `src-tauri/src/rag.rs`. Documents, embeddings, index et OCR **vivent côté infra ESR souveraine**, en
> collections **« private »** (visibles/recherchables par le seul propriétaire). Contrat d'API vérifié :
> `RAG-V2-ilaas.md`.

Pipeline : **document → upload vers une collection gérée (vectorisation serveur bge-m3) →
recherche (semantic/lexical/hybrid) → rerank optionnel → top-k → génération ILaaS avec citations**.

Commandes Rust (`rag.rs`), toutes authentifiées par la clé RAG du profil actif (résolue au trousseau) :
- **Collections** : `rag_list_collections`, `rag_create_collection` (visibility `private`),
  `rag_delete_collection`, `rag_me` (identité `GET /me/info`, pour ne lister que ses collections).
- **Documents** : `rag_upload_document` (multipart, MIME deviné par extension), `rag_upload_text`
  (contenu texte/markdown, sert pour le texte extrait localement et pour Moodle), `rag_list_documents`,
  `rag_get_document` (résolution du nom pour les citations), `rag_delete_document`, `read_file` (IPC
  binaire pour extraire le texte des PDF/DOCX côté front, ce qui **contourne le parser PDF instable**
  du serveur).
- **Recherche / rerank** : `rag_search` (`method` = `semantic | lexical | hybrid`, `limit`,
  `score_threshold` optionnel) ; `rag_rerank` (`bge-reranker-v2-m3`, `top_n` optionnel).

**Pilotage côté front** (`retrieveFromLibrary` dans `src/main.js`) : recherche hybride/… → si le rerank
est activé, on récupère un vivier plus large (jusqu'à 20), on réordonne par pertinence, puis on **écrête
au top-k** ; repli silencieux sur l'ordre de recherche si le rerank est indisponible. Les extraits sont
injectés entre balises `<<<EXTRAIT n>>>…<<<FIN n>>>` **comme données**, avec anti-injection de prompt et
**citations `[n]`**.

**Synchro « dossier → collection » (conservée).** Le front peut **lier un dossier** à une collection et
la **synchroniser à l'ouverture du profil** (`state.ragAutoSync`, `autoSyncProfile()` dans `main.js`).
Le Rust fournit `list_dir_files` / `list_dir_entries` (parcours récursif, extensions supportées, ignore
cachés et liens symboliques, renvoie taille + mtime pour détecter ajouts/modifs/suppressions).

> **Design V1 abandonné (RAG 100 % local).** Le premier design prévoyait un moteur RAG **local** :
> embeddings **`fastembed`/`bge-m3`** en local, base vectorielle **LanceDB / `sqlite-vec`**, index et
> embeddings sur la machine, **OCR `tesseract` local**, table `files(path, hash, mtime, chunks)` pour
> l'indexation incrémentale, et **watch** du dossier. **Cette architecture n'a pas été retenue** : elle
> alourdissait l'app (~100–400 Mo pour l'embedder) et dupliquait des capacités déjà offertes par la
> passerelle gérée. Elle ne subsiste **pas** dans le code livré ; seule demeure la synchro
> « dossier → collection gérée » ci-dessus.

### Correctif : mode Requête (blocage sans appel facturé)
Deux modes de bibliothèque (interrupteur « Utiliser la bibliothèque ») :
- **Chat** (`ragMode = 'chat'`) : s'appuie sur les extraits **en priorité**, complète avec les
  connaissances générales si utile. Si la recherche **échoue**, l'app **prévient** et **répond quand
  même** (repli assumé, avec avertissement).
- **Requête** (`ragMode = 'requete'`) : répond **exclusivement** à partir des extraits. **Correctif
  clé** (`runGeneration` dans `main.js`) : si la recherche RAG **échoue** ou aboutit **sans aucun
  extrait**, le modèle **n'est pas interrogé** (aucun appel facturé) ; l'app affiche un message explicite
  (recherche indisponible, ou phrase de refus configurable `ragRefusal`) au lieu de laisser le modèle
  répondre sur ses connaissances générales.

## 7. Connecteur Moodle (publié / disponible dans la version 20260706.1.0 (2026-07-06))
Module `src-tauri/src/moodle.rs` : **lecture seule stricte**, **aucune donnée personnelle**.

- **Client REST bas niveau `ws_call`** : `POST /webservice/rest/server.php` en form-urlencoded
  (`wstoken`, `wsfunction`, `moodlewsrestformat=json`). Moodle renvoyant souvent ses erreurs en HTTP 200
  (`{exception, errorcode, message}`), on **parse toujours le corps** et on traduit les codes courants en
  messages lisibles.
- **Client HTTP dédié `moodle_client` : redirections DÉSACTIVÉES.** Le jeton voyage dans le **corps** du
  POST ; suivre une 3xx le réémettrait vers l'hôte cible (exfiltration possible sur `http://` LAN ou
  Moodle compromis). Toute redirection est refusée et diagnostiquée.
- **Liste blanche stricte de 8 fonctions de CONTENU** (constante `WHITELIST`, pour audit) :
  `core_webservice_get_site_info`, `core_course_get_categories`, `core_course_get_courses_by_field`,
  `core_course_get_contents`, `mod_page_get_pages_by_courses`, `mod_label_get_labels_by_courses`,
  `mod_resource_get_resources_by_courses`, `mod_book_get_books_by_courses`. Ni notes, ni inscriptions,
  ni participants. **Hors liste blanche**, une seule fonction supplémentaire, **en option** (Lot 7) :
  `core_enrol_get_users_courses`, appelée **uniquement pour le compte technique lui-même** (voir
  filtre opt-in ci-dessous) → jamais de donnée d'étudiant.
- **Test de connexion** (`test_moodle_connection`, `_ephemeral`) : `get_site_info` → renvoie
  site/utilisateur/version, **`downloadfiles`**, et les **fonctions de la liste blanche manquantes** du
  service.
- **Convertisseur HTML → Markdown maison, en Rust, zéro dépendance** (`html_to_markdown` : tokenizer,
  titres/paragraphes/listes/gras/italique/liens/entités, gestion des `<` littéraux et des `>` dans les
  attributs, éléments inline vides supprimés). **Tests unitaires** dans le module. Choix acté (Lot 0) :
  garder l'app légère, pas de `html2md`/`turndown`/`html2text`.
- **Markdown de cours** (`moodle_course_markdown`) : assemble le **texte** d'un cours (résumé du cours +
  titre/résumé de section + descriptions de modules) en un Markdown hiérarchisé (H1 cours · H2 section ·
  H3 module). Renvoie aussi les **métadonnées des fichiers joints** (nom, URL `pluginfile`,
  `timemodified`, taille) pour la synchro des PDF/fichiers.
- **Téléchargement de fichiers** (`moodle_download_file`, Lot 4) : télécharge un fichier `pluginfile`
  d'un cours (jeton dans le **corps** du POST, côté Rust) et renvoie ses **octets** au front, sous
  **garde-fou dur (40 Mo)**. L'**extraction du texte** (PDF/DOCX via `pdf.js`/`mammoth`) se fait **en
  local dans la webview**, puis l'envoi part en `.md`, ce qui **contourne le parser PDF d'ILaaS (502)**.
  Un PDF **scanné** (sans couche texte) est signalé et ignoré, pas d'OCR.
- **Profils de connexion Moodle** (`settings.rs`) : nom + URL (`http://` LAN ou `https://` prod), **jeton
  au trousseau sous le rôle `moodle`**, **indépendants des profils ILaaS**, **plusieurs connexions**
  possibles ; les **cours cochés** sont persistés (`course_ids`).
- **Explorateur de cours (front, `main.js`)** : recherche + filtre par catégorie + cases à cocher,
  sélection persistée ; le bouton **Synchroniser** ingère le texte **et les fichiers** vers une
  collection RAG **« Moodle · <cours> »** du profil ILaaS actif, interrogeable avec citations ;
  **barre de progression par cours/fichier** ; **verrou anti-corruption inter-profils** pendant la synchro.
- **Synchro incrémentale + déduplication** (front, index local `moodleSyncMap`, Lot 5) : re-synchroniser
  **ne duplique plus**. Un **index local** (localStorage) mémorise, par cours, la collection cible et,
  par fichier, `documentId` + `timemodified` + taille. Le **texte** est comparé par **hash** ; les
  **fichiers** par `timemodified` + taille (**pas de téléchargement si inchangé**) ; les fichiers
  **disparus** côté Moodle sont retirés de la collection **et** de l'index. **Bilan détaillé** (ajouts /
  maj / suppressions / ignorés) et **badge « synchronisé »**.
- **Badge « à mettre à jour »** (Lot 5.1) : le bouton **Nouveautés** compare l'état Moodle à l'index
  local et pose un badge **`⟳ à mettre à jour`** sur les cours modifiés côté Moodle depuis la dernière
  synchro (état non conservé d'une ouverture à l'autre).
- **Filtre opt-in « cours inscrits »** (Lot 7, interrupteur `moodleEnrolledOnly`, **défaut ON**) :
  restreint l'explorateur aux **cours où le compte technique est inscrit**, l'inscription de ce compte
  valant **consentement de l'enseignant**. `core_enrol_get_users_courses` n'est appelée que **pour ce
  compte technique** (ses propres cours), **jamais pour un étudiant** → aucune donnée d'étudiant. Le
  mode « tout indexer » (filtre désactivé) relève d'une **décision de la Direction**. Un cours coché
  n'est **jamais retiré en silence** (revue Lot 7).

## 8. Fonctionnalités v8 livrées (rappel)
- **Comparaison multi-modèles** : `state.compareMode` envoie la même question à **deux modèles en
  parallèle**, affichés côte à côte (`runComparison` dans `main.js`).
- **Modes de bibliothèque** Chat / Requête (voir §6) ; **recherche hybride / sémantique / lexicale**,
  **rerank** activable, **top-k** et **seuil de similarité** réglables ; **phrase de refus configurable**.
- **Document de contexte** : un document chargé en mémoire est injecté dans le message système
  (`state.doc`, non persisté).
- **Conso / coût / CO₂** par rôle (§4).
- **Rendu LaTeX** via **KaTeX** (`src/ui.js`) : blocs `$$…$$` / `\[…\]` et en ligne `$…$` / `\(…\)`,
  rendu sûr (sortie KaTeX, `\href` désactivé).
- **Mémoire de conversation** bornée (`memoryTurns`), thème clair/sombre/auto, menu natif macOS.

## 9. Persistance
- **Préférences de génération** + **conversations** : `localStorage` côté webview (migration prévue vers
  `appData`). Aucune clé n'y figure.
- **Métadonnées de profils** (ILaaS et Moodle) + profil actif : `settings.json` dans le dossier de
  données de l'app (`app_data_dir`).
- **Secrets** (clés LLM/RAG, jeton Moodle) : **trousseau OS uniquement**.
- **Documents, embeddings, index RAG** : **côté infra ESR** (collections « private »), pas sur la machine.

## 10. Feuille de route (résumé)
- **Lots 4, 5, 5.1, 7** ; **livrés** (voir §7) : fichiers/PDF, synchro incrémentale + déduplication,
  badge « à mettre à jour », filtre opt-in « cours inscrits ».
- **Lot 6**, interrupteur « Inclure les cours Moodle » dans le chat, **livré (2026-07-03)** :
  recherche RAG multi-collections (collection active + toutes les collections « Moodle · … »).
  **Testé et validé : publié / disponible dans la version 20260706.1.0 (2026-07-06).**
- **Portage Windows** : Tauri multiplateforme + WebView2 + **signature Authenticode**.
- **Version serveur / web** : deux formats (app de bureau vs serveur central sans installation).
- **Linux** (après Moodle).
- **Signature / notarisation** : quarantaine macOS + SmartScreen Windows.

## 11. Prérequis & build
Voir `SETUP.md`. En bref : chaîne Rust + dépendances système, `npm run tauri dev` (dev),
`npm run tauri build` (produit `.app`/`.dmg` **non signés**, macOS arm64).

## 12. Points de vigilance
- **Non signé** : quarantaine macOS à lever manuellement au premier lancement (voir mode d'emploi).
- **Parser PDF serveur instable** (HTTP 502) → extraction du texte **côté front** avant upload en
  `text/markdown` (`read_file` + `rag_upload_text`).
- **Redirections Moodle** : refusées par conception (jeton dans le corps du POST). Une 3xx est souvent le
  symptôme d'un `wwwroot`/https mal configuré côté Moodle.
- **Souveraineté** : en RAG géré, les documents quittent la machine vers l'infra ESR (collections
  « private ») ; c'est le compromis assumé du design retenu.
