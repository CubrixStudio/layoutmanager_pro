# Gestion des calques

## Vue d'ensemble

Layer Manager Pro ajoute un systeme de calques complet a Blockbench. Chaque texture peut avoir plusieurs calques empiles, chacun avec ses propres pixels, opacite, mode de fusion et visibilite.

## Operations de base

### Creer un calque

- **Bouton** : Cliquez sur l'icone `+` dans la barre d'outils du panneau
- **Raccourci** : `Ctrl+Shift+N`
- **Menu** : Texture > Add Layer

Le nouveau calque est cree en haut de la pile avec la taille de la texture.

### Dupliquer un calque

- **Bouton** : Cliquez sur l'icone de copie dans la barre d'outils
- **Raccourci** : `Ctrl+Shift+D`
- **Menu** : Texture > Duplicate Layer

La copie preserve :
- Les pixels
- L'opacite
- Le mode de fusion
- La visibilite
- L'offset (position)
- L'appartenance au groupe (place juste apres l'original)

### Supprimer un calque

- **Bouton** : Cliquez sur l'icone poubelle a cote du calque
- **Menu contextuel** : Clic-droit > Delete

> **Protection** : Un calque verrouille ne peut pas etre supprime. Deverrouillez-le d'abord.

La suppression nettoie automatiquement les masques, filtres et references de groupes associes.

### Renommer un calque

- **Double-clic** sur le nom du calque dans le panneau
- **Menu contextuel** : Clic-droit > Rename

Le renommage supporte **Ctrl+Z** (annulation).

### Importer une image comme calque

- **Bouton** : Cliquez sur l'icone image dans la barre d'outils
- **Raccourci** : `Ctrl+Shift+I`
- **Menu** : Texture > Import Image as Layer

Formats supportes : **PNG, JPG, JPEG, BMP, GIF, WebP**

L'image importee devient un nouveau calque en haut de la pile.

## Proprietes du calque

### Opacite

- Curseur de **0%** (transparent) a **100%** (opaque)
- Affecte le rendu du calque dans la composition finale
- Modifiable uniquement si le calque n'est pas verrouille
- Supporte **Ctrl+Z**

### Modes de fusion

| Mode | Effet |
|------|-------|
| **Default** | Fusion normale (source-over) |
| **Set Opacity** | Remplace l'opacite sans fusionner |
| **Color** | Applique la teinte du calque |
| **Multiply** | Assombrit — multiplie les couleurs |
| **Add** | Eclaircit — additionne les couleurs |
| **Screen** | Eclaircit — inverse de multiply |
| **Difference** | Soustrait les couleurs (valeur absolue) |

Le changement de mode de fusion supporte **Ctrl+Z**.

### Visibilite

- Cliquez sur l'icone oeil a cote du calque
- Un calque masque n'est pas rendu dans la composition
- Supporte **Ctrl+Z**

### Verrouillage

- **Bouton** : Icone cadenas a cote du calque
- **Raccourci** : `/`
- **Menu contextuel** : Clic-droit > Lock/Unlock

Un calque verrouille ne peut pas etre :
- Modifie (peinture, transformation)
- Supprime
- Modifie en opacite ou mode de fusion
- Affecte par un filtre

## Multi-selection

Selectionnez plusieurs calques simultanement :

| Action | Geste |
|--------|-------|
| Ajouter/retirer un calque | `Ctrl+Clic` |
| Selectionner une plage | `Shift+Clic` |
| Vider la selection | Clic simple sur un calque |

La barre de multi-selection apparait quand 2+ calques sont selectionnes et affiche :
- Le nombre de calques selectionnes
- Un bouton **Merge** pour fusionner la selection
- Un bouton **Clear** pour vider la selection

## Copier vers une autre texture

- **Menu contextuel** : Clic-droit > Copy to... > [texture cible]
- Copie le calque complet (pixels, opacite, offset, mode de fusion) vers la texture choisie

## Transformations

| Action | Acces |
|--------|-------|
| **Miroir horizontal** | Menu contextuel > Mirror Horizontal |
| **Miroir vertical** | Menu contextuel > Mirror Vertical |

## Reordonner les calques

Glissez-deposez les calques dans le panneau pour changer leur ordre dans la pile. L'indicateur de position (trait bleu) montre ou le calque sera place.

## Ordre de rendu

Les calques sont rendus de **bas en haut** : le calque du bas est dessine en premier, celui du haut en dernier (par-dessus).
