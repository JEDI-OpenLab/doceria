# Doceria — Point de reprise (handoff)

> **But : permettre à une NOUVELLE conversation de reprendre exactement ici.**
> À lire en premier, puis `docs/MOODLE-IMPLEMENTATION-ROADMAP.md` (chantier en cours),
> `docs/ROADMAP-V2.md`, `docs/ARCHITECTURE.md`, `docs/RAG-V2-ilaas.md`.
> Mis à jour : **2026-07-02**.
>
> **Jalon en cours — CONNECTEUR MOODLE en lecture seule, QUASI COMPLET** (branche `moodle`, validé
> de bout en bout, **pas encore publié en .dmg** — destiné à la prochaine version) : **Lots 0-7 +
> 5.1 LIVRÉS et relus**. Profils de connexion Moodle (jeton au **trousseau**), test de connexion
> (**liste blanche de 8 fonctions de contenu**), **explorateur de cours** central (recherche +
> filtre catégorie + cases à cocher), **Synchroniser** = ingestion du **texte** ET des **fichiers/
> PDF** des cours → collection RAG « Moodle · <cours> » interrogeable avec citations, **synchro
> incrémentale + déduplication** (index local ; re-sync ne duplique plus), bouton **Nouveautés**
> (badge « ⟳ à mettre à jour »), filtre **opt-in « cours inscrits »** (consentement de l'enseignant).
> Détail + journal : `docs/MOODLE-IMPLEMENTATION-ROADMAP.md`. **Chaque lot passe une revue
> multi-agents adversariale** avant validation.
>
> **Gouvernance actée — indexation Moodle OPT-IN par consentement** (opt-in par défaut, **jamais
> opt-out**) : l'inscription du compte technique à un cours = accord de l'enseignant ;
> `core_enrol_get_users_courses` appelée **uniquement pour le compte technique** → **zéro donnée
> d'étudiant**. Mode « tout indexer » = décision de la Direction. Sécurité : **lecture seule
> stricte**, jeton au trousseau, client HTTP dédié sans redirections.
>
> **Correctif RAG récent** : en mode **Requête**, si la recherche RAG échoue (ou 0 extrait), le
> modèle **ne répond plus** sur ses connaissances générales — il **bloque** et l'explique (pas
> d'appel facturé). En mode **Chat**, repli assumé **avec avertissement**.

## 1. Ce qu'est Doceria
App de bureau **Tauri v2** (macOS Apple Silicon ; **Windows et Linux = feuille de route**, ordre
acté : **Moodle avant Linux**), « Enseigner avec l'IA ». Interroge l'**API ILaaS** (fédération
d'inférence **souveraine** de l'ESR, compatible OpenAI) : **chat en streaming** + **RAG géré
ILaaS** (OpenGateLLM). Frontend web (Vite + JS vanilla) dans une coquille Rust. Filiation directe
du POC **Learnix**.

## 2. État global
- **Version publiée : `20260626.8.0`** (macOS **arm64**, **non signée** — pas de compte Apple).
  Guide : `INSTALLATION-macOS.md`.
- **macOS : fonctionnellement complet et soigné** (chat, RAG, comparaison multi-modèles, LaTeX…).
- **Connecteur Moodle : TOUS les lots livrés et relus** (0-7 + 5.1, dont le **Lot 6 « Inclure les
  cours Moodle » ✅ 2026-07-03** — dernier lot, fusionnés dans `main`). Lecture seule complète.
  **Reste = test en réel du Lot 6 puis release.** **Pas encore intégré au .dmg publié** → à
  embarquer dans la prochaine version.
- **Windows / Linux : non livrés** (feuille de route). Tauri est multiplateforme → portage Windows
  surtout conditionné par la **signature Authenticode** (+ WebView2), Linux par le build AppImage.

## 3. Fait, par domaine
**Socle** — fenêtre native (fermer = quitter), chat streaming SSE (`chat://delta`) + Stop, couche
réseau Rust (reqwest rustls, sans CORS), timeouts. Menus natifs **en français** + menu **Aide**
(site / mode d'emploi / signaler un problème). Annuler / Régénérer, éditer sa requête, copier une réponse.
**Clés & profils** — trousseau OS (`keyring`). Multi-profils à **deux jetons** (LLM + RAG) + URL +
modèle. Clé **jamais** dans le webview (résolue en Rust). `test_connection` (+ version éphémère).
**RAG géré ILaaS** (`rag.rs`) — `rag_me`, collections (créer/lister filtré « mes collections »/
supprimer), upload multipart + `rag_upload_text`, get/delete document, `search` (hybride/sémantique/
lexicale), `rerank`, `list_dir_files/entries`. UI Bibliothèque : collection active, création inline,
ajout fichiers/dossier avec progression. Chat : **« Utiliser la bibliothèque »** → recherche →
extraits balisés `<<<EXTRAIT>>>` (**anti prompt-injection**) + **citations [n]** + bloc Sources.
**Modes Chat ⇄ Requête** + réglages (méthode, top-k, seuil, reranking, mémoire), message de refus
configurable, **document de contexte**, **conso/coût** (`/me/usage`). **Correctif Requête** (cf. encart).
**Comparaison multi-modèles** côte à côte (coût ×2, contexte RAG partagé). **Rendu LaTeX/KaTeX**
(bundle local). **Ingestion PDF/DOCX par extraction locale** (pdf.js/mammoth → `.md`).
**Synchro dossier ↔ collection** — « Lier un dossier » → import + suivi ; bouton Synchroniser (diff
incrémental sur taille+mtime, retrait des fichiers disparus) ; option `ragAutoSync`. Index local
`localStorage doceria_sync_v1`. Durci par revue adversariale (profil figé, verrou global `syncing`).
**DA & thème** — charte « Atelier », clair/sombre/auto, vibrance macOS, colonnes pliables, sections
du rail pliables. **Site web** (GitHub Pages, `docs/`) en ligne : https://jedi-openlab.github.io/doceria/
**CONNECTEUR MOODLE (branche `moodle`)** — voir encart en tête + `docs/MOODLE-IMPLEMENTATION-ROADMAP.md`.
Module `src-tauri/src/moodle.rs` : client REST `ws_call` (client HTTP **dédié sans redirections** car
le jeton voyage dans le corps du POST), **liste blanche de 8 fonctions de contenu**, convertisseur
`html_to_markdown` **maison** (zéro dépendance, tests unitaires). Front : section Moodle du rail +
explorateur central. **Lots livrés et relus par revue adversariale** :
- **Lot 0-1 — profils + test** : profils de connexion Moodle (jeton au **trousseau**, rôle « moodle »),
  test de connexion via `get_site_info` (liste blanche de 8 fonctions).
- **Lot 2-2.5 — explorateur central** : liste des cours (recherche + filtre catégorie + cases à
  cocher), **sélection persistée**.
- **Lot 3 — texte des cours** : **Synchroniser** = ingestion du **texte** des cours cochés → collection
  RAG « Moodle · <cours> » du profil ILaaS actif, interrogeable avec citations, **barre de progression**.
- **Lot 4 — fichiers/PDF** : téléchargement sécurisé des ressources + **extraction locale** (réutilise
  pdf.js/mammoth, contourne le 502 du parser ILaaS).
- **Lot 5 — synchro incrémentale + déduplication** : index local ; une re-sync **ne duplique plus** ;
  bilan détaillé (ajoutés / inchangés / retirés).
- **Lot 5.1 — Nouveautés** : bouton qui pose un badge **« ⟳ à mettre à jour »** sur les cours modifiés
  côté Moodle.
- **Lot 7 — filtre opt-in « cours inscrits »** : `core_enrol_get_users_courses` appelée **uniquement
  pour le compte technique** (→ zéro donnée d'étudiant) ; interrupteur, **défaut ON** ; l'inscription
  du compte technique vaut consentement de l'enseignant. Mode « tout indexer » = décision Direction.

## 4. Carte du code
**Front** (`src/`) : `main.js` (orchestration + Moodle : explorateur, synchro), `api.js` (invoke :
chat/profils/RAG/**Moodle**/dialog), `state.js`, `ui.js`, `theme.js`, `conversations.js`,
`documents.js` (pdf.js/mammoth), `styles.css`.
**Rust** (`src-tauri/src/`) : `lib.rs` (commandes, plugins, fenêtre, menus), `ilaas.rs` (chat/
list_models/test + helpers HTTP `pub(crate)`), `keychain.rs` (secrets, write-only, rôles llm/rag/
**moodle**), `settings.rs` (profils ILaaS **et Moodle** en `settings.json` + `resolve`/`resolve_moodle`),
`rag.rs` (client OpenGateLLM), **`moodle.rs`** (client WS REST lecture seule + convertisseur HTML→MD),
`update.rs` (vérif de mise à jour).
**Config** : `Cargo.toml` (reqwest rustls+multipart ; keyring par plateforme ; plugins dialog +
window-state ; `macos-private-api`). `tauri.conf.json` (identifiant `fr.jedi-openlab.doceria`, CSP
autorisant KaTeX, bundle « all »).

## 5. API ILaaS (vérifié en live)
- **Inférence** : `https://llm.ilaas.fr/v1`. Catalogue en évolution (`mistral-small-4-119b`,
  `mistral-medium-latest`, `qwen-3.6-35b-instruct`, `gemma-4-31b`…).
- **RAG** : `https://rag-api.ilaas.fr/v1` (OpenGateLLM). **DEUX clés distinctes** (jamais la clé
  d'inférence sur le RAG). Contrat : `docs/RAG-V2-ilaas.md`.
  - Collections : `visibility` `private`/`public`, champ `owner` (email). On ne liste que `private` || owned.
  - `POST /search` : `{collection_ids, query, method, limit, score_threshold}` → `data:[{score, chunk:{content, document_id, metadata}}]`.
  - `POST /documents` (multipart) ; `rag_upload_text` (texte `.md`, utilisé aussi par le connecteur Moodle).
  - `GET /me/usage` (conso, cost+tokens) ; `GET /me/info`.
  - *Historique* : le parser PDF d'ILaaS a renvoyé des 502 en juin 2026 → contournement en place
    (extraction PDF/DOCX **locale** via pdf.js/mammoth, envoi en `.md`). Pas d'OCR côté ILaaS.
- **Moodle** (instance de test) : `/webservice/rest/server.php`, format `json`, 8 fonctions de
  contenu en lecture seule. Détail reproductible : `docs/MOODLE-TEST-PLAN.md` (placeholders publics ;
  vraies valeurs dans `MOODLE-LOCAL.md`, **gitignoré**).

## 6. Conventions de travail (IMPORTANT — à respecter dès la reprise)
- **Versionnage** : schéma **`AAAAMMJJ.ii.0`** (semver valide, sans zéro initial) → `tauri.conf.json`
  ET `Cargo.toml`. Release taguée `vAAAAMMJJ.ii.0` (comparée par la vérif de mise à jour).
- **Git** : **l'utilisateur pousse LUI-MÊME via SourceTree**, jamais l'assistant. **AUCUN trailer
  `Co-Authored-By`.** Message de commit court par jalon. **Cocher les NOUVEAUX fichiers** dans
  SourceTree. Identité : compte **JEDI-OpenLab** (jamais DrJohn). Le connecteur Moodle vit sur la
  branche `moodle` (sera fusionnée dans `main` quand prête).
- **Secrets** : **jamais persistés** hors trousseau OS (ni mémoire, ni fichier versionné). **Aucune
  donnée privée dans le dépôt** (IP, jeton, chemins perso, noms d'hôte) — les vraies valeurs de
  l'instance Moodle de test vivent dans `MOODLE-LOCAL.md` (**gitignoré**) ; les guides publics
  utilisent des placeholders.
- **Build (outil Bash)** : préfixer `export PATH="$HOME/.cargo/bin:$PATH"` si besoin. Frontend
  modifié → rechargement à chaud (`npm run tauri dev`). Rust/config modifié → **redémarrer** `tauri dev`.
  Tests du convertisseur : `cargo test --lib moodle`.
- **Accès à une machine distante (build Linux, Moodle de test)** : via SSH vers une machine dédiée —
  **les identifiants ne sont pas dans le dépôt** ; demander un **feu vert explicite** avant toute connexion.
- **Revue** : lancer un **workflow adversarial** avant de clore un lot/une phase (systématique sur le
  connecteur Moodle).
- **Webview Tauri** : `window.prompt()` **ne marche pas** → toujours des champs inline.

## 7. Prochaines étapes (feuille de route, dans l'ordre)
1. **Lot 6 — interrupteur « Inclure les cours Moodle »** dans le chat : **✅ livré (2026-07-03)** ;
   reste son **test en réel** par l'utilisateur.
2. **Publier une version embarquant le connecteur** (Lots 0-7 + 5.1, déjà fusionnés dans `main`).
3. **Portage Windows** : Tauri multiplateforme (WebView2) ; le vrai chantier = **signature
   Authenticode** (équivalent Windows de la quarantaine macOS). Appui B7 (certificat + build).
4. **Version serveur/web** : deux formats partageant le cœur Rust (app de bureau vs serveur central
   sans installation). Décision d'archi + hébergement/auth (B7).
5. **Linux** : build AppImage (+ .deb/.rpm), trousseau `async-secret-service`, `webkit2gtk-4.1`.
6. **Signature / notarisation** (quarantaine macOS + SmartScreen Windows).
- **Items UI (v.9)** : entrée de menu « Vérifier les mises à jour » ; regroupement du menu du site.

## 8. Fait / validé récemment
- **v8 publiée** (macOS) : lancement OK, chat + RAG OK, PDF/DOCX en document de contexte OK, CSP stable.
- **Connecteur Moodle** : **Lots 0-7 + 5.1 livrés et relus** (revues multi-agents adversariales),
  testés sur une instance Moodle réelle (synchro texte **et** fichiers/PDF d'un cours → collection RAG
  → réponse sourcée ; re-sync sans doublon ; badge « à mettre à jour » ; filtre « cours inscrits »).
  **Gouvernance OPT-IN par consentement actée** (jamais opt-out ; zéro donnée d'étudiant).
  **Lot 6 (interrupteur chat) livré le 2026-07-03 ; reste : test en réel puis release.**
- **Correctif RAG Requête** : validé (« ça marche parfaitement ») — plus de repli trompeur.
- **Site web** : en ligne. Reste (utilisateur) : captures `docs/assets/screen-*.png` + Release GitHub
  avec le `.dmg`.
