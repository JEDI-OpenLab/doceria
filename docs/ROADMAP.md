# Doceria — Phasage de réalisation (Tauri)

> Ordre conçu pour **dé-risquer** : on prouve le socle natif + le chat avant d'attaquer l'intégration RAG.
> Chaque phase produit un build Mac + Linux testable.

## Avancement (au 2026-06-25)
- ✅ **Phase 1 — Socle Tauri** : chat natif streaming + Stop, fenêtre (fermer = quitter), build macOS `.app`/`.dmg`. *(Build Linux à valider sur machine Linux.)*
- ✅ **Phase 2 — Clés & profils** : trousseau OS (`keyring`), multi-profils à **deux jetons** (LLM + RAG), test de connexion, choix du modèle par menu.
- 🔄 **RAG — pivot « géré d'abord »** (jeton RAG obtenu et validé) : le **RAG géré ILaaS** passe AVANT le local, qui devient optionnel/différé (abstraction `local ⇄ géré` conservée). Sous-étapes :
  - ✅ **A. Client backend** OpenGateLLM (`rag.rs`) : collections, upload multipart, search hybride, rerank.
  - 🔄 **B. UI bibliothèque** : collections (créer/sélectionner/supprimer) + ajout fichiers/dossier. *(Fiabilisation de l'upload en cours.)*
  - ⏳ **C. Récupération dans le chat** : interrupteur « Utiliser la bibliothèque » → recherche + **citations des sources**.
  - ⏳ **Sync dossier ↔ collection** : une collection peut être **liée à un dossier local** ; **bouton « Synchroniser »** (ajoute le nouveau/modifié, retire le supprimé — **indexation incrémentale** par empreinte hash/mtime, on ne re-téléverse pas tout) + **sync auto** au lancement de l'app et/ou à la sélection du profil. *(À trancher : le moment le plus pertinent — ne re-scanner que si quelque chose a changé ; cf. « watch temps réel » en P1.)*
  - ⏳ **D. Finitions + revue** (phase lourde).
- ✅ **Phase 3 — Préférences & thème & DA** : charte **« Atelier »** (papier chaud, pétrole, or), thème **clair/sombre/auto**, **vibrance macOS**, mémorisation fenêtre, colonnes pliables, presets de consigne système.
- ✅ **Finitions macOS** : renommage de conversation inline, **CSP** (à valider pdf/docx), guide `INSTALLATION-macOS.md` (app non signée, **Apple Silicon arm64**). → **macOS quasi bouclé.**
- ✅ **Avant Linux (demandé) — FAIT** : mode **Chat/Requête** (+ garde-fou « Query »), **réglages de récupération** (méthode, top-k, seuil), **mémoire** (tours d'historique), **chevrons de sections** du rail droit (pliage persistant, non destructif). *(Détails dans le backlog ci-dessous.)* → **Prochaine grande étape : build & tests Linux (AppImage via SSH Ubuntu).**
- ⏳ **Phase 5 — Conso/coût** : tokens par échange (V1) ; `GET /v1/me/usage` (RAG géré).
- 📄 **`docs/POINT-DE-REPRISE.md`** : état complet + conventions, à lire en premier pour reprendre.
- ✅ **Site de présentation (GitHub Pages)** — site **premium** dans `docs/` (Fraunces + IBM Plex Sans + Bootstrap + Font Awesome, palette Atelier), publié via Pages « Deploy from a branch → `main` `/docs` » (`.nojekyll`). **En ligne : https://jedi-openlab.github.io/doceria/**. Sections : hero + maquette, fonctionnalités, souveraineté, limites assumées, installation, stack/licence.
  - ⏳ **À FAIRE (utilisateur) — captures d'écran** : déposer 3 PNG nommés **`screen-1.png`, `screen-2.png`, `screen-3.png`** dans le dossier **`docs/assets/`** (suggestions : 1 = chat + citations/Sources ; 2 = Bibliothèque RAG ; 3 = thème sombre), puis commit + push → la section « Aperçu » du site se remplit automatiquement (sinon elle reste masquée).
  - ⏳ **À FAIRE (utilisateur) — Release** : créer une *Release* GitHub et y déposer le `.dmg` (Apple Silicon) → le bouton « Télécharger » du site (qui pointe sur `releases/latest`) devient fonctionnel.

## Notes transverses (UX)
- **Aides contextuelles** : partout où c'est pertinent, ajouter une icône **« ? » dans un cercle** ; au survol, une infobulle s'affiche proprement **par-dessus** (sans casser la mise en page). À généraliser progressivement, toujours utile/pertinent.
- `window.prompt()` **n'est pas géré** par la webview Tauri → toujours des **champs inline** pour les saisies (fait : création de collection ; **à migrer** : renommage de conversation).
- **Build Linux** : à produire/tester sur **Ubuntu Studio** (accès SSH fourni par l'utilisateur quand prêt) — valider l'AppImage, le backend trousseau Linux (`async-secret-service`, pas de libdbus C) et les deps `webkit2gtk-4.1`.
- **Données locales** : l'app n'écrit que `settings.json` (métadonnées profils) en appData + conversations/réglages en `localStorage` (webview). **Aucun cache de documents ni index vectoriel local** (RAG géré côté ILaaS). Supprimer une collection = `DELETE` serveur, rien à purger localement.

## Backlog — réglages avancés chat & RAG (inspiré d'AnythingLLM)
- ✅ **Mode RAG : Chat ⇄ Requête** — contrôle segmenté à côté de l'interrupteur (visible quand la bibliothèque est active). « Chat » = s'appuie sur les documents **+** connaissances générales ; « Requête » = répond **uniquement** à partir des extraits, sinon « Je ne trouve pas la réponse dans la bibliothèque. ». Bascule la consigne système injectée (`buildMessages`), persisté. — **fait**.
- ✅ **Réglages de récupération** : **méthode** (`hybrid`/`semantic`/`lexical`), **top-k** (curseur 1–20), **seuil de similarité** (`score_threshold`, 0 = désactivé) — UI dans la section Bibliothèque, transmis à `/search` (param Rust `score_threshold` ajouté à `rag_search`), persisté. — **fait**.
- ✅ **Mémoire** : champ « tours précédents » dans Génération (0 = tout l'historique ; sinon on borne aux N derniers échanges dans `buildMessages`), persisté. — **fait**.
- *(« Mode Agent » = appels d'outils/fonctions par le modèle : **gros chantier séparé**, conditionné au support function-calling d'ILaaS/Mistral.)*
- *(« Réinitialiser la base vectorielle » d'AnythingLLM = chez nous **suppression de collection**, déjà en place.)*
- ✅ **Modèles de consigne système** (sauvegarde/rappel) + feedback « appliquée » — **fait**.
- ✅ **Colonnes pliables** (chevrons gauche/droite) — **fait**.
- ✅ **Sections pliables du rail droit** (chevron sur chaque titre : Connexion, Modèle, Bibliothèque, Génération, Document ; pliage clavier-accessible, mémorisé par section, non destructif vis-à-vis de l'éditeur de profil) — **fait**.

## Phase 1 — Socle Tauri (le chat marche en natif)
- Scaffolder Tauri autour du projet Vite existant (`src-tauri/`).
- Réintégrer l'UI HTML/CSS/JS **telle quelle**.
- Couche réseau native : `list_models` + **chat en streaming** via commandes Rust + events Tauri.
- Retirer le proxy `vite.config`, `server.js`, le bouton « Quitter ».
- Fenêtre native ; **fermer = quitter**.
- **Livrable** : une app double-clic qui charge les modèles et discute en streaming, sans terminal ni CORS.
  *(À ce stade, la clé peut être saisie dans l'UI, stockage trousseau en Phase 2.)*

## Phase 2 — Clés & profils (trousseau)
- Trousseau OS (crate `keyring`).
- **Multi-clés nommées** + **profil par clé** (URL de base + modèle par défaut) ; clé active.
- Migration : la clé n'est plus dans le webview/localStorage.
- **Livrable** : gestion de plusieurs clés sécurisées, bascule de profil en 2 clics.

## Phase 3 — Préférences & thème
- **Dark mode auto** (suit le système) + clair/sombre manuel ; jeu de variables CSS sombre.
- **Vibrance/translucidité macOS**.
- Préférences persistées (app data) : modèle, génération, thème, etc.
- **Livrable** : app qui « se sent » native et premium, thème impeccable.

## Phase 4 — RAG sur dossier (LOCAL, géré par l'app)
- Sélection de dossier + **autorisation persistée**.
- Moteur Rust local : parse → chunk → **embeddings locaux (`bge-m3` via `fastembed`)** → **base vectorielle locale (LanceDB)**.
- **Indexation incrémentale** (hash/mtime) ; **scan manuel + auto au lancement** ; progression.
- **Retrieval top-k + citations** des sources à la réponse.
- **PDF scannés** : OCR local optionnel, sinon journalisés.
- **Livrable** : pointer l'app sur un dossier → bibliothèque interrogeable **hors-ligne**, sources citées.
- *(Garder une abstraction RAG `local ⇄ géré` pour préparer la V2 sans refonte.)*
- *(P1 : watch temps réel, plusieurs dossiers, réglages de récupération.)*

## Phase V2 (ultérieure) — RAG géré ILaaS, si jeton RAG obtenu
- Conditionnée à l'obtention d'un **jeton RAG** (`rag-api.ilaas.fr`, référentiel séparé de l'inférence).
  **Demande envoyée via `ilaas.fr/demande-dacces`, en attente du comité de pilotage.**
- Bascule du moteur local vers la **passerelle gérée** (collections, documents, search, rerank, OCR serveur)
  + **suivi conso** via `GET /v1/me/usage`. Contrat d'API vérifié + accès : `RAG-V2-ilaas.md`.

## Phase 5 — Conso/coût & confort
- **Tokens par échange** (champ `usage` des réponses). *(Conso agrégée `/v1/me/usage` = V2, avec jeton RAG.)*
- Multi-documents ponctuels + **glisser-déposer**.
- Copier / régénérer une réponse ; recherche dans les conversations.
- **Livrable** : finitions d'usage quotidien.

## Repris tel quel (présent dès la Phase 1)
Streaming + Stop, conversations (créer/renommer/supprimer/export Markdown), réglages de génération,
chargement de documents ponctuels.

## Définition de « fini » par phase
- Le build Mac (.app/.dmg) **et** Linux (AppImage) se génèrent.
- L'app se lance sans terminal et se ferme proprement.
- Pas de secret en clair ni hors trousseau ; en V1, embeddings et index **restent locaux**.
- Une revue de code (sécurité clé + souveraineté + correctness) avant de clore chaque phase lourde (2 et 4).
