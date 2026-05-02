# Fusion de calques

## Vue d'ensemble

Le plugin offre quatre operations de fusion pour combiner des calques. Toutes supportent **Ctrl+Z** (Undo).

## Types de fusion

### Merge Visible

- **Raccourci** : `Ctrl+Shift+E`
- **Menu** : Texture > Merge Visible Layers
- **Bouton** : Icone `call_merge` dans la barre d'outils

**Comportement** :
1. Prend tous les calques **visibles** de la texture
2. Les compose de bas en haut en respectant l'opacite de chaque calque
3. Cree un nouveau calque "Merged" contenant le resultat
4. Supprime tous les calques visibles originaux
5. Le nouveau calque est place en haut de la pile

> **Prerequis** : Au moins 2 calques visibles necessaires.

### Merge Selected

- **Bouton** : Bouton "Merge N Selected" dans la barre de multi-selection
- **Condition** : Au moins 2 calques multi-selectionnes (`Ctrl+Clic`)

**Comportement** :
1. Prend uniquement les calques dans la multi-selection
2. Les compose dans l'ordre de la pile (bas vers haut) avec opacite
3. Cree un nouveau calque "Merged" contenant le resultat
4. Supprime les calques selectionnes originaux
5. Vide la multi-selection

### Merge Down

- **Raccourci** : `Ctrl+E`
- **Menu contextuel** : Clic-droit > Merge Down

**Comportement** :
1. Prend le calque selectionne et le calque **juste en-dessous** dans la pile
2. Dessine le calque du dessus sur celui du dessous en respectant l'opacite et l'offset
3. Supprime le calque du dessus
4. Selectionne le calque du dessous (qui contient maintenant le resultat)

> **Prerequis** : Le calque selectionne ne doit pas etre le plus bas de la pile. Le calque cible (en-dessous) ne doit pas etre verrouille.

### Flatten All

- **Raccourci** : `Ctrl+Shift+F`
- **Menu** : Texture > Flatten All Layers
- **Bouton** : Icone `layers_clear` dans la barre d'outils

**Comportement** :
1. Prend **tous** les calques de la texture
2. Compose uniquement les calques **visibles** de bas en haut avec opacite
3. Cree un seul calque "Flattened" contenant le resultat
4. Supprime **tous** les calques originaux (visibles et invisibles)
5. Reinitialise le treeOrder et les groupes

> **Attention** : Les calques invisibles sont **perdus** lors de l'aplatissement. Utilisez Ctrl+Z si vous souhaitez annuler.

## Composition

Lors de la fusion, chaque calque est compose avec :

- **Opacite** : `globalAlpha = opacite_du_calque / 100`
- **Offset** : Le calque est dessine a sa position d'offset `(x, y)`
- **Mode de rendu** : Actuellement, la fusion utilise le mode `source-over` du canvas (fusion normale)

## Nettoyage automatique

Quand des calques sont supprimes lors d'une fusion, le plugin nettoie automatiquement :
- Les **masques** associes (calque et groupe)
- Les **snapshots de filtres** en memoire
- Les **references de groupe** (le calque est retire de son groupe)
- Les **edits externes** en cours (arrete le polling)

## Exemples d'utilisation

### Combiner un calque et son ombre

1. Selectionnez le calque de l'ombre (en haut)
2. `Ctrl+E` (Merge Down) pour le fusionner avec le calque en-dessous

### Finaliser un projet

1. Assurez-vous que les calques que vous voulez garder sont **visibles**
2. Masquez ceux que vous voulez exclure
3. `Ctrl+Shift+F` (Flatten All) pour tout aplatir en un seul calque

### Combiner une selection

1. `Ctrl+Clic` sur chaque calque a fusionner
2. Cliquez sur "Merge N Selected" dans la barre de multi-selection
