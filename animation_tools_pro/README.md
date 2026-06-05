# Animation Tools Pro

Plugin Blockbench (fichier unique) qui ajoute une boîte à outils d'animation au
mode **Animate** de Blockbench. Toutes les actions opèrent sur l'animation
sélectionnée et sont **annulables** (Ctrl/Cmd + Z).

## Fonctionnalités

### 🕒 Timing

- **Reverse Animation** — inverse l'animation : chaque keyframe est replacé
  symétriquement dans le temps (`nouveau_temps = longueur - temps`) pour la jouer
  à l'envers, à durée constante. Le pivot n'est jamais inférieur au dernier
  keyframe (pas de temps négatif).
- **Animation Speed** — replace les keyframes selon un **pourcentage de vitesse**
  (`× 100 / pourcentage`) et l'applique à la timeline. `200 %` = 2× plus rapide,
  `50 %` = 2× plus lent. Option d'ajuster aussi la longueur de l'animation.
- **Stretch to Length** — recale tous les keyframes proportionnellement pour
  atteindre une **durée cible en secondes**.
- **Shift Keyframes** — décale les keyframes (ou la sélection de la timeline) de
  ±X secondes, avec « clamp à 0 » et extension automatique de la longueur.
- **Snap to FPS** — quantifie les temps des keyframes sur la grille d'images au
  framerate donné (par défaut le snapping de l'animation).

### 🔁 Boucles & lecture

- **Ping-Pong / Bounce** — ajoute une copie miroir dans le temps à la suite de
  l'animation pour créer un aller-retour fluide (longueur doublée).
- **Toggle Loop Mode** — bascule le mode de boucle : `once` → `loop` → `hold`.

### ✂️ Keyframes

- **Set Easing / Interpolation** — applique `linear` / `smooth` (Catmull-Rom) /
  `bezier` / `step` aux keyframes sélectionnés (ou à tous si aucune sélection).
- **Toggle Step / Hold** — bascule rapidement l'interpolation « step » sur la
  sélection.
- **Clean Redundant Keyframes** — supprime les keyframes dont la valeur est
  identique à celles de leurs deux voisins.

### 🪞 Avancé

- **Mirror Left/Right** — échange les keyframes entre os symétriques et inverse
  les axes concernés (position X, rotation Y et Z). Idéal pour les cycles de
  marche.
  - Détection de nommage : `left`/`right` (toutes casses), suffixes `_l`/`_r`,
    `.l`/`.r`, ou un suffixe `L`/`R` en capitale (ex. `armL` ↔ `armR`).
  - Les os sans contrepartie (`body`, `head`…) sont reflétés sur place.
  - Limitation : fonctionne au mieux quand les deux os symétriques existent dans
    le modèle ; les expressions Molang sont négées via `-(...)`.

## Installation

1. Dans Blockbench : **File → Plugins → Load Plugin from File**.
2. Sélectionnez `animation_tools_pro.js`.

Les actions apparaissent dans le menu **Animation** (en mode Animate) et via la
recherche d'actions.

## Développement

Rechargez le plugin pendant le développement avec **Ctrl/Cmd + J** dans
Blockbench.
