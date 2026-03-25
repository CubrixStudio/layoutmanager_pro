# Layer Manager Pro

Plugin Blockbench pour la gestion avancée des calques : dossiers, verrouillage, masques, filtres non-destructifs, opacité, modes de fusion, édition externe (Photoshop), export/import PSD et plus encore.

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
| **Dupliquer un calque** | Copie le calque actif (pixels, opacité, offset, mode de fusion) |
| **Supprimer un calque** | Supprime le calque sélectionné (protégé si verrouillé) |
| **Renommer un calque** | Double-cliquez sur le nom d'un calque pour le renommer |
| **Importer une image** | Importe un fichier image (PNG, JPG, BMP, GIF, WEBP) comme nouveau calque |
| **Copier vers...** | Copie un calque ou un groupe entier vers une autre texture |
| **Miroir H / V** | Retourne le calque horizontalement ou verticalement |

### Dossiers (Groupes de calques)

Organisez vos calques en groupes nommés :

- **Créer un groupe** : Cliquez sur l'icône dossier dans la barre d'outils. Si des calques sont sélectionnés (simple ou multi-sélection), ils sont automatiquement ajoutés au groupe.
- **Ajouter un calque à un groupe** : Glissez-déposez le calque dans le groupe, ou utilisez le menu contextuel
- **Retirer un calque d'un groupe** : Cliquez sur le bouton `-` à côté du calque dans le groupe
- **Basculer la visibilité du groupe** : Masque ou affiche tous les calques du groupe d'un clic
- **Opacité du groupe** : Ajuste proportionnellement l'opacité de tous les calques membres
- **Verrouiller un groupe** : Verrouille/déverrouille tous les calques du groupe
- **Renommer un groupe** : Clic-droit > Rename
- **Supprimer un groupe** : Supprime le groupe (les calques sont déplacés à la racine)

### Verrouillage des calques

Verrouillez un calque pour empêcher toute modification accidentelle :

- Cliquez sur l'icône cadenas à côté du calque
- Un calque verrouillé ne peut pas être modifié (filtres, opacité, mode de fusion, suppression)
- Cliquez à nouveau pour déverrouiller

### Opacité et modes de fusion

- **Opacité** : Curseur de 0% à 100% pour le calque sélectionné
- **Modes de fusion** : Default, Set Opacity, Color, Multiply, Add, Screen, Difference

### Masques

Le plugin supporte les masques de calque et de groupe (non-destructifs) :

| Action | Description |
|--------|-------------|
| **Add Mask** | Ajoute un masque blanc (entièrement visible) |
| **Add Mask from Black** | Ajoute un masque noir (entièrement masqué) |
| **Edit Mask** | Entre en mode édition du masque (peignez en blanc/noir pour révéler/masquer) |
| **Apply Mask** | Applique le masque de façon permanente dans l'alpha du calque |
| **Delete Mask** | Supprime le masque et restaure le calque original |
| **Invert Mask** | Inverse le masque (blanc ↔ noir) |
| **Enable/Disable Mask** | Active/désactive temporairement le masque |

Les masques de groupe fonctionnent de la même façon et affectent tous les calques du groupe.

### Filtres (non-destructifs)

Appliquez des filtres empilables avec contrôle d'intensité :

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

- Chaque filtre a un curseur d'**intensité** (0-100%)
- Les filtres peuvent être **activés/désactivés** individuellement
- L'ordre des filtres est modifiable par **glisser-déposer**
- Les filtres sont recalculés à partir de l'image originale (non-destructif)

### Fusion de calques

| Action | Description |
|--------|-------------|
| **Merge Visible** | Fusionne tous les calques visibles en un seul |
| **Merge Selected** | Fusionne les calques multi-sélectionnés |
| **Merge Down** | Fusionne le calque sélectionné avec celui en-dessous |
| **Flatten All** | Aplatit tous les calques visibles en un seul calque final |

### Multi-sélection

- **Ctrl+Clic** : Ajoute/retire un calque de la sélection
- **Shift+Clic** : Sélectionne une plage de calques
- La barre multi-sélection affiche le nombre de calques sélectionnés et permet de fusionner ou créer un groupe

### Édition externe et Photoshop

| Action | Description |
|--------|-------------|
| **Edit in External Editor** | Exporte le calque en fichier temporaire et l'ouvre dans l'éditeur par défaut. Les modifications sont synchronisées automatiquement. |
| **Edit All in Photoshop** | Exporte tous les calques en un fichier PSD et l'ouvre dans Photoshop. Sauvegardez dans Photoshop pour synchroniser les changements. |
| **Configure Photoshop** | Configure le chemin vers l'exécutable Photoshop |

### Persistance des données

- Les données (groupes, masques, filtres, ordre des calques) sont sauvegardées automatiquement dans le projet Blockbench
- Sauvegarde automatique en localStorage comme filet de sécurité
- Restauration automatique à l'ouverture du projet

## Raccourcis clavier

| Raccourci | Action |
|-----------|--------|
| `Ctrl+Shift+N` | Ajouter un calque |
| `Ctrl+Shift+D` | Dupliquer le calque |
| `Ctrl+Shift+E` | Fusionner les calques visibles |
| `Ctrl+Shift+F` | Aplatir tous les calques |
| `Ctrl+Shift+I` | Importer une image comme calque |
| `Ctrl+E` | Fusionner vers le bas (Merge Down) |
| `/` | Verrouiller/déverrouiller le calque |

## Menu

Les actions du plugin sont également accessibles depuis le menu **Texture** dans la barre de menus :

- Add Layer
- Duplicate Layer
- Import Image as Layer
- Merge Visible Layers
- Merge Down
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
