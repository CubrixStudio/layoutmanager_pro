# Masques

## Vue d'ensemble

Les masques permettent de controler la visibilite de parties d'un calque ou d'un groupe de maniere **non-destructive**. Les zones blanches du masque sont visibles, les zones noires sont masquees, et les niveaux de gris intermediaires sont semi-transparents.

## Principe

```
Blanc (255) = Entierement visible
Gris  (128) = Semi-transparent (50%)
Noir  (0)   = Entierement masque
```

Le masque agit sur le canal alpha du calque : la luminosite de chaque pixel du masque determine l'opacite du pixel correspondant du calque.

Formule : `alpha_final = alpha_original * luminosite_masque / 255`

La luminosite est calculee avec la formule standard : `0.299*R + 0.587*G + 0.114*B`

## Masques de calque

### Ajouter un masque

| Action | Resultat |
|--------|----------|
| **Clic-droit > Add Mask** | Cree un masque blanc (calque entierement visible) |
| **Clic-droit > Add Mask from Black** | Cree un masque noir (calque entierement masque) |

Un seul masque par calque est autorise.

### Editer un masque

1. **Clic-droit > Edit Mask** (ou cliquez sur la miniature du masque)
2. Le panneau affiche une barre orange "Editing Layer Mask"
3. Le canvas de peinture est **temporairement remplace** par le canvas du masque
4. Peignez en **blanc** pour reveler, en **noir** pour masquer
5. Cliquez sur **Done** pour quitter le mode edition du masque

> **Important** : Pendant l'edition du masque, vous peignez directement sur le masque, pas sur le calque. Tous les outils de peinture de Blockbench fonctionnent.

### Apercu du masque

Une miniature du masque (15x15 px) est affichee a cote du calque dans le panneau. La miniature montre un apercu en niveaux de gris du masque.

### Activer / desactiver

- **Clic-droit > Disable Mask / Enable Mask**
- Desactiver un masque restaure temporairement le calque original sans supprimer le masque

### Appliquer un masque

- **Clic-droit > Apply Mask**
- Le masque est **fusionne definitivement** dans le canal alpha du calque
- Le masque est ensuite supprime
- **Cette operation est irreversible** (sauf via Ctrl+Z avant la sauvegarde)

### Supprimer un masque

- **Clic-droit > Delete Mask**
- Le masque est supprime et le calque est **restaure a son etat original** (avant l'application du masque)

### Inverser un masque

- **Clic-droit > Invert Mask**
- Les zones blanches deviennent noires et inversement
- Utile pour inverser rapidement ce qui est visible/masque

## Masques de groupe

Les masques de groupe fonctionnent exactement comme les masques de calque, mais affectent **tous les calques du groupe**.

### Ajouter un masque de groupe

- **Clic-droit sur l'en-tete du groupe > Add Group Mask** (blanc)
- **Clic-droit > Add Group Mask from Black** (noir)

### Editer un masque de groupe

- **Clic-droit > Edit Group Mask**
- Fonctionne comme l'edition de masque de calque
- La barre orange indique "Editing Group Mask"

### Autres operations

Les memes operations sont disponibles pour les masques de groupe :
- Enable / Disable
- Apply (applique a tous les calques du groupe)
- Delete
- Invert

## Interaction masque + filtres

L'ordre d'application est :

1. Les **filtres** sont appliques sur les pixels du calque
2. Le **masque** est applique ensuite sur le resultat filtre

Cela signifie que le masque controle la visibilite du resultat final apres filtrage.

## Persistance

Les masques sont sauvegardes :
- Dans le **fichier projet** Blockbench (en tant que data URL PNG base64)
- En **localStorage** comme sauvegarde automatique

Ils sont restaures automatiquement a l'ouverture du projet.
