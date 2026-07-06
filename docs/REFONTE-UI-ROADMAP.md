# Feuille de route : Refonte de l'interface (« Continuité », macOS natif)

> **But.** Transformer Doceria en une app macOS de première partie (direction retenue :
> **« Continuité »**, aperçu public : [`docs/nouvelle-interface.html`](nouvelle-interface.html) ;
> planches complètes clair + sombre dans le labo local `doceria-design-lab/`, hors dépôt).
> **Contrainte absolue : ZÉRO régression fonctionnelle.** Tout ce que l'app fait aujourd'hui,
> elle le fait encore à la fin ; seul l'endroit et l'habillage changent.
>
> **Méthode éprouvée (chantier Moodle) :** un **lot** = code → **revue adversariale multi-agents**
> → **test utilisateur** → commit. On n'attaque pas le lot suivant tant que le précédent n'est
> pas validé. Journal en fin de document.
>
> **Ce plan a lui-même été passé en revue adversariale** (3 critiques : faisabilité Tauri,
> anti-régression, séquencement — 24 constats, tous intégrés ci-dessous, 2026-07-06).

---

## 0. Réponse à « on sait faire ça en Tauri ? » : OUI, vérifié sur NOTRE config

| Besoin | Mécanisme Tauri | État chez nous |
|---|---|---|
| **Vraie fenêtre Réglages** (⌘,) | Multi-fenêtres natif : 2ᵉ entrée dans `tauri.conf.json > app.windows` (page `settings.html`), cachée au démarrage | ✅ Tauri v2.11, rien à installer |
| **Permissions de la 2ᵉ fenêtre** | Tauri v2 : les permissions (`invoke`, `listen`…) sont **par fenêtre** via les *capabilities* → ajouter `"settings"` à `capabilities/default.json` (sinon TOUT invoke échoue) | ⚠️ indispensable, prévu au lot 1 |
| **Build de prod multi-pages** | Vite ne construit que `index.html` par défaut → `build.rollupOptions.input = { main, settings }` dans `vite.config.js` (sinon `settings.html` marche en dev mais est **absent du .dmg**) | ⚠️ indispensable, prévu au lot 1 |
| Entrée de menu « Réglages… » ⌘, | Menu natif déjà construit **à la main** dans `lib.rs` ; item avec `accelerator("Cmd+,")` qui montre la fenêtre | ✅ menu existant, ajout simple |
| **Cycle de vie de la fenêtre** | `lib.rs` quitte l'app sur TOUT `CloseRequested` (« fermer = quitter », pensé mono-fenêtre) → discriminer par label : `settings` → `prevent_close()` + `hide()` ; `main` → `exit(0)` conservé | ⚠️ modification Rust actée (voir §1.2) |
| **Synchro d'état entre fenêtres** | **Events Tauri (`emit`/`listen`) = canal PRINCIPAL** (déjà éprouvés : `chat://delta`, drag & drop). Le localStorage sert de **persistance seulement** : l'événement `storage` inter-webviews n'est **pas fiable** sous WKWebView (bug WebKit #225344) — on ne s'y fie jamais | ✅ mécanisme documenté et déjà pratiqué |
| **Sidebar translucide** (vibrance) | `transparent: true` + `windowEffects` | ✅ **déjà actif** (`effects: ["sidebar"]`, `macOSPrivateApi: true`) |
| Mémoire de position des fenêtres | `tauri-plugin-window-state` ; ⚠️ configurer `StateFlags` sans `VISIBLE` pour `settings` (sinon le plugin peut la **rouvrir seul** au lancement) | ✅ installé, à configurer |
| Popover de citation, typo SF Pro, grille 4/8, sombre | CSS/JS pur dans la webview (`-apple-system`) | ✅ aucun obstacle |
| Barre de titre masquée + feux tricolores dans la toolbar | `titleBarStyle: "Overlay"` (macOS) | ✅ supporté ; ⚠️ repositionnement fin des feux = plugin (`decorum`) → **optionnel, lot Polish**, jamais bloquant |
| Backend métier (chat, RAG, Moodle, trousseau) | Commandes Rust appelées à l'identique depuis toute fenêtre autorisée | ✅ **aucune commande métier modifiée** |

**Le vrai chantier est le frontend.** Deux faits mesurés : (1) ~45 contrôles de réglages vivent
dans le rail droit ; (2) leur logique est **dans les handlers DOM de `main.js`** (ex. `send()` lit
`$('temp')`, `$('sysPrompt')` à chaque envoi ; `saveProfileFromEditor()` lit `$('pfName')`…).
« Déplacer sans réécrire » exige donc d'abord une **extraction** : la logique sort du DOM vers des
services partagés, l'état devient la seule source de vérité (lot 1.5).

---

## 1. Principes non négociables

1. **Zéro régression, prouvé par contrat.** Au lot 0, on génère `docs/REFONTE-CONTRAT-FONCTIONNEL.md` :
   l'inventaire **exhaustif** des fonctions visibles avec, pour chacune : *emplacement actuel →
   emplacement cible → statut (à migrer / migré / testé / **retiré volontairement**)*. Une fonction
   sans ligne n'existe pas ; une ligne non « testée » (ou non actée « retirée ») bloque la release.
   Le contrat inclut aussi : bandeau de mise à jour, raccourcis (Échap, Entrée/Maj+Entrée, ⌘W),
   états de connexion (`cStatus`), et les clés localStorage orphelines (`doceria_panels`…).
2. **Backend métier intact.** Additions Rust **limitativement autorisées** : (a) item de menu
   « Réglages… » ⌘, ; (b) discrimination du `CloseRequested` par label (settings → hide) ;
   (c) `StateFlags` du plugin window-state ; (d) *(défense en profondeur, optionnel)* refus côté
   commandes `set_active_profile`/`delete_profile` pendant une synchro. **Aucune commande métier
   modifiée ni format de persistance changé.**
3. **Branche dédiée `refonte-ui`** ; l'utilisateur fusionne quand un jalon est validé. `main`
   reste releasable à tout instant.
4. **Un lot à la fois**, testé par l'utilisateur avec un protocole fourni, puis commité.
5. **Transition douce, jamais d'app cassée** : aucune surface supprimée avant validation de sa
   relève. Le rail droit ne disparaît qu'en **fin de lot 4** (micro-étape « Adieu au rail »),
   quand toolbar + composer + sidebar ont TOUS été validés.
6. **Le site web n'est PAS touché** pendant le chantier ; alignement esthétique **après** que
   l'app refondue soit téléchargeable (décision actée).
7. **Pas de presets pédagogiques** (décision antérieure maintenue) : la refonte prévoit les
   *emplacements*, pas le contenu. Corollaire : les **modèles de consigne restent un geste
   QUOTIDIEN** (accès rapide en fenêtre principale), pas un réglage enfoui.

---

## 2. Architecture cible (fichiers)

```
index.html            # fenêtre principale : sidebar unifiée · toolbar · fil · composer
settings.html         # NOUVELLE fenêtre Réglages (5 onglets, style Réglages macOS)
vite.config.js        # + rollupOptions.input { main, settings }  ← build multi-pages
src/
├── tokens.css        # NOUVEAU : design tokens Continuité (couleurs, typo, grille, rayons, ombres)
├── styles.css        # restylé sur les tokens (fenêtre principale)
├── services/         # NOUVEAU (lot 1.5) : logique extraite de main.js, SANS DOM
│   ├── profiles.js   #   CRUD profils ILaaS + clés + test + cascade d'activation
│   ├── moodleconf.js #   CRUD connexions Moodle + jeton + test
│   ├── ragconf.js    #   réglages RAG + génération (source de vérité : state)
│   └── syncengine.js #   synchro dossier↔collection (callbacks de statut, pas de $())
├── bus.js            # NOUVEAU (lot 1) : synchro inter-fenêtres par events Tauri
├── settings.js       # NOUVEAU : vue de la fenêtre Réglages (branche les services)
├── state.js          # inchangé de format ; devient LA source de vérité lue par send()
├── main.js           # allégé : câblage vue de la fenêtre principale
└── api.js            # inchangé (façade invoke, utilisable des 2 fenêtres)
src-tauri/
├── tauri.conf.json   # + fenêtre "settings" (visible:false)
├── capabilities/default.json  # + "settings" dans windows  ← permissions
└── src/lib.rs        # + item de menu ⌘, · close-by-label · StateFlags
```

**Règles du bus (lot 1, tranchées d'avance) :**
- **Canal principal = events Tauri** (`emit`/`emitTo`) : `settings-changed` (payload = champs
  modifiés), `profile-changed`, `busy-changed` (`{chatBusy, syncing, moodleSyncing}`).
- **Écriture du blob `ilaas_portal` : un seul régime autorisé** — *reload-before-write* (toute
  fenêtre relit le blob avant d'écrire et n'écrase que ses champs) **ou** *écrivain unique* (la
  fenêtre Réglages émet, seule la principale persiste). Choix arrêté au lot 1 et documenté ici.
- **Verrous d'occupation respectés partout** : `settings.js` grise/refuse les actions sensibles
  (changer/supprimer un profil) quand `busy-changed` le signale — mêmes règles que le rail actuel.

**Répartition rare / quotidien (corrigée après revue) :**
- **Fenêtre Réglages (rare)** :
  - **Général** : thème, bouton « Vérifier les mises à jour » *(le bandeau automatique au
    lancement reste dans la fenêtre principale, inchangé)*, conso & coût.
  - **Connexion** : profils ILaaS (CRUD, clés au trousseau, Tester, modèles par défaut).
  - **Bibliothèque** : réglages de recherche (méthode, top-k, seuil, reranking, message de refus)
    + option globale « Synchroniser à l'ouverture du profil ». *(La liaison de dossier, « ↻
    Synchroniser », « Délier » restent CONTEXTUELS à la collection active → sidebar.)*
  - **Moodle** : connexions (CRUD, jeton, Tester) + option « cours consentis uniquement »
    *(sa bascule doit rafraîchir l'explorateur ouvert et rejouer la réconciliation de sélection
    — cas de test inter-fenêtres obligatoire)*.
  - **Avancé** : température, longueur max, mémoire, **édition complète** des consignes système
    et des modèles enregistrés.
- **Fenêtre principale (quotidien)** :
  - Sidebar : conversations (+ renommer/supprimer/exporter) · **Mes cours Moodle** (explorateur,
    synchro, badge « à mettre à jour » *alimenté par le bouton « Nouveautés », comme aujourd'hui*)
    · **Ma bibliothèque** (collection active, **créer/supprimer une collection**, gérer les
    documents, ajout fichiers/dossier, **lier/synchroniser/délier un dossier**, glisser-déposer).
  - Toolbar : titre (renommage inline), sélecteur de modèle, Comparer, « + », **indicateur de
    connexion cliquable** (relance « Charger les modèles » après un échec réseau — l'unique geste
    de reconnexion ne doit pas exiger d'ouvrir Réglages).
  - Composer : chips Bibliothèque / Cours Moodle, segments Chat ⇄ Requête, trombone (document de
    contexte), **menu rapide « Consigne »** (choisir un modèle de consigne en un clic ; l'édition
    reste dans Réglages > Avancé), compteur de tokens.

---

## 3. Les lots

### Lot 0 — Fondations (S)
- Branche **`refonte-ui`** ; `src/tokens.css` (non branché : **aucun changement visible**).
- **`docs/REFONTE-CONTRAT-FONCTIONNEL.md`** généré (passe multi-agents sur le code) puis **relu
  par l'utilisateur** ; statuts : à migrer / migré / testé / retiré volontairement. Y inscrire
  d'emblée : pliage des colonnes (décision : la sidebar unifiée reste **masquable**, migration de
  `doceria_panels`), raccourcis existants, bandeau de mise à jour, états `cStatus`.
- *Fait quand :* build OK, app strictement identique, contrat relu/approuvé.

### Lot 1.5 — Extraction des services (M) ← préalable structurel
- Sortir la logique de `main.js` vers `src/services/` **sans DOM** : `profiles.js`,
  `moodleconf.js`, `ragconf.js`, `syncengine.js` (callbacks de statut au lieu de `$('ragStatus')`).
- `send()` / `regenerate()` / `buildMessages()` ne lisent plus le DOM (`$('temp')`,
  `$('sysPrompt')`…) mais **uniquement `state.*`** ; les inputs écrivent dans `state`.
- *Fait quand :* **zéro changement visible**, tous les parcours identiques (protocole de
  non-régression complet sur cette étape purement interne).

### Lot 1 — Fenêtre Réglages : squelette + bus (M)
- `settings.html` minimal + `capabilities` (« settings ») + **entrées Vite multi-pages** +
  fenêtre déclarée `visible:false` + `StateFlags` sans VISIBLE + **close-by-label** dans `lib.rs`
  + item de menu « Réglages… » ⌘,.
- `bus.js` : events Tauri (canal principal), régime d'écriture du blob **tranché et documenté**,
  `busy-changed` publié par la principale.
- Un réglage migré comme preuve : le **thème**.
- *Fait quand :* ⌘, ouvre la fenêtre ; **la fermer ne quitte PAS l'app** et ⌘, la rouvre ;
  quitter avec Réglages ouverte → relance = seule la principale apparaît ; changer le thème dans
  Réglages bascule la principale **sans recharger** ; **build de prod vérifié** (`settings.html`
  présent dans `dist/`, fenêtre fonctionnelle depuis le `.dmg`) ; test de croisement A/B (modifier
  A dans Réglages puis B dans le rail → A survit).

### Lot 2a — Réglages : Connexion + Moodle (M/L, le risque maximal)
- Les deux éditeurs à secrets (jumeaux structurels) : profils ILaaS (~13 contrôles, clés
  write-only au trousseau, test éphémère vs enregistré, auto-test au collage, cascade
  d'activation) + connexions Moodle (~8 contrôles).
- **Cas sensibles au protocole** : changer de profil actif pendant un chat en streaming / pendant
  une synchro (verrous respectés depuis Réglages) ; supprimer un profil pendant une synchro
  (refusé) ; bascule « cours consentis » → l'explorateur ouvert se rafraîchit + réconciliation.
- Le rail reste affiché (double surface pilotant le même état via services + bus).
- *Fait quand :* chaque ligne « Connexion/Moodle » du contrat opérable depuis Réglages avec effet
  identique (test croisé rail ↔ fenêtre), cas sensibles inclus.

### Lot 2b — Réglages : Bibliothèque + Avancé + Général (M)
- Bindings simples : méthode/top-k/seuil/rerank/refus, ragAutoSync, température/longueur/mémoire,
  édition des consignes + modèles, thème, conso & coût, bouton « Vérifier les mises à jour »
  *(en PLUS du bandeau automatique, jamais à sa place)*.
- *Fait quand :* toutes les lignes correspondantes du contrat « migrées », protocole court.

### Lot 3 — Sidebar unifiée (L) — **le rail reste en place**
- Sidebar translucide : conversations · **Mes cours Moodle** · **Ma bibliothèque** (avec
  créer/supprimer collection, dossier lié contextuel) · pied (profil actif, indicateur souverain).
- Sidebar **masquable** (bouton toolbar ou ⌘\), migration de l'état `doceria_panels`.
- **Critère de perfs mesurable** : streaming dans une conversation ≥ 100 messages, vibrance
  active → scroll et frappe fluides ; sinon **repli déclenché dans le lot** (fond du fil opacifié,
  sidebar seule vibrante).
- *Fait quand :* toutes les fonctions colonne gauche + sections Moodle/Bibliothèque du rail sont
  accessibles dans la sidebar (contrat pointé), drag & drop intact, perfs validées.

### Lot 4 — Toolbar + composer, puis « Adieu au rail » (M)
- Toolbar : titre inline, modèle, Comparer, « + », **indicateur de connexion cliquable**
  (reconnexion sans ouvrir Réglages), accès Réglages.
- Composer : chips Bibliothèque / Cours Moodle, Chat ⇄ Requête, trombone (document de contexte),
  **menu rapide « Consigne »**, compteur de tokens. Raccourcis reconduits (Entrée/Maj+Entrée, Échap).
- **Étape finale du lot : retrait du rail droit** — uniquement quand chaque ligne du rail au
  contrat pointe une relève **validée** (Réglages, sidebar, toolbar ou composer).
- *Fait quand :* parcours quotidien complet sans rail, comportements identiques, aucune ligne du
  contrat orpheline.

### Lot 5 — Le fil de conversation (M)
- Typographie du contenu (colonne ~720 px), flux document, **pastilles de citation [n]** pétrole +
  **popover source** (document · collection · extrait) — le geste signature.
- Bloc Sources repensé, états vides, streaming soigné. LaTeX/KaTeX inchangé.
- *Fait quand :* citations cliquables dans le chat ET en comparaison ; copier/régénérer/annuler/
  éditer intacts.

### Lot 6 — Mode sombre + barre de titre (M)
- Tokens sombres (planche A-sombre : accent #4BA396, fonds #1E1E1E/#2A2A2C, jamais de blanc pur).
- **Cas inter-fenêtres au protocole** : changer le thème dans une fenêtre → l'autre suit, y
  compris si elle était cachée puis réaffichée ; mode auto : bascule système répercutée sur les
  DEUX fenêtres (le listener `prefers-color-scheme` est par-fenêtre).
- `titleBarStyle: "Overlay"` si concluant (sinon barre standard) ; feux tricolores : défaut
  accepté, plugin seulement si gênant.
- *Fait quand :* clair/sombre/auto impeccables sur les deux fenêtres, aucune surface oubliée.

### Lot 7 — Onboarding premier lancement (M · optionnel, à décider)
- 3 étapes chaleureuses (coller la clé → test auto → prêt) au premier lancement seulement.
  **Décision utilisateur avant d'engager.**

### Lot 8 — Polish, revue finale, release (M)
- Micro-interactions, aides « ? » repositionnées, passe accessibilité (focus, contrastes),
  passe perfs globale, purge optionnelle des clés localStorage orphelines (actée au contrat).
- Revue adversariale **globale** + **checklist finale = 100 % du contrat** (testé ou retiré).
- Bump version (AAAAMMJJ.ii.0), build .dmg, release GitHub ; **ensuite seulement** : chantier
  séparé d'alignement du site web.

---

## 4. Protocole anti-régression (le filet)

1. **Le contrat** est la source de vérité ; statuts : à migrer / migré / testé / retiré
   volontairement. Chaque lot marque ses lignes ; le test utilisateur les valide.
2. **Revue adversariale par lot** : fonctions perdues, états incohérents entre fenêtres,
   régressions de comportement, verrous contournés.
3. **Tests utilisateur scriptés** par lot (fournis à chaque fin de lot).
4. **Interdits techniques** : pas de changement aux commandes Rust métier (hors liste §1.2), pas
   de changement au format de persistance, pas de suppression d'une surface avant validation de
   sa relève, jamais de dépendance à l'événement `storage` inter-fenêtres.
5. **Rollback simple** : branche dédiée, `main` intouchée, lots = commits atomiques.

## 5. Risques & parades (mis à jour après revue)

| Risque | Parade |
|---|---|
| Fenêtre Réglages sans permissions / absente du build | Capabilities + entrées Vite = critères du « Fait quand » du lot 1 (testé sur le `.dmg`, pas seulement en dev) |
| Fermer Réglages quitte l'app | Close-by-label (lot 1), testé explicitement |
| Synchro `storage` silencieusement morte (WKWebView) | Events Tauri = canal principal ; `storage` jamais utilisé comme signal |
| Blob `ilaas_portal` : 2 écrivains → réglages perdus | Régime d'écriture unique tranché au lot 1 (reload-before-write ou écrivain unique) + test de croisement A/B |
| Verrous (`moodleSyncing`, `syncing`, `busy`) contournés depuis Réglages | `busy-changed` sur le bus + gardes dans `settings.js` (+ option garde côté Rust) |
| Logique dans les handlers DOM → duplication rail/fenêtre | **Lot 1.5 d'extraction préalable** : services sans DOM, `state` seule source de vérité |
| Oublis fonctionnels (collections, dossier lié, consignes, bandeau MAJ…) | Contrat exhaustif + répartition §2 corrigée par la revue (24 constats intégrés) |
| Vibrance + perfs sur longues conversations | Critère mesurable au lot 3 + repli dans le lot (opacifier le fil) |
| Fatigue du chantier | Lots testables indépendamment, `main` saine, pause possible après chaque lot |

## 6. Journal

- **2026-07-06 — Plan initial + revue adversariale du plan.** 3 critiques (faisabilité Tauri
  vérifiée sur la config réelle + doc officielle, anti-régression contre le code, séquencement) :
  **24 constats, tous intégrés** — dont : capabilities par fenêtre, entrées Vite multi-pages,
  close-by-label, StateFlags window-state, events Tauri en canal principal (storage non fiable
  WKWebView), régime d'écriture du blob, lot 1.5 d'extraction, scission du lot 2, rail retiré en
  fin de lot 4, collections/dossier lié/consignes/bandeau MAJ replacés, verrous inter-fenêtres.
  *(à suivre : Lot 0.)*
