# RAG géré ILaaS — contrat d'API

> **Statut : RAG géré ILaaS EN SERVICE et publié** (v20260626.8.0). Le RAG livré est le RAG **géré par ILaaS** (passerelle OpenGateLLM, `rag-api.ilaas.fr`) : documents, embeddings et index vivent côté infra ESR, en collections « private ». C'est le seul mode RAG livré ; le RAG **100 % local** (embedder `bge-m3` local, LanceDB, index/OCR locaux) était un **design V1 abandonné** — voir §7.
> Ce document sert de **contrat d'API de référence** : contrat **vérifié** contre l'`openapi.json` live + le code source OpenGateLLM (passe de vérification adverse), et **confirmé en production** par le client `src-tauri/src/rag.rs` (formes `POST /search`, `POST /documents`, `POST /rerank`).
> Ce qui reste incertain côté exploitant ILaaS (backend vectoriel, rétention) est marqué *(à confirmer)*.

---

## 1. Le 403, expliqué *(historique — jeton RAG obtenu depuis)*

> **Note historique.** Le jeton RAG a été obtenu et le service est en production. Cette section (et les §2–3) documente la démarche d'obtention d'accès ; on la conserve à titre de mémoire, elle n'est plus une action à mener.

La passerelle RAG (`rag-api.ilaas.fr`) est un **service distinct** de l'inférence (`llm.ilaas.fr`), avec son **propre référentiel de clés**.

- **Fait confirmé** (page officielle <https://www.ilaas.fr/rag-ilaas/>) : ILaaS émet **deux jetons distincts** — « *vous aurez reçu un token pour l'inférence et un token pour le RAG* ».
- **Testé** : la clé d'inférence → `200` sur `llm.ilaas.fr/v1/models`, mais `403 {"detail":"Invalid API key."}` sur **tous** les endpoints de `rag-api.ilaas.fr`.
- **Conclusion** : il faut un **jeton RAG dédié**. Ce n'est **pas** un problème de code côté client.
- *(Mécanique probable, non confirmée : `llm.ilaas.fr` et `rag-api.ilaas.fr` sont deux instances OpenGateLLM séparées, annuaires de clés/rôles distincts. À confirmer via `GET /v1/me/info` une fois une clé RAG en main.)*

## 2. Procédure d'accès *(historique — accès accordé)*

- **Canal unique** : le formulaire **<https://www.ilaas.fr/demande-dacces/>** (pas d'email public d'octroi).
- **Validation** par le **comité de pilotage** ILaaS ; les accès arrivent **par email**.
- **Rattachement ESR obligatoire** : les demandes **à titre individuel sont refusées** → rattacher à **Centrale Lille / CentraleSupélec** (un email `gmail.com` ne suffira pas).
- Le formulaire ne distingue pas forcément inférence/RAG → **préciser explicitement** qu'on veut un **jeton RAG**.
- ⚠️ Ne **pas** utiliser `exp-ia[at]listes.univ-rennes.fr` (c'est la plateforme RAGaRenn de l'Univ. Rennes, hors octroi ILaaS).
- **Test de validation** à réception du jeton RAG :
  ```bash
  curl -H "Authorization: Bearer <TOKEN_RAG>" https://rag-api.ilaas.fr/v1/models
  ```
  → doit passer de `403` à `200` et lister `bge-m3` et `bge-reranker-v2-m3`.

## 3. Brouillon de demande *(historique — archive)*

> Modèle de courrier utilisé pour la demande d'accès. Conservé pour mémoire ; l'accès a été accordé.
>
> Objet : **Demande d'accès au service RAG ILaaS (rag-api.ilaas.fr) — token RAG en complément d'un token d'inférence existant**
>
> Bonjour,
>
> Nous disposons déjà d'un accès à votre service d'inférence ILaaS (token fonctionnel sur `https://llm.ilaas.fr/v1`) et souhaitons obtenir un accès au service RAG ILaaS (`https://rag-api.ilaas.fr`).
>
> Contexte technique : notre token d'inférence actuel renvoie un HTTP 403 sur `https://rag-api.ilaas.fr/v1/models`. Nous comprenons, d'après votre documentation (<https://www.ilaas.fr/rag-ilaas/>), que l'inférence et le RAG font l'objet de deux jetons distincts. Nous demandons donc l'émission d'un token dédié au service RAG (ou, le cas échéant, l'extension des droits de notre rôle/organisation au périmètre RAG sur l'instance `rag-api.ilaas.fr`).
>
> Établissement de rattachement (ESR) : **[À COMPLÉTER — ex. Centrale Lille / CentraleSupélec]**, au nom duquel cette demande est formulée.
>
> Usage prévu : application de bureau souveraine (Tauri ; **macOS arm64 livré**, Linux prévu ultérieurement), le « Doceria », destinée à interroger une bibliothèque personnelle de documents via RAG. L'application s'appuierait sur les modèles RAG ILaaS (embeddings `bge-m3`, reranker `bge-reranker-v2-m3`) et sur les endpoints OpenGateLLM standard (`/v1/collections`, `/v1/documents`, `/v1/search`, `/v1/rerank`).
>
> Pourriez-vous nous indiquer la marche à suivre pour obtenir ce token RAG, et nous le transmettre une fois la demande validée par le comité de pilotage ?
>
> Avec nos remerciements,
> **[Nom Prénom] — [Fonction / Établissement ESR] — [Email de contact]**

## 4. La passerelle = OpenGateLLM (ex-« Albert API »)

- `rag-api.ilaas.fr` fait tourner **OpenGateLLM**, anciennement **Albert API**, maintenu par **DINUM / Etalab** (`github.com/etalab-ia/OpenGateLLM`), sponsor CentraleSupélec. Compatible OpenAI.
- **Souveraineté** : ILaaS auto-héberge son instance dans le périmètre du consortium ESR (tutelle MESR). Les documents/vecteurs **restent chez ILaaS**.
- **Stockage** : PostgreSQL (métadonnées), Redis (cache/usage), **Elasticsearch** (chunks + embeddings + recherche) sur la branche actuelle *(versions plus anciennes : Qdrant — millésime ILaaS à confirmer)*.
- **Rétention** : « *No chat history storage* » ; collections/documents/chunks **persistés jusqu'à suppression** (`DELETE`). Politique de rétention précise = décision de l'exploitant ILaaS *(à confirmer)*.
- **Confidentialité** : `visibility: private` (défaut) = collection visible/recherchable **par le seul propriétaire** → adapté à une bibliothèque personnelle.

## 5. Contrat d'API REST (vérifié) — base `https://rag-api.ilaas.fr/v1`

**Auth** : `Authorization: Bearer <CLE_RAG>` (schéma unique `HTTPBearer`) sur tous les `/v1/*`. `openapi.json` lisible sans auth.

### Modèles
`GET /v1/models` → liste `{ id, object, owned_by, type, max_context_length, aliases[], created, costs }`. Côté ILaaS : `bge-m3` (embeddings), `bge-reranker-v2-m3` (reranker, type `text-classification`). `GET /v1/models/{model}`.

### Collections
`POST /v1/collections` (`CollectionRequest`) :

| Champ | Type | Requis | Défaut |
|---|---|---|---|
| `name` | string (minLength 1) | **oui** | — |
| `description` | string\|null | non | — |
| `visibility` | enum `[private, public]` | non | `private` |

Réponse 201 `Collection` : `{ object:"collection", id, name, owner, description, visibility, created, updated, documents }`.
`GET /v1/collections` — query : `name`, `visibility`, `offset` (0), `limit` (1‑100, 10), `order_by` (`id|name|created|updated`, def `id`), `order_direction` (`asc|desc`, def `asc`).
Aussi : `GET|DELETE|PATCH /v1/collections/{collection_id}`.

### Documents (`multipart/form-data`)
`POST /v1/documents` :

| Champ | Type | Requis | Défaut |
|---|---|---|---|
| `file` | binary | non | — |
| `name` | string | non | — |
| `collection_id` | integer (>0) | non | — |
| `collection` | integer | non *(déprécié, alias)* | — |
| `disable_chunking` | boolean | non | `false` |
| `chunk_size` | integer | non | `2048` (0 = pas de découpage) |
| `chunk_min_size` | integer | non | `0` |
| `chunk_overlap` | integer | non | `0` |
| `is_separator_regex` | boolean | non | `false` |
| `separators` | array[string] | non | `[]` |
| `preset_separators` | string (enum, `markdown`…) | non | `markdown` |
| `metadata` | string (JSON, ≤10 props, clés/valeurs ≤255) | non | `""` |

Réponse 201 `DocumentResponse` = `{ id }`. Chunker = `RecursiveCharacterTextSplitter`. Vectorisation auto (`bge-m3`).
Utiliser **`collection_id`** ; en pratique le client envoie `collection_id` **et** l'alias `collection` (tolérance aux millésimes OpenGateLLM — cf. `rag::rag_upload_document` / `rag::rag_upload_text`). Deux points de départ éprouvés en prod : upload d'un **fichier** disque (multipart, MIME deviné) et upload de **texte** brut (`text/markdown`, après extraction locale PDF/DOCX pour contourner le parser d'ILaaS).
`GET /v1/documents` (query `required` bool def true ; `order_by` `[id|name|created]`), `GET /v1/documents/{id}`, `DELETE /v1/documents/{id}` → 204, `POST|GET /v1/documents/{id}/chunks`, `GET|DELETE /v1/documents/{id}/chunks/{chunk_id}`.

### Recherche — `POST /v1/search` (`CreateSearch`) — confirmé en prod
> Schéma vérifié sur l'openapi **et** exercé en production par `rag::rag_search` (`src-tauri/src/rag.rs`) : corps `{ collection_ids, query, method, limit, score_threshold? }`, défaut `method: "hybrid"`.

| Champ | Type | Requis | Défaut |
|---|---|---|---|
| `collection_ids` | array[int >0] | non | `[]` |
| `document_ids` | array[int] | non | — |
| `metadata_filters` | objet | non | — |
| `query` | string\|null | non | — |
| `method` | enum `[semantic, lexical, hybrid]` | non | `semantic` |
| `limit` | int | non | `10` |
| `offset` | int | non | — |
| `rff_k` | int (0‑16384) | non | `60` |
| `score_threshold` | number (0‑1) | non | `0.0` |

*(Aucun champ requis ; pas de `web_search` ici.)* Réponse `Searches` = `{ object:"list", data:[Search], usage }`, `Search` = `{ method, score, chunk }`, `chunk.object = "chunk"`.

### Reranking — `POST /v1/rerank` (`CreateRerank`) — confirmé en prod
> Corps `{ model: "bge-reranker-v2-m3", query, documents, top_n? }` exercé par `rag::rag_rerank` (`src-tauri/src/rag.rs`) ; le tri/écrêtage final est aussi appliqué côté client.
| Champ | Type | Requis | Défaut |
|---|---|---|---|
| `model` | string | **oui** | — (`bge-reranker-v2-m3`) |
| `query` | string | **oui** | — |
| `documents` | array[string] (≥1) | **oui** | — |
| `top_n` | int (≥1)\|null | non | `null` (= renvoie tout) |

*(Pas de `return_scores`.)* Réponse `Reranks` = `{ object:"list", id, results:[{ relevance_score, index }], model, usage }`.

### Embeddings — `POST /v1/embeddings`
`{ input (requis), model (requis, "bge-m3"), dimensions?, encoding_format? (def "float") }`. Compatible OpenAI.

### Chat — `POST /v1/chat/completions`
Champs OpenAI standard (`messages`, `model` requis, `temperature`, `top_p`, `stream`, `max_completion_tokens`, `tools`, `tool_choice`, …). **Aucun `collection_id` au niveau du body.**
- `search` (bool) et `search_args` : **dépréciés**.
- **RAG recommandé via `tools`** : un `SearchTool` `{ type:"search", … }` dans lequel les champs de `SearchArgs` sont **aplatis** (pas imbriqués) : `collection_ids`, `document_ids`, `metadata_filters`, `limit`, `offset`, `method`, `rff_k`, `score_threshold`.
- *(Note : il est tout aussi simple de faire un `POST /v1/search` explicite puis d'injecter les passages dans `messages` — c'est le flux retenu côté app.)*

### OCR — `POST /v1/ocr` (`CreateOCR`, JSON) ⚠️ schéma corrigé
Requête : `document` (requis, `DocumentURLChunk|ImageURLChunk`), `model?`, `pages?` (base 0), `image_limit?`, `image_min_size?`, `include_image_base64?`, `document_annotation_format?`, `bbox_annotation_format?`.
Réponse `OCR` = `{ document_annotation, id, model, pages:[{ index, markdown, dimensions, images }], usage, usage_info }`. *(Le texte d'une page est dans `markdown`, le numéro dans `index`.)*

### Compte & consommation
- `GET|PATCH /v1/me/info` → `UserInfo { permissions: PermissionType[], limits: Limit[] }`. `PermissionType = [admin, create_public_collection, read_metric, provide_models]` ; `Limit = { router, type∈[tpm,tpd,rpm,rpd], value }`. **C'est l'endpoint pour diagnostiquer le 403.**
- `POST /v1/me/keys` (`{ name (requis), expires (int unix|null) }`) → 201 `{ id, token }` ; `GET /v1/me/keys` → `Key = { object:"key", id, name, token, expires, created }` ; `GET|DELETE /v1/me/keys/{key}`.
- `GET /v1/me/usage` — query : `offset` (0), `limit` (1‑100, 10), `start_time` (def −30 j), `end_time` (def now), `endpoint` (`EndpointUsage`|null). **`EndpointUsage` = chemins complets** `["/v1/audio/transcriptions","/v1/chat/completions","/v1/embeddings","/v1/ocr","/v1/rerank","/v1/search"]`.
  Réponse `Usages` = `{ object:"list", data:[Usage] }`, `Usage = { object:"me.usage", model, key, endpoint, method, status, usage: { prompt_tokens, completion_tokens, total_tokens, cost, impacts, metrics }, created }`.
  > ⚠️ **Pas de notion de « parts »/quota restant** dans l'API : seul le **consommé par requête** (`cost` + tokens) est exposé. Pour un suivi « parts », **agréger `cost`/`total_tokens`**.

### Autres
`POST /v1/audio/transcriptions`, `GET /health`, `GET /metrics`, `POST /v1/auth/login` (Playground), namespace `/v1/admin/{providers,routers,organizations,roles,tokens,users}` (RBAC). Dépréciés/legacy : `/v1/parse-beta`, `/v1/chunks/...`.

## 6. Pipeline RAG géré (dev-ready)
1. `POST /v1/collections` (visibility `private`) → mémoriser `collection_id`.
2. `POST /v1/documents` (multipart, `collection_id`) → parse + chunk + embeddings auto (`bge-m3`).
3. `POST /v1/search` (`collection_ids`, `query`, `method:"hybrid"`, `rff_k`, `limit`) → chunks pertinents.
4. *(opt.)* `POST /v1/rerank` (`model:"bge-reranker-v2-m3"`, `query`, `documents`) → réordonner.
5. `POST /v1/chat/completions` avec contexte injecté (ou tool `search` avec `collection_ids`).

## 6 bis. Comportement côté app : modes Chat ⇄ Requête
Quand la bibliothèque est active, un contrôle segmenté propose deux modes (`state.ragMode`, `src/state.js`) :

- **Chat** (`chat`, défaut) : recherche RAG puis réponse **augmentée** des extraits. Si la recherche **échoue** (ou ne remonte aucun extrait), l'app **prévient** puis **replie** sur les connaissances générales du modèle, avec avertissement assumé.
- **Requête** (`requete`) : réponse **strictement fondée** sur les extraits.
  - **Correctif (mono-modèle et multi-modèles)** : si la recherche RAG **échoue** OU aboutit **sans aucun extrait**, le modèle **n'est PAS interrogé** — pas de repli sur les connaissances générales, **pas d'appel facturé**. L'app renvoie un message explicite (cf. `src/main.js`, garde `ragError` / `if (state.ragMode === 'requete')`) :
    - recherche indisponible → « *Recherche dans la bibliothèque indisponible (<cause>). En mode Requête, aucune réponse n'est produite sans extraits…* » ;
    - recherche OK mais 0 extrait → **message de refus configurable** `state.ragRefusal` (défaut : « *Je ne trouve pas la réponse dans la bibliothèque.* »), réglable dans les paramètres ; vidé, il retombe sur le texte par défaut.
  - Réglages associés : `ragMethod` (`semantic|lexical|hybrid`, défaut `hybrid`), `ragTopK` (`limit`, défaut 5), `ragThreshold` (`score_threshold`, 0 = désactivé), `ragRerank` (réordonnancement `bge-reranker` après recherche).

## 6 ter. Connecteur Moodle — même pipeline d'ingestion
Le connecteur Moodle (**lecture seule**, livré sur la branche `moodle` pour la **prochaine** version ; absent du `.dmg` v20260626.8.0 publié) **réutilise ce contrat RAG**. Son bouton **Synchroniser** ingère le **texte** des cours cochés (résumés de section + descriptions de modules, convertis en Markdown par un convertisseur HTML→Markdown maison en Rust) via **`rag_upload_text`** vers une collection **« Moodle · <cours> »** du profil ILaaS actif (`src/main.js`, `onMoodleSync`). Les collections restent `private` et sont ensuite interrogeables avec citations comme n'importe quelle bibliothèque. Les fichiers/PDF Moodle sont livrés (**Lot 4 ✅**, 2026-07-02), via `pluginfile.php` puis `rag_upload_document` (téléchargement en streaming, plafond de taille). L'interrupteur « Inclure les cours Moodle » du chat (Lot 6 ✅, 2026-07-03) interroge la collection active **et** toutes les collections « Moodle · … » en un seul appel `/search` (`collection_ids[]`).

## 7. Design local V1 — ABANDONNÉ
> **Le RAG 100 % local a été abandonné.** Le design V1 embarquait un `Embedder` local (`bge-m3` ONNX), un `VectorStore` local (LanceDB), un `Retriever` local (top-k cosinus) et un index/OCR sur la machine. Cette piste **n'est pas livrée** : documents, embeddings et index vivent désormais côté infra ESR (collections « private » chez ILaaS). On garde ci-dessous la table de correspondance à titre de mémoire — elle explique pourquoi les commandes RAG (`src-tauri/src/rag.rs`) sont de simples proxys HTTP vers OpenGateLLM.

| Brique V1 (locale, abandonnée) | Remplacée par (RAG géré, livré) |
|---|---|
| `Embedder` local (`bge-m3` ONNX) | `POST /v1/documents` (vectorisation serveur `bge-m3`) |
| `VectorStore` local (LanceDB) | **collection ILaaS** (`/v1/collections` + `/v1/documents`) |
| `Retriever` local (top-k cosinus) | `POST /v1/search` (+ `/v1/rerank`) |
| Comptage local des tokens | `GET /v1/me/usage` (agrégé par `rag::fetch_usage`) |

**Ce qui subsiste et n'est PAS abandonné** : la synchro « dossier local ↔ collection » (« Lier un dossier », option « Synchroniser à l'ouverture du profil », `ragAutoSync` dans `src/state.js`). Le dossier reste un **pilote** : ce qui est nouveau/modifié est **envoyé** à la collection ILaaS ; rien n'est indexé localement.

## 8. Deux clés séparées (important)
Stocker **deux secrets distincts** au trousseau :
- `ILAAS_LLM_KEY` → `llm.ilaas.fr` (chat/inférence).
- `ILAAS_RAG_KEY` → `rag-api.ilaas.fr` (RAG). **Ne jamais réutiliser** la clé d'inférence vers la passerelle RAG.
Le « profil par clé » (cf. SPEC) doit donc pouvoir porter **deux jetons** (ou deux profils liés).

## 9. Points encore ouverts (côté exploitant ILaaS)
Le cœur du contrat (`/collections`, `/documents`, `/search`, `/rerank`, `/me/*`) est **vérifié et en production** via `src-tauri/src/rag.rs` — plus rien à « valider en live » de ce côté. Restent des inconnues côté infra/millésime, sans incidence sur le client :
- **Backend vectoriel ILaaS** (Elasticsearch vs Qdrant) et **politique de rétention** — décision de l'exploitant *(à confirmer)*.
- **OCR** (`POST /v1/ocr`) : structure interne `DocumentURLChunk` / réponse — non exercé par l'app (PDF traité par extraction locale puis `rag_upload_text`).
- Tool `search` du chat (`SearchArgs` aplatis) : non utilisé par l'app, qui fait un `POST /v1/search` explicite puis injecte les passages.
- Exigence RBAC `create_public_collection` pour les collections **publiques** (l'app reste en `private` de toute façon).

> OpenGateLLM est en **bêta** (breaking changes possibles) → en cas d'anomalie, revalider contre `https://rag-api.ilaas.fr/openapi.json`.

## 10. Sources
- `https://rag-api.ilaas.fr/openapi.json` (OpenAPI 3.1.0, « OpenGateLLM », MIT) — contrat autoritaire.
- Code source : <https://github.com/etalab-ia/OpenGateLLM> — doc : <https://docs.opengatellm.etalab.gouv.fr/>.
- Accès ILaaS : <https://www.ilaas.fr/rag-ilaas/>, <https://www.ilaas.fr/demande-dacces/>, <https://www.ilaas.fr/services-inference/>.
- Instance de référence DINUM (mêmes endpoints) : `https://albert.api.etalab.gouv.fr/v1`.
