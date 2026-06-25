# Doceria — Phasage de réalisation (Tauri)

> Ordre conçu pour **dé-risquer** : on prouve le socle natif + le chat avant d'attaquer l'intégration RAG.
> Chaque phase produit un build Mac + Linux testable.

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
