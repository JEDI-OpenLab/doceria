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

## 5. Sécurité & souveraineté
- **Jeton au trousseau OS** (`fr.jedi-openlab.doceria`, compte `id:moodle`) ; jamais en JSON/localStorage/webview — seul `hasMoodleToken` (bool) exposé.
- **Lecture seule** : 8 fonctions WS whitelistées (compte technique, rôle étudiant) ; `moodle.rs` n'appelle QUE ces fonctions (constantes pour audit).
- **Zéro donnée personnelle** : jamais de fonction utilisateurs/notes/participants.
- Résolution jeton côté Rust avant tout `await` ; **ne jamais logger** l'URL pluginfile avec le token.
- Validation `Content-Type` sur les téléchargements.

## 6. Découpage en LOTS livrables

- **Lot 0 — Fondations profils Moodle** : `MoodleProfileMeta`, CRUD, rôle trousseau `moodle`, section UI + éditeur, `wireEvents()`. *Fait quand :* on crée/édite/supprime un profil, jeton au trousseau, `hasMoodleToken` affiché, rien en clair dans `settings.json`.
- **Lot 1 — Test de connexion** : `test_moodle_connection(_ephemeral)` + `SiteInfo`, bouton Tester. *Fait quand :* « ✓ connexion OK — downloadfiles=1, 8 fonctions » ou erreur FR explicite.
- **Lot 2 — Liste des cours** : `moodle_list_courses` + liste à cocher persistée (`courseIds`). *Fait quand :* les cours accessibles s'affichent, cases mémorisées.
- **Lot 3 — Ingestion texte d'un cours** : `moodle_course_markdown` (sections+pages+labels+books, sans fichiers) → `rag_upload_text` dans « Moodle · <cours> ». *Fait quand :* un cours → collection RAG interrogeable, Markdown tracé, citations correctes.
- **Lot 4 — Fichiers** : `moodle_download_file` + `uploadFileSmart`. *Fait quand :* PDF/DOCX téléchargés, indexés, cités ; une erreur pluginfile ne crée pas de faux document.
- **Lot 5 — Synchro incrémentale + suppressions** : index de diff, delete+re-upload, progression, verrou. *Fait quand :* 2ᵉ synchro ne recrée pas l'inchangé, supprime les disparus, affiche la progression.
- **Lot 6 — Toggle « Inclure les cours Moodle »** : intégration composeur + `onSend()`. *Fait quand :* le toggle fait remonter les passages Moodle avec citations ; grisé si pas de collection.

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
- *(à suivre : Lot 1 — test de connexion `test_moodle_connection`.)*
