# Installation et configuration

## Installation du plugin

### Methode 1 : Glisser-deposer (recommandee)

1. Telechargez le fichier `layer_manager_pro.js`
2. Ouvrez Blockbench
3. Glissez-deposez le fichier `.js` directement dans la fenetre de Blockbench
4. Le plugin se charge automatiquement

### Methode 2 : Menu Plugins

1. Ouvrez Blockbench
2. Allez dans **File > Plugins**
3. Cliquez sur l'icone de chargement (icone dossier)
4. Selectionnez le fichier `layer_manager_pro.js`

### Methode 3 : Depuis le code source

```bash
git clone https://github.com/CubrixStudio/layoutmanager_pro.git
cd layoutmanager_pro
npm install
```

Puis chargez `layer_manager_pro.js` dans Blockbench comme ci-dessus.

## Premier lancement

Apres l'installation :

1. Le panneau **Layer Manager Pro** apparait automatiquement dans la **barre laterale droite**
2. Le plugin n'est actif qu'en **mode Paint** — il n'apparait pas dans les autres modes (Edit, Display, Animate)
3. Selectionnez une texture pour commencer a travailler avec les calques

## Configuration Photoshop (optionnel)

Si vous souhaitez utiliser l'integration Photoshop :

1. Dans le panneau Layer Manager Pro, cliquez sur l'icone **engrenage** (Configure PS)
2. Entrez le chemin complet vers l'executable Photoshop :
   - **Windows** : `C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe`
   - **macOS** : `/Applications/Adobe Photoshop 2026/Adobe Photoshop 2026.app/Contents/MacOS/Adobe Photoshop 2026`
3. Cliquez OK pour sauvegarder

> **Note** : L'edition externe individuelle (calque par calque) utilise l'editeur d'images par defaut du systeme. Seul l'export PSD complet necessite la configuration de Photoshop.

## Mise a jour

Pour mettre a jour le plugin :

1. Rechargez simplement le nouveau fichier `layer_manager_pro.js` par-dessus l'ancien
2. Vos donnees (calques, groupes, masques, filtres) sont preservees dans le projet

## Desinstallation

1. Allez dans **File > Plugins**
2. Trouvez Layer Manager Pro dans la liste
3. Cliquez sur l'icone de suppression

Les donnees sauvegardees dans vos projets ne sont pas supprimees et seront ignorees sans le plugin.

## Developpement

Pour contribuer au plugin :

```bash
git clone https://github.com/CubrixStudio/layoutmanager_pro.git
cd layoutmanager_pro
npm install
```

Les types Blockbench (`blockbench-types`) sont inclus pour l'autocompletion dans VS Code.

Pour recharger le plugin pendant le developpement : **Ctrl/Cmd + J** dans Blockbench.
