# Raccourcis clavier et reference

## Raccourcis clavier

Tous les raccourcis sont actifs uniquement en **mode Paint**.

### Calques

| Raccourci | Action |
|-----------|--------|
| `Ctrl+Shift+N` | Ajouter un nouveau calque |
| `Ctrl+Shift+D` | Dupliquer le calque selectionne |
| `Ctrl+Shift+I` | Importer une image comme calque |
| `/` | Verrouiller / deverrouiller le calque |

### Fusion

| Raccourci | Action |
|-----------|--------|
| `Ctrl+E` | Merge Down (fusionner avec le calque en-dessous) |
| `Ctrl+Shift+E` | Merge Visible (fusionner les calques visibles) |
| `Ctrl+Shift+F` | Flatten All (aplatir tous les calques) |

## Actions disponibles dans le menu Texture

| ID de l'action | Nom | Description |
|----------------|-----|-------------|
| `lmp_add_layer` | Add Layer | Ajouter un calque vide |
| `lmp_duplicate_layer` | Duplicate Layer | Dupliquer le calque selectionne |
| `lmp_import_layer` | Import Image as Layer | Importer une image |
| `lmp_merge_visible` | Merge Visible Layers | Fusionner les calques visibles |
| `lmp_merge_down` | Merge Down | Fusionner vers le bas |
| `lmp_flatten_layers` | Flatten All Layers | Aplatir tous les calques |
| `lmp_toggle_lock` | Toggle Layer Lock | Verrouiller/deverrouiller |

## Menu contextuel : Calque (clic-droit)

| Action | Description |
|--------|-------------|
| Mirror Horizontal | Retourne le calque horizontalement |
| Mirror Vertical | Retourne le calque verticalement |
| Edit in External Editor | Ouvre le calque dans l'editeur externe |
| Stop External Edit | Arrete la synchronisation externe |
| Rename | Renomme le calque |
| Lock / Unlock | Verrouille ou deverrouille |
| Edit Mask | Entre en mode edition du masque |
| Add Mask | Ajoute un masque blanc |
| Add Mask from Black | Ajoute un masque noir |
| Disable / Enable Mask | Desactive ou active le masque |
| Apply Mask | Applique le masque definitivement |
| Delete Mask | Supprime le masque |
| Invert Mask | Inverse le masque |
| Copy to... | Copie le calque vers une autre texture |
| Merge Down | Fusionne avec le calque en-dessous |
| Delete | Supprime le calque |

## Menu contextuel : Groupe (clic-droit)

| Action | Description |
|--------|-------------|
| Rename | Renomme le groupe |
| Add Group Mask | Ajoute un masque blanc au groupe |
| Add Group Mask from Black | Ajoute un masque noir au groupe |
| Edit Group Mask | Entre en mode edition du masque de groupe |
| Disable / Enable Group Mask | Desactive ou active le masque de groupe |
| Apply Group Mask | Applique le masque a tous les calques du groupe |
| Delete Group Mask | Supprime le masque de groupe |
| Invert Group Mask | Inverse le masque de groupe |
| Copy Group to... | Copie le groupe vers une autre texture |
| Delete Group | Supprime le groupe (garde les calques) |

## Interactions souris

| Geste | Zone | Action |
|-------|------|--------|
| Clic | Calque | Selectionner le calque |
| Ctrl+Clic | Calque | Ajouter/retirer de la multi-selection |
| Shift+Clic | Calque | Selectionner une plage |
| Double-clic | Nom du calque | Renommer |
| Clic-droit | Calque | Menu contextuel du calque |
| Clic-droit | Groupe | Menu contextuel du groupe |
| Glisser-deposer | Calque | Reordonner dans la pile |
| Glisser-deposer | Groupe | Reordonner le groupe |
| Glisser-deposer | Filtre | Reordonner dans la pile de filtres |
| Glisser sur groupe | Calque | Ajouter le calque au groupe |
| Clic | Icone oeil | Basculer la visibilite |
| Clic | Icone cadenas | Basculer le verrouillage |

## Donnees sauvegardees

### Dans le projet Blockbench

Les donnees suivantes sont sauvegardees dans le fichier `.bbmodel` :

- Groupes et leurs membres (UUIDs)
- Ordre des calques (treeOrder)
- Verrouillages (locks)
- Opacites de groupe
- Masques de calque (PNG base64)
- Masques de groupe (PNG base64)
- Piles de filtres (nom, active, intensite)

### Dans localStorage (sauvegarde automatique)

Cle : `lmp_state_{nom_du_projet}`

Meme contenu que ci-dessus, sauvegarde automatiquement toutes les 300ms apres modification.

## Structure des donnees internes

```
perTextureData[texUUID] = {
    groups: {
        "Nom du groupe": ["uuid1", "uuid2", ...]
    },
    treeOrder: ["uuid1", "group:Nom du groupe", "uuid3", ...],
    locks: Set<uuid>,
    groupOpacities: {
        "Nom du groupe": 100
    }
}
```

## Compatibilite

| Fonctionnalite | Desktop | Web |
|----------------|---------|-----|
| Calques, groupes, masques, filtres | Oui | Oui |
| Raccourcis clavier | Oui | Oui |
| Drag & Drop | Oui | Oui |
| Persistance projet | Oui | Oui |
| Edition externe (calque individuel) | Oui | Non |
| Edition PSD (Photoshop) | Oui | Non |
| Sauvegarde localStorage | Oui | Oui |
