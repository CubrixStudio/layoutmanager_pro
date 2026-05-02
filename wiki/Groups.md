# Groupes et dossiers

## Vue d'ensemble

Les groupes (dossiers) permettent d'organiser vos calques en collections nommees. Chaque groupe peut avoir sa propre visibilite, opacite, verrouillage et masque.

## Creer un groupe

1. **Bouton** : Cliquez sur l'icone dossier (`create_new_folder`) dans la barre d'outils
2. Entrez un nom pour le groupe dans la boite de dialogue

### Creation avec des calques selectionnes

Si des calques sont selectionnes au moment de la creation :
- **Selection simple** : Le calque selectionne est automatiquement ajoute au groupe
- **Multi-selection** : Tous les calques multi-selectionnes sont ajoutes au groupe

Si aucun calque n'est selectionne, le groupe est cree vide.

## Gerer les membres

### Ajouter un calque a un groupe

- **Drag & Drop** : Glissez un calque et deposez-le sur un groupe
- **Menu contextuel** : (disponible dans les futures versions)

Quand un calque est ajoute a un groupe, il est retire de la liste principale (treeOrder) et apparait sous le groupe.

### Retirer un calque d'un groupe

- Cliquez sur le bouton `-` (remove_circle_outline) a cote du calque dans le groupe
- Le calque retourne dans la liste principale

## Proprietes du groupe

### Visibilite

- Cliquez sur l'icone oeil a cote du nom du groupe
- **Masquer** : Tous les calques du groupe deviennent invisibles
- **Afficher** : Tous les calques du groupe redeviennent visibles

### Opacite du groupe

- Cliquez sur l'icone opacite a cote du groupe
- Entrez une valeur de 0 a 100
- L'opacite du groupe est appliquee **proportionnellement** a chaque calque membre :
  - Si le groupe est a 50% et un calque a 80%, l'opacite effective du calque sera de 40%

### Verrouillage du groupe

- Cliquez sur l'icone cadenas a cote du groupe
- **Verrouiller** : Tous les calques du groupe sont verrouilles
- **Deverrouiller** : Tous les calques du groupe sont deverrouilles

### Renommer un groupe

- **Menu contextuel** : Clic-droit sur l'en-tete du groupe > Rename
- Les masques de groupe et les opacites sont automatiquement transferes au nouveau nom

## Replier / deplier

Cliquez sur l'icone fleche (expand_more / expand_less) pour replier ou deplier le contenu du groupe. Les calques a l'interieur sont masques visuellement mais restent actifs.

## Supprimer un groupe

- **Menu contextuel** : Clic-droit sur le groupe > Delete Group
- **Comportement** : Le groupe est supprime, mais les calques membres sont **preserves** et deplaces a la position du groupe dans la liste principale
- Les masques et opacites du groupe sont nettoyes

## Reordonner les groupes

Glissez-deposez l'en-tete du groupe pour le deplacer dans la liste. Les calques membres suivent le groupe.

## Copier un groupe vers une autre texture

- **Menu contextuel** : Clic-droit sur le groupe > Copy Group to... > [texture cible]
- Copie tous les calques du groupe vers la texture cible
- Cree un nouveau groupe avec le meme nom sur la texture cible

## Limites

- Un calque ne peut appartenir qu'a **un seul groupe** a la fois
- Les groupes ne peuvent pas etre imbriques (pas de sous-groupes)
- Le nom du groupe doit etre unique par texture
