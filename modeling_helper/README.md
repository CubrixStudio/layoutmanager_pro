# Modeling Helper

Plugin Blockbench (fichier unique) qui ajoute une boîte à outils de **modélisation**
au mode **Edit** de Blockbench. Toutes les actions opèrent sur la sélection courante
et sont **annulables** (Ctrl/Cmd + Z). Elles apparaissent dans le menu **Tools** et
via la recherche d'actions.

## Fonctionnalités

### ❄️ Freeze Rotation (cuire / appliquer la rotation)

Équivalent du « Apply Rotation » de Blender : cuit la rotation d'un élément dans sa
géométrie pour que le champ **Rotation revienne à `0`** sans que la forme bouge
visuellement.

- **Cube avec rotation multiple de 90°** (ex. `0, -90, 0`) : recalcule une boîte
  alignée aux axes équivalente, remappe les faces + UV, et remet la rotation à 0.
  Le cube reste un cube propre.
- **Cube avec rotation quelconque** (ex. `30°`) : l'élément est **converti en mesh**
  (sommets libres) puis la rotation est cuite dans les sommets. Nécessite un format
  qui supporte les meshes.
- **Groupe / bone** : la rotation du groupe est reportée sur ses enfants directs
  (origin, position et rotation composée), puis la rotation du groupe est remise à 0.

Sélectionne un ou plusieurs cubes / meshes / groupes, puis lance **Freeze Rotation**.

### 📐 Snap to Grid

Arrondit la sélection à une grille propre — utile pour nettoyer des coordonnées
« sales » ou rendre un modèle Java valide.

- Pas de position réglable (from/to).
- Cases séparées pour : taille (from/to), pivot (origin), rotation.
- Pas de rotation au choix : `90°`, `45°`, `22.5°`.

### 🔁 Array / Repeat

Duplique la sélection **N fois** avec un décalage de position fixe et un incrément de
rotation optionnel (type « array modifier »). Option pour regrouper les copies dans un
nouveau groupe.

### ↔️ Align & Distribute

- **Align** : aligne les éléments sélectionnés sur un axe (X/Y/Z) par leur bord
  minimum, leur centre, ou leur bord maximum.
- **Distribute** : répartit uniformément les éléments le long d'un axe (3 éléments min).

## Installation

1. Dans Blockbench : **File → Plugins → Load Plugin from File**.
2. Sélectionnez `modeling_helper.js`.

## Développement

Rechargez le plugin pendant le développement avec **Ctrl/Cmd + J** dans Blockbench.

## Limites connues

- Le remap UV/faces du Freeze orthogonal est pixel-parfait pour les rotations simples ;
  des combinaisons multi-axes complexes peuvent demander un léger ajustement manuel de
  la rotation d'une face.
- La conversion en mesh (rotations non 90°) n'est disponible que dans les formats qui
  supportent les meshes.
- **Align & Distribute** utilise la bounding box non tournée (la rotation propre des
  éléments est ignorée pour le calcul des bords).
