# Plan de test — Connecteur Moodle (hors code Doceria)

> **But.** Préparer, paramétrer et valider un accès **en lecture seule** au contenu pédagogique
> d'un cours Moodle via l'API REST, **sans écrire une ligne de code Doceria**. On ne passe à
> l'intégration (`src-tauri/src/moodle.rs`, réutilisant `rag_upload_text`) qu'une fois les
> Phases 0 à 2 concluantes.
>
> Vérifié (juin 2026) sur les sources officielles : `docs.moodle.org/dev`, `moodledev.io`, et le
> code source `github.com/moodle/moodle` (branches 4.5 → 5.1). Structure des réponses REST stable
> sur ces versions.
>
> **Contexte réseau.** Moodle tourne sur **une autre machine du LAN**. Sur cette machine il est
> vu en `http://localhost:8080` — mais `localhost` ne vaut **que** sur cette machine. Depuis le
> Mac de dev, on l'atteint via son **IP LAN** (`VOTRE-MOODLE`).

---

## ⚠️ Résultat du test réseau (confirmé le 2026-07-01, depuis le Mac)

- ✅ **Le Mac atteint la machine Moodle** en `VOTRE-MOODLE:8080` (Apache/Debian, PHP 8.3.31) —
  réseau et pare-feu **OK** (ping + HTTP répondent).
- ⛔ **BLOCAGE : le `wwwroot` de Moodle est `http://localhost:8080`.** Toute requête arrivant via
  `VOTRE-MOODLE:8080` (y compris **l'endpoint web service** `/webservice/rest/server.php`) reçoit
  une **redirection 303 vers `localhost:8080`**. Comme `localhost` = le Mac lui-même, **rien ne
  fonctionnera depuis le Mac** tant que ce n'est pas corrigé. De plus, les `fileurl` renvoyés par
  Moodle seraient construits avec `localhost:8080` → inexploitables à distance.
- ℹ️ Le **port 80** de cette IP répond, mais c'est un **nginx différent** (pas Moodle). Moodle = **`:8080`** (Apache).

---

## Phase 0.0 — Corriger le `wwwroot` (prérequis, sur la machine Moodle)

> **Pourquoi.** Moodle n'accepte les requêtes que sur l'hôte déclaré dans `$CFG->wwwroot`, et
> construit **toutes ses URLs** (dont les `fileurl`/`pluginfile.php`) à partir de cette valeur.
> Tant qu'elle vaut `http://localhost:8080`, aucun client distant (le Mac, puis Doceria) ne peut
> l'utiliser. On l'aligne sur l'URL réellement jointe par les clients : `http://VOTRE-MOODLE:8080`.
>
> **À faire sur la machine Moodle.** Méthode « découvrir d'abord, éditer ensuite » pour ne rien
> casser (l'emplacement de `config.php` dépend de l'installation).

> **Environnement confirmé (2026-07-01).** Environnement de dev officiel **moodle-docker** :
> conteneurs `moodle-app` (`moodlehq/moodle-php-apache:8.3`, `0.0.0.0:8080->80/tcp`) et
> `moodle-db` (`mariadb:11.4`). Le code Moodle est **sur l'hôte** dans
> `<CHEMIN-MOODLE>/` (monté dans le conteneur). Le `config.php` est un
> fichier normal sur l'hôte → **l'éditer est durable** (moodle-docker ne le régénère pas à chaque
> redémarrage). Moodle 5.x utilise `public/` comme racine web, d'où deux candidats :
> `moodle/config.php` et `moodle/public/config.php` — on confirme lequel porte le `wwwroot`.

**Étape A — Identifier l'installation** (sur la machine Moodle) :
```bash
# a) Moodle tourne-t-il dans Docker ?
docker ps
#    → repérer un conteneur Moodle (image contenant 'moodle'/'bitnami', ou nom explicite).

# b) Localiser config.php sur l'hôte (installation classique) :
sudo find / -name config.php -path '*moodle*' 2>/dev/null | head
```

**Étape B — Lire le `wwwroot` actuel** (adapter `<CONFIG>` / `<CONTENEUR>`) :
```bash
# Installation classique (hôte) :
grep -n wwwroot <CONFIG>            # ex. /var/www/html/config.php

# Installation Docker :
docker exec <CONTENEUR> sh -c "grep -rn wwwroot /bitnami/moodle/config.php /var/www/html/config.php /opt/bitnami/moodle/config.php 2>/dev/null"
```
Résultat attendu : `$CFG->wwwroot = 'http://localhost:8080';`

> ⚠️ **Cas Bitnami / config pilotée par variable d'environnement** : si `config.php` construit le
> `wwwroot` à partir d'une variable (`getenv(...)`) plutôt qu'en dur, l'édition directe sera
> **écrasée au redémarrage** du conteneur. Dans ce cas, le correctif durable passe par la
> variable d'env / le `docker-compose.yml` — d'où l'importance de **coller la sortie de l'Étape B
> avant d'éditer**.

**Étape C — Sauvegarder puis modifier** (seulement après avoir confirmé le cas en B) :
```bash
# Toujours une sauvegarde d'abord :
sudo cp <CONFIG> <CONFIG>.bak-$(date +%Y%m%d)

# Remplacement (hôte) :
sudo sed -i "s#http://localhost:8080#http://VOTRE-MOODLE:8080#g" <CONFIG>

# Variante Docker :
# docker exec <CONTENEUR> sed -i "s#http://localhost:8080#http://VOTRE-MOODLE:8080#g" <CONFIG_DANS_CONTENEUR>

# Re-vérifier :
grep -n wwwroot <CONFIG>
```

**Cas confirmé sur cette instance (moodle-docker, valeur en dur).** `wwwroot` est une valeur
**littérale** dans `<CHEMIN-MOODLE>/config.php` (ligne 21 :
`$CFG->wwwroot = 'http://localhost:8080';`). Le `public/config.php` n'a pas de `wwwroot`.
Correctif par `sed`, durable (fichier hôte monté dans le conteneur) :
```bash
# 1. Sauvegarde horodatée
sudo cp <CHEMIN-MOODLE>/config.php \
        <CHEMIN-MOODLE>/config.php.bak-$(date +%Y%m%d)

# 2. Remplacer l'URL (délimiteur '#' car l'URL contient des '/')
sudo sed -i "s#http://localhost:8080#http://VOTRE-MOODLE:8080#g" \
        <CHEMIN-MOODLE>/config.php

# 3. Vérifier la nouvelle valeur
grep -n wwwroot <CHEMIN-MOODLE>/config.php
#    → attendu : $CFG->wwwroot = 'http://VOTRE-MOODLE:8080';
```
Aucun redémarrage nécessaire en principe (PHP relit `config.php` à chaque requête). En cas de
cache : `docker restart moodle-app`.

**Étape D — Vérifier depuis le Mac** (plus de redirection 303 vers localhost) :
```bash
curl -s -o /dev/null -w "code=%{http_code} redirige_vers=%{redirect_url}\n" \
  http://VOTRE-MOODLE:8080/login/index.php
#   → attendu : code=200  (et redirige_vers vide). Si on voit encore localhost:8080, le wwwroot
#     n'a pas été pris en compte (mauvais fichier, ou config pilotée par variable d'env).
```

> ✅ **Confirmé (2026-07-01) depuis le Mac.** `http://VOTRE-MOODLE:8080/login/index.php` répond
> **`200` sans redirection**. L'endpoint web service répond désormais **`403` (corps vide)** au
> lieu de la page « Redirection » — normal, les web services ne sont pas encore activés (→ Phase
> 0). **Le blocage `wwwroot` est levé, Doceria/le Mac peuvent joindre Moodle.**

**Notes de robustesse :**
- **IP stable.** `VOTRE-MOODLE` doit rester stable (bail DHCP figé, réservation, ou IP statique).
  Si l'IP de la machine Moodle change, le `wwwroot` et donc tous les accès casseront.
- **Instance de test.** Changer le `wwwroot` est sans risque sur ce Moodle fraîchement installé
  (pas de contenu déjà truffé d'URLs `localhost`). À ne pas faire à la légère sur une prod vivante.
- **Alternative temporaire sans toucher au serveur** : lancer les `curl` de la Phase 1
  **directement sur la machine Moodle** (là, `localhost:8080` = `wwwroot`). Mais le passage à
  `VOTRE-MOODLE:8080` reste **indispensable** avant que Doceria (sur le Mac) puisse se connecter.

---

## Ce qu'il faut vérifier avant de commencer

| Point | Comment vérifier | Pourquoi ça compte |
|---|---|---|
| **IP LAN réelle de la machine Moodle** | Sur la machine Moodle : `ipconfig getifaddr en0` (macOS) / `hostname -I` (Linux), ou Réglages réseau. | `localhost:8080` vu depuis le Mac pointe vers le Mac lui-même, pas vers Moodle. Piège n°1. |
| **Joignabilité depuis le Mac** | Depuis le Mac : `ping VOTRE-MOODLE` puis `curl -I http://VOTRE-MOODLE:8080/login/index.php`. | Un pare-feu, un mauvais port, ou un Moodle écoutant seulement sur `127.0.0.1` bloquerait tout. |
| **Port réel exposé sur le LAN** | Sur la machine Moodle : `docker ps` (si conteneurisé) / config Apache-nginx. | Le port local (`:8080`) n'est pas forcément celui exposé sur le LAN (binding `127.0.0.1` vs `0.0.0.0`). |
| **Version de Moodle** | Admin → Notifications, ou plus tard via `core_webservice_get_site_info` (`release`/`version`). | Structure REST stable 4.5→5.1 ; utile pour suivre le bon tuto. |
| **Module Book installé ?** | Admin → Plugins → Vue d'ensemble (chercher « Book »), ou présence de `mod_book_get_books_by_courses` dans `functions[]`. | S'il est absent, on l'exclut de la whitelist sans bloquer le reste. |
| **Cours de test au contenu varié** | Au moins : une Page, une Étiquette (Label), une Ressource (PDF), idéalement un Book. | Sans ça, la Phase 1 ne couvre pas toute la whitelist. |

---

## Phase 0 — Configuration admin Moodle (une fois, interface web)

> Tout se fait connecté en **administrateur**, via le navigateur (ici depuis le Mac sur
> `http://VOTRE-MOODLE:8080`). Fil conducteur : **Administration du site → Serveur → Web services
> → Vue d'ensemble** (10 étapes cliquables). Détail granulaire ci-dessous avec nos choix (compte
> dédié, rôle minimal, 8 fonctions, lecture seule). Testé sur **Moodle 5.x / moodle-docker**.

### 0.1 — Activer les services web
Vue d'ensemble → **« 1. Activer les services web »** → page *Fonctionnalités avancées* → cocher
**« Activer les services web »** (`enablewebservices`) → **Enregistrer**. Statut attendu : **Oui**.

### 0.2 — Activer le protocole REST (et rien d'autre)
Vue d'ensemble → **« 2. Activer des protocoles »** → *Gérer les protocoles* → activer **« Protocole
REST »** (icône œil). **Laisser SOAP/autres désactivés** (« seuls les protocoles utilisés doivent
être activés »).

### 0.3 — Créer le compte technique dédié
Administration du site → Utilisateurs → Comptes → **Ajouter un utilisateur** :
- **Nom d'utilisateur** : `doceria-rag-readonly`
- **Méthode d'authentification** : *Comptes manuels*
- **Mot de passe** : conforme à la politique (ce compte ne sert pas à la connexion interactive)
- **Prénom / Nom** : `Doceria` / `RAG (lecture seule)`
- **Courriel** : format valide, ex. `doceria-rag@example.com`
- → **Créer l'utilisateur**. *(Jamais le compte admin : le jeton sera lié à CE compte.)*

### 0.4 — Créer un rôle « Web services REST » (capacité minimale)
Administration du site → Utilisateurs → Permissions → **Définir les rôles** → *Gérer les rôles* →
**Ajouter un nouveau rôle** :
- Page 1 (« Utiliser un rôle ou un archétype ») : **Aucun** → *Continuer*.
- **Nom court** : `wsrest` · **Nom personnalisé** : `Web services REST (lecture seule)`
- **Types de contextes où ce rôle peut être attribué** : cocher **« Système »**.
- Champ *Filtre* des capacités : `webservice/rest:use` → sur *Utiliser le protocole REST* cocher
  **« Autoriser »**.
- → **Créer ce rôle**. *(Une seule capacité, le strict nécessaire pour parler REST.)*

### 0.5 — Attribuer ce rôle au compte technique (contexte système)
Administration du site → Utilisateurs → Permissions → **Attribuer les rôles système** → cliquer le
rôle **« Web services REST (lecture seule) »** → dans *Utilisateurs potentiels*, sélectionner
**`doceria-rag-readonly`** → **Ajouter** (il passe dans *Utilisateurs existants*).

### 0.6 — Créer le service externe dédié
Administration du site → Serveur → Web services → **Services externes** → **Ajouter** :
- **Nom** : `Doceria RAG (lecture seule)`
- Cocher **« Activé »**
- Cocher **« Peut télécharger des fichiers »** (`downloadfiles`) — **indispensable** pour
  `pluginfile.php` (téléchargement = lecture).
- **Laisser DÉCOCHÉ « Autoriser le dépôt de fichiers »** (`uploadfiles` = envoi vers Moodle) :
  on est en **lecture seule**, aucun upload. À ne pas confondre avec le téléchargement ci-dessus.
- Cocher **« Uniquement utilisateurs autorisés »** / « Restreindre les utilisateurs autorisés »
  (plus sûr → on ajoute le compte en 0.8).
- **Capacité requise** : laisser **« Aucune capacité requise »** (la capacité est gérée par le rôle).
- → **Ajouter le service**.

### 0.7 — Ajouter UNIQUEMENT les 8 fonctions de la liste blanche
Dans le service → section **Fonctions** → **Ajouter des fonctions** → chercher chaque nom, le
sélectionner, puis valider. Les 8 fonctions (contenu seulement, **aucune donnée personnelle**) :

| Fonction | Rôle |
|---|---|
| `core_webservice_get_site_info` | Diagnostic : version, fonctions autorisées, `downloadfiles` |
| `core_course_get_categories` | Arborescence des catégories |
| `core_course_get_courses_by_field` | Liste/métadonnées des cours (`fullname`, `summary`…) |
| `core_course_get_contents` | Structure d'un cours : sections → modules (page/label/resource/book), `fileurl`, `contextid` |
| `mod_page_get_pages_by_courses` | Contenu HTML **complet** des Pages |
| `mod_label_get_labels_by_courses` | Contenu des Étiquettes (`intro`) |
| `mod_resource_get_resources_by_courses` | Ressources fichiers (métadonnées + `fileurl`) |
| `mod_book_get_books_by_courses` | Métadonnées des Books *(si module installé ; chapitres via `get_contents`)* |

**Rien d'autre** — surtout pas `core_user_*`, `core_enrol_*`, `gradereport_*`,
`mod_assign_get_submissions` (ce serait des données personnelles / notes).

> **Note — colonne « Capacités requises ».** L'écran du service affiche, pour certaines fonctions,
> des capacités (ex. `core_course_get_contents` → `moodle/course:update, moodle/course:viewhiddencourses`).
> C'est **purement informatif** (métadonnée d'aide à l'admin), **non bloquant** au niveau web
> service : un compte **Étudiant** inscrit récupère bien le contenu **visible** du cours. Ces
> capacités ne concernent que le contenu *caché* — à confirmer en Phase 1, et à **ne pas** ajouter
> préventivement au rôle (moindre privilège).

### 0.8 — Autoriser le compte technique sur le service
Dans le service → **Utilisateurs autorisés** → **Ajouter** → `doceria-rag-readonly`.

### 0.9 — Générer le jeton
Administration du site → Serveur → Web services → **Gérer les jetons** → **Créer un jeton** :
- **Utilisateur** : `doceria-rag-readonly` · **Service** : `Doceria RAG (lecture seule)`
- **Restriction IP** : laisser **vide** au début (une IP DHCP qui change ferait échouer les appels
  silencieusement, en HTTP 200 + JSON d'erreur).
- → **Enregistrer**, puis **copier le jeton** (chaîne alphanumérique).
- **⚠️ Secret : jamais dans le repo Doceria, jamais dans un commit** (gestionnaire de secrets ou
  `.env` hors de `doceria/`).

### 0.10 — Inscrire le compte technique sur les cours à indexer
> **Confirmé (Phase 1.2) : OBLIGATOIRE.** Sans inscription, `core_course_get_contents` renvoie
> l'exception `errorcoursecontextnotvalid` (« Not enrolled »). Le compte peut *lister* les cours
> (`get_courses_by_field`), mais **pas lire leur contenu** sans y être inscrit.

Dans **chaque cours à indexer** → *Participants* → **Inscrire des utilisateurs** →
`doceria-rag-readonly` → rôle **« Étudiant »** (lecture seule, sans édition) → *Inscrire*.

> **Implication de conception pour Doceria.** Le connecteur ne verra que les cours où le compte
> technique est inscrit. Deux stratégies (à trancher avec l'admin Moodle, à exposer côté produit) :
> - **(recommandé — moindre privilège)** inscrire le compte, **cours par cours**, sur ceux que
>   l'établissement veut indexer ;
> - **(plus large)** donner au rôle `wsrest` une capacité type `moodle/course:view` au niveau
>   **catégorie/système** → accès aux cours sans inscription, plus commode pour indexer en masse,
>   mais moins granulaire.

---

## Phase 1 — Validation manuelle via curl (aucun code Doceria)

Exportez les placeholders pour éviter les erreurs :
```bash
export URL_MOODLE="http://VOTRE-MOODLE:8080"   # à confirmer (Phase 0 réseau)
export TOKEN="VOTRE_TOKEN_ICI"
export COURSEID=2                               # id du cours de test (visible dans son URL Moodle)
```

### 1.1 — Sanity check
```bash
curl -s -X POST "$URL_MOODLE/webservice/rest/server.php" \
  --data-urlencode "wstoken=$TOKEN" \
  --data-urlencode "wsfunction=core_webservice_get_site_info" \
  --data-urlencode "moodlewsrestformat=json" | python3 -m json.tool
```
**Vérifier :** pas de clé `"exception"`/`"errorcode"` ; **`"downloadfiles": 1`** ; `"functions"` contient bien les 8 fonctions ; `"username"` = compte technique ; noter `"release"`/`"version"`.

### 1.2 — Catégories & cours
```bash
curl -s -X POST "$URL_MOODLE/webservice/rest/server.php" \
  --data-urlencode "wstoken=$TOKEN" --data-urlencode "wsfunction=core_course_get_categories" \
  --data-urlencode "moodlewsrestformat=json" | python3 -m json.tool

curl -s -X POST "$URL_MOODLE/webservice/rest/server.php" \
  --data-urlencode "wstoken=$TOKEN" --data-urlencode "wsfunction=core_course_get_courses_by_field" \
  --data-urlencode "moodlewsrestformat=json" | python3 -m json.tool
```
**Vérifier :** le cours de test apparaît (sinon compte non inscrit → Phase 0 étape 5) ; repérer son `id` réel.

### 1.3 — Contenu détaillé d'un cours
```bash
curl -s -X POST "$URL_MOODLE/webservice/rest/server.php" \
  --data-urlencode "wstoken=$TOKEN" --data-urlencode "wsfunction=core_course_get_contents" \
  --data-urlencode "moodlewsrestformat=json" --data-urlencode "courseid=$COURSEID" | python3 -m json.tool
```
**Vérifier :** sections (`name`, `summary`) → `modules[]` avec `modname` (page/resource/label/book), `instance`, `contextid` ; ressources → `contents[].fileurl` ; Book → chapitres en `contents[]` `type="content"` + HTML dans `content`.

Compléments (contenu **complet** des Pages/Étiquettes/Ressources) :
```bash
# Pages (contenu HTML complet ; get_contents ne donne qu'une description tronquée)
curl -s -X POST "$URL_MOODLE/webservice/rest/server.php" \
  --data-urlencode "wstoken=$TOKEN" --data-urlencode "wsfunction=mod_page_get_pages_by_courses" \
  --data-urlencode "moodlewsrestformat=json" --data-urlencode "courseids[0]=$COURSEID" | python3 -m json.tool

# Étiquettes (tout est dans intro)
curl -s -X POST "$URL_MOODLE/webservice/rest/server.php" \
  --data-urlencode "wstoken=$TOKEN" --data-urlencode "wsfunction=mod_label_get_labels_by_courses" \
  --data-urlencode "moodlewsrestformat=json" --data-urlencode "courseids[0]=$COURSEID" | python3 -m json.tool

# Ressources (fichiers)
curl -s -X POST "$URL_MOODLE/webservice/rest/server.php" \
  --data-urlencode "wstoken=$TOKEN" --data-urlencode "wsfunction=mod_resource_get_resources_by_courses" \
  --data-urlencode "moodlewsrestformat=json" --data-urlencode "courseids[0]=$COURSEID" | python3 -m json.tool
```

### 1.4 — Téléchargement d'un fichier via `pluginfile.php`
Repérer un `fileurl` de l'étape 1.3, y **ajouter `?token=`** :
```bash
curl -s -o test_telecharge.pdf \
  "http://VOTRE-MOODLE:8080/webservice/pluginfile.php/29/mod_resource/content/3/MonFichier.pdf?token=$TOKEN&forcedownload=1"
file test_telecharge.pdf   # doit dire "PDF document", pas "ASCII text" (= JSON d'erreur déguisé)
```
**Si erreur « Web service file downloading must be enabled » :** `downloadfiles` pas activé (Phase 0 étape 3).

**✅ Sortie de Phase 1** (les 4 avant de passer en Phase 2) :
- [ ] `get_site_info` OK + `downloadfiles=1`
- [ ] Cours de test listé, contenu lisible via `get_contents`
- [ ] Une Page, une Étiquette, une Ressource récupérées avec leur contenu utile
- [ ] Un vrai PDF téléchargé et validé via `pluginfile.php?token=`

---

## Phase 2 — Prototype de mapping JSON → Markdown (script jetable, hors repo)

**Objectif :** vérifier que le contenu récupéré se transforme en **Markdown hiérarchisé** exploitable
par le RAG, **avant** de toucher à Doceria.

**Emplacement : HORS du repo Doceria** (ex. `~/scratch/moodle-proto/`), pour zéro risque de committer le token.
```
moodle-proto/
  .env                 # MOODLE_URL, MOODLE_TOKEN — jamais committé, jamais dans doceria/
  fetch.py             # appelle la whitelist, sauve le JSON brut dans ./raw/
  raw/                 # réponses JSON brutes (pour itérer sans re-requêter)
  map_to_markdown.py   # JSON → Markdown H1/H2/H3
  out/                 # .md générés, à relire à l'œil
```

**Mapping à prototyper** (conforme à `ROADMAP-V2.md`) :
- `H1` = Catégorie / Cours (`fullname`)
- `H2` = Section (`name`) — **+ le `summary` de la section** converti en Markdown. ⚠️ **Confirmé en
  Phase 1.3** : sur des cours réels, le **texte pédagogique vit souvent dans le résumé de section**
  (pas dans des Pages/Étiquettes). Le `summary` est renvoyé par `core_course_get_contents` pour
  chaque section — c'est une **source de contenu à part entière**, à ne pas oublier.
- `H3` = Activité (`name`) précédée d'un **en-tête de provenance** :
  ```markdown
  ### Cours magistral 3 — Introduction aux réseaux
  > Source : Moodle · Cours « Réseaux L3 » · Section « Semaine 3 » · Type : Page · maj 2026-05-12

  <contenu HTML converti en Markdown>
  ```
- HTML → Markdown : lib standard (`html2text` en Python / `turndown` en Node), pas de parsing maison.
- Cas particuliers :
  - `mod_page` → champ `content` (complet), pas la `description` tronquée de `get_contents`.
  - `mod_label` → tout est dans `intro`.
  - `mod_resource` → **ne pas** convertir le fichier ; référencer le fichier téléchargé (le PDF/DOCX
    sera traité par le pipeline RAG existant de Doceria, pas par ce mapping HTML→MD).
  - `mod_book` → chaque chapitre (`contents[]` `type="content"`, `modname=book`) devient un `H4`.

**✅ Sortie de Phase 2 :**
- [ ] Un cours converti en `.md` lisibles et bien hiérarchisés
- [ ] En-tête de provenance présent sur chaque bloc
- [ ] Les 4 types (Page, Étiquette, Ressource, Book si présent) couverts
- [ ] Tout tourne hors du repo Doceria

---

## Phase 3 — Intégration dans Doceria (ensuite, PAS maintenant)

Seulement une fois les Phases 0–2 concluantes : porter la logique validée dans
`src-tauri/src/moodle.rs`, en réutilisant `rag_upload_text` pour l'ingestion. Travail de code
séparé, à cadrer le moment venu.

---

## Les 6 pièges à garder en tête

1. **`localhost:8080` ≠ IP LAN** : depuis le Mac, toujours l'IP LAN (`VOTRE-MOODLE`) + le port réellement exposé (peut ≠ `:8080`).
2. **HTTP 200 ≠ succès** : Moodle renvoie ses erreurs en 200 + JSON `{exception, errorcode, message}`. Toujours parser le corps.
3. **`downloadfiles=1` sur le service** : indispensable à `pluginfile.php`. Vérifié dès `get_site_info`.
4. **Restriction IP sur le token** : à éviter au début (une IP DHCP qui change casse tout silencieusement).
5. **`mod_book_get_books_by_courses` ne donne pas le contenu des chapitres** : passer par `core_course_get_contents` (`modname=book`).
6. **Jeton du compte technique, jamais admin** — et jamais dans le repo (même le `.env` reste hors de `doceria/`).

---

## Journal de progression (instance de test)

- **2026-07-01 — Réseau & `wwwroot`.** Mac ↔ Moodle `VOTRE-MOODLE:8080` OK. `wwwroot` corrigé de
  `http://localhost:8080` → `http://VOTRE-MOODLE:8080` (`config.php` ligne 21, env moodle-docker).
  Login répond **`200` sans redirection** depuis le Mac.
- **2026-07-01 — Moteur WS.** « Activer les services web » = Oui ; **protocole REST** activé (SOAP
  laissé désactivé, hygiène). Vérifié depuis le Mac : `POST …/webservice/rest/server.php` avec un
  faux token renvoie **`HTTP 200` + JSON `{"errorcode":"invalidtoken",…}`** → moteur REST OK, et
  confirme le piège « erreurs en HTTP 200 ».
- **2026-07-01 — Accès dédié.** Compte technique `doceria-rag-readonly` créé (0.3) ; rôle `wsrest`
  (capacité `webservice/rest:use`, contexte Système) créé (0.4) et **attribué** au compte (0.5).
- **2026-07-01 — Service & fonctions.** Service externe `Doceria RAG (lecture seule)` créé (0.6 :
  Activé, `downloadfiles` ON, `uploadfiles` OFF, utilisateurs restreints, aucune capacité requise).
  Les **8 fonctions** ajoutées (0.7) ; **module Book présent** sur l'instance. Compte autorisé sur
  le service (0.8) ; jeton créé (0.9, expire 31/07/2026).
- **2026-07-01 — Phase 1.1 (sanity check) ✅.** Depuis le Mac, `core_webservice_get_site_info`
  renvoie les **8 fonctions exactes**, `downloadfiles=1`, `uploadfiles=0`, Moodle **5.1.x**,
  `siteurl=http://VOTRE-MOODLE:8080`, `username=doceria-rag-readonly`.
- **2026-07-01 — Phase 1.2 (découverte).** `core_course_get_categories` → 4 catégories ;
  `core_course_get_courses_by_field` → **7 cours** (id 1–7). **`core_course_get_contents` sur un
  cours NON inscrit → exception `errorcoursecontextnotvalid` (« Not enrolled »)** → l'inscription du
  compte au cours est **obligatoire** pour en lire le contenu (cf. 0.10 + implication design).
- **2026-07-01 — Phase 1.3/1.4 (contenu & fichiers) ✅.** Compte inscrit (Étudiant) sur le cours
  **id=4** → `core_course_get_contents` OK. `mod_resource_get_resources_by_courses` → **2 PDF** ;
  `mod_page`/`mod_label` → 0 (ce cours n'en a pas) mais les fonctions répondent proprement. **PDF
  réel téléchargé** via `pluginfile.php?token=` (25 p., 1,2 Mo, en-tête `%PDF`). **Découverte
  mapping : le texte pédagogique de ce cours est dans les RÉSUMÉS DE SECTION** (`summary` de chaque
  section renvoyé par `get_contents`), pas dans des Pages/Étiquettes → le mapping doit inclure les
  résumés de section comme source de texte à part entière.
- *(reste à couvrir avec du vrai contenu : Page, Étiquette, Book — sur un cours qui en contient.)*
