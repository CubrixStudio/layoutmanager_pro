# Animation Tools Pro

Plugin Blockbench (fichier unique) qui ajoute des utilitaires d'animation au
mode **Animate** de Blockbench.

## Fonctionnalités

### Reverse Animation (Inverser l'animation)

Inverse l'animation sélectionnée : chaque keyframe est replacé symétriquement
dans le temps (`nouveau_temps = longueur - temps`), de sorte que l'animation se
joue à l'envers tout en conservant exactement la même durée.

- Agit sur **tous** les animateurs (os, effets…) et tous les canaux
  (`rotation`, `position`, `scale`, `particle`, `sound`, `timeline`).
- Le pivot utilisé est la longueur déclarée de l'animation (jamais inférieure au
  dernier keyframe), ce qui évite tout temps négatif.

### Animation Speed (Vitesse d'animation)

Replace automatiquement les keyframes en fonction d'un **pourcentage de
vitesse**, et l'applique à la timeline :

- `100 %` = vitesse d'origine.
- `200 %` = deux fois plus rapide (durée divisée par deux).
- `50 %` = deux fois plus lent (durée doublée).

Le temps de chaque keyframe est multiplié par `100 / pourcentage`. Une case à
cocher permet d'ajuster aussi automatiquement la longueur de l'animation pour
qu'elle corresponde à la nouvelle vitesse.

## Installation

1. Dans Blockbench : **File → Plugins → Load Plugin from File**.
2. Sélectionnez `animation_tools_pro.js`.

Les deux actions apparaissent ensuite dans le menu **Animation** (en mode
Animate) et sont accessibles via la recherche d'actions. Toutes les opérations
sont **annulables** (Ctrl/Cmd + Z).

## Développement

Rechargez le plugin pendant le développement avec **Ctrl/Cmd + J** dans
Blockbench.
