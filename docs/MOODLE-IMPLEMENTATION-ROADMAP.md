# Feuille de route — Connecteur Moodle pour Doceria (implémentation)

> Plan d'implémentation **dans l'app**, complément de `MOODLE-TEST-PLAN.md` (qui valide le flux
> hors app). Établi à partir d'une **cartographie du code réel** de Doceria (noms de fichiers,
> fonctions et signatures existantes à réutiliser).
>
> **Décisions produit validées :** Moodle = source d'ingestion qui alimente des collections RAG
> normales · une collection par cours · textes + fichiers · synchro à la demande (nocturne = à
> l'échelle) · sous-menu « Moodle » dans le rail (après Modèle, avant Bibliothèque) · profils
> Moodle indépendants, jeton au trousseau OS.

## 0. Principe directeur

Moodle est une **source d'ingestion** : elle alimente des collections RAG normales via le pipeline
existant (`rag_create_collection`, `rag_upload_text`, `uploadFileSmart`). Aucun canal
d'interrogation séparé. L'intégration = **un module Rust `moodle.rs`** (client REST + mapping
JSON→Markdown) + **une section UI** + **une orchestration JS de synchro** calquée sur
`syncCollection()`.

## 1. Modèle de données & état

### 1.1 Backend — `src-tauri/src/settings.rs`
Structure sœur de `ProfileMeta`, persistée dans `settings.json` (champ `moodle_profiles`, +
`active_moodle_id` sur le patron `active_id`) :
```rust
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoodleProfileMeta {
    pub id: String,
    pub name: String,
    pub moodle_base_url: String,
    #[serde(default)]
    pub course_ids: Vec<i64>,        // cours cochés pour la synchro
}
```
Vue sécurisée (jamais le jeton) : `MoodleProfileView { #[serde(flatten)] meta, has_moodle_token: bool }`.

### 1.2 Trousseau — `src-tauri/src/keychain.rs`
Réutiliser avec un nouveau rôle `"moodle"` : `set_secret(id,"moodle",token)`, `get_secret`,
`has_secret`. Ajouter `"moodle"` à la liste blanche de `set_profile_key` (ou `set_moodle_profile_key`).
`delete_all(id)` doit purger la clé `moodle`.

### 1.3 État frontend — `src/state.js`
```javascript
moodleProfiles: [],       // [{ id, name, moodleBaseUrl, courseIds, hasMoodleToken }]
activeMoodleId: null,
useMoodle: false,         // toggle composeur
moodleCollections: {},    // { [profileId]: { [courseId]: { collectionId, name } } }
```
Persister **uniquement** `useMoodle`, `activeMoodleId`, `moodleCollections` (jamais le jeton ;
métadonnées de profil = backend Rust). L'index de synchro réutilise le format `SYNC_KEY`
(`doceria_sync_v1`), clé composite `profileId::collectionId` (= `syncMapKey()`).

## 2. Backend Rust — `src-tauri/src/moodle.rs` (nouveau)

### 2.1 Client REST bas niveau
```rust
const REST_PATH: &str = "/webservice/rest/server.php";
async fn ws_call(base_url:&str, token:&str, function:&str, params:&[(String,String)]) -> Result<Value,String>
```
- POST form-urlencoded : `wstoken`, `wsfunction`, `moodlewsrestformat=json`, + `params`.
- **HTTP 200 ≠ succès** : toujours parser le corps ; si `"exception"`/`"errorcode"` → `Err`. Mapper
  `invalidtoken`, `errorcoursecontextnotvalid` (« compte non inscrit »),
  `webservicefilesdownloadingdisabled` en messages FR clairs.
- Client `reqwest` partagé (comme `rag.rs`).

### 2.2 Commandes Tauri
Jeton **résolu côté Rust** au trousseau à partir du `profile_id` (patron `resolve()`) — jamais
transmis par la webview, sauf en test éphémère.

| Commande | Signature | Fonction WS |
|---|---|---|
| `test_moodle_connection` | `(profile_id) → SiteInfo` | `core_webservice_get_site_info` (vérifie `downloadfiles==1` + 8 fonctions) |
| `test_moodle_connection_ephemeral` | `(base_url, token) → SiteInfo` | idem, jeton non encore persisté |
| `moodle_list_categories` | `(profile_id) → Vec<Category>` | `core_course_get_categories` |
| `moodle_list_courses` | `(profile_id) → Vec<Course>` | `core_course_get_courses_by_field` |
| `moodle_course_markdown` | `(profile_id, course_id) → CourseIngest` | orchestration §2.3 |
| `moodle_download_file` | `(profile_id, file_url, dest_dir) → String` | `pluginfile.php?token=` |

`SiteInfo` expose `download_files: bool`, `release`, `missing_functions: Vec<String>`.

### 2.3 `moodle_course_markdown` — mapping JSON→Markdown
```rust
#[derive(Serialize)]
pub struct CourseIngest {
    pub course_id: i64,
    pub course_name: String,
    pub markdown_docs: Vec<MarkdownDoc>,   // { name, content } — un par section
    pub files: Vec<RemoteFile>,            // { name, file_url } — à télécharger + uploadFileSmart
}
```
1. `core_course_get_contents(course_id)` → sections + modules.
2. Un appel par type : `mod_page/mod_label/mod_resource/mod_book_get_..._by_courses` (indexés par `instance`).
3. Markdown hiérarchisé (H1 cours → H2 section + `section.summary` → H3 module). Par `modname` :
   `page`→`content`, `label`→`intro`, `book`→chapitres (`type=="content"`), `resource`→référence + `files`.
4. HTML→Markdown : crate `html2md` (élaguer `<script>/<style>`, préserver listes/tableaux/gras).
5. En-tête de traçabilité par bloc (`> Source : Moodle · "<cours>" · Section "<x>" · Maj <timemodified>`)
   → alimente les citations RAG.

**Un document Markdown par section** (pas un seul énorme) → meilleur chunking + diff plus fin.

### 2.4 Téléchargement fichiers — `moodle_download_file`
- URL : `{base}/webservice/pluginfile.php/{fileid}?token={token}&forcedownload=1`.
- **Valider `Content-Type`** : si `application/json` → erreur déguisée → `Err`.
- Écrire en dossier temporaire (scratch), retourner le chemin → `uploadFileSmart()` côté JS.

### 2.5 API JS — `src/api.js`
```javascript
export const moodleApi = {
  list: () => invoke('list_moodle_profiles'),
  upsert: (profile) => invoke('upsert_moodle_profile', { profile }),
  remove: (id) => invoke('delete_moodle_profile', { profileId: id }),
  setActive: (id) => invoke('set_active_moodle_profile', { profileId: id }),
  setKey: (id, secret) => invoke('set_moodle_profile_key', { profileId: id, secret }),
  test: (id) => invoke('test_moodle_connection', { profileId: id }),
  testEphemeral: (baseUrl, token) => invoke('test_moodle_connection_ephemeral', { baseUrl, token }),
  listCourses: (id) => invoke('moodle_list_courses', { profileId: id }),
  courseMarkdown: (id, courseId) => invoke('moodle_course_markdown', { profileId: id, courseId }),
  downloadFile: (id, fileUrl, destDir) => invoke('moodle_download_file', { profileId: id, fileUrl, destDir }),
};
```

## 3. Flux de synchro « à la demande »
`onSyncMoodle()` dans `src/main.js`, calqué sur `syncCollection()` (réutilise `extractDocId()`,
`SYNC_KEY`, `uploadFileSmart()`). Pour chaque `courseId` coché du profil actif :
1. **Collection** `"Moodle · <course_name>"` : créer via `ragApi.createCollection(name)` si absente,
   sinon réutiliser l'id mémorisé dans `state.moodleCollections[profileId][courseId]`.
2. **Récupération** : `moodleApi.courseMarkdown(profileId, courseId)` → `{ markdown_docs, files }`.
3. **Textes** : `ragApi.uploadText(collectionId, name, content, …)`. Clé de diff = nom + **hash du contenu**.
4. **Fichiers** : `moodleApi.downloadFile()` → chemin local → `uploadFileSmart(collectionId, path, profileId)`.
   Clé de diff = `file_url`.
5. **Diff / suppressions** : index local (`SYNC_KEY`) `{ [key]: { documentId, hash } }` — comme
   `syncCollection()` : supprimer les disparus (`ragApi.deleteDocument`), réuploader si hash changé, persister après chaque op.
6. **Progression** : `#moodleStatus` (« Section 3/8… »), verrou `moodleSyncing`.
7. Fin : activer `#useMoodle`, enregistrer le mapping cours→collection.

## 4. UI (rail) — `index.html` + `src/main.js`

### 4.1 Section « Moodle »
Insérée **après** `<h2 data-section="modele">` et **avant** `<h2 data-section="rag">`. Pliage auto
via `data-section="moodle"` (`setupSections()` — rien à coder). Réutiliser `.field`, `.profile-bar`,
`.filebtn`, `.btnfull`, `.key-row`, `.hint`, `.help`.
Contenu : `#moodleProfileSelect` ; barre `+ Nouveau / Modifier / Supprimer` ; éditeur `#moodleEditor`
(hidden) `#moName`, `#moUrl`, `#moToken` (password) + `#moTest` ; **liste de cours à cocher**
`#moCourseList` (après test réussi) ; bouton `#moodleSyncBtn` (« ↻ Synchroniser Moodle ») ; `#moodleStatus`.

### 4.2 Logique JS
Répliquer le cycle des profils ILaaS : `refreshMoodleProfiles()`, `openMoodleEditor(isNew)`,
`onTestMoodle()` (peuple la liste des cours), `saveMoodleProfileFromEditor()` (`upsert` + `setKey`
si jeton saisi, puis vider `#moToken` en `finally`), `onDeleteMoodleProfile()`, `switchMoodleProfile(id)`,
`onSyncMoodle()`. Câbler dans `wireEvents()`.

### 4.3 Toggle composeur « Inclure les cours Moodle »
Dans `.composer-tools`, après `useLibrary` + `ragModeGroup`. `disabled` tant qu'aucune collection
Moodle synchronisée. **Indépendant** de `useLibrary` (les deux cochables). Actif → `onSend()` ajoute
la/les collection(s) Moodle à la requête RAG.
**Formulation retenue : « Inclure les cours Moodle »** *(cohérent avec « Utiliser la bibliothèque
(RAG) » ; « cours » rappelle que la source = le contenu synchronisé, pas Moodle en direct)*.

> **✅ Livré (Lot 6, 2026-07-03).** Voir le journal en fin de document. **Écart assumé** : le toggle
> **requiert** « Utiliser la bibliothèque » (il l'étend) plutôt que d'en être indépendant — sans RAG
> actif la recherche ne fait rien, un toggle indépendant serait inerte.

## 5. Sécurité & souveraineté
- **Jeton au trousseau OS** (`fr.jedi-openlab.doceria`, compte `id:moodle`) ; jamais en JSON/localStorage/webview — seul `hasMoodleToken` (bool) exposé.
- **Lecture seule** : 8 fonctions WS whitelistées (compte technique, rôle étudiant) ; `moodle.rs` n'appelle QUE ces fonctions (constantes pour audit).
- **Zéro donnée personnelle** : jamais de fonction utilisateurs/notes/participants.
- Résolution jeton côté Rust avant tout `await` ; **ne jamais logger** l'URL pluginfile avec le token.
- Validation `Content-Type` sur les téléchargements.

## 5.bis Gouvernance : opt-in par consentement

Doceria adopte l'**opt-in par défaut**. À rebours du modèle « l'IA est partout, à vous de la
désactiver » (opt-out), **aucun cours Moodle n'est indexé sans une action explicite de
l'enseignant**. Valeurs portées : **transparence, choix, liberté** de l'enseignant.

**Mécanisme.** Le compte technique de **lecture seule** (`doceria-rag-readonly`) n'est **inscrit**
que dans les cours dont l'enseignant a donné son accord. **L'inscription du compte vaut
consentement.** Doceria n'affiche et n'indexe **que** ces cours. Un rôle Moodle dédié
« **Doceria — indexation IA (lecture seule)** » rend la présence du compte transparente pour
l'enseignant.

**Mode « tout indexer » (alternative, décision de la Direction).** Si l'établissement décide
d'indexer tous les cours par défaut : soit donner au compte l'accès en lecture au niveau
catégorie/système (capacité `moodle/course:view`), soit inscrire le compte massivement, **puis**
désactiver le filtre opt-in dans Doceria. C'est un **choix de gouvernance**, pas un réglage
technique par défaut.

**Statut honnête.** Le principe et la configuration Moodle sont posés (cf. `MOODLE-TEST-PLAN.md`).
Le **filtre applicatif** — Doceria n'affiche que les cours consentis — est le **prochain lot,
en cours** ; il **ne faut pas** le présenter comme déjà livré. Voir Lot 7 ci-dessous.

## 6. Découpage en LOTS livrables

- **Lot 0 — Fondations profils Moodle** : `MoodleProfileMeta`, CRUD, rôle trousseau `moodle`, section UI + éditeur, `wireEvents()`. *Fait quand :* on crée/édite/supprime un profil, jeton au trousseau, `hasMoodleToken` affiché, rien en clair dans `settings.json`.
- **Lot 1 — Test de connexion** : `test_moodle_connection(_ephemeral)` + `SiteInfo`, bouton Tester. *Fait quand :* « ✓ connexion OK — downloadfiles=1, 8 fonctions » ou erreur FR explicite.
- **Lot 2 — Liste des cours** : `moodle_list_courses` + liste à cocher persistée (`courseIds`). *Fait quand :* les cours accessibles s'affichent, cases mémorisées.
- **Lot 3 — Ingestion texte d'un cours** : `moodle_course_markdown` (sections+pages+labels+books, sans fichiers) → `rag_upload_text` dans « Moodle · <cours> ». *Fait quand :* un cours → collection RAG interrogeable, Markdown tracé, citations correctes.
- **Lot 4 — Fichiers** : `moodle_download_file` + `uploadFileSmart`. *Fait quand :* PDF/DOCX téléchargés, indexés, cités ; une erreur pluginfile ne crée pas de faux document.
- **Lot 5 — Synchro incrémentale + suppressions** : index de diff, delete+re-upload, progression, verrou. *Fait quand :* 2ᵉ synchro ne recrée pas l'inchangé, supprime les disparus, affiche la progression.
- **Lot 6 — Toggle « Inclure les cours Moodle »** ✅ **(2026-07-03)** : intégration composeur, recherche multi-collections. *Fait quand :* le toggle fait remonter les passages Moodle avec citations ; masqué si pas de collection Moodle. **FAIT** (journal en fin de document).
- **Lot 7 — Filtre « cours inscrits » (opt-in par consentement)** ✅ **(2026-07-02)** : Doceria n'affiche que les cours où le **compte technique est inscrit**, via **`core_enrol_get_users_courses`** — **9ᵉ fonction** de la liste blanche du service, appelée **uniquement pour le compte technique** (donc **aucune donnée d'étudiant**). Un **interrupteur** permet de basculer en **mode « tout indexer »** (désactive le filtre — décision de gouvernance, cf. §5.bis). *Fait quand :* sans réglage, l'explorateur ne liste **que** les cours consentis (inscription = consentement) ; l'interrupteur « tout indexer » restitue la liste complète.

## 7. À NOTER pour l'échelle (pas maintenant)
- **Synchro planifiée nocturne** : job périodique rejouant `onSyncMoodle()` (scheduler/cron), avec journal de synchro et fenêtre horaire. **Roadmap, pas ce chantier.**
- **Indexation multi-cours en masse** : pool de synchro parallèle borné (catégorie entière).
- **Capacité `moodle/course:view` au niveau catégorie** : éviter l'inscription cours-par-cours du compte technique (arbitrage sûreté/granularité avec l'admin).
- **Index de synchro en base Rust** (plutôt que localStorage) quand le volume grossit.
- **Alerte d'expiration de jeton** + restriction IP en prod.
- **Détection fine via `timemodified`** par module (quand exposé) pour éviter le hash intégral.

---
Fichiers concernés : `src-tauri/src/moodle.rs` (nouveau), `settings.rs`, `keychain.rs`, `lib.rs`
(enregistrement des commandes), `src/api.js`, `src/state.js`, `src/main.js`, `src/ui.js`, `index.html`.

---

## Journal d'implémentation

- **2026-07-02 — Lot 0 (Fondations profils Moodle) ✅.**
  - **Rust** : `MoodleProfileMeta` + champs `moodle_profiles`/`active_moodle_id` dans `settings.rs` ;
    vue `MoodleProfileView` (`has_moodle_token`, jamais le jeton) ; commandes
    `list/upsert/delete/set_active_moodle_profile` ; **URL http:// OU https://** acceptée (Moodle
    LAN de test). Trousseau (`keychain.rs`) : rôle **« moodle »** ajouté à la liste blanche de
    `set_profile_key` + `delete_moodle()` (purge à la suppression). 4 commandes enregistrées dans
    `lib.rs`. `cargo check` ✅.
  - **Frontend** : `moodleApi` (`api.js`, `setKey` réutilise `set_profile_key` rôle « moodle ») ;
    `state.moodleProfiles`/`activeMoodleId` + `activeMoodleProfile()` (state.js) ;
    `ui.renderMoodleProfiles()` ; **section « Moodle »** dans le rail (après Modèle, avant
    Bibliothèque) : sélecteur + barre Nouveau/Modifier/Supprimer + éditeur (nom, URL, jeton) ;
    logique `refreshMoodleProfiles / switchMoodleProfile / openMoodleEditor /
    saveMoodleProfileFromEditor / onSaveMoodleProfile / onDeleteMoodleProfile` + câblage
    `wireEvents()` + chargement à l'`init()`. Le jeton est vidé du DOM en `finally`. Build Vite ✅.
  - **Décision (point 3 — conversion HTML→Markdown)** : **pas** de crate `html2md`. On écrira un
    **convertisseur maison léger** au Lot 3 (cohérent avec le rendu Markdown maison déjà présent,
    zéro dépendance exotique, poids de l'app maîtrisé). À réévaluer si un cas HTML complexe le justifie.
  - *Fait quand :* la section Moodle apparaît, on crée/édite/supprime une connexion, le jeton part
    au trousseau (rôle `moodle`), `hasMoodleToken` s'affiche, rien en clair dans `settings.json`.
- **2026-07-02 — Lot 1 (Test de connexion) ✅.**
  - **Nouveau module `src-tauri/src/moodle.rs`** — le **client REST**, socle de tous les lots
    suivants : `ws_call(base, token, function, params)` (POST `form-urlencoded` vers
    `/webservice/rest/server.php`, `moodlewsrestformat=json`) ; parsing **systématique** du corps car
    Moodle renvoie ses erreurs applicatives en HTTP 200 (`{errorcode, message}`) → `moodle_error()`
    traduit les codes courants (`invalidtoken`, `accessexception`, `errorcoursecontextnotvalid`,
    `webservicefilesdownloadingdisabled`…) en français ; **liste blanche `WHITELIST`** de 8 fonctions
    de contenu (audit). Réutilise `client/normalize_base/send_error/http_error` d'`ilaas.rs` (aucune
    dépendance nouvelle).
  - Commandes `test_moodle_connection` (profil enregistré → jeton au trousseau via
    `settings::resolve_moodle`) et `test_moodle_connection_ephemeral` (URL+jeton saisis, **rien
    persisté**) → `core_webservice_get_site_info` → `SiteInfo { sitename, username, release,
    downloadFiles, missingFunctions }`. `resolve_moodle` ajouté à `settings.rs` ; 2 commandes
    enregistrées dans `lib.rs`. `cargo check` ✅.
  - **Front** : `moodleApi.test/testEphemeral` (api.js) ; bouton **Tester** dans l'éditeur
    (`key-row`, patron ILaaS) ; `onTestMoodle()` (main.js) → affiche « ✓ *site* — *compte* · Moodle
    *version* · téléchargement fichiers OK · 8 fonctions OK », ou le diagnostic d'erreur. Build ✅.
  - *Fait quand :* le bouton **Tester** confirme `downloadFiles=true` et **0 fonction manquante**
    sur le Moodle de test ; un mauvais jeton/URL affiche un message clair.
- **2026-07-02 — Lot 2 (Liste des cours + cases à cocher) ✅.**
  - **Empirique d'abord** : `curl core_course_get_courses_by_field` (sans `field`) sur le Moodle de
    test → `{courses:[…], warnings:[]}`, 7 cours dont **id=1 = cours « site »** (page d'accueil, à ne
    jamais indexer). Champs utiles : `id, shortname, fullname, categoryname, visible`. Le `summary` du
    cours est du HTML riche (Bootstrap) → réservé au Lot 3.
  - **Rust (`moodle.rs`)** : `CourseBrief { id, shortname, fullname, category, visible }` +
    `parse_courses()` (**filtre `id==1`**) + commande `list_moodle_courses(profile_id)` (jeton au
    trousseau via `resolve_moodle`, `core_course_get_courses_by_field`). Enregistrée dans `lib.rs`.
    `cargo check` ✅.
  - **Front** : `moodleApi.listCourses` (api.js) ; zone **« Cours à indexer »** (index.html, sous
    l'éditeur) avec bouton **Rafraîchir** ; `main.js` : `renderMoodleAll` (= liste connexions +
    zone cours), `refreshMoodleCoursesUI` (affiche la zone si jeton présent, **charge à la demande**),
    `onRefreshMoodleCourses`, `renderCourseCheckboxes` (**DOM sûr : `createElement`/`textContent`,
    jamais `innerHTML`** — noms de cours non fiables), `persistSelectedCourses` (coche → `upsert`
    métadonnées seules, jeton intact, `courseIds` persistés). CSS `.moodle-courses/.course-row`. Build ✅.
  - **Revue adversariale (11 agents, 3 dimensions + vérification)** → 4 findings confirmés, **tous
    corrigés** avant le test utilisateur :
    1. *(sécurité, medium)* le client HTTP suivait les redirections ; le jeton étant dans le **corps**
       du POST, une 3xx d'un Moodle malveillant/compromis (ou MITM sur `http://` LAN) pouvait
       l'exfiltrer → **client Moodle dédié `redirect(Policy::none())`** + erreur explicite sur 3xx
       (diagnostique aussi un `wwwroot`/https mal réglé). `moodle.rs`.
    2. *(correction, medium)* « Tester » validait l'URL **persistée**, pas celle éditée à l'écran quand
       le jeton restait vide → `test_moodle_connection(base_url: Option)` **prime l'URL affichée** ;
       `moodleApi.test(id, url)`. `moodle.rs`, `api.js`, `main.js`.
    3. *(UX, low)* le résultat du test écrasait le rappel « jeton défini » → **hint dédié `#moTestHint`**.
       `index.html`, `main.js`.
    4. *(robustesse, low)* un cours coché puis supprimé côté Moodle restait compté/stocké → **réconcilie
       `courseIds` au Rafraîchir** (purge silencieuse des cours disparus). `main.js`.
    - Faux positifs correctement **réfutés** par les vérificateurs (ex. `moodleHint` statique = copie
      fidèle du patron ILaaS validé).
  - *Fait quand :* les cours accessibles s'affichent, on coche/décoche, la sélection est mémorisée
    (persiste après fermeture/réouverture), le cours « site » n'apparaît pas.
- **2026-07-02 — Lot 2.5 (Explorateur de cours, vue centrale) ✅ — décision UX de l'utilisateur.**
  - **Pourquoi** : la liste à cocher dans le rail étroit ne passe pas l'échelle (centaines de cours).
    Choix retenu (question posée) : **explorateur dans la fenêtre du milieu** (recherche + filtre par
    catégorie + liste groupée + bouton Synchroniser). Le rail garde connexion + résumé « N cours
    sélectionnés » + bouton **« Gérer les cours… »**.
  - **Front (100 % — pas de Rust)** : `#moodleView` (index.html) couvre `.main` (`position:absolute`,
    z-index ; rail + conversations restent visibles). Machine à états (main.js) : `mvCourses`,
    **`mvSelected` = `Set` source de vérité** (survit à la recherche/au filtre — on ne lit jamais
    « coché » depuis le DOM), `mvCollapsed`, `mvLoadedFor` (cache par connexion), `mvOpenFor` (ferme
    l'explorateur si la connexion active change). Recherche (nom/code/catégorie), filtre catégorie,
    groupes repliables, « Tout cocher (filtré) », compteur, réconciliation des cours disparus, rendu
    **anti-XSS** (`createElement`/`textContent`). CSS `.moodle-view/.mv-*`. Le bouton **Synchroniser**
    est en place mais son action (ingestion) est le **Lot 3** (stub honnête pour l'instant). Build ✅.
  - **Revue adversariale (8 agents)** → 3 findings, **tous corrigés** :
    1. *(BLOQUANT — course async)* si on **change de connexion pendant** le `await listCourses(A)`, la
       réponse tardive réconciliait puis **écrivait la sélection de A dans le profil de B** (corruption
       inter-connexions). → **Garde anti-course** : `reqId` capturé à l'entrée ; après l'`await`, on
       ignore la réponse si `mvOpenFor !== reqId` ou si la connexion active a changé. `main.js`.
    2. *(idem, vu par la dimension UX)* → couvert par la même garde.
    3. *(UX, low)* le stub Synchroniser écrasait le **compteur** `#mvCount`. → message dans un élément
       **dédié `#mvStatus`**, effacé au prochain changement de sélection. `index.html`, `styles.css`, `main.js`.
    - Faux positif **réfuté** : « un refresh tardif écrase le précédent » — non reproductible (pas de
      garde manquante pour ce cas précis).
  - *Fait quand :* on ouvre l'explorateur au centre, on cherche/filtre par catégorie, on coche sur
    plusieurs pages de recherche sans rien perdre, le résumé du rail suit, et changer de connexion
    ferme proprement la vue.
- **2026-07-02 — Lot 3 (Synchroniser : ingestion du texte) ✅.**
  - **Empirique** : `core_course_get_contents(courseid=4)` → 5 sections ; le **texte pédagogique est
    dans les `summary` de section** (McLuhan 8 k, Serres 12 k…), les PDF sont des modules `resource`.
    Balises réelles des résumés : `<br>` (417), `<strong>` (358), `<p>` (8), `<span>` (6, `data-*` à
    ignorer), beaucoup d'accents/entités.
  - **Convertisseur HTML→Markdown MAISON (`moodle.rs`, zéro dépendance — décision Lot 0)** :
    `html_to_markdown` (tokenise → sérialise → normalise). Gère titres, `p/div`, `br`, `ul/ol/li`,
    `strong/em`, `a[href]`, `blockquote`, `code` ; strip le reste ; **décode les entités** nommées +
    numériques ; découpes **char-safe** (aucun panic sur l'UTF-8 accentué — `decode_entities` borne le
    `;` via `char_indices().take(12)`). **4 tests unitaires** (`cargo test`). Validé sur le contenu réel.
  - **Commande `moodle_course_markdown(profileId, courseId)`** → `{ fullname, markdown, sections,
    chars }` : 2 appels WS (méta cours + contenus), assemble **H1 cours · H2 section · H3 module**,
    saute les sections sans texte (fichiers seuls → Lot 4). Enregistrée dans `lib.rs`. `cargo check` ✅.
  - **Front** : `moodleApi.courseMarkdown` (api.js) ; **`onMoodleSync` réel** (main.js) : pour chaque
    cours coché → Markdown → collection **« Moodle · <cours> »** dans le **RAG du profil ILaaS actif**
    (`ragApi`, dédup par nom) → `uploadText`. **Barre de progression** par cours (`mvProgress` +
    `#mvProgress`), **verrouillage des contrôles et des sélecteurs de profil** pendant la synchro
    (`setMvSyncing` — anti-corruption inter-profils), poursuite malgré échec + bilan, refus clair si
    RAG non configuré. `loadCollections()` rafraîchit le rail. Build ✅.
  - **Prérequis** : un **profil ILaaS actif avec RAG configuré** (URL + clé) = destination. Re-synchro
    peut créer un doublon de document (**dédup/incrémental = Lot 5**).
  - **Revue adversariale (15 agents, harnais Rust autonome)** → **9 findings, tous corrigés** :
    - *(convertisseur, bloquant+high #1/#4/#8)* un « `<` » **littéral** (« 3 < 5 ») ou une balise non
      fermée **tronquait le texte** ingéré → réécriture `tokenize_html` : « `<` » n'est une balise que
      s'il est suivi d'une lettre/`/`/`!`/`?`, sinon littéral.
    - *(convertisseur, high #3)* un « `>` » **dans un attribut** (`data-x="a>b"`) coupait la balise et
      **fuyait du HTML brut** → scan de fin de balise **en respectant les guillemets**.
    - *(convertisseur, low #6)* éléments inline vides → `****`/`` `` ``/`[](url)` → **garde « contenu
      vide »** à la fermeture (pile inline). **+3 tests unitaires** (7 au total).
    - *(synchro, bloquant+high #2/#5)* **corruption inter-profils** : `createCollection`/`listCollections`
      suivaient `state.activeId` alors que `uploadText` seul était figé, et les **boutons du rail**
      restaient cliquables → **destination figée `dest=ip.id`** pour TOUTES les ops RAG (profileId
      optionnel ajouté à `listCollections`/`createCollection`), **verrou `moodleSyncing`** + gel des
      boutons de profil + gardes sur `switchProfile`/`onSaveProfile`/`onDeleteProfile`, boucle en
      `try/finally` (déverrouillage garanti).
    - *(synchro, low #7)* dédup sur collections d'autrui → **filtre par propriété** (comme `loadCollections`).
    - *(assemblage, low #9)* `createCollection` sans id → **erreur claire** au lieu d'un plantage Tauri.
    - Vérification ciblée supplémentaire du blocker inter-profils par un agent adversarial dédié.
  - *Fait quand :* on coche des cours, on clique **Synchroniser**, la barre progresse cours par cours,
    et les collections « Moodle · … » apparaissent dans la Bibliothèque, interrogeables (avec citations).
- **2026-07-02 — Lot 4 (Fichiers/PDF des cours) ✅.**
  - **Rust (`moodle.rs`)** : `CourseFile { filename, fileurl, mimetype, filesize }` ajouté à
    `CourseMarkdown.files`. Collecte des fichiers dans la boucle des modules **AVANT** le `continue`
    sur description vide → fichiers récupérés pour **toutes** les sections, même sans texte (ex. une
    section « Généralités » qui ne contient qu'un PDF). Commande **`moodle_download_file(profileId,
    fileUrl)`** → octets (`tauri::ipc::Response`, comme `read_file`) : jeton au trousseau, **contrôle
    même-origine** `origin_of(fileUrl) == origin_of(base)` (**anti-exfiltration** : le jeton, ajouté en
    query, ne part que vers l'hôte Moodle configuré), **client sans redirection**, 3xx/non-2xx refusés,
    **plafond dur 40 Mo**. `cargo check` + `cargo test` ✅.
  - **Front** : `moodleApi.downloadFile` (api.js) ; **`ingestMoodleFile`** (main.js) — PDF/DOCX
    **extraits en local** (`readDocument` pdf.js/mammoth → `rag_upload_text`, contourne le 502 d'ILaaS) ;
    formats texte (txt/md/csv/json/html…) décodés UTF-8 ; autres formats **ignorés** ; PDF scanné →
    skip « pas d'OCR ». `onMoodleSync` crée la collection s'il y a **texte OU fichiers**, ingère le
    texte puis chaque fichier avec **progression « fichier k/M »**, poursuit malgré un échec par
    fichier, **bilan enrichi** (« N cours · M fichiers importés (K ignorés) »). Destination RAG figée
    (`dest`) + `mp.id` capturé (acquis Lot 3). Build ✅.
  - **Réutilisation maximale** : aucun fichier temporaire (octets en IPC comme `read_file`), pipeline
    d'extraction locale existant, `rag_upload_text`. Zéro dépendance nouvelle.
  - **Revue adversariale (10 agents)** → 7 findings, **corrigés** (sauf le #4 = doublons, qui EST le
    Lot 5) :
    - *(sécurité, high #1/#5)* le plafond 40 Mo était vérifié **après** `res.bytes()` (tout bufferisé →
      **OOM** si un Moodle malveillant stream des Go) → **lecture en flux** (`bytes_stream` + compteur,
      abandon dès MAX) + pré-contrôle `content_length`. `moodle.rs`.
    - *(ingestion, medium #3/#7)* plafonds **incohérents** (download 40 Mo / extraction 25 Mo) →
      PDF/DOCX bornés à **25 Mo** (skip explicite), message d'erreur **distinguant** « trop volumineux »
      d'un vrai PDF scanné. `main.js`.
    - *(ingestion, medium #2)* texte PDF/DOCX **tronqué à 120k** silencieusement → option `noTruncate`
      sur `readDocument` (le RAG chunke côté serveur) : **texte complet** ingéré, sur le chemin Moodle
      **et** l'upload manuel RAG. `documents.js`, `main.js`.
    - *(ingestion, low #6)* `.rtf` (balisage binaire) et HTML brut pollutaient le RAG → `.rtf` **retiré**,
      HTML **détagué** (`DOMParser` → texte). `main.js`.
    - *(#4, medium — doublons à la re-synchro)* **non corrigé ici, à dessein** : c'est le périmètre du
      **Lot 5** (synchro incrémentale + dédup).
    - 1er lancement de revue interrompu par l'utilisateur ; **relancé** pour rigueur.
  - **Validé en réel** contre le Moodle de test (2 PDF, 1,2 + 4,1 Mo, origine vérifiée, PDF valides).
  - **Prérequis test** : Moodle de test **rallumé** + un profil ILaaS avec RAG. Sur le cours de test,
    « Synchroniser » ajoutera le texte **+ les 2 PDF** à « Moodle · Les fondateurs… ».
  - *Fait quand :* après « Synchroniser », les PDF d'un cours sont interrogeables (texte extrait, cité) ;
    un PDF scanné ou un format non géré est ignoré proprement avec mention au bilan.
- **2026-07-02 — Lot 5 (Synchro incrémentale + déduplication) ✅.** Règle le #4 du Lot 4 : re-synchro
  = **plus de doublons**, et bilan de ce qui a changé.
  - **Index local** `doceria_moodle_sync_v1` (localStorage), clé `dest::mpId::courseId` →
    `{ collectionId, textHash, textDocId, files:{ nom:{documentId, timemodified, filesize} } }`. Sur le
    patron éprouvé de la synchro dossier (`extractDocId`, persist après chaque op). `hashString` = FNV-1a.
  - **Rust** : `CourseFile.timemodified` ajouté (signal de changement d'un fichier **sans le télécharger**).
  - **`onMoodleSync` incrémental** : **abandonne** si `listCollections` échoue (sinon risque de doublonner
    une collection) ; par cours → **TEXTE** comparé par **hash** (inchangé/maj/ajout, ou retrait) ;
    **FICHIERS** diff par nom sur **(timemodified, taille)** — *aucun téléchargement si inchangé* ; une MàJ =
    **upload du nouveau PUIS suppression de l'ancien** (pas de perte, pas d'orphelin) ; **retraits** des
    fichiers disparus côté Moodle. Persistance après chaque opération. Si la collection mémorisée a été
    supprimée → repart de zéro. **Bilan détaillé** : « N cours · X ajoutés · Y mis à jour · Z inchangés ·
    W retirés (K ignorés) ».
  - **Badge « ✓ synchronisé »** dans l'explorateur (cours présents dans l'index, lecture locale, sans appel
    réseau) ; **purge** de l'index dans `onDeleteCollection`.
  - **Réponse à la question utilisateur** (« que se passe-t-il si on re-synchronise ? ») : **plus d'écrasement
    ni de doublon** — seuls les changements sont appliqués, et le bilan dit précisément quoi.
  - **Revue adversariale (14 agents) → 11 findings, consolidés en 6 correctifs** :
    - *(high)* **collision de noms de fichiers** (2 fichiers de même nom dans un cours → 1 clé d'index →
      perte de contenu + churn) → clé = **`fileurl`** (unique par fichier).
    - *(high)* **purge non scoppée** dans `onDeleteCollection` (les ids de collection sont propres à
      chaque profil) → exiger le préfixe `activeId::`.
    - *(medium)* la garde du texte exigeait `textDocId != null` → **churn**/doublons si `extractDocId`
      renvoie null → se fier au **hash seul**.
    - *(medium)* un fichier **ignoré** était **re-téléchargé** à chaque synchro → **mémoriser le skip**
      (timemodified+taille) dans l'index.
    - *(medium)* orphelin possible au crash → **persister le nouvel id AVANT** de supprimer l'ancien
      (l'index pointe toujours vers un doc réel).
    - *(low)* `isCourseSynced` = **code mort** → supprimé ; badge affiné (exige un vrai document).
    - **Re-revue** du code corrigé → **5 findings, tous cosmétiques** (comptage du bilan sur les
      transitions « ignoré ↔ réel ») : le comptage add/màj/retrait se base désormais sur l'existence
      d'un **vrai document** (plus de « retiré » fantôme, ni de « màj » pour un premier ajout). **Zéro
      défaut fonctionnel** (pas de doublon, perte ni orphelin) sur les 2 passes. *Édge accepté* : si
      `extractDocId` renvoie `null` sur une màj de texte (ILaaS renvoie toujours un id — cf. synchro
      dossier), un seul orphelin possible lors d'un changement ultérieur ; le hash évite tout churn.
  - *Fait quand :* re-synchro d'un cours inchangé = 0 doublon ; un ajout/retrait/modif côté Moodle se
    reflète proprement ; le badge marque les cours déjà synchronisés.
- **2026-07-02 — Lot 5.1 (Badge « nouveautés ») ✅ — demandé par l'utilisateur.**
  - Bouton **« Nouveautés »** dans l'explorateur : `checkMoodleUpdates()` va chercher le contenu des
    cours **déjà synchronisés** (peu nombreux) et le compare à l'index (**lecture seule**, aucune
    ré-ingestion) → badge **« ⟳ à mettre à jour »** (prioritaire sur « ✓ synchronisé »).
    `courseHasUpdates` = hash du texte + `(timemodified, taille)` des fichiers pris en charge + retraits.
    Coût = 1 appel par cours suivi, à la demande. Badge vidé après synchro / réinitialisé au Rafraîchir.
  - **Bilan de synchro amélioré** : en cas d'échec d'un cours, la **raison** est affichée (ex. compte
    technique non inscrit — `errorcoursecontextnotvalid`) et non plus seulement le nom.
  - *Note terrain* : lire le contenu d'un cours exige que le **compte technique y soit inscrit**
    (sinon « Not enrolled ») — c'est une config Moodle, pas un bug ; l'app le signale désormais clairement.
- **2026-07-02 — Gouvernance : opt-in par consentement (principe posé, filtre à venir).**
  - **Principe** : opt-in par défaut — **aucun cours indexé sans action explicite de l'enseignant**.
    Le compte technique **lecture seule** (`doceria-rag-readonly`) n'est **inscrit** que dans les cours
    consentis ; **l'inscription vaut consentement**. Doceria n'affiche/n'indexe **que** ces cours. Rôle
    Moodle dédié « **Doceria — indexation IA (lecture seule)** » pour la transparence. Valeurs :
    transparence, choix, liberté de l'enseignant. Cf. §5.bis et `MOODLE-TEST-PLAN.md`.
  - **Mode « tout indexer »** (décision de la Direction) : accès catégorie/système
    (`moodle/course:view`) **ou** inscription massive, **puis** désactivation du filtre opt-in dans
    Doceria — **choix de gouvernance**, pas un défaut technique.
  - **Statut honnête** : le principe et la config Moodle sont posés ; le **filtre applicatif est le
    prochain lot, EN COURS** (**Lot 7**) — à **ne pas** présenter comme livré. Il s'appuiera sur
    **`core_enrol_get_users_courses`** (**9ᵉ fonction** du service, appelée **uniquement pour le compte
    technique** → **aucune donnée d'étudiant**), avec un **interrupteur « tout indexer »**.
- **2026-07-02 — Lot 7 (Filtre « cours inscrits » = opt-in par consentement) ✅.**
  - **Rust** : `list_moodle_courses(profile_id, enrolled_only)` ; si `enrolled_only` → `get_site_info`
    (userid du **compte porteur du jeton**) → **`core_enrol_get_users_courses(userid)`** → on ne garde que
    les cours dont l'id est inscrit. **Appelée UNIQUEMENT pour le compte technique → zéro donnée
    d'étudiant.** Message actionnable si la fonction n'est pas whitelistée (« ajoute-la au service, ou
    décoche »). `cargo check` ✅.
  - **Front** : réglage `state.moodleEnrolledOnly` (**défaut ON**, persisté) ; **interrupteur
    « Cours consentis uniquement »** dans l'en-tête de l'explorateur ; `onMvRefresh` passe le réglage ;
    bascule → recharge la liste (filtrée / complète). Build ✅.
  - **Validé en réel** contre le Moodle de test : `core_enrol_get_users_courses` renvoie les 6 cours
    inscrits (ids 2‑7) ; **« Cinéma » (id 8, non inscrit) est bien exclu**. *(Note : « Algorithmique »
    id 5 était inscrit — l'opt-in reflète l'état réel des inscriptions.)*
  - **Revue** adversariale ciblée (confidentialité / filtre / fonction manquante / sélection) lancée.
  - *Fait quand :* ON → l'explorateur ne liste que les cours consentis ; OFF → liste complète.
- **2026-07-03 — Lot 6 (Toggle « Inclure les cours Moodle » dans le chat) ✅ — dernier lot.**
  - **Constat clé** : le backend RAG supporte **déjà** la recherche multi-collections — `rag_search`
    prend `collection_ids: Vec<i64>`. Lot 6 est donc **purement frontend** (aucun changement Rust).
  - **Front** (`src/main.js`) : `retrieveFromLibrary()` construit un **Set dédupliqué** = collection
    active + (toggle ? toutes les collections « Moodle · … » : ∅) → **un seul** appel `ragApi.search`.
    Constantes partagées `MOODLE_COLL_PREFIX` / `MOODLE_COLL_DESC` (source unique, aussi utilisées par
    la création dans `onMoodleSync`). `isMoodleCollection(c)` = préfixe de **nom** **+** marque système
    dans la **description** (renfort anti-collision, repli gracieux sur le nom seul si le backend ne
    renvoie pas la description → jamais de régression). État `state.includeMoodleCourses` **de session**
    (non persisté, comme `useLibrary`).
  - **UI** (`index.html` + `styles.css`) : `#includeMoodle` dans `.composer-tools` (span `.ragmoodle`,
    même motif `[hidden]` que `.ragmode`), **visible dès qu'un cours Moodle est indexé**, actif seulement
    quand la bibliothèque est utilisable ; `updateMoodleChatToggle()` gère affichage/état/reset (câblé
    dans `updateRagControls`, le reset de `refreshRag`, et les handlers `useLibrary`/`includeMoodle`).
    Méta « recherche (bibliothèque + cours Moodle)… ». Citations inchangées (résolution par
    `document_id`, transverse aux collections). `vite build` ✅.
  - **Écart assumé vs plan §4.3** : le toggle n'est **pas** indépendant de `useLibrary` mais le
    **requiert** (grisé sinon). Raison : `retrieveFromLibrary` ne fait rien si `useLibrary` est off →
    un toggle « indépendant » serait inerte et trompeur. « Inclure les cours Moodle » est donc une
    **extension** de « Utiliser la bibliothèque ».
  - **Revue** adversariale (logique + régression/confidentialité → vérification indépendante) : **1
    constat confirmé** — identification par préfixe de nom → faux positif si l'utilisateur nomme une
    collection « Moodle · … » à la main → **corrigé** par le renfort description ci-dessus.
    Confidentialité OK (les ids proviennent de `state.collections`, déjà filtré aux collections
    **propres** de l'utilisateur).
  - *Fait quand :* toggle coché → une question interroge la collection active **et** tous les cours
    Moodle indexés, avec citations ; masqué si aucun cours Moodle.
  - *Reste :* **test en réel** par l'utilisateur (comme les lots précédents), puis **merge + release**.
