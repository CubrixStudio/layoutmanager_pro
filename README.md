# Layer Manager Pro

Plugin Blockbench pour la gestion avancée des calques : dossiers, verrouillage, filtres, opacité, modes de fusion et plus encore.

## Installation

1. Téléchargez le fichier `layer_manager_pro.js`
2. Ouvrez Blockbench
3. Allez dans **File > Plugins** (ou glissez-déposez le fichier directement dans Blockbench)
4. Cliquez sur l'icône de chargement et sélectionnez le fichier

Le panneau **Layer Manager Pro** apparaît automatiquement dans la barre latérale droite en mode **Paint**.

## Fonctionnalités

### Gestion des calques

| Action | Description |
|--------|-------------|
| **Ajouter un calque** | Crée un nouveau calque vide sur la texture sélectionnée |
| **Dupliquer un calque** | Copie le calque actif (pixels, opacité, mode de fusion) |
| **Supprimer un calque** | Supprime le calque sélectionné (protégé si verrouillé) |
| **Renommer un calque** | Double-cliquez sur le nom d'un calque pour le renommer |
| **Importer une image** | Importe un fichier image (PNG, JPG, BMP, GIF, WEBP) comme nouveau calque |

### Dossiers (Groupes de calques)

Organisez vos calques en groupes nommés :

- **Créer un groupe** : Cliquez sur l'icône dossier dans la barre d'outils
- **Ajouter un calque à un groupe** : Utilisez le menu déroulant "Group..." sur chaque calque
- **Retirer un calque d'un groupe** : Cliquez sur le bouton `-` à côté du calque dans le groupe
- **Basculer la visibilité du groupe** : Masque ou affiche tous les calques du groupe d'un clic
- **Supprimer un groupe** : Supprime le groupe (les calques ne sont pas supprimés)

### Verrouillage des calques

Verrouillez un calque pour empêcher toute modification accidentelle :

- Cliquez sur l'icône cadenas à côté du calque
- Un calque verrouillé ne peut pas être modifié (filtres, opacité, mode de fusion, suppression)
- Cliquez à nouveau pour déverrouiller

### Opacité et modes de fusion

- **Opacité** : Curseur de 0% à 100% pour le calque sélectionné
- **Modes de fusion** : Default, Set Opacity, Color, Multiply, Add, Screen, Difference

### Filtres

Appliquez des filtres directement sur le calque sélectionné :

| Filtre | Effet |
|--------|-------|
| **Grayscale** | Convertit en niveaux de gris |
| **Invert** | Inverse les couleurs |
| **Brightness +** | Augmente la luminosité |
| **Brightness -** | Diminue la luminosité |
| **Contrast** | Augmente le contraste |
| **Sepia** | Applique un ton sépia |
| **Blur** | Applique un flou léger |
| **Sharpen** | Renforce la netteté |

Chaque filtre supporte l'annulation via **Ctrl+Z**.

### Fusion de calques

| Action | Description |
|--------|-------------|
| **Merge Visible** | Fusionne tous les calques visibles en un seul |
| **Flatten All** | Aplatit tous les calques visibles en un seul calque final |

## Menu

Les actions du plugin sont également accessibles depuis le menu **Texture** dans la barre de menus :

- Add Layer
- Duplicate Layer
- Import Image as Layer
- Merge Visible Layers
- Flatten All Layers
- Toggle Layer Lock

## Compatibilité

- **Blockbench** : 4.9.0 ou supérieur
- **Variante** : Desktop et Web

## Développement

```bash
npm install
```

Les types Blockbench (`blockbench-types`) sont inclus pour l'autocomplétion dans VS Code.

Pour recharger le plugin pendant le développement : **Ctrl/Cmd + J** dans Blockbench.

## Licence

MIT — CubrixStudio
