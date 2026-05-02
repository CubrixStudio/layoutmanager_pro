# Edition externe et integration PSD

## Vue d'ensemble

Le plugin permet d'editer les calques dans des editeurs d'images externes (Photoshop, GIMP, Paint.NET, etc.) avec synchronisation automatique des modifications.

Deux modes sont disponibles :
1. **Edition individuelle** : Exporte un seul calque en PNG vers l'editeur par defaut du systeme
2. **Edition PSD complete** : Exporte tous les calques en un fichier PSD vers Photoshop

## Edition individuelle d'un calque

### Lancer l'edition

- **Menu contextuel** : Clic-droit sur un calque > Edit in External Editor

### Fonctionnement

1. Le calque est exporte en tant que fichier **PNG temporaire** dans le dossier `blockbench_lmp` du repertoire temporaire du systeme
2. Le fichier est ouvert avec l'**editeur d'images par defaut** du systeme
3. Un **polling** (toutes les 500ms) surveille les modifications du fichier
4. Quand le fichier est sauvegarde dans l'editeur externe, les pixels sont automatiquement reimportes dans le calque

### Indicateur visuel

Un calque en cours d'edition externe affiche une icone de **lien** a cote de son nom dans le panneau.

### Arreter l'edition

- **Menu contextuel** : Clic-droit > Stop External Edit
- Le fichier temporaire est supprime
- Le polling s'arrete

### Securite

- Si la texture est supprimee pendant l'edition, le polling s'arrete automatiquement
- Si le fichier temporaire est supprime, le polling s'arrete automatiquement
- Les fichiers temporaires sont nettoyes a la fermeture du plugin

## Edition PSD complete (Photoshop)

### Prerequis

1. **Adobe Photoshop** installe sur la machine
2. Le chemin vers Photoshop doit etre configure (voir ci-dessous)

### Configurer Photoshop

1. Cliquez sur l'icone **engrenage** dans la barre d'outils du panneau
2. Entrez le chemin complet :
   - **Windows** : `C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe`
   - **macOS** : `/Applications/Adobe Photoshop 2026/Adobe Photoshop 2026.app/Contents/MacOS/Adobe Photoshop 2026`
3. Le chemin est sauvegarde dans localStorage

### Lancer l'edition PSD

- **Bouton** : Cliquez sur l'icone Photoshop (`photo_library`) dans la barre d'outils

### Fonctionnement

1. Tous les calques sont exportes dans un fichier **PSD** temporaire
2. Le fichier PSD est ouvert dans Photoshop
3. Un **polling** (toutes les 800ms) surveille les modifications du fichier
4. Quand vous sauvegardez dans Photoshop, les calques sont reimportes automatiquement

### Format PSD

Le plugin inclut un encodeur/decodeur PSD complet :

**Encodage (export)** :
- En-tete PSD valide (signature `8BPS`, version 1)
- 4 canaux par calque (R, G, B, A)
- Donnees de calques avec noms, positions et opacites
- Compatible avec Photoshop CS2+

**Decodage (import)** :
- Lecture des calques avec canaux separees
- Support de la compression **RLE** (PackBits) et des donnees **brutes**
- Correspondance des calques par **index** (le calque 0 du PSD → calque 0 de la texture)
- Si le PSD contient plus de calques que la texture, les calques supplementaires sont ajoutes

### Indicateur visuel

Quand l'edition PSD est active :
- Le bouton Photoshop passe en **cyan**
- Un bouton **Stop** (`stop`) apparait dans la barre d'outils

### Arreter l'edition PSD

- Cliquez sur le bouton **Stop** dans la barre d'outils
- Le fichier PSD temporaire est supprime
- Le polling s'arrete

## Fichiers temporaires

| Type | Emplacement | Nom | Nettoyage |
|------|------------|-----|-----------|
| Calque individuel | `{tmpdir}/blockbench_lmp/` | `{layerName}_{uuid8chars}.png` | A l'arret de l'edition |
| PSD complet | `{tmpdir}/blockbench_lmp/` | `{textureName}_{uuid8chars}.psd` | A l'arret de l'edition |

> **Note** : Si Blockbench se ferme anormalement, les fichiers temporaires peuvent rester sur le disque. Ils sont sans danger et peuvent etre supprimes manuellement.

## Limites

- L'edition externe necessite la **version Desktop** de Blockbench
- L'edition PSD necessite Photoshop (pas de support GIMP pour le PSD)
- Les masques et filtres ne sont **pas exportes** dans le PSD (seuls les pixels composites sont exportes)
- La correspondance des calques se fait par **index**, pas par nom : ne changez pas l'ordre des calques dans Photoshop
- Un seul fichier PSD peut etre en edition a la fois
