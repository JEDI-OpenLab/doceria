# Doceria — Feuille de route

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

## 1. v-next — ✅ LIVRÉ (version `20260626.8.0`)

Ces chantiers, choisis pour leur **rapport valeur/effort** et leur alignement enseignant, sont
**désormais en service**. *(Les « presets de prompts pédagogiques » initialement prévus ont été
**écartés** : bien faits, ils demandent un vrai cadre pédagogique — taxonomie de Bloom, rédaction
d'objectifs — à poser en amont ; voir §1.3.)*

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
**Comment.** Intégrer KaTeX (bundle local, pas de CDN — cohérent avec la CSP stricte) dans le
rendu Markdown des bulles. Attention à l'échappement (le rendu Markdown actuel échappe le HTML
d'abord ; insérer KaTeX après, sur les délimiteurs math).

### 1.6 Multi-modèles en parallèle — comparaison côte à côte  · `should` · `M`–`L`
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

1. ✅ **v-next « confort prof »** — les chantiers du §1 (LaTeX + comparaison multi-modèles +
   régénérer/modifier/copier + menu Aide + message de refus). **Livré** en `20260626.8.0`.
2. **Chantier Moodle** — le différenciateur, en chantier dédié — voir §4. *(Choix acté : Moodle
   **avant** Linux.)*
3. **Build Linux** — voir §3.
4. **Backlog** (§5) selon les retours terrain.

### v.9 — petits correctifs & polish (rapides, avant/pendant Moodle)
- **Première ouverture macOS : commande Terminal en évidence.** Sur macOS récent, « Ouvrir
  quand même » n'apparaît **pas** pour le message « endommagé » (quarantaine posée sur une app
  non signée téléchargée). → **Remonter en tête** du LISEZ-MOI du `.dmg` **ET la faire figurer
  sur le site web, dans la rubrique « Installer »**, la commande :
  `xattr -dr com.apple.quarantine /Applications/Doceria.app`
  (c'est le chemin réel et fiable sur macOS récent). *(Le vrai correctif — la **notarisation
  Apple** — reste « plus tard », §5.4.)*
- **Menu natif : entrée « Vérifier les mises à jour… ».** Ajouter une entrée dans le menu
  **Doceria**, **sous « À propos »**, qui déclenche manuellement `check_update` (déjà appelée au
  démarrage). Effort S.
- **Menu natif en français.** Les items prédéfinis s'affichent en **anglais** (About / Hide /
  Quit) même sur un système français. → Passer un libellé FR aux `PredefinedMenuItem` :
  `about(&h, Some("À propos de Doceria"), …)`, `hide(&h, Some("Masquer Doceria"))`,
  `quit(&h, Some("Quitter Doceria"))`, etc. (ou déclarer la localisation `fr` du bundle). Effort S.
- **Site web : alléger le menu de navigation.** La barre de nav est chargée (Présentation,
  Fonctionnalités, Mode d'emploi, Souveraineté, Feuille de route, Installer, GitHub, JEDI-OpenLab).
  → **Regrouper** des entrées sous un menu déroulant — p. ex. **Présentation / Fonctionnalités /
  Mode d'emploi** sous un « Découvrir » (ou « Le produit ») — pour clarifier la lecture. Effort S.

---

## 3. Build Linux  · `should` · `M`

**Pourquoi.** L'ESR utilise **beaucoup Linux** sur les postes ; élargit la cible sans changer
l'identité. La **vérification de mise à jour** (GitHub Releases) est déjà en place.
**Points d'attention** (déjà anticipés dans le code) :
- Trousseau Linux via `keyring` backend **`async-secret-service` + `crypto-rust`** (pas de
  dépendance à libdbus C).
- Dépendances système **`webkit2gtk-4.1`** & co.
- TLS **rustls** (déjà retenu) → AppImage portable, sans OpenSSL système.
- Livrables `.AppImage` (+ `.deb`/`.rpm`). Build à produire/tester sur une machine Linux
  (accès SSH `lcn-ubuntu` prévu).
- **macOS sert de modèle** : même base de code, mêmes commandes Tauri.

---

## 4. Chantier Moodle — le différenciateur

> Inspiré du POC **[Learnix](https://jedi-openlab.github.io/Learnix/)** (extraction nocturne via
> WS REST, compte technique à jeton révocable limité aux fonctions de contenu, lecture seule
> après validation, revue humaine, **jamais** la base Moodle, **sans données personnelles** ;
> contenus = **Pages / Étiquettes / Ressources fichiers / Books** ; sortie **Markdown** avec
> hiérarchie ; RAG strict « uniquement depuis les documents »).

**Verdict : à FAIRE, en `should`**, en **prochain chantier dédié** (la v-next étant livrée) — **avant** le build Linux.
C'est la fonctionnalité **la plus alignée « prof ESR souverain »** : elle **nourrit le RAG du
prof avec son propre cours Moodle**, sans copier-coller, en restant dans le périmètre ESR.
**Techniquement faisable et peu risquée côté client.**

### 4.1 Sous-étapes
| Pri | Effort | Item |
|---|---|---|
| should | L | **Connecteur Moodle WS REST en lecture seule** (compte technique à jeton, au trousseau) |
| should | M | **Écran de configuration + sélection des cours/catégories** à indexer |
| should | M | **Mapping HTML Moodle → Markdown hiérarchisé + revue humaine** avant publication |
| could | M | **Synchro nocturne + gestion des suppressions** (réutilise le diff de la synchro dossier) |

### 4.2 Plan technique
- **Module `src-tauri/src/moodle.rs`** : un seul endpoint `POST /webservice/rest/server.php`
  via `reqwest` (déjà compilé : json / multipart / stream / rustls). Jeton **rangé au
  trousseau** (modèle `settings::resolve`), **jamais** exposé à la webview ni journalisé.
- **Liste blanche STRICTE — fonctions de contenu uniquement** :
  - `core_webservice_get_site_info` (test de connexion / diagnostic),
  - `core_course_get_categories`, `core_course_get_courses_by_field`, `core_course_get_contents`,
  - `mod_page_get_pages_by_courses`, `mod_label_get_labels_by_courses`,
    `mod_resource_get_resources_by_courses`, `mod_book_get_books_by_courses`,
  - téléchargement des fichiers via `pluginfile.php?token=…`.
- **EXCLURE impérativement** : `core_user_*`, `core_enrol_*`, `gradereport_*`,
  `mod_assign_get_submissions`, etc. → garantit **« sans données personnelles »**.
- **Robustesse Moodle** : **toujours parser le corps JSON même en HTTP 200** (Moodle renvoie ses
  erreurs `{exception, errorcode, message}` avec un statut 200). Réécrire les
  `@@PLUGINFILE@@`/liens relatifs. Parsing **tolérant aux millésimes** 3.x / 4.x / 5.x.
- **Pipeline** : extraction → **Markdown hiérarchisé** (H1 catégorie/cours · H2 section ·
  H3 activité, + en-tête de provenance pour de bonnes citations) → **revue humaine** (prévisu)
  → `rag_upload_text` (réutilise `uploadFileSmart`, en `text/markdown`, qui **contourne déjà le
  parseur PDF instable d'ILaaS**) dans une **collection privée**.
- **Synchro** : réutiliser la logique de **diff de la synchro dossier** ; un contenu **supprimé**
  côté Moodle doit **sortir** de la collection (sinon le RAG cite du périmé).

### 4.3 Frein principal = organisationnel (pas technique)
Il faut que l'**administrateur·rice Moodle** : active **Web Services + protocole REST**, crée un
**service externe dédié** + un **compte technique** + un **jeton**, et coche **« files
download »** sur le service. → Doceria doit livrer une **checklist claire** et des **messages
d'erreur explicites** (capability manquante, jeton invalide, WS désactivés…).

*(Le **mode Requête + citations** de Doceria couvrent déjà l'exigence « RAG strict » de Learnix.)*

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
| later | L | **LLM 100 % local optionnel** (Ollama / LM Studio) comme **repli hors-ligne** — l'attache ILaaS/OpenGateLLM restant le défaut et un atout. |
| later | L | **Updater signé complet** (auto-install) — nécessite une paire de clés de signature Tauri + `latest.json`. |
| later | L | **Notarisation Apple** — si un compte développeur Apple est pris (supprime les avertissements « app non signée »). |

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
> c'est une fonctionnalité **retenue pour la v-next** (§1.6) — utile pour choisir le meilleur
> modèle souverain.
