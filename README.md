# Doceria

> **Enseigner avec l'IA.**

Application de bureau **native** pour interroger l'**API ILaaS** — la
fédération d'inférence souveraine de l'enseignement supérieur et de la recherche français
(API compatible OpenAI ; modèle de chat `mistral-medium-latest`). Doceria fait aussi du
**RAG** sur une bibliothèque de documents via le **service RAG géré ILaaS** (collections
privées OpenGateLLM ; documents, embeddings et index vivent côté infrastructure ESR — l'ancien
projet de RAG 100 % local est une piste abandonnée). **Seul macOS (Apple Silicon) est livré à ce
jour** ; Windows et Linux relèvent de la feuille de route.

Double-clic pour lancer : pas de terminal, pas de CORS, clés au trousseau du système.

Fonctionnalités : **profils de connexion** multiples (chaque profil porte ses clés LLM + RAG
au trousseau, son URL et son modèle), **chat en streaming** avec Stop, réglages de génération
(température, longueur, consigne système + **modèles de consigne** enregistrables), **mémoire
ajustable** (nombre de tours d'historique envoyés), **multi-conversations** (créer / renommer /
supprimer + export Markdown), **comparaison multi-modèles côte à côte** (la même question posée
à plusieurs modèles en même temps, contexte RAG partagé, résultat éphémère tant qu'on ne l'a pas
enregistré), **rendu LaTeX/KaTeX** des formules dans les réponses (`$…$`, `$$…$$`, `\(…\)`,
`\[…\]`), **bibliothèque RAG** (collections + ajout de documents/dossier) avec **modes
Chat ⇄ Requête** et **réglages de récupération** (méthode `hybrid`/`semantic`/`lexical`, nombre
d'extraits, seuil de similarité), chargement de documents de contexte ponctuels
(txt, md, csv, json, pdf, docx). En **mode Requête**, la réponse est strictement fondée sur les
documents : si la recherche RAG échoue ou ne renvoie **aucun extrait**, le modèle **n'est pas
interrogé** (aucun appel facturé) et un message l'explique — pas de repli sur ses connaissances
générales. En **mode Chat**, un tel repli reste possible mais s'accompagne d'un avertissement.
Interface soignée : **thème clair/sombre/auto**, **vibrance macOS**, **colonnes et sections
pliables**, aides contextuelles.

La **bibliothèque** peut aussi être **liée à un dossier local** : un bouton « Synchroniser »
(ou une synchro automatique à l'ouverture du profil, `ragAutoSync`) ajoute les nouveaux fichiers,
met à jour les modifiés et **retire** de la collection ceux supprimés du dossier — indexation
incrémentale, sans tout re-téléverser. Les **PDF/DOCX sont extraits en texte localement**
(pdf.js/mammoth) avant l'envoi, ce qui contourne les limites du parseur serveur.

### Connecteur Moodle (jalon phare — livré sur la branche `moodle`, pour la prochaine version)

Le connecteur **Moodle** est **livré et validé** sur la branche `moodle` ; il ne fait **pas encore
partie du `.dmg` publié** (version actuelle 20260626.8.0) et est destiné à la **prochaine version**.
En bref :

- **Lecture seule stricte** : aucune donnée personnelle (ni notes, ni inscriptions, ni
  participants). Le test de connexion s'appuie sur une **liste blanche de 8 fonctions de contenu**
  plus `downloadfiles`, via un **client HTTP dédié sans redirections** (le jeton voyageant dans le
  corps du POST, suivre une 3xx pourrait l'exfiltrer).
- **Indexation opt-in par consentement de l'enseignant** : aucun cours n'est indexé sans une action
  explicite de l'enseignant — le compte technique de lecture seule (`doceria-rag-readonly`) n'est
  **inscrit** que dans les cours où l'enseignant a accepté, et Doceria n'indexe **que** ces cours ;
  l'inscription du compte vaut consentement. Un mode « tout indexer » reste possible sur décision de
  l'établissement (accès en lecture au niveau catégorie/système). Le **filtre applicatif** qui n'affiche
  que les cours consentis (via `core_enrol_get_users_courses` appelée pour le seul compte technique —
  donc aucune donnée d'étudiant) est le **prochain lot, en cours** ; procédure : `docs/MOODLE-TEST-PLAN.md`.
- **Profils de connexion Moodle** (nom + URL + jeton) **indépendants** des profils ILaaS,
  plusieurs connexions possibles ; le **jeton va au trousseau** (rôle « moodle »).
- **Explorateur de cours** central : recherche, filtre par catégorie, cases à cocher, **sélection
  persistée** dans les métadonnées du profil.
- Bouton **Synchroniser** = ingestion du **texte** (résumés de section + descriptions de modules)
  via un **convertisseur HTML → Markdown maison en Rust** (zéro dépendance, tests unitaires — ni
  html2md, ni turndown, ni html2text) vers une collection RAG « **Moodle · &lt;cours&gt;** » du
  profil ILaaS actif, ensuite interrogeable avec citations. **Barre de progression** par cours et
  garde-fou anti-corruption inter-profils (verrou pendant la synchro).
- Les **fichiers/PDF** joints aux cours relèvent du **Lot 4** (à venir).

Référence d'implémentation : `src-tauri/src/moodle.rs` et `docs/MOODLE-IMPLEMENTATION-ROADMAP.md`.

Également : **glisser-déposer** de fichiers vers une collection (avec barre de progression),
**gestion documentaire** (lister / supprimer un document), **suivi de consommation** (requêtes,
tokens, coût et impact CO₂ via `GET /me/usage`), **sélecteur de modèle** directement dans le chat,
et **vérification de mise à jour** au démarrage (GitHub Releases). Direction artistique
**façon macOS** (gris système, accent teal du logo), clair et sombre.

> 📖 **Mode d'emploi complet** (chaque fonction et chaque réglage expliqués) sur le site :
> <https://jedi-openlab.github.io/doceria/#guide>

## Ce qui distingue Doceria

Doceria s'inspire des outils de RAG de bureau (comme **AnythingLLM**) mais assume des choix
différents, pensés pour l'**enseignement supérieur souverain** et la simplicité côté enseignant :

- **Souverain par conception** — bâti pour **ILaaS / OpenGateLLM** (fédération ESR, tutelle MESR) :
  données et vecteurs restent dans le périmètre ESR. Les outils agnostiques laissent, eux, la
  souveraineté dépendre de votre configuration.
- **Dossier ↔ collection** — liez une collection à un dossier local et synchronisez (ajout, mise à
  jour, **retrait**) à la demande ou à l'ouverture du profil. La synchro de documents d'AnythingLLM
  est, à ce jour, limitée à **un seul fichier** à la fois (« *you currently cannot watch an entire
  directory* »).
- **Léger & natif** — **Tauri** (webview système + cœur Rust, ~15 Mo, vibrance macOS) plutôt
  qu'**Electron**.
- **Clés au trousseau du système** — jamais dans un fichier de l'app ni dans la page ; réseau en
  Rust (pas de CORS). AnythingLLM chiffre les clés au repos dans sa base SQLite applicative.
- **Zéro télémétrie** — rien ne sort vers un tiers, par défaut. (AnythingLLM collecte une télémétrie
  *anonyme* activée par défaut, désactivable.)

En toute honnêteté, AnythingLLM reste **plus riche** sur d'autres terrains (agents, connecteurs
multiples, multi-vector-DB, multi-utilisateur). Doceria vise la **souveraineté ESR**, la
**simplicité** et un **flux documentaire** sans friction pour les enseignants.

> Sources (vérifié en juin 2026 ; AnythingLLM évolue vite) :
> [Automatic document sync](https://docs.anythingllm.com/beta-preview/active-features/live-document-sync),
> [Privacy & Data](https://docs.anythingllm.com/features/privacy-and-data-handling),
> [General Desktop Information](https://docs.anythingllm.com/installation-desktop/storage).

## Stack

- **Frontend** : Vite + JavaScript vanilla (l'UI HTML/CSS/JS du portail web, réutilisée telle quelle).
- **Coquille native** : **Tauri v2** (Rust + webview système). La couche réseau ILaaS
  (liste des modèles, chat streaming) est en Rust (`reqwest`) → appels natifs, **sans CORS**,
  la clé ne transite pas par le webview.

Voir `docs/ARCHITECTURE.md` pour le détail, `docs/ROADMAP.md` pour le phasage.

## Prérequis

Chaîne Rust + dépendances système (et Node 18+). Procédure complète : **`docs/SETUP.md`**.
En bref : `rustup` (cargo/rustc), Xcode (macOS), Node. (Les dépendances Linux —
`libwebkit2gtk-4.1-dev` & co — ne concernent que le portage Linux, qui n'est pas encore livré.)

## Développement

```bash
npm install
npm run tauri dev      # ouvre la fenêtre native, rechargement à chaud du frontend
```

Dans l'app : crée un **profil** (rail « Connexion » → **+ Nouveau**), colle ta **clé d'inférence**
(URL `https://llm.ilaas.fr/v1` par défaut), **Tester** récupère les modèles ; ajoute si besoin
l'**URL + clé RAG** (`https://rag-api.ilaas.fr/v1`) pour activer la bibliothèque. Les clés vont
au trousseau du système — aucune variable d'environnement requise (cf. `.env.example`).

## Build (application distribuable, non signée)

```bash
npm run tauri build
```

Le numéro de version suit le schéma **`AAAAMMJJ.ii.0`** (date · itération du jour · 0), valide semver — voir `src-tauri/Cargo.toml`. Pour une release, taguer `vAAAAMMJJ.ii.0` (le bouton « Télécharger » du site et la vérification de mise à jour s'appuient dessus).

- **macOS — Apple Silicon (arm64), seule plateforme livrée** : `Doceria.app` +
  `Doceria_<version>_aarch64.dmg` (`src-tauri/target/release/bundle/`). Le build se fait sur un Mac
  Apple Silicon → app **arm64** native (pas d'Intel — cible arm64 conforme au matériel Apple Silicon
  visé). Build **non signé** → au 1ᵉʳ lancement : clic droit → **Ouvrir**, ou Réglages Système →
  Confidentialité et sécurité → « Ouvrir quand même ». Guide utilisateur pas-à-pas :
  [`INSTALLATION-macOS.md`](INSTALLATION-macOS.md).
- **Linux** (`.AppImage`, `.deb`, `.rpm`) : **non livré** — cibles prévues dans la feuille de route
  (le portage Linux est planifié **après** le connecteur Moodle). Windows relève également de la
  feuille de route.

## Structure du dépôt

```
doceria/
├── index.html              # point d'entrée du frontend (Vite)
├── vite.config.js          # bundler frontend de Tauri (port 1420 ; plus de proxy)
├── public/logo.png         # logo affiché dans l'UI
├── branding/               # source du logo (icônes générées via « tauri icon »)
├── src/                    # UI réutilisée
│   ├── main.js             # orchestration : profils, modèles, chat, bibliothèque RAG
│   ├── api.js              # invoke(...) : chat, profils, RAG (+ listen('chat://delta'))
│   ├── state.js  ui.js  conversations.js  documents.js  styles.css
├── src-tauri/              # coquille Rust (Tauri v2)
│   ├── src/ilaas.rs        # réseau ILaaS : list_models, chat streaming, cancel, test
│   ├── src/rag.rs          # RAG géré ILaaS : collections, upload, search, rerank
│   ├── src/keychain.rs     # secrets au trousseau OS (write-only ; rôles llm/rag/moodle)
│   ├── src/settings.rs     # profils (métadonnées non sensibles, appData)
│   ├── src/moodle.rs       # connecteur Moodle : WS REST lecture seule + HTML→Markdown maison
│   ├── src/update.rs       # vérification de mise à jour (GitHub Releases, hors webview)
│   ├── src/lib.rs  main.rs # entrée, commandes, fenêtre (fermer = quitter)
│   ├── tauri.conf.json     # config app (nom, fenêtre, identifiant, bundle)
│   ├── capabilities/  icons/  Cargo.toml
└── docs/                   # index.html (site), SPEC, ARCHITECTURE, ROADMAP, SETUP, RAG-V2-ilaas,
                            #   MOODLE-IMPLEMENTATION-ROADMAP, MOODLE-TEST-PLAN, POINT-DE-REPRISE
```

## Feuille de route à venir

- **Moodle — Lot 4** : ingestion des **fichiers/PDF** joints aux cours (`pluginfile.php` avec
  `token=` → `rag_upload_document`).
- **Moodle — Lot 5** : **synchro incrémentale + déduplication**, planifiable la nuit.
- **Moodle — Lot 6** : interrupteur « inclure les cours Moodle » directement dans le chat.
- **Portage Windows** : Tauri multiplateforme + WebView2 + **signature Authenticode**.
- **Version serveur/web** : deux formats visés (app de bureau vs serveur central sans installation).
- **Portage Linux** : `.AppImage` / `.deb` / `.rpm` (planifié **après** Moodle).
- **Signature / notarisation** : lève la quarantaine macOS et le SmartScreen Windows.

Détail du phasage : `docs/ROADMAP.md` et `docs/MOODLE-IMPLEMENTATION-ROADMAP.md`.

## Sécurité de la clé

Les clés ILaaS (inférence **et** RAG) sont **nominatives** et **facturées**. Elles vivent dans
le **trousseau du système** (Keychain macOS / Secret Service Linux), rattachées à un profil ;
elles ne transitent jamais par le webview ni par un fichier (la résolution clé → requête se
fait dans le cœur Rust). Ne placez jamais de clé en clair dans un fichier versionné.

> ⚠️ **macOS, app non signée** : au premier accès au trousseau, macOS peut afficher
> « Doceria souhaite utiliser le trousseau » — c'est attendu. L'app n'étant pas signée
> (signature ad-hoc), l'autorisation peut être redemandée après une reconstruction ; une
> signature/notarisation (hors V1) la rendrait stable.

## Licence

Doceria est publié sous **double licence** (voir [`LICENSE`](LICENSE)) :
- **Code source** : licence **MIT**.
- **Contenus originaux JEDI-OpenLab** (documentation, ressources) : **CC BY 4.0**.

L'API ILaaS, les modèles et les bibliothèques tierces (pdf.js, mammoth, Tauri) conservent
leurs licences propres.
