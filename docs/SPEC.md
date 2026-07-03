# Doceria — Cahier des charges (application de bureau)

> **⚠️ DOCUMENT DE CADRAGE HISTORIQUE.** Ce cahier des charges décrit les intentions **de départ**
> du projet (passation, début du développement). Il est conservé pour mémoire, mais **plusieurs
> décisions ont évolué depuis** — voir les encarts « ⟳ Depuis » ci-dessous. Pour l'état **courant**
> et le mode d'emploi, se référer à `../README.md`, au site (section « Mode d'emploi »),
> à `MOODLE-IMPLEMENTATION-ROADMAP.md` et à `src-tauri/src/`.
>
> **Filiation.** Doceria est la **filiation directe du POC Learnix** : ce dernier a servi de preuve
> de concept d'un portail RAG pour l'ESR ; Doceria en est la version application de bureau, mono-
> utilisateur, s'appuyant désormais sur le **RAG géré ILaaS** (OpenGateLLM).
>
> **Décisions structurantes ayant changé depuis ce cadrage :**
> - **RAG livré = RAG GÉRÉ ILaaS** (OpenGateLLM, `rag-api.ilaas.fr`). Le « RAG 100 % local » décrit
>   plus bas (embedder `bge-m3` local, base vectorielle locale type LanceDB/`sqlite-vec`, index et
>   OCR locaux) était le design **V1 abandonné** : documents, embeddings et index vivent côté infra
>   ESR (collections « private »).
> - **Plateformes : seul macOS arm64 est livré.** Windows et Linux relèvent de la feuille de route
>   (ordre acté : **Moodle avant Linux**).
> - **Connecteur Moodle quasi complet** (lecture seule, **opt-in par consentement**, Lots 0-7 fusionnés
>   dans `main`), destiné à la **prochaine** version — voir `MOODLE-IMPLEMENTATION-ROADMAP.md` et
>   `src-tauri/src/moodle.rs`.
> - **Correctif RAG mode Requête** en place (voir § E).
> - **Question ouverte « jeton RAG » : RÉSOLUE** — le RAG géré ILaaS est **en service** (§ 8).

## 1. Problème & objectif
Le portail ILaaS existe en application web (Vite + JS vanilla, fonctionnelle), mais son usage
suppose un terminal (lancer un serveur, ouvrir un onglet). Cible : un·e enseignant·e-chercheur·e,
pas un·e développeur·se.

**Objectif : une application de bureau native, double-cliquable, sans terminal**, qui par construction :
- règle le CORS (requêtes hors navigateur, en natif) ;
- sécurise les clés API dans le **trousseau du système** ;
- et apporte un **RAG** sur une **bibliothèque = une collection interrogeable**.

> **⟳ Depuis.** Cible de départ « macOS + Linux ». **Livré : macOS arm64 uniquement.** Linux relève
> de la feuille de route (**après Moodle**). Le RAG livré est le **RAG géré ILaaS** (OpenGateLLM),
> pas l'indexation locale décrite ici (design V1 abandonné — voir bandeau).

## 2. Techno retenue
**Tauri** (coquille Rust + webview système). Voir `ARCHITECTURE.md` pour le détail et la
justification. Décision définitive.

## 3. Objectifs mesurables
- **Zéro commande** : installer = poser l'app ; utiliser = double-clic ; quitter = fermer la fenêtre.
- **Souveraineté** : clés au trousseau. *(Objectif de départ « documents et vecteurs 100 % locaux »
  abandonné : le RAG livré est **géré par ILaaS** ; documents, embeddings et index vivent côté infra
  ESR, en collections « private ».)*
- **Continuité** : tout ce que fait l'app web aujourd'hui marche à l'identique.
- **RAG utile** : une bibliothèque (collection) interrogeable, avec citation des sources.

## 4. Non-objectifs (hors périmètre, assumés)
- ❌ Pas de compte / pas de cloud : 100 % local, mono-utilisateur.
- ❌ Pas de multi-fournisseurs : **ILaaS uniquement**.
- ❌ Pas de signature/notarisation : **app non signée** (sur macOS : « Ouvrir quand même » au 1ᵉʳ lancement).
- ❌ Pas de Windows ni de Linux au lancement — feuille de route (ordre acté : **Moodle avant Linux** ;
  Windows = Tauri multiplateforme + WebView2 + signature Authenticode). Seul **macOS arm64** est livré.
- ❌ Pas de mise à jour automatique en V1.
- ❌ Ce portail n'est PAS Learnix, mais en est **la filiation directe** : Learnix a été le **POC** d'un
  portail RAG pour l'ESR (institutionnel/gouverné, multi-utilisateurs, corpus partagé) ; Doceria en est
  la version **application de bureau mono-utilisateur**, adossée au **RAG géré ILaaS**. Deux outils,
  deux usages, une même filiation.

## 5. Exigences fonctionnelles (par domaine)

### A. Clés & connexion
- **P0** — Plusieurs **clés API nommées** (ajouter / renommer / supprimer), choisir la **clé active**.
- **P0** — **Profil par clé** : chaque clé porte aussi son **URL de base** et son **modèle par défaut**.
  Changer de clé = changer de profil complet.
- **P0** — Clés stockées dans le **trousseau OS** (Keychain macOS / Secret Service Linux), jamais en clair.
- **P0** — Chargement des modèles + requêtes **natives** (plus de proxy, plus de CORS).
- **P1** — Test de connexion par clé / indicateur de validité.

### B. Préférences & thème
- **P0** — **Thème clair / sombre / auto** (auto = suit le système, bascule en temps réel).
- **P0** — Préférences **persistées** (clé active, modèle, température/longueur/consigne, thème, dossier RAG…).
- **P1** — Fenêtre Préférences dédiée ; **vibrance/translucidité macOS**.
- **P2** — Taille de police / accessibilité ; langue FR/EN.

### C. RAG — géré par ILaaS (cœur de l'app livrée)
> **⟳ Depuis — RAG géré ILaaS.** Cette section décrivait le design **V1 « RAG 100 % local »
> (ABANDONNÉ)** : embedder `bge-m3` local, base vectorielle locale, index et OCR sur la machine.
> Le RAG **livré** est le **RAG géré ILaaS** (OpenGateLLM, `rag-api.ilaas.fr`, `src-tauri/src/rag.rs`) :
> l'app **téléverse** les documents vers des **collections « private »** côté infra ESR ; découpage,
> vectorisation (`bge-m3` **côté serveur**), stockage et recherche top-k se font **côté ILaaS**.
> Les puces ci-dessous sont conservées pour mémoire et **réinterprétées** en conséquence.
- **P0** — **Choisir un dossier** via dialogue natif ; **autorisation persistée** (security-scoped bookmark macOS). *(Livré : la synchro « dossier local → collection » existe — Lier un dossier, « Synchroniser à l'ouverture du profil », `ragAutoSync` — mais elle **téléverse** vers une collection ILaaS ; elle n'indexe pas localement.)*
- **P0** — ~~**Scanner** (récursif) → découper → **vectoriser (embedder local `bge-m3`)** → **base vectorielle locale**~~ → **remplacé** par : téléversement des fichiers vers la collection ILaaS ; découpe/vectorisation **côté serveur**.
- **P0** — **Indexation incrémentale** : empreinte (hash + date) par fichier ; au re-scan, ne traiter que le nouveau/modifié. *(Design V1 local ; côté connecteur Moodle, la synchro incrémentale + dédup est **livrée** — Lot 5, voir § H.)*
- **P0** — **Bouton de synchronisation** + option **synchro à l'ouverture du profil**.
- **P0** — À la question : **récupérer les passages pertinents (top-k)** côté ILaaS et les injecter ; **citer les sources**.
- **P0** — État visible : progression pendant la synchronisation, collections listées.
- **P1** — **Surveillance temps réel** du dossier (auto-synchronisation à l'ajout d'un fichier). *(Piste ; la synchro à l'ouverture du profil est livrée.)*
- **P1** — Plusieurs dossiers / exclusions ; re-synchroniser.
- **P1** — ~~**PDF scannés** : OCR local~~ → OCR **côté ILaaS** (piste abandonnée en local).
- **P2** — Réglages de récupération (top-k, seuil).

### D. Document de contexte ponctuel (existant, conservé)
- **P0** — Charger un ou **plusieurs documents** ponctuels (txt/md/csv/json/pdf/docx) injectés tels quels, en plus du RAG.
- **P1** — **Glisser-déposer** ; liste de documents retirables individuellement.

### E. Chat & génération
- **P0** — Streaming + **Stop** (existant), réglages température/longueur/consigne.
- **P0** — **Modes RAG (livré) : Chat ⇄ Requête** (`state.ragMode`, `src/main.js`). En mode **Requête**,
  si la recherche RAG **échoue** (ou renvoie **0 extrait**), le modèle **NE répond PLUS** sur ses
  connaissances générales : il **bloque** et l'explique (**aucun appel facturé**). En mode **Chat**,
  repli assumé **avec avertissement**.
- **P0** — **Suivi de consommation** : **tokens par échange** (champ `usage` des réponses chat). *(La conso
  agrégée via `GET /v1/me/usage` n'existe que sur la passerelle RAG → V2 ; l'API ILaaS n'expose pas de
  notion de « parts », seulement le coût/tokens consommés par requête.)*
- **P1** — Copier une réponse ; régénérer la dernière réponse.
- **P2** — Rendu Markdown enrichi (tableaux, liens **assainis**), édition d'un message.

### F. Conversations (existant, conservé)
- **P0** — Créer / renommer / supprimer ; historique persisté (dossier de données de l'app) ; export Markdown.
- **P1** — Recherche dans les conversations.
- **P2** — Dossiers / épingles ; export/import global (sauvegarde).

### G. Application & distribution
- **P0** — Fenêtre native ; **fermer = tout arrêter** ; icône + nom.
- **P0** — Build **macOS (.app/.dmg)**, **non signé** (version publiée `20260626.8.0`, macOS arm64).
  *(Linux AppImage = feuille de route, après Moodle ; Windows plus tard.)*
- **P2** — Windows (Tauri + WebView2 + signature Authenticode) ; Linux ; mise à jour automatique ;
  signature/notarisation (quarantaine macOS + SmartScreen Windows).

### H. Connecteur Moodle (complet — voir `MOODLE-IMPLEMENTATION-ROADMAP.md`)
> **⟳ Ajouté depuis ce cadrage.** Non prévu au cahier des charges d'origine. **Complet** (lecture
> seule, **opt-in par consentement**) : Lots 0-7 livrés, relus par revues multi-agents adversariales et
> **fusionnés dans `main`**, destinés à la **prochaine** version (**pas encore dans le `.dmg` publié
> `20260626.8.0`**). Le Lot 6 (interrupteur « Inclure les cours Moodle » dans le chat) est **livré
> (2026-07-03)** ; reste le test en réel puis le merge/release. Référence de vérité :
> `MOODLE-IMPLEMENTATION-ROADMAP.md` et `src-tauri/src/moodle.rs`.
- **Lecture seule stricte** (web services REST Moodle).
- **Profils de connexion Moodle** (nom + URL + jeton ; jeton au **trousseau**, rôle « moodle » ;
  indépendants des profils ILaaS ; plusieurs connexions possibles).
- **Test de connexion** : liste blanche de **8 fonctions de contenu** + `downloadfiles` ; client HTTP dédié
  **sans redirections** (le jeton voyage dans le corps du POST).
- **Explorateur de cours** central (recherche + filtre par catégorie + cases à cocher ; sélection persistée).
- **Synchroniser** = ingestion du **texte** (résumés de section + descriptions de modules) via un
  **convertisseur HTML → Markdown maison en Rust** (zéro dépendance, tests unitaires — **pas**
  html2md/turndown/html2text) vers une collection RAG **« Moodle · <cours> »** dans le profil ILaaS actif,
  interrogeable avec citations. **Barre de progression** par cours ; synchro **anti-corruption** inter-profils.
- **Fichiers/PDF des cours** (Lot 4) : téléchargement sécurisé (`pluginfile.php?token=` → `rag_upload_document`)
  + extraction locale, contournant le 502 ILaaS.
- **Synchro incrémentale + déduplication** (Lot 5) : index local ; une re-synchro ne duplique plus, avec
  bilan détaillé. **Bouton « Nouveautés »** (Lot 5.1) → badge « ⟳ à mettre à jour » sur les cours modifiés
  côté Moodle.
- **Filtre opt-in « cours inscrits »** (Lot 7) = **consentement de l'enseignant** : l'inscription du compte
  technique vaut accord ; `core_enrol_get_users_courses` appelée **uniquement pour le compte technique**
  (zéro donnée d'étudiant) ; interrupteur, **défaut ON** ; le mode « tout indexer » relève d'une décision
  de la Direction.
- **Interrupteur « Inclure les cours Moodle »** dans le composer du chat (Lot 6, ✅ 2026-07-03) :
  étend la recherche RAG à la collection active **+ toutes** les collections « Moodle · … », en un
  seul appel, avec citations. Reste : test en réel puis merge/release.

## 6. Exigences non-fonctionnelles
- **Sécurité/souveraineté** : clés et jetons au trousseau ; zéro télémétrie ; aucune dépendance CDN.
  *(L'objectif « documents et vecteurs locaux » n'a pas été retenu : le RAG est **géré par ILaaS**,
  documents et index côté infra ESR, collections « private ».)*
- **Multiplateforme** : **macOS arm64 livré** ; Linux en feuille de route (après Moodle), Windows plus tard.
- **Réutilisation** : l'UI HTML/CSS/JS existante est conservée ; seule la couche réseau + la coquille changent.
- **Performance** : la 1ʳᵉ synchronisation d'une bibliothèque peut être longue (progression + tâche de fond).
- **Hors-ligne** : l'app se lance sans réseau ; le RAG **géré ILaaS** requiert le réseau (téléversement,
  recherche, chat).
- **Maintenabilité** : l'auteur édite HTML/CSS/JS ; la coquille Rust est écrite par l'assistant et bouge peu.

## 7. Décisions actées (rappel)
> Colonne « ⟳ Livré » = ce qui a effectivement été retenu quand la décision de cadrage a évolué.

| Sujet | Décision (cadrage) | ⟳ Livré |
|---|---|---|
| Techno | **Tauri** | inchangé |
| Plateformes | macOS + Linux (Windows hors V1) | **macOS arm64 seul** ; Linux en feuille de route (**après Moodle**) |
| Signature | **Non signée** | inchangé (quarantaine macOS au 1ᵉʳ lancement) |
| Clés | **Multi-clés nommées + profil par clé** (URL + modèle), au **trousseau** | inchangé |
| Documents | **Plusieurs** à la fois | inchangé |
| RAG | Local, géré par l'app (embedder + base vectorielle locale) | **Géré ILaaS** (OpenGateLLM, `rag-api.ilaas.fr`) — design local **abandonné** |
| Embeddings | `bge-m3` en local (via `fastembed`/ONNX) | `bge-m3` **côté serveur ILaaS** |
| Bibliothèque | Un dossier local, indexé localement | **Collections ILaaS « private »** (téléversement + recherche côté serveur) |
| Modes RAG | — | **Chat ⇄ Requête** ; en Requête, pas de repli si échec/0 extrait (aucun appel facturé) |
| Conso | **Tokens par échange** | inchangé (`usage` des réponses chat) |
| Modèle chat | **`mistral-medium-latest`** (id réel) | inchangé |
| Connecteur Moodle | *(non prévu)* | **Quasi complet** (lecture seule, opt-in par consentement) — Lots 0-7 dans `main`, prochaine version (§ H) |
| Positionnement | RAG personnel, distinct de **Learnix** | RAG personnel adossé à ILaaS ; **filiation directe du POC Learnix** |

## 8. Questions ouvertes (au moment du cadrage) — **résolues depuis**
1. **Jeton RAG ILaaS** : ✅ **RÉSOLUE — le RAG géré ILaaS est en service.** Le jeton RAG (distinct de la
   clé d'inférence) a été obtenu et stocké au trousseau ; l'app crée des collections « private »,
   téléverse et interroge le RAG géré ILaaS (`rag-api.ilaas.fr`, `src-tauri/src/rag.rs`). Ce qui était
   présenté comme « toute la V2 » **est le mode livré**.
2. ~~Modèle d'embeddings local (`bge-m3` via `fastembed`/ONNX)~~ — **caduque** : l'embedding `bge-m3` se fait
   **côté serveur ILaaS**. Pas d'embedder local.
3. ~~Base vectorielle locale (LanceDB vs `sqlite-vec`)~~ — **caduque** : stockage/recherche **côté ILaaS**.
4. ~~OCR local (tesseract) pour PDF scannés~~ — **caduque en local** : traitement des fichiers **côté ILaaS**
   (fichiers/PDF Moodle = Lot 4, voir § H).
