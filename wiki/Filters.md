# Filtres non-destructifs

## Vue d'ensemble

Le systeme de filtres permet d'appliquer des effets visuels sur les calques de maniere **non-destructive**. Les filtres sont empiles et recalcules a partir de l'image originale, ce qui permet de les modifier, reordonner ou supprimer a tout moment.

## Appliquer un filtre

1. Selectionnez un calque
2. Dans la section **Filters** du panneau, choisissez un filtre dans le menu deroulant
3. Le filtre est ajoute a la pile et applique immediatement

> **Note** : Les calques verrouilles ne peuvent pas recevoir de filtres.

## Filtres disponibles

| Filtre | Effet | Details techniques |
|--------|-------|--------------------|
| **Grayscale** | Niveaux de gris | Luminosite : `0.299*R + 0.587*G + 0.114*B` |
| **Invert** | Inversion des couleurs | `255 - valeur` par canal RGB |
| **Brightness +** | Eclaircissement | `+30` par canal, clampe a 0-255 |
| **Brightness -** | Assombrissement | `-30` par canal, clampe a 0-255 |
| **Contrast** | Augmentation du contraste | Facteur calcule : `259*(80+255) / (255*(259-80))` |
| **Sepia** | Ton sepia chaud | Matrice : R=0.393r+0.769g+0.189b, G=0.349r+0.686g+0.168b, B=0.272r+0.534g+0.131b |
| **Blur** | Flou leger | Box blur avec rayon de 1 pixel |
| **Sharpen** | Nettete | Convolution 3x3 : `[0,-1,0,-1,5,-1,0,-1,0]` |

## Controle d'intensite

Chaque filtre a un curseur d'**intensite** de 0% a 100% :

- **100%** : Effet complet du filtre
- **50%** : Melange 50/50 entre l'image originale et l'image filtree
- **0%** : Pas d'effet visible (equivalent a desactive)

Le melange est fait pixel par pixel : `resultat = original * (1 - intensite) + filtre * intensite`

## Pile de filtres

### Ordre d'application

Les filtres sont appliques **dans l'ordre de la pile**, de haut en bas. L'ordre peut changer le resultat :

```
Exemple 1 : Grayscale → Sepia  = Sepia sur du gris
Exemple 2 : Sepia → Grayscale  = Tout en niveaux de gris
```

### Reordonner les filtres

Glissez-deposez un filtre dans la pile pour changer son ordre. La pile est recalculee automatiquement.

### Activer / desactiver un filtre

Cliquez sur l'icone d'activation a cote du filtre. Un filtre desactive est ignore dans le calcul mais reste dans la pile.

### Supprimer un filtre

Cliquez sur l'icone de suppression a cote du filtre. Si c'est le dernier filtre, l'image originale est restauree.

## Fonctionnement interne

Le systeme de filtres est entierement non-destructif :

1. Quand le premier filtre est ajoute, un **snapshot** de l'ImageData originale est sauvegarde
2. A chaque modification (ajout, suppression, reordonnement, changement d'intensite), la pile entiere est **recalculee depuis le snapshot original**
3. Les filtres sont chaines : le resultat d'un filtre est passe au suivant
4. Le masque est applique **apres** tous les filtres
5. Quand tous les filtres sont supprimes, le snapshot original est libere de la memoire

## Persistance

Les piles de filtres sont sauvegardees dans le projet :
- Nom du filtre
- Etat active/desactive
- Intensite

> **Note** : Le snapshot original n'est pas sauvegarde. Au chargement du projet, les filtres sont reappliques sur les pixels actuels du calque.

## Limites

- Les parametres des filtres (luminosite +30, rayon du flou 1) sont fixes
- Le blur n'a qu'un rayon de 1 pixel (effet subtil)
- Les filtres ne s'appliquent qu'a un calque a la fois (pas de filtre de groupe)
- Pas d'API pour ajouter des filtres personnalises
