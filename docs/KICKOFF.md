# Instruction de démarrage — développement de l'app Doceria (à coller dans la nouvelle conversation)

---

On démarre le développement de l'application de bureau **Doceria** (techno **Tauri**).
Tout le cadrage est écrit. **Avant d'écrire du code, lis ces fichiers** dans
`JEDI-OpenLab/doceria/docs/` :
- `SPEC.md` — cahier des charges et décisions actées
- `ARCHITECTURE.md` — choix techniques, migration depuis l'app web, RAG local (V1)
- `ROADMAP.md` — phasage de réalisation
- `SETUP.md` — prérequis (chaîne Rust, dépendances système)
- `RAG-V2-ilaas.md` — le RAG géré ILaaS (V2, si jeton RAG) : contrat d'API vérifié + accès

**Contexte clé** :
- L'app web actuelle (Vite + JS vanilla) est dans `JEDI-OpenLab/doceria/`. Son frontend
  (`index.html`, `src/*.js`, `styles.css`) **est conservé et réutilisé** : Tauri utilise Vite comme
  bundler frontend. On ajoute la coquille Rust autour, et on retire `server.js`, le bouton « Quitter »
  et le proxy de `vite.config.js` pendant la migration.
- Décisions actées : **Tauri**, **macOS + Linux** (pas Windows), **app non signée**, **multi-clés nommées
  avec profil par clé** (URL + modèle) au **trousseau OS**, **plusieurs documents** ponctuels.
- **RAG — V1 = LOCAL, géré par l'app** : dossier local → **embeddings locaux `bge-m3`** (via `fastembed`) →
  **base vectorielle locale** (LanceDB) → retrieval top-k + citations. **Hors-ligne**, rien ne sort sauf le chat.
- **RAG — V2 (ultérieur, si jeton RAG)** : bascule vers le **service géré ILaaS** (OpenGateLLM, `rag-api.ilaas.fr`).
  ILaaS émet **deux jetons distincts** (inférence + RAG) ; **demande de jeton RAG envoyée le 2026-06-25 via
  `ilaas.fr/demande-dacces`, en attente de validation du comité de pilotage** (la clé d'inférence renvoie
  « Invalid API key » sur le RAG — testé). Contrat d'API vérifié + procédure : `RAG-V2-ilaas.md`.
- **Conso** : V1 = tokens par échange (champ `usage`) ; V2 = `GET /v1/me/usage`. Modèle chat réel : **`mistral-medium-latest`**.
- Garder une **abstraction RAG `local ⇄ géré`** pour permettre la bascule V2 sans refonte.
- Ce portail est mon **RAG personnel et local**, distinct de **Learnix** (RAG institutionnel/multi-utilisateurs).

**Ce que je veux que tu fasses, dans l'ordre** :
1. Vérifier mes **prérequis** (`cargo --version`, etc. selon `SETUP.md`) et me dire ce qui manque.
2. Me proposer un **plan détaillé de la Phase 1 (socle Tauri)** : arborescence `src-tauri/`, commandes
   Rust prévues (`list_models`, `chat` en streaming via events), adaptation de `src/api.js`, suppression
   des pièces obsolètes. **Puis attendre mon accord avant de coder.**
3. Après accord : réaliser la Phase 1, vérifier le build (Mac + Linux) et le lancement, puis on enchaîne.

Travaille phase par phase (voir `ROADMAP.md`), avec une revue de code (sécurité de la clé, souveraineté,
correctness) avant de clore les phases lourdes (clés, RAG).

---

*(Fin de l'instruction à coller.)*
