# RAG géré ILaaS (V2) — accès & contrat d'API

> **Statut : V2, en attente d'un jeton RAG.** La V1 fait le RAG **en local** (voir `SPEC.md` / `ARCHITECTURE.md`).
> Ce document prépare la bascule vers le **RAG géré ILaaS** dès que le jeton RAG sera obtenu.
> Contrat **vérifié** contre l'`openapi.json` live + le code source OpenGateLLM (passe de vérification adverse).
> Tout ce qui reste incertain est marqué *(à valider en live)*.

---

## 1. Le 403, expliqué

La passerelle RAG (`rag-api.ilaas.fr`) est un **service distinct** de l'inférence (`llm.ilaas.fr`), avec son **propre référentiel de clés**.

- **Fait confirmé** (page officielle <https://www.ilaas.fr/rag-ilaas/>) : ILaaS émet **deux jetons distincts** — « *vous aurez reçu un token pour l'inférence et un token pour le RAG* ».
- **Testé** : la clé d'inférence → `200` sur `llm.ilaas.fr/v1/models`, mais `403 {"detail":"Invalid API key."}` sur **tous** les endpoints de `rag-api.ilaas.fr`.
- **Conclusion** : il faut un **jeton RAG dédié**. Ce n'est **pas** un problème de code côté client.
- *(Mécanique probable, non confirmée : `llm.ilaas.fr` et `rag-api.ilaas.fr` sont deux instances OpenGateLLM séparées, annuaires de clés/rôles distincts. À confirmer via `GET /v1/me/info` une fois une clé RAG en main.)*

## 2. Procédure d'accès

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

## 3. Brouillon de demande (prêt à envoyer)

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
> Usage prévu : application de bureau souveraine (Tauri, macOS et Linux), le « Doceria », destinée à interroger une bibliothèque personnelle de documents via RAG. L'application s'appuierait sur les modèles RAG ILaaS (embeddings `bge-m3`, reranker `bge-reranker-v2-m3`) et sur les endpoints OpenGateLLM standard (`/v1/collections`, `/v1/documents`, `/v1/search`, `/v1/rerank`).
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
Utiliser **`collection_id`** (pas l'alias déprécié `collection`).
`GET /v1/documents` (query `required` bool def true ; `order_by` `[id|name|created]`), `GET /v1/documents/{id}`, `DELETE /v1/documents/{id}` → 204, `POST|GET /v1/documents/{id}/chunks`, `GET|DELETE /v1/documents/{id}/chunks/{chunk_id}`.

### Recherche — `POST /v1/search` (`CreateSearch`) ⚠️ schéma corrigé
> Le premier passage avait halluciné `collections`/`prompt`/`k` ; **voici les vrais noms** (vérifiés sur l'openapi).

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

### Reranking — `POST /v1/rerank` (`CreateRerank`)
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

## 7. Migration V1 → V2 (sans refonte)
L'app V1 expose une **abstraction RAG** (`Embedder` + `VectorStore` + `Retriever`). En V2 :
- `Embedder` local (`bge-m3` ONNX) → `POST /v1/embeddings` (ou délégué au serveur via `POST /v1/documents`).
- `VectorStore` local (LanceDB) → **collection ILaaS** (`/v1/collections` + `/v1/documents`).
- `Retriever` local (top-k cosinus) → `POST /v1/search` (+ `/v1/rerank`).
- **Le « dossier local » reste le pilote** : la synchro envoie le nouveau/modifié vers la collection.
- **Conso** : passer du comptage des tokens (champ `usage` du chat) à `GET /v1/me/usage`.

## 8. Deux clés séparées (important)
Stocker **deux secrets distincts** au trousseau :
- `ILAAS_LLM_KEY` → `llm.ilaas.fr` (chat/inférence).
- `ILAAS_RAG_KEY` → `rag-api.ilaas.fr` (RAG). **Ne jamais réutiliser** la clé d'inférence vers la passerelle RAG.
Le « profil par clé » (cf. SPEC) doit donc pouvoir porter **deux jetons** (ou deux profils liés).

## 9. À valider en live (une fois le jeton RAG obtenu)
OpenGateLLM est en **bêta** (breaking changes possibles) → revalider contre `https://rag-api.ilaas.fr/openapi.json` :
- Diagnostic du 403 via `GET /v1/me/info` (200 vide = rôle sans droit RAG ; 401/403 = clé inconnue de l'instance).
- Forme interne de `SearchArgs` dans le tool `search` (présence de `template`/`rff_k`).
- Structure interne `DocumentURLChunk` / réponse OCR.
- Backend vectoriel ILaaS (Elasticsearch vs Qdrant) et politique de rétention.
- Existence (non confirmée) d'une exigence RBAC `create_public_collection` pour les collections publiques (on reste en `private` de toute façon).

## 10. Sources
- `https://rag-api.ilaas.fr/openapi.json` (OpenAPI 3.1.0, « OpenGateLLM », MIT) — contrat autoritaire.
- Code source : <https://github.com/etalab-ia/OpenGateLLM> — doc : <https://docs.opengatellm.etalab.gouv.fr/>.
- Accès ILaaS : <https://www.ilaas.fr/rag-ilaas/>, <https://www.ilaas.fr/demande-dacces/>, <https://www.ilaas.fr/services-inference/>.
- Instance de référence DINUM (mêmes endpoints) : `https://albert.api.etalab.gouv.fr/v1`.
