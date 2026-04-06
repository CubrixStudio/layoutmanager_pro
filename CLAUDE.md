# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a single-file **Blockbench plugin** (`layer_manager_pro.js`) that provides advanced layer management for the Blockbench 3D editor. It is not a Node.js application — `package.json` only includes `blockbench-types` for TypeScript autocomplete in VS Code.

## Development Commands

```bash
npm install   # Install dev dependencies (blockbench-types for autocomplete)
```

To reload the plugin during development: **Ctrl/Cmd + J** in Blockbench.

## Architecture

### Plugin Registration (line 3374)

The plugin registers via `Plugin.register('layer_manager_pro', {...})` with:
- `onload`: Initializes CSS, Panel, Actions, event listeners, and restores saved data
- `onunload`: Cleans up intervals, event listeners, and CSS

### State Structure

All state is organized per-texture to support multiple textures:

```
perTextureData[textureUUID] = { groups: {}, treeOrder: [], locks: Set }
```

- `groups`: `{ groupName: [layerUUID, ...] }` — which layers belong to which group
- `treeOrder`: `['group:Name' | layerUUID, ...]` — flat ordered list of groups and root layers (bottom-to-top)
- `locks`: `Set` of locked layer UUIDs

**Shorthand accessors** (lines 35-37):
- `_groups()` → `getTexData().groups`
- `_treeOrder()` → `getTexData().treeOrder`
- `_locks()` → `getTexData().locks`

### Mask System

Layer masks (`layerMasks`) and group masks (`groupMasks`) are separate from Blockbench layers. Each mask has its own canvas that is composited onto the layer. Mask editing mode swaps the layer's `canvas`/`ctx` with the mask's canvas so Blockbench paints directly onto the mask.

### Filter System

Filters are non-destructive: they store an `original` snapshot and recompute from it on each change. `layerFilterStacks[layerUUID]` holds `{ original: ImageData, filters: [{ id, name, enabled, intensity }] }`.

- `snapshotOriginal()` — captures the pre-filter layer pixels
- `recomputeFilters()` — applies the full filter stack to the original and outputs final pixels
- `applyMaskToLayer()` — at the end of recomputation, masks are applied last

### Layer Ordering

`tex.layers` is Blockbench's internal array (bottom-to-top). `treeOrder` is the plugin's shadow copy. `syncLayerOrder()` reconciles the two. The display order (top-to-bottom) is the reverse of `treeOrder`.

### Undo Integration

All layer-modifying operations must be wrapped in `Undo.initEdit()` / `Undo.finishEdit('description')` calls. This is Blockbench's undo/redo system.

### Persistence

- Primary: serialized into the Blockbench project file via `serializeLmpData()` / `deserializeLmpData()` (codec hooks at the bottom of the file)
- Fallback: `localStorage` via `_lmpStorageKey()` / `saveLmpToLocalStorage()` / `restoreLmpFromLocalStorage()`

### UI

The entire UI is a single Vue component built via `buildPanelComponent()` (line 2199). It returns a Vue template object. `updatePanel()` triggers Vue reactivity to refresh the panel.

### External Photoshop Editing

- `editAllLayersExternal()` → `buildPSD()` exports all layers to a PSD file and opens in Photoshop
- PSD changes are reimported via `reimportPsdEdit()` which calls `parsePSD()` (line 1382)
- External layer edits use a temp file + file watcher pattern (`reimportExternalEdit()`)

### Key Functions for Navigation

| Function | Purpose |
|---|---|
| `getTexData(texUUID)` | Get per-texture state object |
| `_groups()` / `_treeOrder()` / `_locks()` | Shorthand accessors for current texture |
| `syncLayerOrder()` | Reconcile `tex.layers` with `treeOrder` |
| `updatePanel()` | Trigger Vue reactivity refresh |
| `recomputeFilters(layer)` | Recompute all filters for a layer from original |
| `applyMaskToLayer(layer)` | Apply layer+group masks to a layer |
| `serializeLmpData()` / `deserializeLmpData()` | Project file persistence |
