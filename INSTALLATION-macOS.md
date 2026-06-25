# Installer Doceria sur macOS

Doceria est une application **macOS pour puces Apple Silicon** (Mac M1, M2, M3, M4…).
*(Elle ne fonctionne pas sur les anciens Mac à processeur Intel.)*

L'application n'est **pas signée par Apple** (projet interne) : macOS demande donc une
autorisation **une seule fois** au premier lancement. C'est normal et sans danger.

---

## 1. Installer

1. Ouvrez le fichier **`Doceria_x.x.x_aarch64.dmg`** (double-clic).
2. Dans la fenêtre qui s'ouvre, **glissez l'icône Doceria** sur le dossier **Applications**.
3. Éjectez le `.dmg` (clic droit → Éjecter) et ouvrez le dossier **Applications**.

## 2. Premier lancement (à faire une seule fois)

Comme l'app n'est pas signée, un double-clic affichera un message du type
« *Doceria ne peut pas être ouverte car Apple ne peut pas vérifier…* ». Deux façons de l'autoriser :

**Méthode simple (clic droit) :**
1. Dans **Applications**, faites un **clic droit** sur **Doceria** → **Ouvrir**.
2. Dans la boîte de dialogue, cliquez de nouveau sur **Ouvrir**.
   → L'app se lance, et les fois suivantes un simple double-clic suffira.

**Si la méthode ci-dessus ne propose pas « Ouvrir » :**
1. Double-cliquez sur Doceria (le message d'erreur apparaît) puis fermez-le.
2. Ouvrez **Réglages Système** → **Confidentialité et sécurité**.
3. Tout en bas, à côté de « Doceria a été bloqué… », cliquez sur **« Ouvrir quand même »**.
4. Confirmez par **Ouvrir**.

## 2bis. Si macOS dit que l'app est « endommagée »

Sur macOS récent, au lieu du message ci-dessus, vous pourriez voir
« *Doceria est endommagé et ne peut pas être ouvert. Placez-le dans la corbeille.* ».
**Ce n'est pas un vrai dommage** : c'est la « quarantaine » que macOS pose sur une app
non signée téléchargée. Pour la lever, une seule fois :

1. Ouvrez **Terminal** (Applications → Utilitaires).
2. Copiez-collez cette ligne, puis appuyez sur **Entrée** :

   ```
   xattr -dr com.apple.quarantine /Applications/Doceria.app
   ```

3. Relancez Doceria (double-clic).

*(Sur macOS récent — Sequoia/Tahoe —, le parcours le plus fiable reste de toute façon
Réglages Système → Confidentialité et sécurité → « Ouvrir quand même ».)*

## 3. Au premier accès au trousseau

Quand vous enregistrez votre première clé, macOS affiche
« *Doceria souhaite utiliser vos informations confidentielles… du trousseau* ».
Cliquez sur **« Toujours autoriser »** pour ne plus être redemandé.

---

## Utiliser l'application

1. À droite, dans **Connexion** → **+ Nouveau** : donnez un nom, collez votre **clé d'inférence**
   ILaaS, cliquez **Tester** (la liste des modèles se remplit), puis **Enregistrer le profil**.
2. Cliquez **Charger les modèles** : vous pouvez maintenant discuter.
3. *(Optionnel)* Pour la **bibliothèque RAG** : dans le profil, ajoutez l'**URL + la clé RAG**,
   puis créez une collection et ajoutez-y des documents (section **Bibliothèque (RAG)**).

Bonne utilisation — et merci d'**enseigner avec l'IA** ✨
