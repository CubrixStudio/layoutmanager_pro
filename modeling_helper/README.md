# Modeling Helper

Plugin Blockbench (fichier unique) qui ajoute une boîte à outils de **modélisation**
au mode **Edit** de Blockbench. Toutes les actions opèrent sur la sélection courante
et sont **annulables** (Ctrl/Cmd + Z). Elles apparaissent dans le menu **Tools** et
via la recherche d'actions.

## Fonctionnalités

### ❄️ Freeze Rotation (cuire / reformater la rotation)

Cuit la rotation d'un élément dans sa géométrie. **Un cube reste toujours un cube**
(jamais de conversion en mesh) :

- La **partie multiple de 90°** de chaque axe est cuite dans la géométrie : la boîte
  alignée aux axes est recalculée, les faces + UV sont remappées.
- Le **résidu** est snappé à l'angle valide le plus proche parmi
  **`0`, `±22.5`, `±45`** (les angles autorisés d'un cube en format Java Block Model)
  et conservé comme rotation du cube.

Exemples :

| Rotation avant | Géométrie cuite | Rotation après | Résultat |
|---|---|---|---|
| `-90°` | −90° | `0°` | le cube ne bouge pas, rotation remise à 0 |
| `45°` | — | `45°` | aucun changement (déjà valide) |
| `22.5°` | — | `22.5°` | aucun changement (déjà valide) |
| `30°` | — | `22.5°` | rotation snappée au valide le plus proche |
| `135°` | 90° | `45°` | cube préservé, visuellement identique |

- **Mesh** : si un mesh est sélectionné, la rotation est cuite dans ses sommets (il
  reste un mesh).
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

- Le remap UV/faces du Freeze est pixel-parfait pour les rotations sur un seul axe
  (le cas courant) ; des combinaisons multi-axes complexes peuvent demander un léger
  ajustement manuel de la rotation d'une face.
- Le snapping du résidu suppose une rotation sur un seul axe (contrainte des cubes
  Java Block Model). Un résidu non standard (ex. `30°`) est ramené à l'angle valide le
  plus proche, ce qui peut légèrement modifier l'orientation visuelle.
- **Align & Distribute** utilise la bounding box non tournée (la rotation propre des
  éléments est ignorée pour le calcul des bords).
