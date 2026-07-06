# Doceria, feuille de route

> **Méthode.** Cette feuille de route est issue d'un tour d'horizon **vérifié sur le web**
> (juin 2026) : AnythingLLM, agents de code (Aider, OpenCode, Continue, Cline), apps de bureau
> LLM/RAG (LM Studio, Jan, Open WebUI, Msty, Cherry Studio…) et **web services Moodle** (en
> s'appuyant sur le POC **[Learnix](https://jedi-openlab.github.io/Learnix/)**).
>
> **Filtre directeur.** Tout est filtré par l'ADN de Doceria : **souverain** (les données
> restent dans le périmètre ESR), **simple** (zéro Docker, zéro terminal, pour un·e
> enseignant·e non-technicien·ne), **ciblé enseignement**. Ce qui ne sert pas ce filtre est
> écarté volontairement (voir « Ce qu'on n'intègre pas »).
>
> Conventions : priorité `must` / `should` / `could` / `later` · effort `S` / `M` / `L`.

---

## 1. v-next, ✅ LIVRÉ (version `20260626.8.0`)

Ces chantiers, choisis pour leur **rapport valeur/effort** et leur alignement enseignant, sont
**désormais en service**. *(Les « presets de prompts pédagogiques » initialement prévus ont été
**écartés** : bien faits, ils demandent un vrai cadre pédagogique (taxonomie de Bloom, rédaction
d'objectifs) à poser en amont ; voir §1.3.)*

### 1.1 Entrée de menu « Aide » → site officiel  · `must` · `S`
**Ce que c'est.** Un sous-menu **« Aide »** dans la barre de menus macOS (à côté de
Doceria / Édition / Fenêtre), avec une entrée **« Site Doceria »** (et idéalement « Mode
d'emploi », « Signaler un problème »).
**Pourquoi.** Donne enfin un **point de support et de découvrabilité** à un·e prof
non-technicien·ne. C'est l'item explicitement demandé.
**Comment.** Dans `src-tauri/src/lib.rs`, ajouter un `Submenu` au menu existant ; chaque entrée
appelle la commande **`update::open_url`** (déjà présente, ouvre une URL `https` dans le
navigateur). Brique déjà là → effort trivial.

### 1.2 Annuler / Régénérer la dernière réponse  · `must` · `S`
**Ce que c'est.** Un bouton **« Régénérer »** (et « Annuler ») sur le dernier message de
l'assistant, pour relancer la même question (éventuellement avec un autre modèle ou une
température différente).
**Pourquoi.** Geste de base attendu par tout public (« refais autrement »), **sans git ni
terminal**. Manque aujourd'hui.
**Comment.** S'appuie sur l'archi de conversations existante : retirer le dernier tour
assistant (`removeLastMessage`) et relancer `send()` sur le dernier message utilisateur.

### 1.3 Bibliothèque de presets de prompts pédagogiques  · ❌ ÉCARTÉ
> **Décision :** non implémenté. Bien fait, ce chantier exige un vrai travail de conception
> pédagogique (taxonomie de Bloom, rédaction d'objectifs d'apprentissage) à poser délibérément,
> plutôt que de l'improviser. À reconsidérer si le cadre pédagogique est fourni en amont.

**Ce que c'était (idée initiale).** Des **modèles de consigne prêts à l'emploi**, déclenchables en un clic ou par
commande : `/qcm`, `/plan-de-cours`, `/reformuler`, `/barème`, `/vulgariser`, **tuteur
socratique**, **correcteur**, **générateur d'exercices**…
**Pourquoi.** C'est **le manque le plus net** face aux concurrents et **le plus fort levier
d'adoption** pour des profs non-techniciens. 100 % local, zéro dépendance externe.
**Comment.** Étend les « modèles de consigne » déjà présents : une liste de presets fournis +
les presets persos de l'utilisateur ; un preset remplit `sysPrompt` ou préfixe le message.
Bonus : **variables** (`{COURS}`, `{NIVEAU}`, date) insérables dans le prompt (`should`, `S`).

### 1.4 Réglages RAG exposés : seuil + message de refus  · `should` · `S`
**Ce que c'est.** Exposer dans l'UI le **seuil de similarité** (déjà supporté côté API) et
rendre **configurable le message de refus** du mode Requête (« Je ne trouve pas la réponse… »).
**Pourquoi.** **Fiabilité pédagogique** du RAG strict : l'enseignant·e ajuste la sévérité et le
ton du refus. Les modes Chat/Requête + hybride + reranking sont déjà là ; il ne manque que les
curseurs.

### 1.5 Rendu LaTeX / KaTeX  · `must` · `M`
**Ce que c'est.** Afficher les **formules mathématiques** (`$...$`, `$$...$$`) dans les réponses
**et les citations**, via KaTeX (rendu local, sans réseau).
**Pourquoi.** **Débloque massivement l'ESR scientifique** (maths, physique, info théorique) :
corrigés, démonstrations, énoncés avec formules deviennent lisibles. Fort impact disciplinaire
pour un effort modéré, 100 % local.
**Comment.** Intégrer KaTeX (bundle local, pas de CDN, cohérent avec la CSP stricte) dans le
rendu Markdown des bulles. Attention à l'échappement (le rendu Markdown actuel échappe le HTML
d'abord ; insérer KaTeX après, sur les délimiteurs math).

### 1.6 Multi-modèles en parallèle, comparaison côte à côte  · `should` · `M`–`L`
**Ce que c'est.** Envoyer **une seule requête à plusieurs modèles en même temps** et afficher
leurs réponses **côte à côte** : la zone de conversation se **divise en deux** (ou N) colonnes,
chacune diffusant en streaming la réponse de son modèle.
**Pourquoi.** Très utile pour un·e enseignant·e qui veut **choisir le meilleur modèle souverain**
pour une tâche donnée (ex. `mistral-medium` vs `gemma-4` vs `qwen-3.6`), repérer les
désaccords, ou simplement comparer la qualité avant de retenir une réponse. *(Demandé par
l'utilisateur.)*
**Comment (esquisse).**
- Un mode **« Comparer »** : on sélectionne 2 modèles (extensible à N) ; le composeur envoie le
  **même message** à chacun.
- La zone de fil passe en **colonnes** ; chaque colonne a son `requestId` et son streaming
  (`streamChat` est déjà par-requête → on lance les appels **en parallèle**).
- À la fin, l'utilisateur peut **retenir une réponse** (elle rejoint le fil principal) ou tout
  garder. État de conversation à généraliser pour porter plusieurs réponses par tour.
- ⚠️ **Coût.** Comparer N modèles = **N× la conso/coût** d'un tour. Afficher un **indicateur
  clair « ×N »** et s'appuyer sur le suivi **Conso & coût** déjà en place. À garder **opt-in**
  (pas le mode par défaut) pour ne pas gonfler la facture souveraine par inadvertance.
**Effort.** `M` pour une version 2-colonnes ; `L` si N colonnes + rétention fine.

---

## 2. Séquencement

1. ✅ **v-next « confort prof »**, les chantiers du §1 (LaTeX + comparaison multi-modèles +
   régénérer/modifier/copier + menu Aide + message de refus). **Livré** en `20260626.8.0`.
2. ✅ **Chantier Moodle**, le différenciateur, voir §4. **Terminé (Lots 0-7) et publié /
   disponible dans la version `20260706.1.0` (2026-07-06)**, y compris le Lot 6 (interrupteur
   composeur). *(Choix acté : Moodle **avant** Linux.)*
3. **Build Linux**, voir §3.
4. **Backlog** (§5) selon les retours terrain.

### v.9, petits correctifs & polish (rapides, avant/pendant Moodle)
- ✅ **FAIT, Première ouverture macOS : commande Terminal en évidence.** Sur macOS récent,
  « Ouvrir quand même » n'apparaît **pas** pour le message « endommagé » (quarantaine posée sur
  une app non signée téléchargée). La commande
  `xattr -dr com.apple.quarantine /Applications/Doceria.app` est **déjà remontée sur le site web
  (rubrique « Installer », `docs/index.html`) ET dans le LISEZ-MOI** du `.dmg`. *(Le vrai
  correctif, la **notarisation Apple**, reste « plus tard », §5.4.)*
- **Menu natif : entrée « Vérifier les mises à jour… ».** Ajouter une entrée dans le menu
  **Doceria**, **sous « À propos »**, qui déclenche manuellement `check_update` (déjà appelée au
  démarrage). Effort S.
- **Menu natif en français.** Les items prédéfinis s'affichent en **anglais** (About / Hide /
  Quit) même sur un système français. → Passer un libellé FR aux `PredefinedMenuItem` :
  `about(&h, Some("À propos de Doceria"), …)`, `hide(&h, Some("Masquer Doceria"))`,
  `quit(&h, Some("Quitter Doceria"))`, etc. (ou déclarer la localisation `fr` du bundle). Effort S.
- **Site web : alléger le menu de navigation.** La barre de nav est chargée (Présentation,
  Fonctionnalités, Mode d'emploi, Souveraineté, Feuille de route, Installer, GitHub, JEDI-OpenLab).
  → **Regrouper** des entrées sous un menu déroulant, p. ex. **Présentation / Fonctionnalités /
  Mode d'emploi** sous un « Découvrir » (ou « Le produit »), pour clarifier la lecture. Effort S.

---

## 3. Build Linux  · `should` · `M`

**Pourquoi.** L'ESR utilise **beaucoup Linux** sur les postes ; élargit la cible sans changer
l'identité. La **vérification de mise à jour** (GitHub Releases) est déjà en place.
**Points d'attention** (déjà anticipés dans le code) :
- Trousseau Linux via `keyring` backend **`async-secret-service` + `crypto-rust`** (pas de
  dépendance à libdbus C).
- Dépendances système **`webkit2gtk-4.1`** & co.
- TLS **rustls** (déjà retenu) → AppImage portable, sans OpenSSL système.
- Livrables `.AppImage` (+ `.deb`/`.rpm`). Build à produire/tester sur une machine Linux dédiée.
- **macOS sert de modèle** : même base de code, mêmes commandes Tauri.

---

## 4. Chantier Moodle, le différenciateur

> Inspiré du POC **[Learnix](https://jedi-openlab.github.io/Learnix/)** (extraction via WS REST,
> compte technique à jeton révocable limité aux fonctions de contenu, **lecture seule stricte**,
> **jamais** la base Moodle, **sans données personnelles** ; contenus = **résumés de section +
> descriptions de modules + fichiers/PDF** (Lot 4, livré) ; sortie **Markdown** avec hiérarchie ;
> RAG strict « uniquement depuis les documents »).

**Verdict : TERMINÉ (Lots 0-7, tous les lots) ; publié / disponible dans la version `20260706.1.0` (2026-07-06).** Le connecteur est
**implémenté, relu (revues multi-agents adversariales) et validé** sur un Moodle 5.1.4 de test, et
il est **publié / disponible dans la version `20260706.1.0` (2026-07-06)**. **Le Lot 6** (interrupteur composeur « Inclure les cours Moodle ») est **livré (2026-07-03)** et
publié dans `20260706.1.0`. C'était le chantier dédié après la v-next,
**avant** le build Linux (choix acté). C'est la fonctionnalité **la plus alignée « prof ESR
souverain »** : elle **nourrit le RAG du prof avec son propre cours Moodle**, sans copier-coller,
en restant dans le périmètre ESR.

> **Référence de vérité :** `docs/MOODLE-IMPLEMENTATION-ROADMAP.md` (journal des Lots 0-7) et
> `src-tauri/src/moodle.rs`.

### 4.1 Sous-étapes
| État | Effort | Item |
|---|---|---|
| ✅ FAIT | L | **Connecteur Moodle WS REST en lecture seule** (profils Moodle indépendants ; jeton au trousseau, rôle « moodle » ; test de connexion : liste blanche de 8 fonctions de contenu + `downloadfiles`), Lots 0-1 |
| ✅ FAIT | M | **Configuration + sélection des cours** (explorateur central : recherche + filtre catégorie + cases à cocher, sélection persistée), Lots 2 + 2.5 |
| ✅ FAIT | M | **Mapping HTML Moodle → Markdown hiérarchisé** (convertisseur **maison en Rust**, zéro dépendance) → ingestion du texte dans « Moodle · <cours> », synchro one-shot avec barre de progression, Lot 3. *(Pas de revue humaine / prévisualisation implémentée : ingestion directe.)* |
| ✅ FAIT | M | **Fichiers / PDF des cours** (téléchargement sécurisé via `pluginfile.php?token=` + extraction locale → `rag_upload_document`, contourne le 502 ILaaS), Lot 4 |
| ✅ FAIT | M | **Synchro incrémentale + déduplication** (index local de diff : une re-synchro ne duplique plus ; suppressions ; bilan détaillé), Lot 5 |
| ✅ FAIT | S | **Bouton « Nouveautés »** → badge « ⟳ à mettre à jour » sur les cours modifiés côté Moodle, Lot 5.1 |
| ✅ FAIT | M | **Filtre opt-in « cours inscrits » = consentement de l'enseignant·e** (inscription du compte technique = accord ; `core_enrol_get_users_courses` appelée **uniquement** pour le compte technique → zéro donnée d'étudiant·e ; interrupteur, **défaut ON**), Lot 7 |
| ✅ FAIT | S | **Interrupteur composeur « Inclure les cours Moodle »** dans le chat (recherche RAG multi-collections : collection active + tous les cours Moodle indexés, avec citations), **Lot 6** (2026-07-03) ; publié / disponible dans la version `20260706.1.0` (2026-07-06) |

### 4.2 Plan technique (livré, Lots 0-5 + 5.1 + 7)
- **Module `src-tauri/src/moodle.rs`** : un seul endpoint `POST /webservice/rest/server.php`
  via `reqwest` (déjà compilé : json / stream / rustls). Jeton **résolu côté Rust au
  trousseau** (modèle `settings::resolve_moodle`, rôle « moodle »), **jamais** exposé à la
  webview ni journalisé. **Client HTTP Moodle dédié `redirect(Policy::none())`** : le jeton
  voyageant dans le **corps** du POST, une 3xx d'un Moodle malveillant/compromis (ou MITM sur
  `http://` LAN) pourrait l'exfiltrer → toute redirection est **refusée** (revue sécurité Lot 2).
- **Liste blanche STRICTE (`WHITELIST`, fonctions de contenu uniquement, constante pour audit)** :
  - `core_webservice_get_site_info` (test de connexion / diagnostic),
  - `core_course_get_categories`, `core_course_get_courses_by_field`, `core_course_get_contents`,
  - `mod_page_get_pages_by_courses`, `mod_label_get_labels_by_courses`,
    `mod_resource_get_resources_by_courses`, `mod_book_get_books_by_courses`,
  - téléchargement des fichiers via `pluginfile.php?token=…` (Lot 4, **livré**),
  - `core_enrol_get_users_courses` **uniquement pour le compte technique** (filtre opt-in
    « cours inscrits », Lot 7, **livré** ; aucune donnée d'étudiant·e).
- **EXCLURE impérativement** : `core_user_*`, `core_enrol_*`, `gradereport_*`,
  `mod_assign_get_submissions`, etc. → garantit **« sans données personnelles »**.
- **Robustesse Moodle** : **toujours parser le corps JSON même en HTTP 200** (Moodle renvoie ses
  erreurs `{exception, errorcode, message}` avec un statut 200 ; `moodle_error()` les traduit en
  français). Parsing **tolérant aux millésimes** 3.x / 4.x / 5.x. Le cours « site » (`id==1`) est
  **filtré**.
- **Convertisseur HTML → Markdown MAISON en Rust (`html_to_markdown`, zéro dépendance,
  PAS html2md/turndown)** : tokenise → sérialise → normalise ; gère titres, `p/div`, `br`,
  `ul/ol/li`, `strong/em`, `a[href]`, `blockquote`, `code` ; décode les entités nommées +
  numériques ; découpes char-safe (aucun panic sur l'UTF-8 accentué) ; **7 tests unitaires**
  (`cargo test`, dont « `<` » littéral, « `>` » dans un attribut, éléments inline vides).
- **Pipeline (Lot 3, texte)** : `moodle_course_markdown` → **Markdown hiérarchisé** (H1 cours ·
  H2 section + `summary` · H3 module, + en-tête de provenance pour de bonnes citations) →
  `uploadText` dans la **collection « Moodle · <cours> » du profil ILaaS actif** (dédup par nom,
  filtre par propriétaire). Périmètre = **texte** (résumés de section + descriptions de modules) ;
  **fichiers/PDF = Lot 4 (livré)**. **Pas de revue humaine ni de prévisualisation** : l'ingestion
  est directe (à réintroduire si besoin plus tard). **Barre de progression par cours** ; **verrou
  anti-corruption inter-profils** (destination RAG figée `dest=ip.id`, gel des sélecteurs de
  profil pendant la synchro).
- **Fichiers / PDF (Lot 4, livré)** : téléchargement **sécurisé** via `pluginfile.php?token=…`
  (client HTTP dédié sans redirections, validation `Content-Type`) puis **extraction locale** du
  texte → `rag_upload_document`. L'extraction locale **contourne le 502 ILaaS** rencontré sur
  certains PDF.
- **Synchro incrémentale + déduplication (Lot 5, livré)** : **index local de diff** ; une
  re-synchro **ne duplique plus** les documents ; un contenu **supprimé** côté Moodle **sort** de
  la collection (sinon le RAG cite du périmé) ; **bilan détaillé** en fin de synchro. Le bouton
  **« Nouveautés »** (Lot 5.1) pose un badge **« ⟳ à mettre à jour »** sur les cours modifiés côté
  Moodle.

### 4.3 Correctif RAG mode Requête (livré)
En mode **Requête**, si la recherche RAG **échoue** (ou remonte 0 extrait), le modèle **ne répond
plus sur ses connaissances générales** : il **bloque** et l'explique (« mode Requête : recherche
indisponible, réponse bloquée » / « aucun extrait pertinent trouvé »), **sans appel facturé**. En
mode **Chat**, repli assumé sur les connaissances générales **avec avertissement**. Ce garde-fou
s'applique aussi bien au chat mono-modèle qu'à la comparaison multi-modèles (§1.6).

### 4.4 Frein principal = organisationnel (pas technique)
Il faut que l'**administrateur·rice Moodle** : active **Web Services + protocole REST**, crée un
**service externe dédié** + un **compte technique** + un **jeton**, et coche **« files
download »** sur le service. → Doceria doit livrer une **checklist claire** et des **messages
d'erreur explicites** (capability manquante, jeton invalide, WS désactivés…).

*(Le **mode Requête + citations** de Doceria couvrent déjà l'exigence « RAG strict » de Learnix ;
le correctif §4.3 le renforce.)*

### 4.5 Décision de gouvernance, Indexation Moodle : opt-in par consentement

**Principe.** Doceria adopte l'**opt-in par défaut**. À rebours du modèle « l'IA est partout, à
vous de la désactiver » (**opt-out**), **aucun cours Moodle n'est indexé sans une action explicite
de l'enseignant·e**. Valeurs portées : **transparence**, **choix** et **liberté** de
l'enseignant·e sur ses propres contenus.

**Mécanisme : l'inscription du compte vaut consentement.** Le compte technique de **lecture seule**
(`doceria-rag-readonly`) n'est **inscrit que dans les cours** dont l'enseignant·e a donné son
accord ; Doceria n'affiche et n'indexe **que ces cours**. Un rôle dédié
**« Doceria — indexation IA (lecture seule) »** rend la présence du compte **transparente** pour
l'enseignant·e. Techniquement, le filtre s'appuie sur `core_enrol_get_users_courses` appelée
**uniquement pour le compte technique** ; donc **aucune donnée d'étudiant·e** n'est lue.

**Deux modes de gouvernance :**
- **Opt-in par défaut** (recommandé) : inscription cours par cours = consentement explicite ;
  Doceria filtre pour n'exposer que les cours consentis.
- **« Tout indexer »** (alternative, **décision de la Direction**), si l'établissement choisit
  d'indexer tous les cours par défaut : soit donner au compte l'accès en lecture au niveau
  catégorie/système (capacité `moodle/course:view`), soit inscrire le compte massivement, **puis**
  désactiver le filtre opt-in dans Doceria. C'est un **choix de gouvernance**, pas un réglage
  technique par défaut.

> **Statut.** Le **principe**, la **configuration Moodle** et le **filtre applicatif** (Doceria
> n'affiche et n'indexe que les cours consentis) sont **livrés (Lot 7)** : interrupteur opt-in
> « cours inscrits », **défaut ON**, `core_enrol_get_users_courses` appelée **uniquement** pour le
> compte technique (zéro donnée d'étudiant·e). Le mode « tout indexer » reste une **décision de la
> Direction**. Publié / disponible dans la version `20260706.1.0` (2026-07-06). Procédure reproductible : `docs/MOODLE-TEST-PLAN.md`.

### 4.6 État du chantier Moodle
**Livrés et relus (publiés / disponibles dans la version `20260706.1.0` (2026-07-06)) :**
- ✅ **Lot 4, Fichiers / PDF** : `moodle_download_file` (`pluginfile.php?token=…`, validation
  `Content-Type` pour ne pas créer de faux document) + **extraction locale** (contourne le 502
  ILaaS) → `rag_upload_document`.
- ✅ **Lot 5, Synchro incrémentale + dédup** : index local de diff (delete + re-upload),
  suppressions, bilan détaillé ; une re-synchro ne duplique plus.
- ✅ **Lot 5.1, Bouton « Nouveautés »** : badge « ⟳ à mettre à jour » sur les cours modifiés côté
  Moodle.
- ✅ **Lot 7, Filtre opt-in « cours inscrits »** (consentement de l'enseignant·e ; interrupteur,
  défaut ON ; `core_enrol_get_users_courses` **uniquement** pour le compte technique).

**Publié / disponible dans la version `20260706.1.0` (2026-07-06) :**
- **Lot 6, Interrupteur composeur « Inclure les cours Moodle » ✅ (2026-07-03)** : fait remonter les
  passages Moodle avec citations dans le chat (recherche RAG multi-collections) ; masqué tant qu'aucune
  collection Moodle n'est synchronisée, actif seulement quand « Utiliser la bibliothèque » l'est.
- **Merge / release** ✅ : connecteur embarqué et publié dans la version `20260706.1.0` (2026-07-06).
- *(Portage **Windows**, Tauri multiplateforme + WebView2 + **signature Authenticode**, version
  **serveur/web**, **Linux** et **notarisation** : voir §3 et §5.4.)*

---

## 5. Backlog (versions ultérieures)

### 5.1 Enrichissement RAG
| Pri | Effort | Item | Pourquoi |
|---|---|---|---|
| should | M | **Épinglage d'un document** (syllabus injecté en entier) | Le syllabus/consigne officielle toujours en contexte, pas seulement retrouvé par chunks. |
| should | M | **Recherche ciblée (RAG) vs document entier injecté** | Pour un petit corpus, injecter le texte entier évite les trous. |
| should | M | **Pièce jointe au fil** (PDF ad hoc, non indexé) | Question ponctuelle sur UNE copie/un article sans polluer la collection. |
| should | M | **Resynchro automatique du dossier** (au démarrage / planifiée) | Déclenchement auto de la synchro dossier→collection déjà existante ; simple interrupteur. |
| could | M | **« Résumer ce document » / « Synthétiser la collection »** | Deux actions concrètes isolées d'un framework d'agents. |
| could | M | **Sélection de modèle par tâche** (gros modèle pour le plan, petit pour le reste) | Qualité vs coût souverain maîtrisé ; en préréglages. |

### 5.2 Structuration & confort
| Pri | Effort | Item | Pourquoi |
|---|---|---|---|
| should | L | **Espaces de cours** = collection + historique + réglages (prompt/mode) | Regrouper « L1 Algo » vs « M2 Réseaux » sans fuite de contexte. |
| should | S | **Export PDF du fil** (avec citations) | Récupérer une réponse RAG sourcée en polycopié/note ; le Markdown existe déjà. |
| should | S | **Recherche globale + palette Cmd+K** | Retrouver un échange précis quand les conversations s'accumulent. |
| could | L | **Dictée vocale locale** (Whisper / Web Speech) | Confort/accessibilité ; souverain si 100 % local. Ajout d'un binaire non trivial → plus tard. |

### 5.3 Agent / outils (prudence)
| Pri | Effort | Item | Note |
|---|---|---|---|
| could | M | **Mode « Plan / Discussion »** (3ᵉ mode) | Cadrer objectifs/niveau/contraintes avant de générer ; réduit allers-retours et coût. |
| could | M | **Compaction / résumé automatique du contexte** | Sessions longues (construire un cours) ; évite le blocage « contexte plein » et maîtrise le coût. |
| later | M | **Web search/fetch comme OUTIL opt-in** | Uniquement opt-in explicite, désactivable, journalisé local, **jamais** exfiltrer les collections privées. |
| later | L | **MCP** (outils externes) | Potentiel à terme (ENT) mais public avancé ; contredit « zéro terminal/JSON ». Mode avancé caché au mieux. |

### 5.4 Distribution
| Pri | Effort | Item |
|---|---|---|
| later | L | **LLM 100 % local optionnel** (Ollama / LM Studio) comme **repli hors-ligne**, l'attache ILaaS/OpenGateLLM restant le défaut et un atout. |
| later | L | **Updater signé complet** (auto-install), nécessite une paire de clés de signature Tauri + `latest.json`. |
| later | L | **Notarisation Apple**, si un compte développeur Apple est pris (supprime les avertissements « app non signée »). |

---

## 6. Ce qu'on n'intègre PAS (filtre souverain)

Volontairement écarté, parce que **hors-scope pour un·e prof ESR souverain·e** :

- **Multi-utilisateur** (rôles/permissions/JWT) → relève d'un déploiement serveur ; Doceria est
  une app **mono-utilisateur** (un prof = un poste, clés au trousseau).
- **Multi-vector-DB enfichables** (PGVector/Qdrant/Chroma) & **LLM clouds US**
  (OpenAI/Anthropic/Groq) → l'attache volontaire à **ILaaS/OpenGateLLM est un atout**, pas un
  manque. Seul un **LLM local optionnel** (Ollama) est défendable, en repli.
- **Connecteurs cloud non-souverains** : Confluence, YouTube (Google), GitHub/GitLab cloud →
  tension avec « données dans le périmètre ESR ».
- **Community Hub / marketplace** de skills/prompts tierces → dépendance + risque sécurité ; à
  transposer en **partage local** (export/import d'un fichier de presets).
- **API REST développeur / widget de chat embarquable / extension navigateur** → orientés
  intégrateurs, pas un prof sur son poste.
- **MCP via édition d'un JSON de serveurs + jobs cron** → exactement le « terminal/Docker »
  qu'on refuse pour des non-techniciens.
- **Web search temps réel par défaut, partage de session en ligne, TTS/STT cloud** → font sortir
  des données du périmètre ESR / cassent le zéro-télémétrie. Ne retenir que les variantes
  **100 % locales**.
- **Exécution de code / artefacts-canvas** (Python in-app) → power-users, sécurité, alourdit.
  Au plus : rendu **Mermaid/LaTeX** (sans exécution).
- **Scraper web embarquant Chromium/Puppeteer** → alourdit Tauri ; viser une extraction HTML
  légère (`fetch`) si un connecteur web est un jour retenu.

> **Note sur la comparaison multi-modèles.** L'affichage côte à côte **par défaut** est à
> éviter (double la conso/coût). Mais en **mode opt-in explicite** (avec indicateur de coût),
> c'est une fonctionnalité **retenue pour la v-next** (§1.6), utile pour choisir le meilleur
> modèle souverain.
