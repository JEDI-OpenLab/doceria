# Doceria — Cahier des charges (application de bureau)

> Document de passation. Lu en début de la conversation de développement.
> État : **spec figée**, décisions actées. Voir aussi `ARCHITECTURE.md`, `ROADMAP.md`, `SETUP.md`.
>
> **⚠️ Doc de cadrage (historique).** L'application est désormais **réalisée**. Le **RAG géré ILaaS** est le mode implémenté (le RAG local est resté optionnel/différé). Pour l'état courant et le mode d'emploi : `../README.md` et le site (section « Mode d'emploi »).

## 1. Problème & objectif
Le portail ILaaS existe en application web (Vite + JS vanilla, fonctionnelle), mais son usage
suppose un terminal (lancer un serveur, ouvrir un onglet). Cible : un·e enseignant·e-chercheur·e,
pas un·e développeur·se.

**Objectif : une application de bureau native, double-cliquable (macOS + Linux), sans terminal**,
qui par construction :
- règle le CORS (requêtes hors navigateur, en natif) ;
- sécurise les clés API dans le **trousseau du système** ;
- et apporte un **RAG local** sur une **bibliothèque = un dossier de l'ordinateur** (indexation **locale**
  en V1 ; bascule possible vers le **RAG géré ILaaS** en V2 — voir `RAG-V2-ilaas.md`).

## 2. Techno retenue
**Tauri** (coquille Rust + webview système). Voir `ARCHITECTURE.md` pour le détail et la
justification. Décision définitive.

## 3. Objectifs mesurables
- **Zéro commande** : installer = poser l'app ; utiliser = double-clic ; quitter = fermer la fenêtre.
- **Souveraineté** : clés au trousseau ; en V1, **documents et vecteurs 100 % locaux** (aucune donnée ne
  sort sauf la génération finale envoyée à ILaaS).
- **Continuité** : tout ce que fait l'app web aujourd'hui marche à l'identique.
- **RAG utile** : pointer l'app sur un dossier → bibliothèque interrogeable, avec citation des sources.

## 4. Non-objectifs (hors périmètre, assumés)
- ❌ Pas de compte / pas de cloud : 100 % local, mono-utilisateur.
- ❌ Pas de multi-fournisseurs : **ILaaS uniquement**.
- ❌ Pas de signature/notarisation : **app non signée** (sur macOS : « Ouvrir quand même » au 1ᵉʳ lancement).
- ❌ Pas de Windows en V1 (impossible à tester) — Tauri le permettra plus tard sans refonte.
- ❌ Pas de mise à jour automatique en V1.
- ❌ Ce portail n'est PAS Learnix : Learnix reste le RAG **institutionnel/gouverné, multi-utilisateurs**
  (corpus partagé, AnythingLLM) ; ce portail est un RAG **personnel et local** (un dossier sur ta machine,
  indexé **localement** en V1). Deux outils, deux usages.

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

### C. RAG sur dossier — local, géré par l'app (cœur de la V1)
> **V1 = RAG 100 % local.** La passerelle RAG ILaaS exige un **jeton RAG séparé** (distinct de la clé
> d'inférence) — demandé, en attente. Le passage au **RAG géré ILaaS** est prévu en **V2** : voir `RAG-V2-ilaas.md`.
- **P0** — **Choisir un dossier** via dialogue natif ; **autorisation persistée** (security-scoped bookmark macOS).
- **P0** — **Scanner** (récursif) : lire chaque fichier supporté → découper → **vectoriser (embedder local `bge-m3`)** → ranger dans une **base vectorielle locale** persistée.
- **P0** — **Indexation incrémentale** : empreinte (hash + date) par fichier ; au re-scan, ne traiter que le nouveau/modifié ; retirer de l'index les fichiers disparus.
- **P0** — **Bouton « Scanner la bibliothèque »** + option **scan auto au lancement** (incrémental).
- **P0** — À la question : **récupérer les passages pertinents (top-k)** en local et les injecter ; **citer les sources** (fichier, page).
- **P0** — État visible : nb de documents, nb de passages, date du dernier scan, progression pendant l'indexation.
- **P1** — **Surveillance temps réel** du dossier (auto-indexation à l'ajout d'un fichier).
- **P1** — Plusieurs dossiers / exclusions ; bouton « ré-indexer tout ».
- **P1** — **PDF scannés** : OCR local optionnel (sinon journalisés et ignorés).
- **P2** — Réglages de récupération (taille de chunk, top-k, seuil) exposés.

### D. Document de contexte ponctuel (existant, conservé)
- **P0** — Charger un ou **plusieurs documents** ponctuels (txt/md/csv/json/pdf/docx) injectés tels quels, en plus du RAG.
- **P1** — **Glisser-déposer** ; liste de documents retirables individuellement.

### E. Chat & génération
- **P0** — Streaming + **Stop** (existant), réglages température/longueur/consigne.
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
- **P0** — Builds **macOS (.app/.dmg)** + **Linux (AppImage)**, **non signés**.
- **P2** — Windows ; mise à jour automatique ; signature/notarisation.

## 6. Exigences non-fonctionnelles
- **Sécurité/souveraineté** : clés au trousseau ; **documents et vecteurs locaux (V1)** ; zéro télémétrie ; aucune dépendance CDN.
- **Multiplateforme** : macOS + Linux a minima.
- **Réutilisation** : l'UI HTML/CSS/JS existante est conservée ; seule la couche réseau + la coquille changent.
- **Performance** : 1ʳᵉ indexation potentiellement longue (progression + tâche de fond) ;
  scans suivants quasi instantanés (incrémental).
- **Hors-ligne** : l'app se lance sans réseau ; en V1, le réseau ne sert qu'au **chat** ILaaS (l'indexation RAG est locale).
- **Maintenabilité** : l'auteur édite HTML/CSS/JS ; la coquille Rust est écrite par l'assistant et bouge peu.

## 7. Décisions actées (rappel)
| Sujet | Décision |
|---|---|
| Techno | **Tauri** |
| Plateformes | **macOS + Linux** (Windows hors V1) |
| Signature | **Non signée** |
| Clés | **Multi-clés nommées + profil par clé** (URL + modèle), au **trousseau** |
| Documents | **Plusieurs** à la fois |
| Conso | **Suivi tokens + estimation parts** |
| RAG (V1) | **Local, géré par l'app** : embedder local + base vectorielle locale |
| RAG (V2) | **Service géré ILaaS** (OpenGateLLM) si **jeton RAG** obtenu — voir `RAG-V2-ilaas.md` |
| Embeddings (V1) | **`bge-m3` en local** (via `fastembed`/ONNX) — même modèle qu'ILaaS |
| Bibliothèque | Un **dossier local**, indexé **localement** |
| Conso | **Tokens par échange** en V1 ; `GET /v1/me/usage` en V2 (jeton RAG) |
| Modèle chat | **`mistral-medium-latest`** (id réel ; plus « Mistral Medium 3 ») |
| Positionnement | RAG **personnel et local**, distinct de **Learnix** (institutionnel) |

## 8. Questions ouvertes (à résoudre pendant le dev)
1. **Jeton RAG ILaaS (V2)** : **demandé via `ilaas.fr/demande-dacces`, en attente** du comité de pilotage.
   ILaaS émet **deux jetons distincts** (inférence + RAG) ; la clé d'inférence renvoie « Invalid API key »
   sur `rag-api.ilaas.fr` (testé). Conditionne **toute la V2**. La demande doit être **rattachée à un
   établissement ESR** (les demandes individuelles sont refusées).
2. **Modèle d'embeddings local (V1)** : retenir **`bge-m3`** (multilingue, le même qu'ILaaS) via `fastembed`/ONNX
   — vérifier disponibilité/poids/quantization.
3. **Base vectorielle locale (V1)** : LanceDB (embarquée, Rust) vs `sqlite-vec` — à trancher selon intégration Tauri.
4. **OCR local (V1)** : intégrer un OCR local (tesseract) pour les PDF scannés, ou les ignorer en V1 ?
