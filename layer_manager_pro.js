(function () {
	'use strict';

	let layerPanel;
	let importLayerAction;
	let addLayerAction;
	let duplicateLayerAction;
	let mergeVisibleAction;
	let flattenLayersAction;
	let toggleLockAction;
	let mergeDownAction;
	let css;
	let updateInterval;
	const eventListeners = [];
	let codecCompileCb = null;
	let codecParseCb = null;
	let _restoring = false; // true during restore to prevent untracked auto-add

	// Per-texture data: groups, tree order, and locks (independent per texture)
	// treeOrder entries: 'group:Name' for groups, 'uuid' for ungrouped layers
	const perTextureData = {}; // { textureUUID: { groups: {}, treeOrder: [], locks: Set, groupOpacities: {} } }

	function getTexData(texUUID) {
		if (!texUUID) {
			var tex = getSelectedTexture();
			if (!tex) return { groups: {}, treeOrder: [], locks: new Set(), groupOpacities: {} };
			texUUID = tex.uuid;
		}
		if (!perTextureData[texUUID]) {
			perTextureData[texUUID] = { groups: {}, treeOrder: [], locks: new Set(), groupOpacities: {} };
		}
		return perTextureData[texUUID];
	}

	// Shorthand accessors for current texture's data
	function _groups() { return getTexData().groups; }
	function _treeOrder() { return getTexData().treeOrder; }
	function _locks() { return getTexData().locks; }

	// Move any entry (group or layer) in the treeOrder
	function moveTreeEntry(entry, direction) {
		var to = _treeOrder();
		var idx = to.indexOf(entry);
		if (idx === -1) return;
		var newIdx = idx + direction;
		if (newIdx < 0 || newIdx >= to.length) return;
		var tmp = to[idx];
		to[idx] = to[newIdx];
		to[newIdx] = tmp;
		syncLayerOrder();
		updatePanel();
	}

	// ---- Multi-select state ----
	var multiSelected = new Set(); // Set of layer UUIDs

	// ---- Drag & Drop state ----
	var dragInfo = {
		type: null,        // 'layer' | 'group' | 'filter'
		layerUUID: null,
		sourceGroup: null,
		groupName: null,
		filterId: null,
		dragEl: null,      // reference to dragged DOM element
	};

	// ---- Mask Editing Mode state ----
	var maskEditMode = {
		active: false,
		layerUUID: null,
		groupName: null,       // null = layer mask, string = group mask
		savedCanvas: null,
		savedCtx: null,
	};

	// ---- Helpers ----

	function createCanvas(w, h) {
		var c = document.createElement('canvas');
		c.width = w; c.height = h;
		return { canvas: c, ctx: c.getContext('2d') };
	}

	function getLayerOffset(layer) {
		return layer && layer.offset ? [layer.offset[0], layer.offset[1]] : [0, 0];
	}

	function getLayerOpacity(layer) {
		return layer && layer.opacity != null ? layer.opacity : 100;
	}

	function getDragPos(event, element) {
		var rect = element.getBoundingClientRect();
		var ratio = (event.clientY - rect.top) / rect.height;
		return ratio < 0.5 ? 'before' : 'after';
	}

	function getDragPos3(event, element) {
		var rect = element.getBoundingClientRect();
		var ratio = (event.clientY - rect.top) / rect.height;
		if (ratio < 0.25) return 'before';
		if (ratio > 0.75) return 'after';
		return 'inside';
	}

	// ---- Reordering helpers ----

	function moveLayerInTexture(layerUUID, direction) {
		// direction: -1 = move up (visually), +1 = move down (visually)
		// tex.layers is bottom-to-top, display is reversed (top-to-bottom)
		// so "up" visually = higher index in tex.layers
		var tex = getSelectedTexture();
		if (!tex || !tex.layers_enabled) return;
		var idx = tex.layers.findIndex(function (l) { return l.uuid === layerUUID; });
		if (idx === -1) return;
		// visual up = array index +1, visual down = array index -1
		var newIdx = idx + (direction === -1 ? 1 : -1);
		if (newIdx < 0 || newIdx >= tex.layers.length) return;
		var tmp = tex.layers[idx];
		tex.layers[idx] = tex.layers[newIdx];
		tex.layers[newIdx] = tmp;
		tex.updateLayerChanges(true);
		updatePanel();
	}

	function moveLayerInGroup(groupName, layerUUID, direction) {
		// direction: -1 = up, +1 = down in the displayed list
		var uuids = _groups()[groupName];
		if (!uuids) return;
		var idx = uuids.indexOf(layerUUID);
		if (idx === -1) return;
		var newIdx = idx + direction;
		if (newIdx < 0 || newIdx >= uuids.length) return;
		var tmp = uuids[idx];
		uuids[idx] = uuids[newIdx];
		uuids[newIdx] = tmp;
		syncLayerOrder();
		updatePanel();
	}

	function moveGroup(groupName, direction) {
		moveTreeEntry('group:' + groupName, direction);
	}

	function moveFilterInStack(layerUUID, filterId, direction) {
		var stack = getFilterStack(layerUUID);
		var idx = stack.filters.findIndex(function (f) { return f.id === filterId; });
		if (idx === -1) return;
		var newIdx = idx + direction;
		if (newIdx < 0 || newIdx >= stack.filters.length) return;
		var tmp = stack.filters[idx];
		stack.filters[idx] = stack.filters[newIdx];
		stack.filters[newIdx] = tmp;
		var tex = getSelectedTexture();
		var layer = tex ? tex.layers.find(function (l) { return l.uuid === layerUUID; }) : null;
		if (layer) recomputeFilters(layer);
		updatePanel();
	}

	// ---- Mask system ----
	// layerMasks[layerUUID] = { canvas, ctx, enabled, original: ImageData|null }
	// groupMasks[groupName] = { canvas, ctx, enabled }
	const layerMasks = {};
	const groupMasks = {};

	function getLayerMask(layerUUID) {
		return layerMasks[layerUUID] || null;
	}

	function getGroupMask(groupName) {
		return groupMasks[groupName] || null;
	}

	function createMaskCanvas(w, h) {
		var c = document.createElement('canvas');
		c.width = w; c.height = h;
		var ctx = c.getContext('2d');
		// Default: white = fully visible
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, w, h);
		return { canvas: c, ctx: ctx };
	}

	function addLayerMask(layer) {
		if (!layer || !layer.canvas) return;
		if (layerMasks[layer.uuid]) return; // already has mask
		var m = createMaskCanvas(layer.canvas.width, layer.canvas.height);
		layerMasks[layer.uuid] = { canvas: m.canvas, ctx: m.ctx, enabled: true, original: null };
		applyMaskToLayer(layer);
		updatePanel();
	}

	function addLayerMaskBlack(layer) {
		if (!layer || !layer.canvas) return;
		// Remove existing mask first if any
		if (layerMasks[layer.uuid]) {
			restoreLayerFromMask(layer);
			delete layerMasks[layer.uuid];
		}
		var w = layer.canvas.width, h = layer.canvas.height;
		var c = document.createElement('canvas');
		c.width = w; c.height = h;
		var ctx = c.getContext('2d');
		// Black = fully hidden
		ctx.fillStyle = '#000000';
		ctx.fillRect(0, 0, w, h);
		layerMasks[layer.uuid] = { canvas: c, ctx: ctx, enabled: true, original: null };
		applyMaskToLayer(layer);
		updatePanel();
	}

	function invertMask(maskObj) {
		if (!maskObj || !maskObj.canvas) return;
		var w = maskObj.canvas.width, h = maskObj.canvas.height;
		var imgData = maskObj.ctx.getImageData(0, 0, w, h);
		var d = imgData.data;
		for (var i = 0; i < d.length; i += 4) {
			d[i] = 255 - d[i];
			d[i + 1] = 255 - d[i + 1];
			d[i + 2] = 255 - d[i + 2];
			// Keep alpha at 255
		}
		maskObj.ctx.putImageData(imgData, 0, 0);
	}

	function removeLayerMask(layer, apply) {
		if (!layer) return;
		if (maskEditMode.active && maskEditMode.layerUUID === layer.uuid && !maskEditMode.groupName) {
			exitMaskEdit();
		}
		var mask = layerMasks[layer.uuid];
		if (!mask) return;
		if (apply) {
			// "Apply mask" = bake mask into layer alpha permanently
			bakeMaskIntoLayer(layer);
		} else {
			// "Delete mask" = remove mask and restore original alpha
			restoreLayerFromMask(layer);
		}
		delete layerMasks[layer.uuid];
		var tex = getSelectedTexture();
		if (tex) tex.updateLayerChanges(true);
		updatePanel();
	}

	function toggleLayerMaskEnabled(layer) {
		var mask = layerMasks[layer.uuid];
		if (!mask) return;
		mask.enabled = !mask.enabled;
		applyMaskToLayer(layer);
		updatePanel();
	}

	function addGroupMask(groupName) {
		if (groupMasks[groupName]) return;
		var tex = getSelectedTexture();
		if (!tex || !tex.layers_enabled || !tex.layers[0]) return;
		var w = tex.layers[0].canvas.width;
		var h = tex.layers[0].canvas.height;
		var m = createMaskCanvas(w, h);
		groupMasks[groupName] = { canvas: m.canvas, ctx: m.ctx, enabled: true };
		// Apply mask to all layers in the group
		var grp = _groups()[groupName];
		if (grp) {
			grp.forEach(function (uuid) {
				var layer = findLayerByUUID(uuid);
				if (layer) applyMaskToLayer(layer);
			});
		}
		updatePanel();
	}

	function addGroupMaskBlack(groupName) {
		if (groupMasks[groupName]) return;
		var tex = getSelectedTexture();
		if (!tex || !tex.layers_enabled || !tex.layers[0]) return;
		var w = tex.layers[0].canvas.width;
		var h = tex.layers[0].canvas.height;
		var c = document.createElement('canvas');
		c.width = w; c.height = h;
		var ctx = c.getContext('2d');
		ctx.fillStyle = '#000000';
		ctx.fillRect(0, 0, w, h);
		groupMasks[groupName] = { canvas: c, ctx: ctx, enabled: true };
		var grp = _groups()[groupName];
		if (grp) {
			grp.forEach(function (uuid) {
				var layer = findLayerByUUID(uuid);
				if (layer) applyMaskToLayer(layer);
			});
		}
		updatePanel();
	}

	function removeGroupMask(groupName, apply) {
		if (maskEditMode.active && maskEditMode.groupName === groupName) {
			exitMaskEdit();
		}
		var mask = groupMasks[groupName];
		if (!mask) return;
		var grp = _groups()[groupName];
		if (grp) {
			grp.forEach(function (uuid) {
				var layer = findLayerByUUID(uuid);
				if (layer) {
					if (apply) {
						bakeMaskIntoLayer(layer);
					} else {
						restoreLayerFromMask(layer);
					}
				}
			});
		}
		delete groupMasks[groupName];
		var tex = getSelectedTexture();
		if (tex) tex.updateLayerChanges(true);
		updatePanel();
	}

	function toggleGroupMaskEnabled(groupName) {
		var mask = groupMasks[groupName];
		if (!mask) return;
		mask.enabled = !mask.enabled;
		var grp = _groups()[groupName];
		if (grp) {
			grp.forEach(function (uuid) {
				var layer = findLayerByUUID(uuid);
				if (layer) applyMaskToLayer(layer);
			});
		}
		var tex = getSelectedTexture();
		if (tex) tex.updateLayerChanges(true);
		updatePanel();
	}

	function findLayerByUUID(uuid) {
		var tex = getSelectedTexture();
		if (!tex || !tex.layers_enabled) return null;
		for (var i = 0; i < tex.layers.length; i++) {
			if (tex.layers[i].uuid === uuid) return tex.layers[i];
		}
		return null;
	}

	function findFirstValidLayerInGroup(groupName) {
		var grp = _groups()[groupName];
		if (!grp) return null;
		for (var i = 0; i < grp.length; i++) {
			var layer = findLayerByUUID(grp[i]);
			if (layer && layer.canvas) return layer;
		}
		return null;
	}

	// Snapshot the original pixels before applying mask (so we can restore later)
	function snapshotMaskOriginal(layer) {
		var mask = layerMasks[layer.uuid];
		if (mask && !mask.original) {
			// Use filter stack's original if available, else snapshot current
			var filterStack = layerFilterStacks[layer.uuid];
			if (filterStack && filterStack.original) {
				mask.original = new ImageData(new Uint8ClampedArray(filterStack.original.data), layer.canvas.width, layer.canvas.height);
			} else {
				mask.original = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
			}
		}
	}

	function applyMaskToLayer(layer) {
		if (!layer || !layer.canvas) return;
		var mask = layerMasks[layer.uuid];
		var groupName = getLayerGroupName(layer.uuid);
		var gMask = groupName ? groupMasks[groupName] : null;

		if (!mask && !gMask) return;

		if (mask) snapshotMaskOriginal(layer);

		// If filters exist, recomputeFilters already applies masks at the end
		var filterStack = layerFilterStacks[layer.uuid];
		if (filterStack && filterStack.original && filterStack.filters.length > 0) {
			recomputeFilters(layer);
			return;
		}

		// No filters: apply mask directly on current pixels
		var w = layer.canvas.width, h = layer.canvas.height;
		// Restore from mask original if available
		if (mask && mask.original) {
			layer.ctx.putImageData(mask.original, 0, 0);
		}
		var imgData = layer.ctx.getImageData(0, 0, w, h);
		applyMaskToImageData(layer.uuid, imgData);
		layer.ctx.putImageData(imgData, 0, 0);
		var tex = getSelectedTexture();
		if (tex) tex.updateLayerChanges(true);
	}

	function bakeMaskIntoLayer(layer) {
		// Already applied visually, just discard original
		var mask = layerMasks[layer.uuid];
		if (mask) mask.original = null;
	}

	function restoreLayerFromMask(layer) {
		var mask = layerMasks[layer.uuid];
		if (mask && mask.original) {
			layer.ctx.putImageData(mask.original, 0, 0);
			mask.original = null;
			// Re-run filters
			var filterStack = layerFilterStacks[layer.uuid];
			if (filterStack && filterStack.original && filterStack.filters.length > 0) {
				recomputeFilters(layer);
			}
		}
	}

	// ---- Mask Editing Mode ----

	function enterMaskEdit(layer, groupName) {
		if (!layer || !layer.canvas) return;
		// Exit current mask edit if active
		if (maskEditMode.active) exitMaskEdit();

		var mask;
		if (groupName) {
			mask = groupMasks[groupName];
		} else {
			mask = layerMasks[layer.uuid];
		}
		if (!mask || !mask.canvas) return;

		// Ensure mask canvas matches layer dimensions
		if (mask.canvas.width !== layer.canvas.width || mask.canvas.height !== layer.canvas.height) {
			var oldData = mask.ctx.getImageData(0, 0, mask.canvas.width, mask.canvas.height);
			mask.canvas.width = layer.canvas.width;
			mask.canvas.height = layer.canvas.height;
			mask.ctx.fillStyle = '#ffffff';
			mask.ctx.fillRect(0, 0, mask.canvas.width, mask.canvas.height);
			mask.ctx.putImageData(oldData, 0, 0);
		}

		// Restore layer to its unmasked state before swapping
		if (!groupName && layerMasks[layer.uuid] && layerMasks[layer.uuid].original) {
			layer.ctx.putImageData(layerMasks[layer.uuid].original, 0, 0);
		}

		// Save the real canvas/ctx
		maskEditMode.savedCanvas = layer.canvas;
		maskEditMode.savedCtx = layer.ctx;
		maskEditMode.layerUUID = layer.uuid;
		maskEditMode.groupName = groupName || null;

		// Swap: Blockbench will now paint on the mask canvas
		layer.canvas = mask.canvas;
		layer.ctx = mask.ctx;
		maskEditMode.active = true;

		// Select this layer so Blockbench targets it
		layer.select();
		var tex = getSelectedTexture();
		if (tex) tex.updateLayerChanges(true);
		updatePanel();
		Blockbench.showQuickMessage('Mask edit mode - Paint white (show) / black (hide)', 2000);
	}

	function exitMaskEdit() {
		if (!maskEditMode.active) return;
		var tex = getSelectedTexture();
		var layer = null;
		if (tex && tex.layers_enabled) {
			for (var i = 0; i < tex.layers.length; i++) {
				if (tex.layers[i].uuid === maskEditMode.layerUUID) {
					layer = tex.layers[i];
					break;
				}
			}
		}

		if (layer && maskEditMode.savedCanvas && maskEditMode.savedCtx) {
			layer.canvas = maskEditMode.savedCanvas;
			layer.ctx = maskEditMode.savedCtx;

			var mask = layerMasks[layer.uuid];
			if (mask) {
				mask.original = null; // Force re-snapshot
			}
			applyMaskToLayer(layer);
		}

		maskEditMode.active = false;
		maskEditMode.layerUUID = null;
		maskEditMode.groupName = null;
		maskEditMode.savedCanvas = null;
		maskEditMode.savedCtx = null;

		if (tex) tex.updateLayerChanges(true);
		updatePanel();
	}

	function isMaskEditActive() {
		return maskEditMode.active;
	}

	function getMaskPreviewDataURL(maskObj) {
		if (!maskObj || !maskObj.canvas) return '';
		try {
			var size = 22;
			var tmp = document.createElement('canvas');
			tmp.width = size; tmp.height = size;
			var tctx = tmp.getContext('2d');
			tctx.fillStyle = '#000';
			tctx.fillRect(0, 0, size, size);
			var sw = maskObj.canvas.width, sh = maskObj.canvas.height;
			if (sw > 0 && sh > 0) {
				var scale = Math.min(size / sw, size / sh);
				var dw = sw * scale, dh = sh * scale;
				var dx = (size - dw) / 2, dy = (size - dh) / 2;
				tctx.drawImage(maskObj.canvas, 0, 0, sw, sh, dx, dy, dw, dh);
			}
			return tmp.toDataURL('image/png');
		} catch (e) { return ''; }
	}

	// Non-destructive filter system
	// layerFilterStacks[layerUUID] = { original: ImageData|null, filters: [{ id, name, enabled, intensity }] }
	const layerFilterStacks = {};
	let filterIdCounter = 0;

	function getFilterStack(layerUUID) {
		if (!layerFilterStacks[layerUUID]) {
			layerFilterStacks[layerUUID] = { original: null, filters: [] };
		}
		return layerFilterStacks[layerUUID];
	}

	function snapshotOriginal(layer) {
		const stack = getFilterStack(layer.uuid);
		if (!stack.original) {
			stack.original = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
		}
	}

	function recomputeFilters(layer) {
		const tex = getSelectedTexture();
		const stack = getFilterStack(layer.uuid);
		if (!stack.original || stack.filters.length === 0) return;

		// Restore original pixels
		var w = layer.canvas.width;
		var h = layer.canvas.height;
		var origData = stack.original;

		// Start from a copy of original
		var working = new ImageData(new Uint8ClampedArray(origData.data), w, h);

		// Apply each enabled filter in order with its intensity
		stack.filters.forEach(function (f) {
			if (!f.enabled) return;
			var intensity = f.intensity / 100;
			if (intensity <= 0) return;

			// Get a copy before this filter to blend with
			var before = new Uint8ClampedArray(working.data);

			applyFilterToImageData(f.name, working, w, h);

			// Blend between before and after based on intensity
			if (intensity < 1) {
				var d = working.data;
				for (var i = 0; i < d.length; i += 4) {
					d[i] = before[i] + (d[i] - before[i]) * intensity;
					d[i + 1] = before[i + 1] + (d[i + 1] - before[i + 1]) * intensity;
					d[i + 2] = before[i + 2] + (d[i + 2] - before[i + 2]) * intensity;
					d[i + 3] = before[i + 3] + (d[i + 3] - before[i + 3]) * intensity;
				}
			}
		});

		// Apply masks after filters
		applyMaskToImageData(layer.uuid, working);

		layer.ctx.putImageData(working, 0, 0);
		if (tex) tex.updateLayerChanges(true);
	}

	// Apply layer and group masks to an ImageData in-place
	function applyMaskToImageData(layerUUID, imgData) {
		var mask = layerMasks[layerUUID];
		var groupName = getLayerGroupName(layerUUID);
		var gMask = groupName ? groupMasks[groupName] : null;
		if (!mask && !gMask) return;

		var w = imgData.width, h = imgData.height;
		var pixels = imgData.data;

		var layerMaskPixels = null;
		if (mask && mask.enabled) {
			var mData = mask.ctx.getImageData(0, 0, mask.canvas.width, mask.canvas.height);
			layerMaskPixels = mData.data;
		}
		var groupMaskPixels = null;
		if (gMask && gMask.enabled) {
			var gData = gMask.ctx.getImageData(0, 0, gMask.canvas.width, gMask.canvas.height);
			groupMaskPixels = gData.data;
		}

		for (var i = 0; i < pixels.length; i += 4) {
			var maskAlpha = 1;
			if (layerMaskPixels) {
				maskAlpha *= (layerMaskPixels[i] * 0.299 + layerMaskPixels[i + 1] * 0.587 + layerMaskPixels[i + 2] * 0.114) / 255;
			}
			if (groupMaskPixels) {
				maskAlpha *= (groupMaskPixels[i] * 0.299 + groupMaskPixels[i + 1] * 0.587 + groupMaskPixels[i + 2] * 0.114) / 255;
			}
			pixels[i + 3] = Math.round(pixels[i + 3] * maskAlpha);
		}
	}

	function addFilterToStack(layer, filterName) {
		snapshotOriginal(layer);
		var stack = getFilterStack(layer.uuid);
		stack.filters.push({
			id: ++filterIdCounter,
			name: filterName,
			enabled: true,
			intensity: 100,
		});
		recomputeFilters(layer);
		updatePanel();
	}

	function removeFilterFromStack(layerUUID, filterId) {
		var stack = getFilterStack(layerUUID);
		var idx = stack.filters.findIndex(function (f) { return f.id === filterId; });
		if (idx !== -1) stack.filters.splice(idx, 1);
		// If no filters left, restore original and clear snapshot
		var tex = getSelectedTexture();
		if (stack.filters.length === 0 && stack.original) {
			var layer = tex ? tex.layers.find(function (l) { return l.uuid === layerUUID; }) : null;
			if (layer) {
				layer.ctx.putImageData(stack.original, 0, 0);
				if (tex) tex.updateLayerChanges(true);
			}
			stack.original = null;
		} else {
			var layer = tex ? tex.layers.find(function (l) { return l.uuid === layerUUID; }) : null;
			if (layer) recomputeFilters(layer);
		}
		updatePanel();
	}

	function toggleFilterEnabled(layerUUID, filterId) {
		var stack = getFilterStack(layerUUID);
		var f = stack.filters.find(function (x) { return x.id === filterId; });
		if (f) f.enabled = !f.enabled;
		var tex = getSelectedTexture();
		var layer = tex ? tex.layers.find(function (l) { return l.uuid === layerUUID; }) : null;
		if (layer) recomputeFilters(layer);
		updatePanel();
	}

	function setFilterIntensity(layerUUID, filterId, intensity) {
		var stack = getFilterStack(layerUUID);
		var f = stack.filters.find(function (x) { return x.id === filterId; });
		if (f) f.intensity = intensity;
		var tex = getSelectedTexture();
		var layer = tex ? tex.layers.find(function (l) { return l.uuid === layerUUID; }) : null;
		if (layer) recomputeFilters(layer);
	}

	const FILTER_LABELS = {
		grayscale: 'Grayscale',
		invert: 'Invert',
		brightness_up: 'Brightness +',
		brightness_down: 'Brightness -',
		contrast: 'Contrast',
		sepia: 'Sepia',
		blur: 'Blur',
		sharpen: 'Sharpen',
	};

	// ---- Helpers ----

	function getSelectedTexture() {
		return Texture.selected || Texture.all[0];
	}

	// Validate and clean up stale UUIDs in treeOrder and groups
	function cleanupLayerResources(uuid) {
		if (layerMasks[uuid]) {
			layerMasks[uuid].canvas = null;
			layerMasks[uuid].ctx = null;
			delete layerMasks[uuid];
		}
		if (layerFilterStacks[uuid]) {
			layerFilterStacks[uuid].original = null;
			delete layerFilterStacks[uuid];
		}
		if (externalEdits[uuid]) {
			stopExternalEdit(uuid);
		}
	}

	function cleanupGroupResources(groupName) {
		if (groupMasks[groupName]) {
			groupMasks[groupName].canvas = null;
			groupMasks[groupName].ctx = null;
			delete groupMasks[groupName];
		}
	}

	// Removes references to layers that no longer exist in the texture
	// Also attempts to re-map UUIDs by matching layer names when possible
	function cleanupStaleRefs(tex) {
		if (!tex || !tex.layers_enabled) return;
		_invalidateGroupCache();
		var td = getTexData(tex.uuid);
		var validUUIDs = new Set();
		var layersByName = {};
		tex.layers.forEach(function (l) {
			validUUIDs.add(l.uuid);
			// Build name→uuid map for re-mapping (use first match per name)
			var n = l.name || '';
			if (!layersByName[n]) layersByName[n] = [];
			layersByName[n].push(l.uuid);
		});

		// Collect all UUIDs currently referenced (to know which valid UUIDs are "claimed")
		var claimedUUIDs = new Set();
		td.treeOrder.forEach(function (e) {
			if (e.indexOf('group:') !== 0 && validUUIDs.has(e)) claimedUUIDs.add(e);
		});
		for (var gn in td.groups) {
			td.groups[gn].forEach(function (uid) {
				if (validUUIDs.has(uid)) claimedUUIDs.add(uid);
			});
		}

		// Build a map of stale UUID → layer name (from previous save, if we stored it)
		// We don't have names stored, so we rely on positional matching within groups
		// For groups: try to remap stale member UUIDs to unclaimed valid UUIDs
		var changed = false;
		for (var gn in td.groups) {
			var members = td.groups[gn];
			for (var i = members.length - 1; i >= 0; i--) {
				if (!validUUIDs.has(members[i])) {
					// Stale UUID - remove it
					members.splice(i, 1);
					changed = true;
				}
			}
			// Remove empty groups
			if (members.length === 0) {
				delete td.groups[gn];
				var gi = td.treeOrder.indexOf('group:' + gn);
				if (gi !== -1) td.treeOrder.splice(gi, 1);
				changed = true;
			}
		}

		// Clean up stale layer UUIDs from treeOrder
		for (var i = td.treeOrder.length - 1; i >= 0; i--) {
			var entry = td.treeOrder[i];
			if (entry.indexOf('group:') === 0) {
				// Check group still exists
				var gname = entry.slice(6);
				if (!td.groups[gname]) {
					td.treeOrder.splice(i, 1);
					changed = true;
				}
			} else if (!validUUIDs.has(entry)) {
				// Stale layer UUID
				td.treeOrder.splice(i, 1);
				changed = true;
			}
		}

		// Remove duplicate entries in treeOrder
		var seen = new Set();
		for (var i = td.treeOrder.length - 1; i >= 0; i--) {
			if (seen.has(td.treeOrder[i])) {
				td.treeOrder.splice(i, 1);
				changed = true;
			} else {
				seen.add(td.treeOrder[i]);
			}
		}

		// Ensure all ungrouped layers are in treeOrder
		var allGroupedUUIDs = new Set();
		for (var gn in td.groups) {
			td.groups[gn].forEach(function (uid) { allGroupedUUIDs.add(uid); });
		}
		var treeSet = new Set(td.treeOrder);
		tex.layers.forEach(function (l) {
			if (!treeSet.has(l.uuid) && !allGroupedUUIDs.has(l.uuid)) {
				td.treeOrder.push(l.uuid);
				changed = true;
			}
		});

		if (changed) {
			console.log('LMP: Cleaned up stale references for texture ' + tex.uuid);
		}
		return changed;
	}

	// Sync tex.layers order to match treeOrder display
	// treeOrder is top-to-bottom (visual), tex.layers is bottom-to-top (render)
	function syncLayerOrder() {
		var tex = getSelectedTexture();
		if (!tex || !tex.layers_enabled) return;
		var to = _treeOrder();
		// Build ordered list: walk treeOrder top-to-bottom, expanding groups
		var orderedUUIDs = [];
		for (var i = 0; i < to.length; i++) {
			var entry = to[i];
			if (entry.indexOf('group:') === 0) {
				var name = entry.slice(6);
				var members = _groups()[name];
				if (members) {
					for (var j = 0; j < members.length; j++) {
						orderedUUIDs.push(members[j]);
					}
				}
			} else {
				orderedUUIDs.push(entry);
			}
		}
		// orderedUUIDs is top-to-bottom visual order
		// tex.layers should be bottom-to-top, so reverse
		var layerMap = {};
		tex.layers.forEach(function (l) { layerMap[l.uuid] = l; });
		var newLayers = [];
		for (var i = orderedUUIDs.length - 1; i >= 0; i--) {
			var l = layerMap[orderedUUIDs[i]];
			if (l) {
				newLayers.push(l);
				delete layerMap[orderedUUIDs[i]];
			}
		}
		// Append any layers not in treeOrder (safety)
		for (var uuid in layerMap) {
			newLayers.push(layerMap[uuid]);
		}
		tex.layers.length = 0;
		for (var i = 0; i < newLayers.length; i++) {
			tex.layers.push(newLayers[i]);
		}
		tex.updateLayerChanges(true);
	}

	function getSelectedLayer() {
		const tex = getSelectedTexture();
		if (!tex || !tex.layers_enabled) return null;
		return TextureLayer.selected || tex.getActiveLayer();
	}

	function isLayerLocked(layer) {
		return layer && _locks().has(layer.uuid);
	}

	function ensureLayersEnabled(texture) {
		if (!texture) return false;
		if (!texture.layers_enabled) {
			texture.activateLayers(true);
		}
		return texture.layers_enabled;
	}

	// ---- Layer Group (Folder) Management ----

	function createLayerGroup(name, layerUUIDs) {
		if (!name) {
			Blockbench.textPrompt('New Layer Group', 'Group 1', function (value) {
				if (value && !_groups()[value]) {
					_groups()[value] = [];
					_treeOrder().unshift('group:' + value);
					if (layerUUIDs && layerUUIDs.length > 0) {
						layerUUIDs.forEach(function (uuid) { addLayerToGroup(value, uuid); });
						multiSelected.clear();
					}
					Blockbench.showQuickMessage('Created group: ' + value, 1500);
					updatePanel();
				}
			});
		} else if (!_groups()[name]) {
			_groups()[name] = [];
			_treeOrder().unshift('group:' + name);
			if (layerUUIDs && layerUUIDs.length > 0) {
				layerUUIDs.forEach(function (uuid) { addLayerToGroup(name, uuid); });
				multiSelected.clear();
			}
			updatePanel();
		}
	}

	function addLayerToGroup(groupName, layerUUID) {
		if (!_groups()[groupName]) return;
		if (_groups()[groupName].indexOf(layerUUID) === -1) {
			_groups()[groupName].push(layerUUID);
			_invalidateGroupCache();
		}
		// Remove from treeOrder top-level (now inside a group)
		var ti = _treeOrder().indexOf(layerUUID);
		if (ti !== -1) _treeOrder().splice(ti, 1);
		syncLayerOrder();
		updatePanel();
	}

	function removeLayerFromGroup(groupName, layerUUID) {
		if (!_groups()[groupName]) return;
		const idx = _groups()[groupName].indexOf(layerUUID);
		if (idx !== -1) {
			_groups()[groupName].splice(idx, 1);
			_invalidateGroupCache();
		}
		// Add back to treeOrder if not in any other group
		if (!getLayerGroupName(layerUUID)) {
			var gi = _treeOrder().indexOf('group:' + groupName);
			if (gi !== -1) {
				_treeOrder().splice(gi + 1, 0, layerUUID);
			} else {
				_treeOrder().push(layerUUID);
			}
		}
		syncLayerOrder();
		updatePanel();
	}

	function deleteLayerGroup(groupName) {
		// Move group's layers back to treeOrder at the group's position
		var gi = _treeOrder().indexOf('group:' + groupName);
		var members = (_groups()[groupName] || []).slice();
		delete _groups()[groupName];
		_invalidateGroupCache();
		var td = getTexData();
		delete td.groupOpacities[groupName];
		cleanupGroupResources(groupName);
		if (gi !== -1) {
			_treeOrder().splice(gi, 1);
			// Insert members where the group was
			for (var i = 0; i < members.length; i++) {
				_treeOrder().splice(gi + i, 0, members[i]);
			}
		}
		syncLayerOrder();
		updatePanel();
	}

	function toggleGroupVisibility(groupName) {
		const tex = getSelectedTexture();
		if (!tex || !tex.layers_enabled) return;
		const uuids = _groups()[groupName] || [];
		const layers = tex.layers.filter(function (l) {
			return uuids.indexOf(l.uuid) !== -1;
		});
		if (layers.length === 0) return;
		// Toggle based on first layer's current state
		const newState = !layers[0].visible;
		layers.forEach(function (l) {
			l.visible = newState;
		});
		tex.updateLayerChanges(true);
		updatePanel();
	}

	function getGroupOpacity(groupName) {
		var td = getTexData();
		return td.groupOpacities[groupName] != null ? td.groupOpacities[groupName] : 100;
	}

	function setGroupOpacity(groupName, opacity) {
		var td = getTexData();
		var tex = getSelectedTexture();
		if (!tex || !tex.layers_enabled) return;
		var prev = td.groupOpacities[groupName] != null ? td.groupOpacities[groupName] : 100;
		td.groupOpacities[groupName] = opacity;
		var members = _groups()[groupName] || [];
		members.forEach(function (uuid) {
			var layer = findLayerByUUID(uuid);
			if (layer) {
				// Scale layer opacity proportionally: if group was at 80 and layer at 40,
				// base ratio is 40/80 = 0.5. New group opacity 60 → layer = 60 * 0.5 = 30
				var base = prev > 0 ? (layer.opacity / prev) : (1 / members.length);
				layer.opacity = Math.round(Math.min(100, Math.max(0, base * opacity)));
			}
		});
		tex.updateLayerChanges(true);
		updatePanel();
	}

	function isGroupLocked(groupName) {
		var uuids = _groups()[groupName] || [];
		if (uuids.length === 0) return false;
		for (var i = 0; i < uuids.length; i++) {
			if (!_locks().has(uuids[i])) return false;
		}
		return true;
	}

	function toggleGroupLock(groupName) {
		var uuids = _groups()[groupName] || [];
		if (uuids.length === 0) return;
		var locked = isGroupLocked(groupName);
		uuids.forEach(function (uuid) {
			if (locked) {
				_locks().delete(uuid);
			} else {
				_locks().add(uuid);
			}
		});
		Blockbench.showQuickMessage((locked ? 'Unlocked' : 'Locked') + ' group: ' + groupName, 1000);
		updatePanel();
	}

	// ---- Lock Management ----

	function toggleLayerLock(layer) {
		if (!layer) return;
		if (_locks().has(layer.uuid)) {
			_locks().delete(layer.uuid);
			Blockbench.showQuickMessage('Layer unlocked: ' + layer.name, 1000);
		} else {
			_locks().add(layer.uuid);
			Blockbench.showQuickMessage('Layer locked: ' + layer.name, 1000);
		}
		updatePanel();
	}

	// ---- Layer Operations ----

	function addNewLayer() {
		const tex = getSelectedTexture();
		if (!tex) {
			Blockbench.showQuickMessage('No texture selected', 1500);
			return;
		}
		ensureLayersEnabled(tex);
		const layer = new TextureLayer(
			{ name: 'Layer ' + (tex.layers.length + 1) },
			tex
		);
		layer.setSize(tex.width, tex.height);
		layer.addForEditing();
		_treeOrder().unshift(layer.uuid);
		tex.updateLayerChanges(true);
		updatePanel();
	}

	function duplicateSelectedLayer() {
		const tex = getSelectedTexture();
		const layer = getSelectedLayer();
		if (!tex || !layer) {
			Blockbench.showQuickMessage('No layer selected', 1500);
			return;
		}
		Undo.initEdit({ textures: [tex] });

		const newLayer = new TextureLayer(
			{ name: layer.name + ' copy' },
			tex
		);
		newLayer.setSize(layer.canvas.width, layer.canvas.height);
		newLayer.offset = getLayerOffset(layer);
		newLayer.opacity = getLayerOpacity(layer);
		newLayer.blend_mode = layer.blend_mode;
		newLayer.visible = layer.visible;
		newLayer.ctx.drawImage(layer.canvas, 0, 0);
		newLayer.addForEditing();
		// Insert duplicate right after original in treeOrder
		var origGroup = getLayerGroupName(layer.uuid);
		if (origGroup) {
			var grpArr = _groups()[origGroup];
			if (grpArr) {
				var oi = grpArr.indexOf(layer.uuid);
				grpArr.splice(oi + 1, 0, newLayer.uuid);
			}
		} else {
			var oi = _treeOrder().indexOf(layer.uuid);
			if (oi !== -1) {
				_treeOrder().splice(oi + 1, 0, newLayer.uuid);
			} else {
				_treeOrder().unshift(newLayer.uuid);
			}
		}

		Undo.finishEdit('Duplicate layer');
		tex.updateLayerChanges(true);
		updatePanel();
	}

	function copyLayerToTexture(layer, targetTex) {
		if (!layer || !targetTex) return;
		ensureLayersEnabled(targetTex);
		Undo.initEdit({ textures: [targetTex] });
		var newLayer = new TextureLayer(
			{ name: layer.name },
			targetTex
		);
		newLayer.setSize(layer.canvas.width, layer.canvas.height);
		newLayer.offset = getLayerOffset(layer);
		newLayer.opacity = getLayerOpacity(layer);
		newLayer.blend_mode = layer.blend_mode;
		newLayer.visible = layer.visible;
		newLayer.ctx.drawImage(layer.canvas, 0, 0);
		newLayer.addForEditing();
		var td = getTexData(targetTex.uuid);
		td.treeOrder.unshift(newLayer.uuid);
		Undo.finishEdit('Copy layer to ' + targetTex.name);
		targetTex.updateLayerChanges(true);
		return newLayer;
	}

	function copyGroupToTexture(groupName, targetTex) {
		if (!targetTex) return;
		var srcTex = getSelectedTexture();
		if (!srcTex) return;
		var members = _groups()[groupName] || [];
		if (members.length === 0) return;
		ensureLayersEnabled(targetTex);
		Undo.initEdit({ textures: [targetTex] });
		var td = getTexData(targetTex.uuid);
		// Create group on target texture if it doesn't exist
		var targetGroupName = groupName;
		var suffix = 1;
		while (td.groups[targetGroupName]) {
			targetGroupName = groupName + ' (' + suffix + ')';
			suffix++;
		}
		td.groups[targetGroupName] = [];
		td.treeOrder.unshift('group:' + targetGroupName);
		// Copy each member layer
		for (var i = 0; i < members.length; i++) {
			var srcLayer = findLayerByUUID(members[i]);
			if (!srcLayer) continue;
			var newLayer = new TextureLayer(
				{ name: srcLayer.name },
				targetTex
			);
			newLayer.setSize(srcLayer.canvas.width, srcLayer.canvas.height);
			newLayer.offset = getLayerOffset(srcLayer);
			newLayer.opacity = getLayerOpacity(srcLayer);
			newLayer.blend_mode = srcLayer.blend_mode;
			newLayer.visible = srcLayer.visible;
			newLayer.ctx.drawImage(srcLayer.canvas, 0, 0);
			newLayer.addForEditing();
			td.groups[targetGroupName].push(newLayer.uuid);
		}
		// Copy group opacity
		var srcTd = getTexData(srcTex.uuid);
		if (srcTd.groupOpacities[groupName] != null) {
			td.groupOpacities[targetGroupName] = srcTd.groupOpacities[groupName];
		}
		Undo.finishEdit('Copy group to ' + targetTex.name);
		targetTex.updateLayerChanges(true);
		updatePanel();
	}

	function mergeDown() {
		var tex = getSelectedTexture();
		var layer = getSelectedLayer();
		if (!tex || !layer) {
			Blockbench.showQuickMessage('No layer selected', 1500);
			return;
		}
		// Find the layer below in tex.layers (render order: bottom=0, top=last)
		var idx = tex.layers.indexOf(layer);
		if (idx <= 0) {
			Blockbench.showQuickMessage('No layer below to merge into', 1500);
			return;
		}
		var below = tex.layers[idx - 1];
		if (isLayerLocked(below)) {
			Blockbench.showQuickMessage('Target layer is locked', 1500);
			return;
		}

		Undo.initEdit({ textures: [tex] });

		// Draw current layer onto the one below with opacity
		below.ctx.globalAlpha = getLayerOpacity(layer) / 100;
		var off = getLayerOffset(layer);
		var belowOff = getLayerOffset(below);
		below.ctx.drawImage(layer.canvas, off[0] - belowOff[0], off[1] - belowOff[1]);
		below.ctx.globalAlpha = 1;

		// Remove the upper layer
		var gn = getLayerGroupName(layer.uuid);
		if (gn) {
			var ga = _groups()[gn];
			if (ga) { var ri = ga.indexOf(layer.uuid); if (ri !== -1) ga.splice(ri, 1); }
			_invalidateGroupCache();
		}
		var ti = _treeOrder().indexOf(layer.uuid);
		if (ti !== -1) _treeOrder().splice(ti, 1);
		cleanupLayerResources(layer.uuid);
		layer.remove(false);

		// Select the merged-into layer
		below.select();
		Undo.finishEdit('Merge down');
		tex.updateLayerChanges(true);
		updatePanel();
	}

	function mergeVisibleLayers() {
		const tex = getSelectedTexture();
		if (!tex || !tex.layers_enabled || tex.layers.length < 2) {
			Blockbench.showQuickMessage('Need at least 2 layers', 1500);
			return;
		}

		Undo.initEdit({ textures: [tex] });

		const visibleLayers = tex.layers.filter(function (l) {
			return l.visible;
		});
		if (visibleLayers.length < 2) {
			Undo.cancelEdit();
			Blockbench.showQuickMessage('Need at least 2 visible layers', 1500);
			return;
		}

		// Create merged layer
		const merged = new TextureLayer(
			{ name: 'Merged' },
			tex
		);
		merged.setSize(tex.width, tex.height);

		// Draw all visible layers from bottom to top
		visibleLayers.forEach(function (l) {
			merged.ctx.globalAlpha = getLayerOpacity(l) / 100;
			merged.ctx.drawImage(l.canvas, l.offset[0], l.offset[1]);
		});
		merged.ctx.globalAlpha = 1;

		// Remove visible layers from treeOrder and groups
		for (let i = visibleLayers.length - 1; i >= 0; i--) {
			var vuuid = visibleLayers[i].uuid;
			var vg = getLayerGroupName(vuuid);
			if (vg) {
				var ga = _groups()[vg];
				if (ga) { var ri = ga.indexOf(vuuid); if (ri !== -1) ga.splice(ri, 1); }
			}
			var ti = _treeOrder().indexOf(vuuid);
			if (ti !== -1) _treeOrder().splice(ti, 1);
			cleanupLayerResources(vuuid);
			visibleLayers[i].remove(false);
		}

		merged.addForEditing();
		_treeOrder().unshift(merged.uuid);
		Undo.finishEdit('Merge visible layers');
		tex.updateLayerChanges(true);
		updatePanel();
	}

	function mergeSelectedLayers() {
		var tex = getSelectedTexture();
		if (!tex || !tex.layers_enabled) return;
		if (multiSelected.size < 2) {
			Blockbench.showQuickMessage('Select at least 2 layers (Ctrl+Click)', 1500);
			return;
		}

		Undo.initEdit({ textures: [tex] });

		// Get selected layers in render order (bottom to top = tex.layers order)
		var selectedLayers = tex.layers.filter(function (l) { return multiSelected.has(l.uuid); });
		if (selectedLayers.length < 2) {
			Undo.cancelEdit();
			return;
		}

		var merged = new TextureLayer({ name: 'Merged' }, tex);
		merged.setSize(tex.width, tex.height);

		selectedLayers.forEach(function (l) {
			merged.ctx.globalAlpha = (l.opacity != null ? l.opacity : 100) / 100;
			merged.ctx.drawImage(l.canvas, l.offset[0], l.offset[1]);
		});
		merged.ctx.globalAlpha = 1;

		// Remove selected layers from treeOrder and groups
		for (var i = selectedLayers.length - 1; i >= 0; i--) {
			var uuid = selectedLayers[i].uuid;
			var gn = getLayerGroupName(uuid);
			if (gn) {
				var ga = _groups()[gn];
				if (ga) { var ri = ga.indexOf(uuid); if (ri !== -1) ga.splice(ri, 1); }
			}
			var ti = _treeOrder().indexOf(uuid);
			if (ti !== -1) _treeOrder().splice(ti, 1);
			cleanupLayerResources(uuid);
			selectedLayers[i].remove(false);
		}

		merged.addForEditing();
		_treeOrder().unshift(merged.uuid);
		multiSelected.clear();
		Undo.finishEdit('Merge selected layers');
		tex.updateLayerChanges(true);
		updatePanel();
	}

	function flattenAllLayers() {
		const tex = getSelectedTexture();
		if (!tex || !tex.layers_enabled || tex.layers.length < 2) {
			Blockbench.showQuickMessage('Need at least 2 layers', 1500);
			return;
		}

		Undo.initEdit({ textures: [tex] });

		const flattened = new TextureLayer(
			{ name: 'Flattened' },
			tex
		);
		flattened.setSize(tex.width, tex.height);

		// Draw all layers from bottom to top
		tex.layers.slice().forEach(function (l) {
			if (l.visible) {
				flattened.ctx.globalAlpha = getLayerOpacity(l) / 100;
				flattened.ctx.drawImage(l.canvas, l.offset[0], l.offset[1]);
			}
		});
		flattened.ctx.globalAlpha = 1;

		// Remove all existing layers
		const toRemove = tex.layers.slice();
		for (let i = toRemove.length - 1; i >= 0; i--) {
			cleanupLayerResources(toRemove[i].uuid);
			toRemove[i].remove(false);
		}

		flattened.addForEditing();
		// Reset treeOrder and groups for this texture
		var td = getTexData();
		for (var k in td.groups) delete td.groups[k];
		td.treeOrder.length = 0;
		td.treeOrder.push(flattened.uuid);
		Undo.finishEdit('Flatten all layers');
		tex.updateLayerChanges(true);
		updatePanel();
	}

	function importImageAsLayer() {
		const tex = getSelectedTexture();
		if (!tex) {
			Blockbench.showQuickMessage('No texture selected', 1500);
			return;
		}
		ensureLayersEnabled(tex);

		Blockbench.import(
			{
				resource_id: 'texture',
				type: 'Image',
				extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'],
				readtype: 'image',
			},
			function (files) {
				if (!files || files.length === 0) return;
				Undo.initEdit({ textures: [tex] });

				const file = files[0];
				const img = new Image();
				img.onload = function () {
					const layer = new TextureLayer(
						{ name: file.name || 'Imported Layer' },
						tex
					);
					layer.setSize(img.width, img.height);
					layer.ctx.drawImage(img, 0, 0);
					layer.addForEditing();
					_treeOrder().unshift(layer.uuid);

					Undo.finishEdit('Import image as layer');
					tex.updateLayerChanges(true);
					updatePanel();
				};
				img.onerror = function () {
					Blockbench.showQuickMessage('Failed to load image: ' + (file.name || 'unknown'), 2000);
				};
				img.src = file.content;
			}
		);
	}

	// ---- Edit in External Editor (Photoshop link) ----

	var externalEdits = {}; // { layerUUID: { path, watcher, texUUID } }

	function editLayerExternal(layer) {
		if (!layer) return;
		var tex = getSelectedTexture();
		if (!tex) return;
		var uuid = layer.uuid;

		// If already being edited externally, just re-open the file
		if (externalEdits[uuid]) {
			require('electron').shell.openPath(externalEdits[uuid].path);
			Blockbench.showQuickMessage('Reopened in external editor', 1500);
			return;
		}

		var fs = require('fs');
		var path = require('path');
		var os = require('os');

		// Export layer to temp PNG
		var tmpDir = path.join(os.tmpdir(), 'blockbench_lmp');
		try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (e) {}
		var safeName = (layer.name || 'layer').replace(/[^a-zA-Z0-9_-]/g, '_');
		var tmpFile = path.join(tmpDir, safeName + '_' + uuid.slice(0, 8) + '.png');

		// Write canvas to PNG file
		var dataURL = layer.canvas.toDataURL('image/png');
		var base64 = dataURL.replace(/^data:image\/png;base64,/, '');
		fs.writeFileSync(tmpFile, Buffer.from(base64, 'base64'));

		// Watch for file changes
		var lastMtime = Date.now();
		var pollInterval = setInterval(function () {
			try {
				// Stop if layer or texture was deleted
				var edit = externalEdits[uuid];
				if (!edit || !Texture.all.find(function (t) { return t.uuid === edit.texUUID; })) {
					stopExternalEdit(uuid);
					return;
				}
				var stat = fs.statSync(tmpFile);
				var mtime = stat.mtimeMs;
				if (mtime > lastMtime) {
					lastMtime = mtime;
					reimportExternalEdit(uuid, tmpFile);
				}
			} catch (e) {
				// File deleted or inaccessible — stop watching
				stopExternalEdit(uuid);
			}
		}, 500);

		externalEdits[uuid] = { path: tmpFile, pollInterval: pollInterval, texUUID: tex.uuid };

		// Open in default image editor (Photoshop if set as default for .png)
		require('electron').shell.openPath(tmpFile);
		Blockbench.showQuickMessage('Opened "' + layer.name + '" in external editor. Save there to sync back.', 3000);
		updatePanel();
	}

	function reimportExternalEdit(uuid, filePath) {
		var fs = require('fs');
		var edit = externalEdits[uuid];
		if (!edit) return;

		var tex = Texture.all.find(function (t) { return t.uuid === edit.texUUID; });
		if (!tex || !tex.layers_enabled) return;
		var layer = tex.layers.find(function (l) { return l.uuid === uuid; });
		if (!layer) return;

		// Read the modified file and draw onto layer
		var buf = fs.readFileSync(filePath);
		var blob = new Blob([buf], { type: 'image/png' });
		var url = URL.createObjectURL(blob);
		var img = new Image();
		img.onload = function () {
			layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
			layer.ctx.drawImage(img, 0, 0);
			URL.revokeObjectURL(url);
			tex.updateLayerChanges(true);
			updatePanel();
			Blockbench.showQuickMessage('Layer "' + layer.name + '" synced from external editor', 1500);
		};
		img.onerror = function () {
			URL.revokeObjectURL(url);
		};
		img.src = url;
	}

	function stopExternalEdit(uuid) {
		var edit = externalEdits[uuid];
		if (!edit) return;
		if (edit.pollInterval) clearInterval(edit.pollInterval);
		// Clean up temp file
		try { require('fs').unlinkSync(edit.path); } catch (e) {}
		delete externalEdits[uuid];
		updatePanel();
	}

	function stopAllExternalEdits() {
		for (var uuid in externalEdits) {
			stopExternalEdit(uuid);
		}
	}

	function isExternallyEdited(uuid) {
		return !!externalEdits[uuid];
	}

	// ---- PSD Encoder / Decoder ----

	function buildPSD(layers, docW, docH, groupInfo) {
		var parts = [];
		function w8(v) { var b = Buffer.alloc(1); b.writeUInt8(v); parts.push(b); }
		function wi16(v) { var b = Buffer.alloc(2); b.writeInt16BE(v); parts.push(b); }
		function wu16(v) { var b = Buffer.alloc(2); b.writeUInt16BE(v); parts.push(b); }
		function wi32(v) { var b = Buffer.alloc(4); b.writeInt32BE(v); parts.push(b); }
		function wu32(v) { var b = Buffer.alloc(4); b.writeUInt32BE(v); parts.push(b); }
		function wbuf(b) { parts.push(Buffer.isBuffer(b) ? b : Buffer.from(b)); }
		function wstr(s) { parts.push(Buffer.from(s, 'ascii')); }
		function pos() { var n = 0; for (var i = 0; i < parts.length; i++) n += parts[i].length; return n; }
		function ph32() { var idx = parts.length; wu32(0); return idx; }
		function fill32(idx, v) { parts[idx].writeUInt32BE(v); }

		// Filter out layers without valid canvas
		layers = layers.filter(function (l) { return l.canvas && l.canvas.width > 0 && l.canvas.height > 0; });
		if (layers.length === 0) throw new Error('No valid layers to export');

		// Build PSD entry list with group markers if groupInfo provided
		// groupInfo: { treeOrder: [...], groups: { name: [uuid,...] } }
		// PSD layers are stored bottom-to-top; groups use lsct section dividers
		var entries = []; // { type: 'layer'|'group_start'|'group_end', layer?, name? }
		if (groupInfo && groupInfo.treeOrder) {
			var layerMap = {};
			layers.forEach(function (l) { layerMap[l.uuid] = l; });
			// Walk treeOrder top-to-bottom, build visual order
			var visual = [];
			for (var i = 0; i < groupInfo.treeOrder.length; i++) {
				var entry = groupInfo.treeOrder[i];
				if (entry.indexOf('group:') === 0) {
					var gname = entry.slice(6);
					var members = groupInfo.groups[gname] || [];
					visual.push({ type: 'group_start', name: gname });
					for (var j = 0; j < members.length; j++) {
						var ml = layerMap[members[j]];
						if (ml) { visual.push({ type: 'layer', layer: ml }); delete layerMap[members[j]]; }
					}
					visual.push({ type: 'group_end', name: gname });
				} else {
					var ul = layerMap[entry];
					if (ul) { visual.push({ type: 'layer', layer: ul }); delete layerMap[entry]; }
				}
			}
			// Add any remaining layers not in treeOrder
			for (var uuid in layerMap) {
				visual.push({ type: 'layer', layer: layerMap[uuid] });
			}
			// Reverse to get bottom-to-top (PSD order)
			entries = visual.reverse();
		} else {
			// No groups, flat list (already bottom-to-top from tex.layers)
			for (var i = 0; i < layers.length; i++) {
				entries.push({ type: 'layer', layer: layers[i] });
			}
		}

		// Prepare PSD record data for each entry
		var lds = [];
		for (var ei = 0; ei < entries.length; ei++) {
			var e = entries[ei];
			if (e.type === 'layer') {
				var layer = e.layer;
				var w = layer.canvas.width, h = layer.canvas.height;
				var px = layer.ctx.getImageData(0, 0, w, h).data;
				var n = w * h;
				var R = Buffer.alloc(n), G = Buffer.alloc(n), B = Buffer.alloc(n), A = Buffer.alloc(n);
				for (var p = 0; p < n; p++) {
					R[p] = px[p * 4]; G[p] = px[p * 4 + 1]; B[p] = px[p * 4 + 2]; A[p] = px[p * 4 + 3];
				}
				var ox = layer.offset ? layer.offset[0] : 0;
				var oy = layer.offset ? layer.offset[1] : 0;
				var nb = Buffer.from(layer.name || 'Layer ' + ei, 'utf8');
				if (nb.length > 255) nb = nb.slice(0, 255);
				var npl = Math.ceil((1 + nb.length) / 4) * 4;
				lds.push({ kind: 'layer', w: w, h: h, ox: ox, oy: oy, R: R, G: G, B: B, A: A, nb: nb, npl: npl,
					op: Math.round((layer.opacity != null ? layer.opacity : 100) * 255 / 100),
					vis: layer.visible !== false, lsct: -1 });
			} else if (e.type === 'group_end') {
				// After reverse: group_end is first in PSD (bottom) = bounding section divider
				var dnb = Buffer.from('</Layer group>', 'utf8');
				var dnpl = Math.ceil((1 + dnb.length) / 4) * 4;
				lds.push({ kind: 'group_close', w: 0, h: 0, ox: 0, oy: 0, nb: dnb, npl: dnpl,
					op: 255, vis: true, lsct: 3 }); // lsct=3: bounding section divider
			} else if (e.type === 'group_start') {
				// After reverse: group_start is last in PSD (top) = open folder with group name
				var gnb = Buffer.from(e.name, 'utf8');
				if (gnb.length > 255) gnb = gnb.slice(0, 255);
				var gnpl = Math.ceil((1 + gnb.length) / 4) * 4;
				lds.push({ kind: 'group_open', w: 0, h: 0, ox: 0, oy: 0, nb: gnb, npl: gnpl,
					op: 255, vis: true, lsct: 1 }); // lsct=1: open folder
			}
		}

		var totalRecords = lds.length;

		// Header
		wstr('8BPS'); wu16(1); wbuf(Buffer.alloc(6)); wu16(4);
		wu32(docH); wu32(docW); wu16(8); wu16(3);
		wu32(0); // color mode
		wu32(0); // image resources

		// Layer and Mask Info
		var lmiIdx = ph32(); var lmiStart = pos();
		var liIdx = ph32(); var liStart = pos();
		wi16(-totalRecords);

		// Layer records
		for (var i = 0; i < lds.length; i++) {
			var d = lds[i];
			if (d.kind === 'layer') {
				var cdl = 2 + d.w * d.h;
				wi32(d.oy); wi32(d.ox); wi32(d.oy + d.h); wi32(d.ox + d.w);
				wu16(4);
				wi16(-1); wu32(cdl); wi16(0); wu32(cdl); wi16(1); wu32(cdl); wi16(2); wu32(cdl);
				wstr('8BIM'); wstr('norm');
				w8(d.op); w8(0); w8(d.vis ? 0 : 2); w8(0);
				wu32(4 + 4 + d.npl); wu32(0); wu32(0);
				w8(d.nb.length); wbuf(d.nb);
				var pad = d.npl - 1 - d.nb.length;
				if (pad > 0) wbuf(Buffer.alloc(pad));
			} else {
				// Group marker (open folder or bounding divider)
				// Empty 1x1 transparent layer with lsct additional info
				wi32(0); wi32(0); wi32(0); wi32(0); // zero rect
				wu16(4);
				wi16(-1); wu32(2); wi16(0); wu32(2); wi16(1); wu32(2); wi16(2); wu32(2); // minimal channel data (compression only)
				wstr('8BIM'); wstr(d.lsct === 3 ? 'norm' : 'pass'); // pass-through for folder
				w8(d.op); w8(0); w8(0); w8(0);
				// Extra data: mask(4) + blending(4) + name(npl) + lsct block(24)
				var lsctLen = 8 + 4 + 12; // '8BIM'(4) + 'lsct'(4) + length_field(4) + data(12: type+sig+blend)
				wu32(4 + 4 + d.npl + lsctLen);
				wu32(0); wu32(0); // mask + blending ranges
				w8(d.nb.length); wbuf(d.nb);
				var pad = d.npl - 1 - d.nb.length;
				if (pad > 0) wbuf(Buffer.alloc(pad));
				// lsct additional layer information
				wstr('8BIM'); wstr('lsct');
				wu32(12); // data length: type(4) + sig(4) + blend(4)
				wu32(d.lsct); // section type
				wstr('8BIM');
				wstr(d.lsct === 3 ? 'norm' : 'pass');
			}
		}

		// Channel data
		for (var i = 0; i < lds.length; i++) {
			var d = lds[i];
			if (d.kind === 'layer') {
				wu16(0); wbuf(d.A); wu16(0); wbuf(d.R); wu16(0); wbuf(d.G); wu16(0); wbuf(d.B);
			} else {
				// Group markers: minimal empty channel data (compression type 0, no pixels)
				wu16(0); wu16(0); wu16(0); wu16(0);
			}
		}

		var liLen = pos() - liStart;
		if (liLen % 2 !== 0) { w8(0); liLen++; }
		fill32(liIdx, liLen);
		wu32(0); // global layer mask
		fill32(lmiIdx, pos() - lmiStart);

		// Composite (white)
		wu16(0);
		var plane = Buffer.alloc(docW * docH, 255);
		wbuf(plane); wbuf(plane); wbuf(plane); wbuf(plane);

		return Buffer.concat(parts);
	}

	function parsePSD(buf) {
		var bufLen = buf.length;
		var o = { v: 0 };
		function check(n) { if (o.v + n > bufLen) throw new Error('Unexpected end of PSD data at offset ' + o.v + ' (need ' + n + ' bytes, buf=' + bufLen + ')'); }
		function r8() { check(1); return buf.readUInt8(o.v++); }
		function ri16() { check(2); var v = buf.readInt16BE(o.v); o.v += 2; return v; }
		function ru16() { check(2); var v = buf.readUInt16BE(o.v); o.v += 2; return v; }
		function ri32() { check(4); var v = buf.readInt32BE(o.v); o.v += 4; return v; }
		function ru32() { check(4); var v = buf.readUInt32BE(o.v); o.v += 4; return v; }
		function skip(n) {
			if (n < 0) n = 0;
			if (o.v + n > bufLen) { o.v = bufLen; return; }
			o.v += n;
		}
		function safeSlice(len) {
			if (len <= 0) return Buffer.alloc(0);
			var end = Math.min(o.v + len, bufLen);
			var sl = buf.slice(o.v, end);
			o.v = end;
			return sl;
		}

		if (bufLen < 26 || buf.toString('ascii', 0, 4) !== '8BPS') throw new Error('Not PSD');
		o.v = 4;
		ru16(); skip(6); var ch = ru16(); var h = ru32(); var w = ru32(); ru16(); ru16();
		var cmLen = ru32(); skip(cmLen); // color mode
		var irLen = ru32(); skip(irLen); // image resources

		if (o.v + 4 > bufLen) return { width: w, height: h, layers: [] };
		var lmiLen = ru32();
		if (lmiLen === 0) return { width: w, height: h, layers: [] };
		var lmiEnd = Math.min(o.v + lmiLen, bufLen);

		if (o.v + 4 > lmiEnd) { o.v = lmiEnd; return { width: w, height: h, layers: [] }; }
		var liLen = ru32();
		if (liLen === 0) { o.v = lmiEnd; return { width: w, height: h, layers: [] }; }
		var liEnd = Math.min(o.v + liLen, bufLen);

		var cnt = Math.abs(ri16());
		var recs = [];
		for (var i = 0; i < cnt; i++) {
			if (o.v + 18 > bufLen) break; // not enough data for a layer record
			var top = ri32(), left = ri32(), bottom = ri32(), right = ri32();
			var chCnt = ru16();
			if (chCnt > 56) { chCnt = 0; } // sanity check
			var chInfo = [];
			for (var c = 0; c < chCnt; c++) {
				if (o.v + 6 > bufLen) break;
				chInfo.push({ id: ri16(), len: ru32() });
			}
			if (o.v + 12 > bufLen) break;
			skip(4); // blend sig
			skip(4); // blend mode
			var opacity = r8(); r8(); var flags = r8(); r8();
			var extraLen = ru32();
			var extraEnd = Math.min(o.v + extraLen, bufLen);
			// Mask data
			if (o.v + 4 <= extraEnd) { var maskLen = ru32(); skip(maskLen); }
			// Blending ranges
			if (o.v + 4 <= extraEnd) { var brLen = ru32(); skip(brLen); }
			// Pascal string name (padded to 4 bytes)
			var name = '';
			if (o.v < extraEnd) {
				var nl = r8();
				if (o.v + nl <= bufLen) {
					name = buf.toString('utf8', o.v, o.v + nl);
					o.v += nl;
				}
			}
			// Scan for lsct (layer section divider) in additional layer info
			var lsctType = -1;
			var scan = o.v;
			while (scan + 12 <= extraEnd) {
				var sig = buf.toString('ascii', scan, scan + 4);
				if (sig !== '8BIM' && sig !== '8B64') { scan++; continue; }
				var key = buf.toString('ascii', scan + 4, scan + 8);
				var dlen = buf.readUInt32BE(scan + 8);
				if (key === 'lsct' || key === 'lsdk') {
					if (scan + 16 <= bufLen) lsctType = buf.readUInt32BE(scan + 12);
					break;
				}
				scan += 12 + dlen;
				if (scan % 2 !== 0) scan++;
			}
			o.v = extraEnd;
			recs.push({ top: top, left: left, w: Math.max(0, right - left), h: Math.max(0, bottom - top),
				chInfo: chInfo, opacity: opacity, flags: flags, name: name,
				visible: !(flags & 2), lsctType: lsctType });
		}

		// Channel image data
		var layers = [];
		for (var i = 0; i < recs.length; i++) {
			var rec = recs[i];
			var isGroupMarker = rec.lsctType >= 0;
			var n = rec.w * rec.h;
			var chd = {};
			for (var c = 0; c < rec.chInfo.length; c++) {
				var chDataLen = rec.chInfo[c].len;
				var chStart = o.v;
				var chEnd = Math.min(o.v + chDataLen, bufLen);
				var cid = rec.chInfo[c].id;

				if (o.v + 2 > bufLen) { o.v = chEnd; continue; }
				var comp = ru16();

				if (isGroupMarker || n === 0 || chDataLen <= 2) {
					// Skip channel data for group markers / empty layers
					o.v = chEnd;
				} else if (comp === 0) {
					// Raw uncompressed
					var rawLen = Math.min(n, chEnd - o.v);
					chd[cid] = safeSlice(rawLen);
					o.v = chEnd; // ensure we advance to the right position
				} else if (comp === 1) {
					// RLE PackBits
					if (o.v + rec.h * 2 > bufLen) { o.v = chEnd; continue; }
					var slc = [];
					for (var y = 0; y < rec.h; y++) slc.push(ru16());
					var out = Buffer.alloc(n);
					var ui = 0;
					for (var y = 0; y < rec.h; y++) {
						var rowEnd = Math.min(o.v + slc[y], chEnd, bufLen);
						while (o.v < rowEnd && ui < n) {
							if (o.v >= bufLen) break;
							var b = buf.readInt8(o.v++);
							if (b >= 0) {
								var copyLen = Math.min(b + 1, n - ui, bufLen - o.v);
								if (copyLen > 0) { buf.copy(out, ui, o.v, o.v + copyLen); o.v += copyLen; ui += copyLen; }
							} else if (b > -128) {
								if (o.v < bufLen) {
									var vl = buf.readUInt8(o.v++);
									var fillLen = Math.min(1 - b, n - ui);
									out.fill(vl, ui, ui + fillLen);
									ui += fillLen;
								}
							}
						}
						o.v = rowEnd;
					}
					chd[cid] = out;
					o.v = chEnd; // ensure correct position
				} else {
					// Unknown compression: skip using channel length
					o.v = chEnd;
					chd[cid] = Buffer.alloc(n);
				}
			}
			if (isGroupMarker || n === 0) continue;
			var R = chd[0] || Buffer.alloc(n); var G = chd[1] || Buffer.alloc(n);
			var B = chd[2] || Buffer.alloc(n); var A = chd[-1] || Buffer.alloc(n, 255);
			var rgba = new Uint8ClampedArray(n * 4);
			for (var p = 0; p < n; p++) {
				rgba[p * 4] = R[p]; rgba[p * 4 + 1] = G[p]; rgba[p * 4 + 2] = B[p]; rgba[p * 4 + 3] = A[p];
			}
			layers.push({ name: rec.name, left: rec.left, top: rec.top, w: rec.w, h: rec.h,
				opacity: Math.round(rec.opacity * 100 / 255), visible: rec.visible, rgba: rgba });
		}
		return { width: w, height: h, layers: layers };
	}

	// ---- Edit All Layers in Photoshop ----

	var psdEditState = null; // { path, pollInterval, texUUID }
	var DEFAULT_PS_PATH = 'C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Photoshop.exe';

	function getPhotoshopPath() {
		var saved = localStorage.getItem('lmp_photoshop_path');
		if (saved) return saved;
		return DEFAULT_PS_PATH;
	}

	function setPhotoshopPath(p) {
		localStorage.setItem('lmp_photoshop_path', p);
	}

	function openFileInPhotoshop(filePath, callback) {
		var psPath = getPhotoshopPath();
		var cp = require('child_process');
		// On Windows, just execFile Photoshop directly
		cp.execFile(psPath, [filePath], function (err) {
			if (err) console.warn('LMP: Photoshop exec:', err.message);
		});
		if (callback) callback(true);
	}

	function configurePhotoshopPath() {
		var current = getPhotoshopPath();
		var dialog = new Dialog({
			id: 'lmp_ps_config',
			title: 'Photoshop Configuration',
			form: {
				ps_path: { label: 'Photoshop Path', type: 'text', value: current },
				info: { type: 'info', text: 'Default: ' + DEFAULT_PS_PATH }
			},
			buttons: ['dialog.confirm', 'Browse...', 'dialog.cancel'],
			onButton: function (idx) {
				if (idx === 1) {
					// Browse button
					Blockbench.import({
						extensions: ['exe'],
						type: 'Locate Photoshop.exe',
						readtype: 'none',
						resource_id: 'lmp_photoshop_path',
						startpath: 'C:\\Program Files\\Adobe'
					}, function (files) {
						if (files && files.length > 0) {
							dialog.setFormValues({ ps_path: files[0].path });
						}
					});
					return false; // keep dialog open
				}
			},
			onConfirm: function (formData) {
				if (formData.ps_path && formData.ps_path.trim()) {
					setPhotoshopPath(formData.ps_path.trim());
					Blockbench.showQuickMessage('Photoshop path saved', 1500);
				}
			}
		});
		dialog.show();
	}

	function editAllLayersExternal() {
		var tex = getSelectedTexture();
		if (!tex || !tex.layers_enabled || tex.layers.length === 0) {
			Blockbench.showQuickMessage('No layers to export', 1500);
			return;
		}

		// If already editing, reopen
		if (psdEditState && psdEditState.texUUID === tex.uuid) {
			openFileInPhotoshop(psdEditState.path);
			Blockbench.showQuickMessage('Reopened PSD in Photoshop', 1500);
			return;
		}

		// Stop previous edit if any
		stopPsdEdit();

		var fs = require('fs');
		var path = require('path');
		var os = require('os');
		var tmpDir = path.join(os.tmpdir(), 'blockbench_lmp');
		try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (e) {}

		var td = getTexData();
		var groupInfo = {
			treeOrder: td.treeOrder.slice(),
			groups: JSON.parse(JSON.stringify(td.groups))
		};

		var psdBuf;
		try {
			psdBuf = buildPSD(tex.layers, tex.width, tex.height, groupInfo);
		} catch (e) {
			console.error('LMP: buildPSD failed:', e);
			Blockbench.showQuickMessage('Error building PSD: ' + e.message, 3000);
			return;
		}
		var safeName = (tex.name || 'texture').replace(/[^a-zA-Z0-9_-]/g, '_');
		var tmpFile = path.join(tmpDir, safeName + '_' + tex.uuid.slice(0, 8) + '.psd');
		try {
			fs.writeFileSync(tmpFile, psdBuf);
		} catch (e) {
			console.error('LMP: Failed to write PSD:', e);
			Blockbench.showQuickMessage('Error writing PSD: ' + e.message, 3000);
			return;
		}

		console.log('LMP: PSD written to', tmpFile, '(' + psdBuf.length + ' bytes)');

		// Start polling immediately, then open Photoshop
		var lastMtime = Date.now();
		var poll = setInterval(function () {
			try {
				// Stop if texture was deleted
				if (!Texture.all.find(function (t) { return t.uuid === psdEditState.texUUID; })) {
					stopPsdEdit();
					return;
				}
				var mtime = fs.statSync(tmpFile).mtimeMs;
				if (mtime > lastMtime) {
					lastMtime = mtime;
					reimportPsdEdit(tmpFile);
				}
			} catch (e) { stopPsdEdit(); }
		}, 800);

		psdEditState = { path: tmpFile, pollInterval: poll, texUUID: tex.uuid };
		updatePanel();

		// Launch Photoshop
		openFileInPhotoshop(tmpFile);
		Blockbench.showQuickMessage('All layers exported to PSD. Save in Photoshop to sync back.', 3000);
	}

	function reimportPsdEdit(filePath) {
		if (!psdEditState) return;
		var tex = Texture.all.find(function (t) { return t.uuid === psdEditState.texUUID; });
		if (!tex || !tex.layers_enabled) return;

		try {
			var fs = require('fs');
			var psdBuf = fs.readFileSync(filePath);
			var parsed = parsePSD(psdBuf);

			// Match layers by index
			var count = Math.min(parsed.layers.length, tex.layers.length);
			for (var i = 0; i < count; i++) {
				var pl = parsed.layers[i];
				var tl = tex.layers[i];
				// Resize canvas if needed
				if (tl.canvas.width !== pl.w || tl.canvas.height !== pl.h) {
					tl.setSize(pl.w, pl.h);
				}
				var imgData = new ImageData(pl.rgba, pl.w, pl.h);
				tl.ctx.clearRect(0, 0, pl.w, pl.h);
				tl.ctx.putImageData(imgData, 0, 0);
				if (pl.opacity != null) tl.opacity = pl.opacity;
				tl.visible = pl.visible;
				if (pl.name) tl.name = pl.name;
				if (pl.left != null) tl.offset = [pl.left, pl.top];
			}

			// Add new layers from PSD if count increased
			for (var i = count; i < parsed.layers.length; i++) {
				var pl = parsed.layers[i];
				var nl = new TextureLayer({ name: pl.name || 'Layer ' + (i + 1) }, tex);
				nl.setSize(pl.w, pl.h);
				nl.ctx.putImageData(new ImageData(pl.rgba, pl.w, pl.h), 0, 0);
				if (pl.opacity != null) nl.opacity = pl.opacity;
				nl.visible = pl.visible;
				if (pl.left != null) nl.offset = [pl.left, pl.top];
				nl.addForEditing();
				_treeOrder().push(nl.uuid);
			}

			tex.updateLayerChanges(true);
			updatePanel();
			Blockbench.showQuickMessage('Layers synced from PSD (' + parsed.layers.length + ' layers)', 1500);
		} catch (e) {
			Blockbench.showQuickMessage('Error reading PSD: ' + e.message, 2000);
		}
	}

	function stopPsdEdit() {
		if (!psdEditState) return;
		if (psdEditState.pollInterval) clearInterval(psdEditState.pollInterval);
		try { require('fs').unlinkSync(psdEditState.path); } catch (e) {}
		psdEditState = null;
		updatePanel();
	}

	function isPsdEditing() {
		var tex = getSelectedTexture();
		return psdEditState && tex && psdEditState.texUUID === tex.uuid;
	}

	// ---- Mirror Operations ----

	function mirrorLayerH(layer) {
		if (!layer || isLayerLocked(layer)) return;
		var tex = getSelectedTexture();
		if (!tex) return;
		var w = layer.canvas.width, h = layer.canvas.height;
		var tmp = document.createElement('canvas');
		tmp.width = w; tmp.height = h;
		var tctx = tmp.getContext('2d');
		tctx.drawImage(layer.canvas, 0, 0);
		layer.ctx.clearRect(0, 0, w, h);
		layer.ctx.save();
		layer.ctx.translate(w, 0);
		layer.ctx.scale(-1, 1);
		layer.ctx.drawImage(tmp, 0, 0);
		layer.ctx.restore();
		tex.updateLayerChanges(true);
		updatePanel();
	}

	function mirrorLayerV(layer) {
		if (!layer || isLayerLocked(layer)) return;
		var tex = getSelectedTexture();
		if (!tex) return;
		var w = layer.canvas.width, h = layer.canvas.height;
		var tmp = document.createElement('canvas');
		tmp.width = w; tmp.height = h;
		var tctx = tmp.getContext('2d');
		tctx.drawImage(layer.canvas, 0, 0);
		layer.ctx.clearRect(0, 0, w, h);
		layer.ctx.save();
		layer.ctx.translate(0, h);
		layer.ctx.scale(1, -1);
		layer.ctx.drawImage(tmp, 0, 0);
		layer.ctx.restore();
		tex.updateLayerChanges(true);
		updatePanel();
	}

	// ---- Layer Preview Thumbnail ----

	function getLayerPreviewDataURL(layer) {
		if (!layer || !layer.canvas) return '';
		try {
			var size = 28;
			var tmp = document.createElement('canvas');
			tmp.width = size; tmp.height = size;
			var tctx = tmp.getContext('2d');
			// Draw checkerboard background for transparency
			tctx.fillStyle = '#888';
			tctx.fillRect(0, 0, size, size);
			tctx.fillStyle = '#555';
			for (var y = 0; y < size; y += 4) {
				for (var x = 0; x < size; x += 4) {
					if ((x / 4 + y / 4) % 2 === 0) tctx.fillRect(x, y, 4, 4);
				}
			}
			// Scale layer to fit
			var sw = layer.canvas.width, sh = layer.canvas.height;
			if (sw > 0 && sh > 0) {
				var scale = Math.min(size / sw, size / sh);
				var dw = sw * scale, dh = sh * scale;
				var dx = (size - dw) / 2, dy = (size - dh) / 2;
				tctx.drawImage(layer.canvas, 0, 0, sw, sh, dx, dy, dw, dh);
			}
			return tmp.toDataURL('image/png');
		} catch (e) {
			return '';
		}
	}

	// ---- Filter Operations ----

	// Pure filter: applies filter to an ImageData in-place (no layer/texture side effects)
	function applyFilterToImageData(filterName, imageData, width, height) {
		const data = imageData.data;

		switch (filterName) {
			case 'grayscale':
				for (let i = 0; i < data.length; i += 4) {
					const avg = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
					data[i] = avg;
					data[i + 1] = avg;
					data[i + 2] = avg;
				}
				break;

			case 'invert':
				for (let i = 0; i < data.length; i += 4) {
					data[i] = 255 - data[i];
					data[i + 1] = 255 - data[i + 1];
					data[i + 2] = 255 - data[i + 2];
				}
				break;

			case 'brightness_up':
				for (let i = 0; i < data.length; i += 4) {
					data[i] = Math.min(255, data[i] + 30);
					data[i + 1] = Math.min(255, data[i + 1] + 30);
					data[i + 2] = Math.min(255, data[i + 2] + 30);
				}
				break;

			case 'brightness_down':
				for (let i = 0; i < data.length; i += 4) {
					data[i] = Math.max(0, data[i] - 30);
					data[i + 1] = Math.max(0, data[i + 1] - 30);
					data[i + 2] = Math.max(0, data[i + 2] - 30);
				}
				break;

			case 'contrast': {
				const factor = (259 * (80 + 255)) / (255 * (259 - 80));
				for (let i = 0; i < data.length; i += 4) {
					data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128));
					data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128));
					data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128));
				}
				break;
			}

			case 'sepia':
				for (let i = 0; i < data.length; i += 4) {
					const r = data[i], g = data[i + 1], b = data[i + 2];
					data[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
					data[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
					data[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
				}
				break;

			case 'blur':
				applyBoxBlur(imageData, width, height, 1);
				break;

			case 'sharpen':
				applySharpen(imageData, width, height);
				break;
		}
	}

	// Entry point: adds a filter non-destructively to the selected layer
	function applyFilter(filterName) {
		const tex = getSelectedTexture();
		const layer = getSelectedLayer();
		if (!tex || !layer) {
			Blockbench.showQuickMessage('No layer selected', 1500);
			return;
		}
		if (isLayerLocked(layer)) {
			Blockbench.showQuickMessage('Layer is locked', 1500);
			return;
		}
		addFilterToStack(layer, filterName);
	}

	function applyBoxBlur(imageData, width, height, radius) {
		const data = imageData.data;
		const copy = new Uint8ClampedArray(data);
		const size = (radius * 2 + 1) * (radius * 2 + 1);

		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				let r = 0, g = 0, b = 0, a = 0;
				for (let ky = -radius; ky <= radius; ky++) {
					for (let kx = -radius; kx <= radius; kx++) {
						const px = Math.min(width - 1, Math.max(0, x + kx));
						const py = Math.min(height - 1, Math.max(0, y + ky));
						const idx = (py * width + px) * 4;
						r += copy[idx];
						g += copy[idx + 1];
						b += copy[idx + 2];
						a += copy[idx + 3];
					}
				}
				const idx = (y * width + x) * 4;
				data[idx] = r / size;
				data[idx + 1] = g / size;
				data[idx + 2] = b / size;
				data[idx + 3] = a / size;
			}
		}
	}

	function applySharpen(imageData, width, height) {
		const data = imageData.data;
		const copy = new Uint8ClampedArray(data);
		// Sharpen kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0]
		const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

		for (let y = 1; y < height - 1; y++) {
			for (let x = 1; x < width - 1; x++) {
				for (let c = 0; c < 3; c++) {
					let val = 0;
					for (let ky = -1; ky <= 1; ky++) {
						for (let kx = -1; kx <= 1; kx++) {
							const idx = ((y + ky) * width + (x + kx)) * 4 + c;
							val += copy[idx] * kernel[(ky + 1) * 3 + (kx + 1)];
						}
					}
					const idx = (y * width + x) * 4 + c;
					data[idx] = Math.min(255, Math.max(0, val));
				}
			}
		}
	}

	// ---- Persistence (save/load into .bbmodel) ----

	function serializeLmpData() {
		var perTex = {};
		for (var texUUID in perTextureData) {
			var td = perTextureData[texUUID];
			var hasGroups = Object.keys(td.groups).length > 0;
			var hasLocks = td.locks.size > 0;
			var hasLayerStates = false;
			var tex = Texture.all.find(function(t) { return t.uuid === texUUID; });
			if (!tex) continue;

			// Check if we need to save layer-specific data
			if (tex.layers_enabled) {
				for (var i = 0; i < td.treeOrder.length; i++) {
					var entry = td.treeOrder[i];
					if (entry.indexOf('group:') === 0) continue;
					var idx = findLayerIndexByUUID(entry);
					if (idx !== -1) {
						var layer = tex.layers[idx];
						var hasNonDefault = layer.visible === false ||
								layer.offset ||
								layer.blend_mode !== 'default' ||
								layer.locked;
								if (hasNonDefault) {
									hasLayerStates = true;
									break;
									}
					}
				}
			}

			if (hasGroups || hasLocks || td.treeOrder.length > 0 || hasLayerStates) {
				perTex[texUUID] = {
					groups: JSON.parse(JSON.stringify(td.groups)),
					treeOrder: td.treeOrder.slice(),
					locks: Array.from(td.locks),
					groupOpacities: JSON.parse(JSON.stringify(td.groupOpacities || {})),
					// Save layer-specific states (lock, opacity, visible, blend mode, offset)
					layerStates: (function () {
						var out = {};
						for (var i = 0; i < tex.layers.length; i++) {
							var layer = tex.layers[i];
							var visibleState = layer.visible === false ? 'hidden' : null;
							var opacityState = layer.opacity !== 100 ? layer.opacity : null;
							var blendModeState = layer.blend_mode !== 'default' ? layer.blend_mode : null;
							var offsetState = layer.offset && (layer.offset[0] !== 0 || layer.offset[1] !== 0) ? layer.offset : null;
							var lockedState = layer.locked ? true : null;

							if (visibleState || opacityState || blendModeState || offsetState || lockedState) {
								out[layer.uuid] = {
									visible: visibleState,
									opacity: opacityState,
									blendMode: blendModeState,
									offset: offsetState,
									locked: lockedState,
								};
							}
						}
						return out;
					})(),
				};
			}
		}
		return {
			perTexture: perTex,
			filters: (function () {
				var out = {};
				for (var uuid in layerFilterStacks) {
					var stack = layerFilterStacks[uuid];
					if (stack.filters.length > 0) {
						out[uuid] = stack.filters.map(function (f) {
							return { name: f.name, enabled: f.enabled, intensity: f.intensity };
						});
					}
				}
				return out;
			})(),
			masks: (function () {
				var out = {};
				for (var uuid in layerMasks) {
					var m = layerMasks[uuid];
					if (m && m.canvas) {
						out[uuid] = {
							data: m.canvas.toDataURL('image/png'),
							enabled: m.enabled,
						};
					}
				}
				return out;
			})(),
			groupMasks: (function () {
				var out = {};
				for (var name in groupMasks) {
					var m = groupMasks[name];
					if (m && m.canvas) {
						out[name] = {
							data: m.canvas.toDataURL('image/png'),
							enabled: m.enabled,
						};
					}
				}
				return out;
			})(),
		};
	}

	function clearLmpData() {
		_invalidateGroupCache();
		for (var key in perTextureData) delete perTextureData[key];
		for (var key in layerFilterStacks) delete layerFilterStacks[key];
		for (var key in layerMasks) delete layerMasks[key];
		for (var key in groupMasks) delete groupMasks[key];
		filterIdCounter = 0;
	}

	function _loadTexDataFromSrc(td, src) {
		_invalidateGroupCache();
		// Clear existing data first to ensure clean restore from saved state
		td.groups = {};
		td.treeOrder = [];
		td.locks = new Set();
		td.groupOpacities = {};

		if (src.groups) {
			for (var name in src.groups) {
				td.groups[name] = src.groups[name].slice();
			}
		}
		if (src.treeOrder && Array.isArray(src.treeOrder)) {
			// New format: unified tree order - use directly instead of pushing
			td.treeOrder = src.treeOrder.slice();
		} else if (src.groupOrder && Array.isArray(src.groupOrder)) {
			// Legacy format: convert groupOrder to treeOrder (groups only)
			src.groupOrder.forEach(function (n) {
				if (td.groups[n] !== undefined) td.treeOrder.push('group:' + n);
			});
		}
		// Ensure all groups are in the treeOrder
		for (var name in td.groups) {
			if (td.treeOrder.indexOf('group:' + name) === -1) td.treeOrder.push('group:' + name);
		}
		if (src.locks && Array.isArray(src.locks)) {
			src.locks.forEach(function (uuid) { td.locks.add(uuid); });
		}
		if (src.groupOpacities) {
			for (var name in src.groupOpacities) {
				td.groupOpacities[name] = src.groupOpacities[name];
			}
		}
	}

	function deserializeLmpData(data) {
		clearLmpData();
		if (!data) return;

		if (data.perTexture) {
			// New per-texture format
			for (var texUUID in data.perTexture) {
				_loadTexDataFromSrc(getTexData(texUUID), data.perTexture[texUUID]);
			}
		} else if (data.groups) {
			// Legacy flat format - assign to current/first texture
			var tex = getSelectedTexture();
			if (tex) {
				_loadTexDataFromSrc(getTexData(tex.uuid), data);
			}
		}

		if (data.filters) {
			for (var uuid in data.filters) {
				var stack = getFilterStack(uuid);
				data.filters[uuid].forEach(function (f) {
					stack.filters.push({
						id: ++filterIdCounter,
						name: f.name,
						enabled: f.enabled !== false,
						intensity: f.intensity != null ? f.intensity : 100,
					});
				});
			}
		}

		// Restore layer masks
		if (data.masks) {
			for (var uuid in data.masks) {
				(function (uid, mData) {
					var img = new Image();
					img.onload = function () {
						var m = createCanvas(img.width, img.height);
						m.ctx.drawImage(img, 0, 0);
						layerMasks[uid] = { canvas: m.canvas, ctx: m.ctx, enabled: mData.enabled !== false, original: null };
						// Re-apply mask after load
						var layer = findLayerByUUID(uid);
						if (layer) {
							setTimeout(function () { applyMaskToLayer(layer); }, 300);
						}
						updatePanel();
					};
					img.onerror = function () {
						console.warn('LMP: Failed to load layer mask for ' + uid);
					};
					img.src = mData.data;
				})(uuid, data.masks[uuid]);
			}
		}

		// Restore group masks
		if (data.groupMasks) {
			for (var name in data.groupMasks) {
				(function (gName, mData) {
					var img = new Image();
					img.onload = function () {
						var m = createCanvas(img.width, img.height);
						m.ctx.drawImage(img, 0, 0);
						groupMasks[gName] = { canvas: m.canvas, ctx: m.ctx, enabled: mData.enabled !== false };
						// Re-apply to layers in this group
						var grp = _groups()[gName];
						if (grp) {
							grp.forEach(function (uuid) {
								var layer = findLayerByUUID(uuid);
								if (layer) {
									setTimeout(function () { applyMaskToLayer(layer); }, 400);
								}
							});
						}
						updatePanel();
					};
					img.onerror = function () {
						console.warn('LMP: Failed to load group mask for ' + gName);
					};
					img.src = mData.data;
				})(name, data.groupMasks[name]);
			}
		}

		// Restore layer-specific states (visible, opacity, blend mode, offset, locked)
		if (data.perTexture) {
			for (var texUUID in data.perTexture) {
				var layerStates = data.perTexture[texUUID].layerStates || {};
				if (Object.keys(layerStates).length > 0) {
					// Wait for layers to be synced, then apply states
					setTimeout(function () {
						var tex = getSelectedTexture();
						if (!tex || !tex.layers_enabled) return;
						for (var uuid in layerStates) {
							var state = layerStates[uuid];
							if (state) {
								var layer = findLayerByUUID(uuid);
								if (layer) {
									if (state.visible === 'hidden') {
										layer.visible = false;
									} else if (state.visible) {
										layer.visible = true;
									}
									if (state.opacity !== undefined) {
										layer.opacity = state.opacity;
									}
									if (state.blendMode) {
										layer.blend_mode = state.blendMode;
									}
									if (state.offset) {
										layer.offset = state.offset;
									}
									if (state.locked !== undefined) {
										layer.locked = state.locked;
									}
								}
							}
						}
						tex.updateLayerChanges(true);
						updatePanel();
					}, 100);
				}
			}
		}

		// Defer cleanup + sync to allow textures to finish loading
		setTimeout(function () {
			// Clean up stale references for all loaded textures
			for (var texUUID in perTextureData) {
				var tex = Texture.all.find(function (t) { return t.uuid === texUUID; });
				if (tex) cleanupStaleRefs(tex);
			}
			syncLayerOrder();
		}, 250);
		updatePanel();
	}

	// Reapply filter stacks after project is fully loaded
	function reapplyAllFilterStacks() {
		var tex = getSelectedTexture();
		if (!tex || !tex.layers_enabled) return;
		tex.layers.forEach(function (layer) {
			var stack = layerFilterStacks[layer.uuid];
			if (stack && stack.filters.length > 0 && !stack.original) {
				snapshotOriginal(layer);
				recomputeFilters(layer);
			}
		});
	}

	// ---- Panel UI ----

	function _lmpStorageKey() {
		try {
			if (Project && (Project.save_path || Project.name)) {
				return 'lmp_state_' + (Project.save_path || Project.name);
			}
		} catch (e) {}
		return null;
	}

	function saveLmpToLocalStorage() {
		if (_restoring) return; // Don't save during restore
		if (maskEditMode.active) return; // Don't save while canvas is swapped
		var tex = getSelectedTexture();
		if (!tex || !tex.layers_enabled) return; // No project/texture open
		var key = _lmpStorageKey();
		if (!key) return;
		try {
			var data = serializeLmpData();
			// Only save if there's something meaningful
			if (data.perTexture && Object.keys(data.perTexture).length > 0) {
				localStorage.setItem(key, JSON.stringify(data));
			}
		} catch (e) {
			console.warn('LMP: localStorage save failed:', e.message);
		}
	}

	function restoreLmpFromLocalStorage() {
		var key = _lmpStorageKey();
		if (!key) return false;
		try {
			var raw = localStorage.getItem(key);
			if (raw) {
				var data = JSON.parse(raw);
				deserializeLmpData(data);
				setTimeout(reapplyAllFilterStacks, 200);
				return true;
			}
		} catch (e) {
			console.warn('LMP: localStorage restore failed:', e.message);
		}
		return false;
	}

	var _saveDebounce = null;
	function updatePanel() {
		if (layerPanel && layerPanel.inside_vue) {
			layerPanel.inside_vue.tick++;
		}
		// Debounced auto-save to localStorage
		if (_saveDebounce) clearTimeout(_saveDebounce);
		_saveDebounce = setTimeout(saveLmpToLocalStorage, 300);
	}

	// Reverse-index cache: uuid → groupName (rebuilt on demand)
	var _groupRevCache = null;
	var _groupRevCacheTexUUID = null;

	function _invalidateGroupCache() { _groupRevCache = null; }

	function _buildGroupRevCache() {
		var tex = getSelectedTexture();
		var texUUID = tex ? tex.uuid : null;
		if (_groupRevCache && _groupRevCacheTexUUID === texUUID) return _groupRevCache;
		_groupRevCache = {};
		_groupRevCacheTexUUID = texUUID;
		var groups = _groups();
		for (var name in groups) {
			var members = groups[name];
			for (var i = 0; i < members.length; i++) {
				_groupRevCache[members[i]] = name;
			}
		}
		return _groupRevCache;
	}

	function getLayerGroupName(uuid) {
		return _buildGroupRevCache()[uuid] || null;
	}

	function buildPanelComponent() {
		return {
			template: '\
				<div class="layer-manager-pro">\
					<div class="lmp-toolbar">\
						<button @click="addLayer" title="Add Layer"><i class="material-icons">add</i></button>\
						<button @click="duplicateLayer" title="Duplicate Layer"><i class="material-icons">content_copy</i></button>\
						<button @click="importImage" title="Import Image as Layer"><i class="material-icons">image</i></button>\
						<button @click="mergeVisible" title="Merge Visible"><i class="material-icons">call_merge</i></button>\
						<button v-if="multiCount >= 2" @click="mergeSelected" :title="\'Merge \' + multiCount + \' Selected\'" class="lmp-btn-active"><i class="material-icons">merge</i></button>\
						<button @click="flattenAll" title="Flatten All"><i class="material-icons">layers_clear</i></button>\
						<button @click="createGroup" title="Create Group"><i class="material-icons">create_new_folder</i></button>\
						<button @click="editAllInPS" :title="psdLinked ? \'Reopen PSD in Photoshop\' : \'Edit All Layers in Photoshop\'" :class="{ \'lmp-btn-active\': psdLinked }"><i class="material-icons">photo_library</i></button>\
						<button v-if="psdLinked" @click="stopPS" title="Stop Photoshop Link" class="lmp-btn-active"><i class="material-icons">link_off</i></button>\
						<button @click="configPS" title="Configure Photoshop Path"><i class="material-icons">settings</i></button>\
					</div>\
					\
					<div v-if="hasTexture && hasLayers" class="lmp-controls">\
						<div class="lmp-control-row">\
							<label>Opacity</label>\
							<input type="range" min="0" max="100" step="1" :value="currentOpacity" @input="setOpacity($event)" />\
							<span>{{ Math.round(currentOpacity) }}%</span>\
						</div>\
						<div class="lmp-control-row">\
							<label>Blend</label>\
							<select :value="currentBlendMode" @change="setBlendMode($event)">\
								<option value="default">Default</option>\
								<option value="set_opacity">Set Opacity</option>\
								<option value="color">Color</option>\
								<option value="multiply">Multiply</option>\
								<option value="add">Add</option>\
								<option value="screen">Screen</option>\
								<option value="difference">Difference</option>\
							</select>\
						</div>\
						<div class="lmp-control-row">\
							<label>Filter</label>\
							<select @change="onApplyFilter($event)">\
								<option value="">-- Apply Filter --</option>\
								<option value="grayscale">Grayscale</option>\
								<option value="invert">Invert</option>\
								<option value="brightness_up">Brightness +</option>\
								<option value="brightness_down">Brightness -</option>\
								<option value="contrast">Contrast</option>\
								<option value="sepia">Sepia</option>\
								<option value="blur">Blur</option>\
								<option value="sharpen">Sharpen</option>\
							</select>\
						</div>\
					</div>\
					\
					<div v-if="multiCount >= 1" class="lmp-multi-bar">\
						<span>{{ multiCount }} selected</span>\
						<button @click="mergeSelected" v-if="multiCount >= 2" title="Merge Selected"><i class="material-icons">merge</i> Merge</button>\
						<button @click="clearMultiSelect" title="Clear Selection"><i class="material-icons">close</i></button>\
					</div>\
					<div v-if="maskEditing" class="lmp-mask-edit-bar" @click="exitMaskEditMode">\
						<i class="material-icons">brush</i>\
						<span>Editing Mask - White = visible / Black = hidden</span>\
						<i class="material-icons">close</i>\
					</div>\
					<div v-if="hasTexture && hasLayers" class="lmp-layer-list">\
						<template v-for="item in layerTree">\
							\
							<div v-if="item.type === \'group\'" :key="\'g-\' + item.name" class="lmp-group" :class="{ collapsed: isCollapsed(item.name) }">\
								<div class="lmp-group-header"\
									draggable="true"\
									@click="toggleCollapse(item.name)"\
									@contextmenu.prevent.stop="showGroupContextMenu($event, item.name)"\
									@dragstart.stop="startDragGroup($event, item.name)"\
									@dragover.prevent.stop="dragOverGroup($event, item.name)"\
									@dragleave="onDragLeave($event)"\
									@drop.prevent.stop="dropOnGroup($event, item.name)"\
									@dragend="dragEnd"\
									:class="{ \'lmp-drop-above\': dropId === \'group:\' + item.name && dropPos === \'before\', \'lmp-drop-below\': dropId === \'group:\' + item.name && dropPos === \'after\', \'lmp-drop-inside\': dropId === \'group:\' + item.name && dropPos === \'inside\' }">\
									<i class="material-icons lmp-drag-handle" @mousedown.stop>drag_indicator</i>\
									<i class="material-icons lmp-chevron">{{ isCollapsed(item.name) ? "chevron_right" : "expand_more" }}</i>\
									<i class="material-icons lmp-folder-icon">{{ isCollapsed(item.name) ? "folder" : "folder_open" }}</i>\
									<span class="lmp-group-name" @dblclick.stop="renameGroup(item.name)">{{ item.name }}</span>\
									<span class="lmp-group-count">{{ item.layers.length }}</span>\
									<button @click.stop="toggleGroupVis(item.name)" :title="item.allVisible ? \'Hide group\' : \'Show group\'" class="lmp-grp-btn">\
										<i class="material-icons">{{ item.allVisible ? "visibility" : "visibility_off" }}</i>\
									</button>\
									<button @click.stop="toggleGroupLock(item.name)" :title="item.allLocked ? \'Unlock group\' : \'Lock group\'" class="lmp-grp-btn">\
										<i class="material-icons">{{ item.allLocked ? "lock" : "lock_open" }}</i>\
									</button>\
									<button v-if="hasGroupMask(item.name)" class="lmp-grp-btn lmp-mask-btn" :class="{ \'lmp-mask-disabled\': !isGroupMaskEnabled(item.name) }" @click.stop="toggleGrpMask(item.name)" title="Toggle group mask">\
										<img class="lmp-mask-thumb-sm" :src="getGroupMaskPreview(item.name)" />\
									</button>\
									<button @click.stop="deleteGroup(item.name)" title="Delete group" class="lmp-grp-btn">\
										<i class="material-icons">close</i>\
									</button>\
								</div>\
								<div v-if="!isCollapsed(item.name)" class="lmp-group-opacity">\
									<label>Opacity</label>\
									<input type="range" min="0" max="100" step="1" :value="getGroupOpacity(item.name)" @input="setGroupOpacity(item.name, $event)" />\
									<span>{{ getGroupOpacity(item.name) }}%</span>\
								</div>\
								<div v-if="!isCollapsed(item.name)" class="lmp-group-body"\
									@dragover.prevent.stop="dragOverGroupBody($event, item.name)"\
									@drop.prevent.stop="dropOnGroupBody($event, item.name)">\
									<div v-for="(layer, li) in item.layers" :key="layer.uuid"\
										class="lmp-layer-item lmp-grouped"\
										:class="{ selected: isSelected(layer), \'multi-selected\': isMultiSelected(layer), locked: isLocked(layer), \'mask-editing\': isMaskEditing(layer), \'lmp-drop-above\': dropId === layer.uuid && dropPos === \'before\', \'lmp-drop-below\': dropId === layer.uuid && dropPos === \'after\' }"\
										draggable="true"\
										@dragstart.stop="startDragLayer($event, layer.uuid, item.name)"\
										@dragover.prevent.stop="dragOverGroupedLayer($event, layer.uuid)"\
										@dragleave="onDragLeave($event)"\
										@drop.prevent.stop="dropOnGroupedLayer($event, item.name, layer.uuid)"\
										@dragend="dragEnd"\
										@click="selectLayer(layer, $event)"\
										@contextmenu.prevent.stop="showLayerContextMenu($event, layer)">\
										<i class="material-icons lmp-drag-handle" @mousedown.stop>drag_indicator</i>\
										<span class="lmp-preview-wrap"><img class="lmp-layer-preview" :src="getPreview(layer)" draggable="false" /><i v-if="isExtEdited(layer)" class="material-icons lmp-ext-badge" title="Linked to external editor">link</i></span>\
										<button class="lmp-btn" @click.stop="toggleVis(layer)" :title="layer.visible ? \'Hide\' : \'Show\'">\
											<i class="material-icons">{{ layer.visible ? "visibility" : "visibility_off" }}</i>\
										</button>\
										<span class="lmp-layer-name" @dblclick.stop="renameLayer(layer)">{{ layer.name }}</span>\
										<button class="lmp-btn" @click.stop="toggleLock(layer)" :title="isLocked(layer) ? \'Unlock\' : \'Lock\'">\
											<i class="material-icons">{{ isLocked(layer) ? "lock" : "lock_open" }}</i>\
										</button>\
										<button v-if="hasMask(layer)" class="lmp-btn lmp-mask-btn" :class="{ \'lmp-mask-disabled\': !isMaskEnabled(layer) }" @click.stop="toggleMask(layer)" title="Toggle mask">\
											<img class="lmp-mask-thumb" :src="getMaskPreview(layer)" />\
										</button>\
										<button class="lmp-btn" @click.stop="removeFromGroup(item.name, layer.uuid)" title="Remove from group">\
											<i class="material-icons">logout</i>\
										</button>\
										<button class="lmp-btn lmp-btn-danger" @click.stop="deleteLayer(layer)" title="Delete">\
											<i class="material-icons">delete</i>\
										</button>\
									</div>\
									<div v-if="item.layers.length === 0" class="lmp-group-empty">Drop layers here</div>\
								</div>\
							</div>\
							\
							<div v-else :key="\'l-\' + item.layer.uuid"\
								class="lmp-layer-item"\
								:class="{ selected: isSelected(item.layer), \'multi-selected\': isMultiSelected(item.layer), locked: isLocked(item.layer), \'mask-editing\': isMaskEditing(item.layer), \'lmp-drop-above\': dropId === item.layer.uuid && dropPos === \'before\', \'lmp-drop-below\': dropId === item.layer.uuid && dropPos === \'after\' }"\
								draggable="true"\
								@dragstart="startDragLayer($event, item.layer.uuid, null)"\
								@dragover.prevent="dragOverLayer($event, item.layer.uuid)"\
								@dragleave="onDragLeave($event)"\
								@drop.prevent="dropOnLayer($event, item.layer.uuid)"\
								@dragend="dragEnd"\
								@click="selectLayer(item.layer, $event)"\
								@contextmenu.prevent.stop="showLayerContextMenu($event, item.layer)">\
								<i class="material-icons lmp-drag-handle" @mousedown.stop>drag_indicator</i>\
								<span class="lmp-preview-wrap"><img class="lmp-layer-preview" :src="getPreview(item.layer)" draggable="false" /><i v-if="isExtEdited(item.layer)" class="material-icons lmp-ext-badge" title="Linked to external editor">link</i></span>\
								<button class="lmp-btn" @click.stop="toggleVis(item.layer)" :title="item.layer.visible ? \'Hide\' : \'Show\'">\
									<i class="material-icons">{{ item.layer.visible ? "visibility" : "visibility_off" }}</i>\
								</button>\
								<span class="lmp-layer-name" @dblclick.stop="renameLayer(item.layer)">{{ item.layer.name }}</span>\
								<button class="lmp-btn" @click.stop="toggleLock(item.layer)" :title="isLocked(item.layer) ? \'Unlock\' : \'Lock\'">\
									<i class="material-icons">{{ isLocked(item.layer) ? "lock" : "lock_open" }}</i>\
								</button>\
								<button v-if="hasMask(item.layer)" class="lmp-btn lmp-mask-btn" :class="{ \'lmp-mask-disabled\': !isMaskEnabled(item.layer) }" @click.stop="toggleMask(item.layer)" title="Toggle mask">\
									<img class="lmp-mask-thumb" :src="getMaskPreview(item.layer)" />\
								</button>\
								<button class="lmp-btn lmp-btn-danger" @click.stop="deleteLayer(item.layer)" title="Delete">\
									<i class="material-icons">delete</i>\
								</button>\
							</div>\
						</template>\
					</div>\
					\
					<div v-if="hasTexture && hasLayers && selectedFilters.length > 0" class="lmp-filter-history">\
						<div class="lmp-filter-history-header" @click="filtersExpanded = !filtersExpanded">\
							<i class="material-icons lmp-chevron">{{ filtersExpanded ? "expand_more" : "chevron_right" }}</i>\
							<i class="material-icons" style="font-size:15px; opacity:0.7; color:#ab47bc;">auto_fix_high</i>\
							<span>Filters</span>\
							<span class="lmp-group-count">{{ selectedFilters.length }}</span>\
						</div>\
						<div v-if="filtersExpanded" class="lmp-filter-list">\
							<div v-for="(f, fi) in selectedFilters" :key="f.id"\
								class="lmp-filter-item"\
								:class="{ disabled: !f.enabled, \'lmp-drop-above\': dropId === \'filter:\' + f.id && dropPos === \'before\', \'lmp-drop-below\': dropId === \'filter:\' + f.id && dropPos === \'after\' }"\
								draggable="true"\
								@dragstart="startDragFilter($event, f.id)"\
								@dragover.prevent="dragOverFilter($event, f.id)"\
								@dragleave="onDragLeave($event)"\
								@drop.prevent="dropOnFilter($event, f.id)"\
								@dragend="dragEnd">\
								<i class="material-icons lmp-drag-handle" style="font-size:14px;" @mousedown.stop>drag_indicator</i>\
								<button class="lmp-btn" @click="toggleFilterEnable(f.id)" :title="f.enabled ? \'Disable\' : \'Enable\'">\
									<i class="material-icons">{{ f.enabled ? "visibility" : "visibility_off" }}</i>\
								</button>\
								<span class="lmp-filter-name">{{ filterLabel(f.name) }}</span>\
								<input type="range" class="lmp-filter-intensity" min="0" max="100" step="1" :value="f.intensity" @input="onFilterIntensity(f.id, $event)" title="Intensity" />\
								<span class="lmp-filter-pct">{{ f.intensity }}%</span>\
								<button class="lmp-btn lmp-btn-danger" @click="removeFilter(f.id)" title="Remove filter">\
									<i class="material-icons">close</i>\
								</button>\
							</div>\
						</div>\
					</div>\
					\
					<div v-else-if="!hasTexture || !hasLayers" class="lmp-empty">\
						<p v-if="!hasTexture">No texture selected.</p>\
						<p v-else>No layers. Click + to add a layer.</p>\
					</div>\
				</div>',

			data: function () {
				return {
					tick: 0,
					collapsed: {},
					filtersExpanded: true,
					dropId: null,
					dropPos: null,
				};
			},
			computed: {
				maskEditing: function () {
					this.tick;
					return maskEditMode.active;
				},
				hasTexture: function () {
					this.tick;
					return !!getSelectedTexture();
				},
				hasLayers: function () {
					this.tick;
					var tex = getSelectedTexture();
					return tex && tex.layers_enabled && tex.layers.length > 0;
				},
				groupNames: function () {
					this.tick;
					return _treeOrder().filter(function (e) { return e.indexOf('group:') === 0; })
						.map(function (e) { return e.slice(6); });
				},
				currentOpacity: function () {
					this.tick;
					var layer = getSelectedLayer();
					return layer ? layer.opacity : 100;
				},
				currentBlendMode: function () {
					this.tick;
					var layer = getSelectedLayer();
					return layer ? layer.blend_mode : 'default';
				},
				multiCount: function () {
					this.tick;
					return multiSelected.size;
				},
				psdLinked: function () {
					this.tick;
					return isPsdEditing();
				},
				selectedFilters: function () {
					this.tick;
					var layer = getSelectedLayer();
					if (!layer) return [];
					var stack = getFilterStack(layer.uuid);
					return stack.filters;
				},
				layerTree: function () {
					this.tick;
					var tex = getSelectedTexture();
					if (!tex || !tex.layers_enabled) return [];

					var allLayers = tex.layers.slice().reverse();
					var layerMap = {};
					allLayers.forEach(function (l) { layerMap[l.uuid] = l; });

					var to = _treeOrder();
					var tree = [];
					var seenUUIDs = new Set();

					for (var i = 0; i < to.length; i++) {
						var entry = to[i];
						if (entry.indexOf('group:') === 0) {
							var name = entry.slice(6);
							if (!_groups()[name]) continue;
							var groupLayers = [];
							var allVisible = true;
							var allLocked = true;
							var memberUUIDs = _groups()[name] || [];
							memberUUIDs.forEach(function (uuid) {
								var l = layerMap[uuid];
								if (l) {
									groupLayers.push(l);
									seenUUIDs.add(uuid);
									if (!l.visible) allVisible = false;
									if (!_locks().has(uuid)) allLocked = false;
								}
							});
							if (memberUUIDs.length === 0) allLocked = false;
							tree.push({
								type: 'group', name: name, layers: groupLayers, allVisible: allVisible, allLocked: allLocked,
								canUp: i > 0, canDown: i < to.length - 1,
							});
						} else {
							var l = layerMap[entry];
							if (l && !getLayerGroupName(entry)) {
								seenUUIDs.add(entry);
								tree.push({ type: 'layer', layer: l });
							}
						}
					}

					// Auto-add layers not yet tracked in treeOrder
					// Skip layers that belong to a group (even if not resolved yet)
					var allGroupedUUIDs = new Set();
					var groups = _groups();
					for (var gn in groups) {
						groups[gn].forEach(function (uid) { allGroupedUUIDs.add(uid); });
					}

					var untracked = [];
					allLayers.forEach(function (l) {
						if (!seenUUIDs.has(l.uuid) && !allGroupedUUIDs.has(l.uuid)) {
							untracked.push(l);
						}
					});
					if (untracked.length > 0) {
						// Add untracked layers to treeOrder AFTER the last existing entry
						// to preserve group positions (append instead of prepend)
						for (var u = 0; u < untracked.length; u++) {
							tree.push({ type: 'layer', layer: untracked[u] });
							to.push(untracked[u].uuid);
						}
					}

					return tree;
				},
			},
			methods: {
				addLayer: addNewLayer,
				duplicateLayer: duplicateSelectedLayer,
				importImage: importImageAsLayer,
				getPreview: function (layer) {
					this.tick; // refresh on tick
					return getLayerPreviewDataURL(layer);
				},
				isExtEdited: function (layer) {
					return isExternallyEdited(layer.uuid);
				},
				showLayerContextMenu: function (event, layer) {
					var self = this;
					var items = [
						{
							name: 'Mirror Horizontal',
							icon: 'swap_horiz',
							click: function () {
								mirrorLayerH(layer);
								self.tick++;
							}
						},
						{
							name: 'Mirror Vertical',
							icon: 'swap_vert',
							click: function () {
								mirrorLayerV(layer);
								self.tick++;
							}
						},
						'_',
						{
							name: isExternallyEdited(layer.uuid) ? 'Reopen in External Editor' : 'Edit in External Editor',
							icon: 'open_in_new',
							click: function () {
								editLayerExternal(layer);
								self.tick++;
							}
						},
						isExternallyEdited(layer.uuid) ? {
							name: 'Stop External Edit',
							icon: 'link_off',
							click: function () {
								stopExternalEdit(layer.uuid);
								Blockbench.showQuickMessage('External edit stopped', 1500);
								self.tick++;
							}
						} : null,
						'_',
						{
							name: 'Rename',
							icon: 'edit',
							click: function () {
								Blockbench.textPrompt('Rename Layer', layer.name, function (value) {
									if (value) { layer.name = value; updatePanel(); }
								});
							}
						},
						{
							name: isLayerLocked(layer) ? 'Unlock' : 'Lock',
							icon: isLayerLocked(layer) ? 'lock_open' : 'lock',
							click: function () {
								toggleLayerLock(layer);
								self.tick++;
							}
						},
						'_',
						layerMasks[layer.uuid] ? {
							name: maskEditMode.active && maskEditMode.layerUUID === layer.uuid ? 'Exit Mask Edit' : 'Edit Mask',
							icon: 'brush',
							click: function () {
								if (maskEditMode.active && maskEditMode.layerUUID === layer.uuid) {
									exitMaskEdit();
								} else {
									enterMaskEdit(layer, null);
								}
								self.tick++;
							}
						} : null,
						layerMasks[layer.uuid] ? null : {
							name: 'Add Mask',
							icon: 'gradient',
							click: function () {
								addLayerMask(layer);
								self.tick++;
							}
						},
						layerMasks[layer.uuid] ? {
							name: 'Add Mask from Black',
							icon: 'gradient',
							click: function () {
								addLayerMaskBlack(layer);
								self.tick++;
							}
						} : null,
						layerMasks[layer.uuid] ? {
							name: layerMasks[layer.uuid].enabled ? 'Disable Mask' : 'Enable Mask',
							icon: layerMasks[layer.uuid].enabled ? 'visibility_off' : 'visibility',
							click: function () {
								toggleLayerMaskEnabled(layer);
								self.tick++;
							}
						} : null,
						layerMasks[layer.uuid] ? {
							name: 'Apply Mask',
							icon: 'check_circle',
							click: function () {
								removeLayerMask(layer, true);
								self.tick++;
							}
						} : null,
						layerMasks[layer.uuid] ? {
							name: 'Delete Mask',
							icon: 'delete_forever',
							click: function () {
								removeLayerMask(layer, false);
								self.tick++;
							}
						} : null,
						layerMasks[layer.uuid] ? {
							name: 'Invert Mask',
							icon: 'invert_colors',
							click: function () {
								invertMask(layerMasks[layer.uuid]);
								applyMaskToLayer(layer);
								self.tick++;
							}
						} : null,
						'_',
						(function () {
							var otherTextures = Texture.all.filter(function (t) {
								var cur = getSelectedTexture();
								return cur && t.uuid !== cur.uuid;
							});
							if (otherTextures.length === 0) return null;
							return {
								name: 'Copy to...',
								icon: 'content_copy',
								children: otherTextures.map(function (t) {
									return {
										name: t.name || 'Texture',
										icon: 'image',
										click: function () {
											copyLayerToTexture(layer, t);
											Blockbench.showQuickMessage('Layer copied to ' + (t.name || 'texture'), 1500);
											self.tick++;
										}
									};
								})
							};
						})(),
						'_',
						{
							name: 'Merge Down',
							icon: 'vertical_align_bottom',
							click: function () {
								mergeDown();
								self.tick++;
							}
						},
						{
							name: 'Delete',
							icon: 'delete',
							click: function () {
								self.deleteLayer(layer);
							}
						}
					];
					// Add multi-select actions if applicable
					if (multiSelected.size >= 2) {
						items.push('_');
						items.push({
							name: 'Merge ' + multiSelected.size + ' Selected',
							icon: 'merge',
							click: function () {
								mergeSelectedLayers();
								self.tick++;
							}
						});
						items.push({
							name: 'Add Selected to Group',
							icon: 'create_new_folder',
							click: function () {
								var gNames = Object.keys(_groups());
								if (gNames.length === 0) {
									Blockbench.textPrompt('New Group Name', 'Group 1', function (value) {
										if (value) {
											createLayerGroup(value);
											multiSelected.forEach(function (uuid) { addLayerToGroup(value, uuid); });
											multiSelected.clear();
											updatePanel();
										}
									});
								} else {
									var menuItems = gNames.map(function (gn) {
										return {
											name: gn, icon: 'folder',
											click: function () {
												multiSelected.forEach(function (uuid) { addLayerToGroup(gn, uuid); });
												multiSelected.clear();
												syncLayerOrder();
												updatePanel();
											}
										};
									});
									menuItems.push('_');
									menuItems.push({
										name: 'New Group...', icon: 'create_new_folder',
										click: function () {
											Blockbench.textPrompt('New Group Name', 'Group 1', function (value) {
												if (value) {
													createLayerGroup(value);
													multiSelected.forEach(function (uuid) { addLayerToGroup(value, uuid); });
													multiSelected.clear();
													updatePanel();
												}
											});
										}
									});
									var gmenu = new Menu(menuItems);
									gmenu.open(event);
									return; // Don't open the main menu
								}
							}
						});
					}
					var menu = new Menu(items.filter(function (x) { return x !== null; }));
					menu.open(event);
				},
				editAllInPS: function () {
					try {
						editAllLayersExternal();
					} catch (e) {
						console.error('LMP: editAllLayersExternal error:', e);
						Blockbench.showQuickMessage('Error: ' + e.message, 3000);
					}
					this.tick++;
				},
				configPS: function () {
					configurePhotoshopPath();
				},
				stopPS: function () {
					stopPsdEdit();
					Blockbench.showQuickMessage('Photoshop link stopped', 1500);
					this.tick++;
				},
				mergeVisible: mergeVisibleLayers,
				flattenAll: flattenAllLayers,
				createGroup: function () {
					var uuids = [];
					if (multiSelected.size > 0) {
						multiSelected.forEach(function (uid) { uuids.push(uid); });
					} else {
						var sel = getSelectedLayer();
						if (sel) uuids.push(sel.uuid);
					}
					createLayerGroup(null, uuids);
				},
				selectLayer: function (layer, event) {
					// Exit mask edit mode when selecting a different layer
					if (maskEditMode.active && layer.uuid !== maskEditMode.layerUUID) {
						exitMaskEdit();
					}
					if (event && (event.ctrlKey || event.metaKey)) {
						// Toggle multi-select
						if (multiSelected.has(layer.uuid)) {
							multiSelected.delete(layer.uuid);
						} else {
							multiSelected.add(layer.uuid);
						}
						// Also add current single-selected if first multi-select
						var cur = TextureLayer.selected;
						if (cur && multiSelected.size === 1 && cur !== layer) {
							multiSelected.add(cur.uuid);
						}
						layer.select();
					} else if (event && event.shiftKey) {
						// Range select
						var tex = getSelectedTexture();
						if (tex && tex.layers_enabled) {
							var allUUIDs = this.layerTree.reduce(function (acc, item) {
								if (item.type === 'group') {
									item.layers.forEach(function (l) { acc.push(l.uuid); });
								} else {
									acc.push(item.layer.uuid);
								}
								return acc;
							}, []);
							var cur = TextureLayer.selected;
							var fromIdx = cur ? allUUIDs.indexOf(cur.uuid) : -1;
							var toIdx = allUUIDs.indexOf(layer.uuid);
							if (fromIdx !== -1 && toIdx !== -1) {
								var start = Math.min(fromIdx, toIdx);
								var end = Math.max(fromIdx, toIdx);
								for (var si = start; si <= end; si++) {
									multiSelected.add(allUUIDs[si]);
								}
							} else {
								multiSelected.add(layer.uuid);
							}
						}
						layer.select();
					} else {
						// Normal click - clear multi-select
						multiSelected.clear();
						layer.select();
					}
					this.tick++;
				},
				isSelected: function (layer) {
					return TextureLayer.selected === layer;
				},
				isMultiSelected: function (layer) {
					return multiSelected.has(layer.uuid);
				},
				mergeSelected: function () {
					mergeSelectedLayers();
					this.tick++;
				},
				clearMultiSelect: function () {
					multiSelected.clear();
					this.tick++;
				},
				isLocked: function (layer) {
					return isLayerLocked(layer);
				},
				hasMask: function (layer) {
					this.tick; // reactivity
					return !!layerMasks[layer.uuid];
				},
				isMaskEnabled: function (layer) {
					var m = layerMasks[layer.uuid];
					return m ? m.enabled : false;
				},
				toggleMask: function (layer) {
					// Click on mask thumbnail → enter edit mode (or exit if already editing)
					if (maskEditMode.active && maskEditMode.layerUUID === layer.uuid && !maskEditMode.groupName) {
						exitMaskEdit();
					} else {
						enterMaskEdit(layer, null);
					}
					this.tick++;
				},
				getMaskPreview: function (layer) {
					this.tick;
					return getMaskPreviewDataURL(layerMasks[layer.uuid]);
				},
				hasGroupMask: function (name) {
					this.tick;
					return !!groupMasks[name];
				},
				isGroupMaskEnabled: function (name) {
					var m = groupMasks[name];
					return m ? m.enabled : false;
				},
				toggleGrpMask: function (name) {
					// Click on group mask thumbnail → toggle enabled/disabled
					toggleGroupMaskEnabled(name);
					this.tick++;
				},
				isMaskEditing: function (layer) {
					this.tick;
					return maskEditMode.active && maskEditMode.layerUUID === layer.uuid;
				},
				exitMaskEditMode: function () {
					exitMaskEdit();
					this.tick++;
				},
				getGroupMaskPreview: function (name) {
					this.tick;
					return getMaskPreviewDataURL(groupMasks[name]);
				},
				isCollapsed: function (groupName) {
					return !!this.collapsed[groupName];
				},
				toggleCollapse: function (groupName) {
					this.$set(this.collapsed, groupName, !this.collapsed[groupName]);
				},
				toggleVis: function (layer) {
					var tex = getSelectedTexture();
					if (tex) Undo.initEdit({ textures: [tex] });
					layer.toggleVisibility();
					if (tex) {
						tex.updateLayerChanges(true);
						Undo.finishEdit('Toggle layer visibility');
					}
					this.tick++;
				},
				toggleLock: function (layer) {
					toggleLayerLock(layer);
					this.tick++;
				},
				deleteLayer: function (layer) {
					if (maskEditMode.active && maskEditMode.layerUUID === layer.uuid) {
						exitMaskEdit();
					}
					if (isLayerLocked(layer)) {
						Blockbench.showQuickMessage('Layer is locked', 1500);
						return;
					}
					var gn = getLayerGroupName(layer.uuid);
					if (gn) {
						var ga = _groups()[gn];
						if (ga) { var ri = ga.indexOf(layer.uuid); if (ri !== -1) ga.splice(ri, 1); }
						_invalidateGroupCache();
					}
					var ti = _treeOrder().indexOf(layer.uuid);
					if (ti !== -1) _treeOrder().splice(ti, 1);
					cleanupLayerResources(layer.uuid);
					layer.remove(true);
					var tex = getSelectedTexture();
					if (tex) tex.updateLayerChanges(true);
					this.tick++;
				},
				renameLayer: function (layer) {
					Blockbench.textPrompt('Rename Layer', layer.name, function (value) {
						if (value) {
							var tex = getSelectedTexture();
							if (tex) Undo.initEdit({ textures: [tex] });
							layer.name = value;
							if (tex) Undo.finishEdit('Rename layer');
							updatePanel();
						}
					});
				},
				renameGroup: function (oldName) {
					Blockbench.textPrompt('Rename Group', oldName, function (value) {
						if (value && value !== oldName && !_groups()[value]) {
							_groups()[value] = _groups()[oldName];
							delete _groups()[oldName];
							_invalidateGroupCache();
							// Move group mask to new name
							if (groupMasks[oldName]) {
								groupMasks[value] = groupMasks[oldName];
								delete groupMasks[oldName];
							}
							// Move group opacity to new name
							var td = getTexData();
							if (td.groupOpacities[oldName] != null) {
								td.groupOpacities[value] = td.groupOpacities[oldName];
								delete td.groupOpacities[oldName];
							}
							var oi = _treeOrder().indexOf('group:' + oldName);
							if (oi !== -1) _treeOrder()[oi] = 'group:' + value;
							updatePanel();
						}
					});
				},
				setOpacity: function (event) {
					var layer = getSelectedLayer();
					if (!layer) return;
					if (isLayerLocked(layer)) {
						Blockbench.showQuickMessage('Layer is locked', 1500);
						return;
					}
					var tex = getSelectedTexture();
					if (tex) Undo.initEdit({ textures: [tex] });
					layer.opacity = parseInt(event.target.value, 10);
					if (tex) {
						tex.updateLayerChanges(true);
						Undo.finishEdit('Change layer opacity');
					}
					this.tick++;
				},
				setBlendMode: function (event) {
					var layer = getSelectedLayer();
					if (!layer) return;
					if (isLayerLocked(layer)) {
						Blockbench.showQuickMessage('Layer is locked', 1500);
						return;
					}
					var tex = getSelectedTexture();
					if (tex) Undo.initEdit({ textures: [tex] });
					layer.blend_mode = event.target.value;
					if (tex) {
						tex.updateLayerChanges(true);
						Undo.finishEdit('Change blend mode');
					}
					this.tick++;
				},
				onApplyFilter: function (event) {
					var val = event.target.value;
					if (val) {
						applyFilter(val);
						event.target.value = '';
					}
					this.tick++;
				},
				getGroupOpacity: function (groupName) {
					this.tick;
					return getGroupOpacity(groupName);
				},
				setGroupOpacity: function (groupName, event) {
					setGroupOpacity(groupName, parseInt(event.target.value, 10));
					this.tick++;
				},
				toggleGroupVis: function (groupName) {
					toggleGroupVisibility(groupName);
					this.tick++;
				},
				toggleGroupLock: function (groupName) {
					toggleGroupLock(groupName);
					this.tick++;
				},
				deleteGroup: function (groupName) {
					deleteLayerGroup(groupName);
					if (groupMasks[groupName]) delete groupMasks[groupName];
					this.tick++;
				},
				showGroupContextMenu: function (event, groupName) {
					var self = this;
					var hasMask = !!groupMasks[groupName];
					var items = [
						{
							name: 'Rename',
							icon: 'edit',
							click: function () { self.renameGroup(groupName); }
						},
						'_',
						!hasMask ? {
							name: 'Add Group Mask (White)',
							icon: 'gradient',
							click: function () {
								addGroupMask(groupName);
								self.tick++;
							}
						} : null,
						!hasMask ? {
							name: 'Add Group Mask (Black)',
							icon: 'gradient',
							click: function () {
								addGroupMaskBlack(groupName);
								self.tick++;
							}
						} : null,
						hasMask ? {
							name: groupMasks[groupName].enabled ? 'Disable Group Mask' : 'Enable Group Mask',
							icon: groupMasks[groupName].enabled ? 'visibility_off' : 'visibility',
							click: function () {
								toggleGroupMaskEnabled(groupName);
								self.tick++;
							}
						} : null,
						hasMask ? {
							name: 'Invert Group Mask',
							icon: 'invert_colors',
							click: function () {
								invertMask(groupMasks[groupName]);
								var grp = _groups()[groupName];
								if (grp) {
									grp.forEach(function (uuid) {
										var layer = findLayerByUUID(uuid);
										if (layer) applyMaskToLayer(layer);
									});
								}
								self.tick++;
							}
						} : null,
						hasMask ? {
							name: 'Apply Group Mask',
							icon: 'check_circle',
							click: function () {
								removeGroupMask(groupName, true);
								self.tick++;
							}
						} : null,
						hasMask ? {
							name: 'Delete Group Mask',
							icon: 'delete_forever',
							click: function () {
								removeGroupMask(groupName, false);
								self.tick++;
							}
						} : null,
						'_',
						(function () {
							var otherTextures = Texture.all.filter(function (t) {
								var cur = getSelectedTexture();
								return cur && t.uuid !== cur.uuid;
							});
							if (otherTextures.length === 0) return null;
							return {
								name: 'Copy to...',
								icon: 'content_copy',
								children: otherTextures.map(function (t) {
									return {
										name: t.name || 'Texture',
										icon: 'image',
										click: function () {
											copyGroupToTexture(groupName, t);
											Blockbench.showQuickMessage('Group copied to ' + (t.name || 'texture'), 1500);
											self.tick++;
										}
									};
								})
							};
						})(),
						'_',
						{
							name: 'Delete Group',
							icon: 'delete',
							click: function () {
								self.deleteGroup(groupName);
							}
						}
					].filter(function (i) { return i !== null; });
					var menu = new Menu(items);
					menu.open(event);
				},
				removeFromGroup: function (groupName, uuid) {
					removeLayerFromGroup(groupName, uuid);
					this.tick++;
				},
				filterLabel: function (name) {
					return FILTER_LABELS[name] || name;
				},
				toggleFilterEnable: function (filterId) {
					var layer = getSelectedLayer();
					if (!layer) return;
					toggleFilterEnabled(layer.uuid, filterId);
					this.tick++;
				},
				onFilterIntensity: function (filterId, event) {
					var layer = getSelectedLayer();
					if (!layer) return;
					setFilterIntensity(layer.uuid, filterId, parseInt(event.target.value, 10));
					this.tick++;
				},
				removeFilter: function (filterId) {
					var layer = getSelectedLayer();
					if (!layer) return;
					removeFilterFromStack(layer.uuid, filterId);
					this.tick++;
				},

				// ---- Drag & Drop methods ----
				startDragLayer: function (e, uuid, sourceGroup) {
					dragInfo.type = 'layer';
					dragInfo.layerUUID = uuid;
					dragInfo.sourceGroup = sourceGroup;
					dragInfo.dragEl = e.target;
					e.dataTransfer.effectAllowed = 'move';
					e.dataTransfer.setData('text/plain', 'layer:' + uuid);
					e.target.classList.add('lmp-dragging');
				},
				startDragGroup: function (e, groupName) {
					dragInfo.type = 'group';
					dragInfo.groupName = groupName;
					dragInfo.dragEl = e.target;
					e.dataTransfer.effectAllowed = 'move';
					e.dataTransfer.setData('text/plain', 'group:' + groupName);
				},
				startDragFilter: function (e, filterId) {
					dragInfo.type = 'filter';
					dragInfo.filterId = filterId;
					dragInfo.dragEl = e.target;
					e.dataTransfer.effectAllowed = 'move';
					e.dataTransfer.setData('text/plain', 'filter:' + filterId);
					e.target.classList.add('lmp-dragging');
				},

				dragOverLayer: function (e, uuid) {
					if (dragInfo.type === 'layer') {
						if (dragInfo.layerUUID === uuid) return;
						this.dropId = uuid;
						this.dropPos = getDragPos(e, e.currentTarget);
					} else if (dragInfo.type === 'group') {
						this.dropId = uuid;
						this.dropPos = getDragPos(e, e.currentTarget);
					}
				},
				dragOverGroupedLayer: function (e, uuid) {
					if (dragInfo.type !== 'layer') return;
					if (dragInfo.layerUUID === uuid) return;
					this.dropId = uuid;
					this.dropPos = getDragPos(e, e.currentTarget);
				},
				dragOverGroup: function (e, groupName) {
					if (dragInfo.type === 'layer') {
						this.dropId = 'group:' + groupName;
						this.dropPos = getDragPos3(e, e.currentTarget);
					} else if (dragInfo.type === 'group' && dragInfo.groupName !== groupName) {
						this.dropId = 'group:' + groupName;
						this.dropPos = getDragPos(e, e.currentTarget);
					}
				},
				dragOverGroupBody: function (e, groupName) {
					if (dragInfo.type === 'layer') {
						this.dropId = 'group:' + groupName;
						this.dropPos = 'inside';
					}
				},
				dragOverFilter: function (e, filterId) {
					if (dragInfo.type !== 'filter') return;
					if (dragInfo.filterId === filterId) return;
					this.dropId = 'filter:' + filterId;
					this.dropPos = getDragPos(e, e.currentTarget);
				},
				onDragLeave: function (e) {
					if (!e.currentTarget.contains(e.relatedTarget)) {
						this.dropId = null;
						this.dropPos = null;
					}
				},
				dragEnd: function () {
					if (dragInfo.dragEl) {
						dragInfo.dragEl.classList.remove('lmp-dragging');
					}
					dragInfo.type = null;
					dragInfo.layerUUID = null;
					dragInfo.sourceGroup = null;
					dragInfo.groupName = null;
					dragInfo.filterId = null;
					dragInfo.dragEl = null;
					this.dropId = null;
					this.dropPos = null;
					this.tick++;
				},

				dropOnLayer: function (e, targetUUID) {
					if (dragInfo.type === 'layer') {
						var pos = getDragPos(e, e.currentTarget);
						var uuids = this._getDragUUIDs(dragInfo.layerUUID);
						var self = this;
						uuids.forEach(function (uuid) {
							if (uuid === targetUUID) return;
							var sg = getLayerGroupName(uuid);
							self._doLayerDrop(uuid, sg, targetUUID, null, pos);
						});
					} else if (dragInfo.type === 'group') {
						// Reorder group relative to ungrouped layer in treeOrder
						var pos = getDragPos(e, e.currentTarget);
						var fromEntry = 'group:' + dragInfo.groupName;
						var fromIdx = _treeOrder().indexOf(fromEntry);
						if (fromIdx !== -1) {
							_treeOrder().splice(fromIdx, 1);
							var toIdx = _treeOrder().indexOf(targetUUID);
							if (toIdx === -1) toIdx = _treeOrder().length - 1;
							if (pos === 'after') toIdx++;
							_treeOrder().splice(toIdx, 0, fromEntry);
						}
						syncLayerOrder();
						updatePanel();
					}
					this.dragEnd();
				},
				dropOnGroupedLayer: function (e, groupName, targetUUID) {
					if (dragInfo.type === 'layer') {
						var pos = getDragPos(e, e.currentTarget);
						var uuids = this._getDragUUIDs(dragInfo.layerUUID);
						var self = this;
						uuids.forEach(function (uuid) {
							if (uuid === targetUUID) return;
							var sg = getLayerGroupName(uuid);
							self._doLayerDrop(uuid, sg, targetUUID, groupName, pos);
						});
					}
					this.dragEnd();
				},
				dropOnGroup: function (e, groupName) {
					if (dragInfo.type === 'layer') {
						var pos = getDragPos3(e, e.currentTarget);
						var uuids = this._getDragUUIDs(dragInfo.layerUUID);
						var self = this;
						if (pos === 'inside') {
							uuids.forEach(function (uuid) {
								var sg = getLayerGroupName(uuid);
								self._doLayerDropIntoGroup(uuid, sg, groupName);
							});
						} else {
							// before/after: reorder layers relative to group in treeOrder
							uuids.forEach(function (dragUUID) {
								var sg = getLayerGroupName(dragUUID);
								if (sg) {
									var srcArr = _groups()[sg];
									if (srcArr) { var si = srcArr.indexOf(dragUUID); if (si !== -1) srcArr.splice(si, 1); }
								}
								var fi = _treeOrder().indexOf(dragUUID);
								if (fi !== -1) _treeOrder().splice(fi, 1);
								var gi = _treeOrder().indexOf('group:' + groupName);
								if (gi === -1) gi = _treeOrder().length - 1;
								if (pos === 'after') gi++;
								_treeOrder().splice(gi, 0, dragUUID);
							});
							syncLayerOrder();
							updatePanel();
						}
					} else if (dragInfo.type === 'group' && dragInfo.groupName !== groupName) {
						var pos = getDragPos(e, e.currentTarget);
						var fromEntry = 'group:' + dragInfo.groupName;
						var fromIdx = _treeOrder().indexOf(fromEntry);
						if (fromIdx !== -1) {
							_treeOrder().splice(fromIdx, 1);
							var toIdx = _treeOrder().indexOf('group:' + groupName);
							if (toIdx === -1) toIdx = _treeOrder().length - 1;
							if (pos === 'after') toIdx++;
							_treeOrder().splice(toIdx, 0, fromEntry);
						}
						syncLayerOrder();
						updatePanel();
					}
					this.dragEnd();
				},
				dropOnGroupBody: function (e, groupName) {
					if (dragInfo.type === 'layer') {
						var uuids = this._getDragUUIDs(dragInfo.layerUUID);
						var self = this;
						uuids.forEach(function (uuid) {
							var sg = getLayerGroupName(uuid);
							self._doLayerDropIntoGroup(uuid, sg, groupName);
						});
					}
					this.dragEnd();
				},
				dropOnFilter: function (e, targetFilterId) {
					if (dragInfo.type === 'filter') {
						var layer = getSelectedLayer();
						if (layer) {
							var stack = getFilterStack(layer.uuid);
							var dragFilter = stack.filters.find(function (f) { return f.id === dragInfo.filterId; });
							var targetFilter = stack.filters.find(function (f) { return f.id === targetFilterId; });
							if (dragFilter && targetFilter && dragFilter !== targetFilter) {
								var pos = getDragPos(e, e.currentTarget);
								var fromIdx = stack.filters.indexOf(dragFilter);
								stack.filters.splice(fromIdx, 1);
								var toIdx = stack.filters.indexOf(targetFilter);
								if (pos === 'after') toIdx++;
								stack.filters.splice(toIdx, 0, dragFilter);
								recomputeFilters(layer);
							}
						}
					}
					this.dragEnd();
				},

				_getDragUUIDs: function (primaryUUID) {
					// If the dragged layer is part of multi-selection, return all selected
					if (multiSelected.size >= 2 && multiSelected.has(primaryUUID)) {
						// Return in visual order (top-to-bottom from layerTree)
						var all = this.layerTree.reduce(function (acc, item) {
							if (item.type === 'group') {
								item.layers.forEach(function (l) { if (multiSelected.has(l.uuid)) acc.push(l.uuid); });
							} else {
								if (multiSelected.has(item.layer.uuid)) acc.push(item.layer.uuid);
							}
							return acc;
						}, []);
						return all.length > 0 ? all : [primaryUUID];
					}
					return [primaryUUID];
				},
				_doLayerDrop: function (dragUUID, sourceGroup, targetUUID, targetGroup, position) {
					if (dragUUID === targetUUID) return;
					var tex = getSelectedTexture();
					if (!tex) return;

					// Remove from source group
					if (sourceGroup) {
						var srcArr = _groups()[sourceGroup];
						if (srcArr) {
							var si = srcArr.indexOf(dragUUID);
							if (si !== -1) srcArr.splice(si, 1);
						}
					}

					if (targetGroup) {
						// Dropping onto a layer inside a group: reorder within group
						var tgtArr = _groups()[targetGroup];
						if (!tgtArr) return;
						var ei = tgtArr.indexOf(dragUUID);
						if (ei !== -1) tgtArr.splice(ei, 1);
						var ti = tgtArr.indexOf(targetUUID);
						if (ti === -1) ti = tgtArr.length - 1;
						if (position === 'after') ti++;
						tgtArr.splice(ti, 0, dragUUID);
						// Remove from treeOrder top-level (now inside group)
						var fi = _treeOrder().indexOf(dragUUID);
						if (fi !== -1) _treeOrder().splice(fi, 1);
					} else {
						// Remove from any group the layer might be in
						var existingGroup = getLayerGroupName(dragUUID);
						if (existingGroup) {
							var arr = _groups()[existingGroup];
							if (arr) {
								var ri = arr.indexOf(dragUUID);
								if (ri !== -1) arr.splice(ri, 1);
							}
						}
						// Reorder in treeOrder
						var fi = _treeOrder().indexOf(dragUUID);
						if (fi !== -1) _treeOrder().splice(fi, 1);
						var ti = _treeOrder().indexOf(targetUUID);
						if (ti === -1) ti = _treeOrder().length - 1;
						if (position === 'after') ti++;
						_treeOrder().splice(ti, 0, dragUUID);
					}
					syncLayerOrder();
					updatePanel();
				},
				_doLayerDropIntoGroup: function (dragUUID, sourceGroup, targetGroup) {
					// Remove from source group
					if (sourceGroup) {
						var srcArr = _groups()[sourceGroup];
						if (srcArr) {
							var si = srcArr.indexOf(dragUUID);
							if (si !== -1) srcArr.splice(si, 1);
						}
					}
					// Remove from treeOrder top-level
					var fi = _treeOrder().indexOf(dragUUID);
					if (fi !== -1) _treeOrder().splice(fi, 1);
					// Add to target group
					var tgtArr = _groups()[targetGroup];
					if (!tgtArr) return;
					if (tgtArr.indexOf(dragUUID) === -1) {
						tgtArr.push(dragUUID);
					}
					syncLayerOrder();
					updatePanel();
				},
			},
		};
	}

	// ---- Plugin Registration ----

	Plugin.register('layer_manager_pro', {
		title: 'Layer Manager Pro',
		author: 'CubrixStudio',
		description: 'Advanced layer management for Blockbench: folders, locking, filters, opacity, blend modes, and more.',
		about: 'Layer Manager Pro adds powerful layer management capabilities to Blockbench:\n\n' +
			'- **Layer Groups (Folders)**: Organize layers into named groups for better project structure\n' +
			'- **Layer Locking**: Lock layers to prevent accidental edits\n' +
			'- **Filters**: Apply grayscale, invert, brightness, contrast, sepia, blur, and sharpen filters to individual layers\n' +
			'- **Opacity & Blend Modes**: Quick controls for layer opacity and blend mode\n' +
			'- **Layer Operations**: Add, duplicate, delete, merge visible, flatten all, and import images as layers\n' +
			'- **Rename Layers**: Double-click a layer name to rename it',
		icon: 'layers',
		version: '1.0.0',
		variant: 'both',
		min_version: '4.9.0',
		tags: ['Paint', 'Textures', 'Layers'],

		onload: function () {
			// CSS
			css = Blockbench.addCSS('\
				.layer-manager-pro { padding: 5px; font-size: 12px; }\
				\
				/* Toolbar */\
				.lmp-toolbar { display: flex; gap: 2px; margin-bottom: 8px; flex-wrap: wrap; }\
				.lmp-toolbar button { background: var(--color-button); border: none; padding: 4px 7px; cursor: pointer; border-radius: 4px; display: flex; align-items: center; transition: background 0.15s; }\
				.lmp-toolbar button:hover { background: var(--color-accent); color: var(--color-accent_text); }\
				.lmp-toolbar button.lmp-btn-active { background: #4fc3f7; color: #000; }\
				.lmp-toolbar button i { font-size: 18px; }\
				\
				/* Controls */\
				.lmp-controls { margin-bottom: 8px; padding: 6px; background: var(--color-back); border-radius: 5px; border: 1px solid var(--color-border); }\
				.lmp-control-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }\
				.lmp-control-row:last-child { margin-bottom: 0; }\
				.lmp-control-row label { min-width: 46px; font-size: 11px; opacity: 0.8; }\
				.lmp-control-row input[type="range"] { flex: 1; height: 14px; }\
				.lmp-control-row select { flex: 1; background: var(--color-button); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 4px; padding: 3px 4px; font-size: 11px; }\
				.lmp-control-row span { font-size: 11px; min-width: 36px; text-align: right; opacity: 0.7; }\
				\
				/* Layer list */\
				.lmp-multi-bar { display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: color-mix(in srgb, var(--color-accent) 20%, var(--color-back)); border-bottom: 1px solid var(--color-accent); font-size: 11px; }\
				.lmp-multi-bar span { flex: 1; font-weight: 600; opacity: 0.8; }\
				.lmp-multi-bar button { display: flex; align-items: center; gap: 2px; background: var(--color-accent); color: var(--color-accent_text); border: none; border-radius: 3px; padding: 2px 8px; font-size: 11px; cursor: pointer; }\
				.lmp-multi-bar button i { font-size: 14px; }\
				.lmp-multi-bar button:hover { filter: brightness(1.15); }\
				.lmp-layer-list { overflow-y: auto; }\
				\
				/* Layer items */\
				.lmp-layer-item { display: flex; align-items: center; gap: 3px; padding: 4px 6px; border-radius: 4px; cursor: pointer; margin-bottom: 1px; background: var(--color-back); border: 1px solid transparent; transition: all 0.12s; }\
				.lmp-layer-item:hover { background: var(--color-button); border-color: var(--color-border); }\
				.lmp-layer-item.selected { background: var(--color-accent); color: var(--color-accent_text); border-color: var(--color-accent); }\
				.lmp-layer-item.multi-selected { background: color-mix(in srgb, var(--color-accent) 45%, var(--color-button)); border-color: var(--color-accent); outline: 1px dashed var(--color-accent); outline-offset: -1px; }\
				.lmp-layer-item.locked { opacity: 0.55; }\
				.lmp-preview-wrap { position: relative; flex-shrink: 0; width: 28px; height: 28px; }\
				.lmp-layer-preview { width: 28px; height: 28px; border-radius: 3px; border: 1px solid var(--color-border); image-rendering: pixelated; background: var(--color-back); display: block; }\
				.lmp-ext-badge { position: absolute; bottom: -2px; right: -2px; font-size: 12px; color: #4fc3f7; background: var(--color-back); border-radius: 50%; line-height: 1; }\
				.lmp-layer-name { flex: 1; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 2px; }\
				\
				/* Layer buttons */\
				.lmp-btn { background: none; border: none; cursor: pointer; padding: 2px; opacity: 0.5; display: flex; align-items: center; border-radius: 3px; transition: all 0.12s; }\
				.lmp-btn:hover { opacity: 1; background: rgba(255,255,255,0.08); }\
				.lmp-btn i { font-size: 15px; }\
				.lmp-layer-item.selected .lmp-btn { opacity: 0.8; }\
				.lmp-layer-item.selected .lmp-btn:hover { opacity: 1; background: rgba(255,255,255,0.15); }\
				.lmp-btn-danger:hover { color: #ff6b6b !important; opacity: 1; }\
				\
				\
				/* Groups */\
				.lmp-group { margin-bottom: 3px; border-radius: 5px; overflow: hidden; border: 1px solid var(--color-border); background: var(--color-back); }\
				.lmp-group-header { display: flex; align-items: center; gap: 2px; padding: 5px 6px; background: var(--color-button); cursor: pointer; transition: background 0.12s; user-select: none; }\
				.lmp-group-header:hover { background: color-mix(in srgb, var(--color-accent) 30%, var(--color-button)); }\
				.lmp-chevron { font-size: 18px; opacity: 0.6; transition: transform 0.15s; }\
				.lmp-folder-icon { font-size: 16px; opacity: 0.7; color: #ffc107; }\
				.lmp-group-name { flex: 1; font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\
				.lmp-group-count { font-size: 10px; opacity: 0.5; background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 8px; margin-right: 2px; }\
				.lmp-grp-btn { background: none; border: none; cursor: pointer; padding: 2px; opacity: 0.5; display: flex; align-items: center; border-radius: 3px; transition: all 0.12s; }\
				.lmp-grp-btn:hover { opacity: 1; background: rgba(255,255,255,0.1); }\
				.lmp-grp-btn i { font-size: 15px; }\
				\
				/* Group body (contains grouped layers) */\
				.lmp-group-opacity { display: flex; align-items: center; gap: 4px; padding: 2px 8px; border-top: 1px solid var(--color-border); font-size: 11px; }\
				.lmp-group-opacity label { opacity: 0.7; min-width: 42px; }\
				.lmp-group-opacity input[type="range"] { flex: 1; height: 12px; }\
				.lmp-group-opacity span { min-width: 32px; text-align: right; font-size: 10px; opacity: 0.7; }\
				.lmp-group-body { padding: 2px 2px 2px 8px; border-top: 1px solid var(--color-border); background: color-mix(in srgb, var(--color-back) 50%, transparent); }\
				.lmp-group-body .lmp-layer-item { background: transparent; border-color: transparent; margin-bottom: 0; padding-left: 14px; border-left: 2px solid var(--color-border); border-radius: 0 4px 4px 0; }\
				.lmp-group-body .lmp-layer-item:hover { background: var(--color-button); }\
				.lmp-group-body .lmp-layer-item.selected { background: var(--color-accent); color: var(--color-accent_text); border-left-color: var(--color-accent); }\
				\
				/* Collapsed state */\
				.lmp-group.collapsed { opacity: 0.85; }\
				.lmp-group.collapsed .lmp-group-header { border-radius: 0; }\
				\
				/* Filter history */\
				.lmp-filter-history { margin-top: 8px; border: 1px solid var(--color-border); border-radius: 5px; overflow: hidden; background: var(--color-back); }\
				.lmp-filter-history-header { display: flex; align-items: center; gap: 4px; padding: 5px 6px; background: var(--color-button); cursor: pointer; user-select: none; transition: background 0.12s; }\
				.lmp-filter-history-header:hover { background: color-mix(in srgb, var(--color-accent) 25%, var(--color-button)); }\
				.lmp-filter-history-header span { font-size: 12px; font-weight: 600; }\
				.lmp-filter-history-header span:first-of-type { flex: 1; }\
				.lmp-filter-list { padding: 3px; }\
				.lmp-filter-item { display: flex; align-items: center; gap: 3px; padding: 3px 5px; border-radius: 4px; margin-bottom: 1px; transition: all 0.12s; border-left: 3px solid #ab47bc; background: color-mix(in srgb, var(--color-button) 50%, var(--color-back)); }\
				.lmp-filter-item:hover { background: var(--color-button); }\
				.lmp-filter-item.disabled { opacity: 0.4; border-left-color: var(--color-border); }\
				.lmp-filter-name { flex: 0 0 auto; font-size: 11px; min-width: 70px; white-space: nowrap; }\
				.lmp-filter-intensity { flex: 1; height: 12px; min-width: 40px; cursor: pointer; }\
				.lmp-filter-pct { font-size: 10px; min-width: 28px; text-align: right; opacity: 0.6; }\
				\
				/* Masks */\
				.lmp-mask-btn { position: relative; opacity: 0.8; }\
				.lmp-mask-btn:hover { opacity: 1; }\
				.lmp-mask-btn.lmp-mask-disabled { opacity: 0.3; }\
				.lmp-mask-thumb { width: 18px; height: 18px; border-radius: 2px; border: 1px solid rgba(255,255,255,0.3); image-rendering: pixelated; display: block; cursor: pointer; }\
				.lmp-mask-thumb-sm { width: 15px; height: 15px; border-radius: 2px; border: 1px solid rgba(255,255,255,0.25); image-rendering: pixelated; display: block; cursor: pointer; }\
				\
				/* Mask edit mode */\
				.lmp-mask-edit-bar { display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: #e65100; color: #fff; font-size: 11px; font-weight: 600; cursor: pointer; border-radius: 4px; margin-bottom: 4px; user-select: none; transition: background 0.15s; }\
				.lmp-mask-edit-bar:hover { background: #bf360c; }\
				.lmp-mask-edit-bar i { font-size: 16px; }\
				.lmp-mask-edit-bar span { flex: 1; }\
				.lmp-layer-item.mask-editing { border-color: #e65100 !important; background: color-mix(in srgb, #e65100 25%, var(--color-back)) !important; }\
				.lmp-layer-item.mask-editing .lmp-mask-thumb { border-color: #e65100; box-shadow: 0 0 4px #e65100; }\
				\
				/* Drag & Drop */\
				.lmp-drag-handle { font-size: 14px; opacity: 0.25; cursor: grab; flex-shrink: 0; transition: opacity 0.12s; }\
				.lmp-drag-handle:hover { opacity: 0.7; }\
				.lmp-layer-item.selected .lmp-drag-handle { opacity: 0.5; }\
				.lmp-group-header .lmp-drag-handle { opacity: 0.3; }\
				.lmp-group-header .lmp-drag-handle:hover { opacity: 0.7; }\
				.lmp-dragging { opacity: 0.35 !important; }\
				.lmp-drop-above { border-top: 2px solid var(--color-accent) !important; }\
				.lmp-drop-below { border-bottom: 2px solid var(--color-accent) !important; }\
				.lmp-drop-inside { background: color-mix(in srgb, var(--color-accent) 30%, var(--color-button)) !important; }\
				.lmp-group-empty { padding: 10px; text-align: center; font-size: 11px; opacity: 0.35; font-style: italic; }\
				\
				/* Empty state */\
				.lmp-empty { padding: 20px 12px; text-align: center; opacity: 0.5; font-size: 12px; }\
				.lmp-empty p { margin: 0; }\
			');

			// Panel
			layerPanel = new Panel({
				id: 'layer_manager_pro',
				name: 'Layer Manager Pro',
				icon: 'layers',
				condition: { modes: ['paint'] },
				default_position: {
					slot: 'right_bar',
					float_position: [0, 0],
					float_size: [300, 500],
					height: 400,
					folded: false,
				},
				default_side: 'right',
				component: buildPanelComponent(),
				expand_button: true,
				growable: true,
			});

			// Actions
			addLayerAction = new Action('lmp_add_layer', {
				name: 'Add Layer',
				description: 'Add a new empty layer to the selected texture',
				icon: 'add',
				keybind: new Keybind({ key: 'n', ctrl: true, shift: true }),
				condition: { modes: ['paint'] },
				click: addNewLayer,
			});

			duplicateLayerAction = new Action('lmp_duplicate_layer', {
				name: 'Duplicate Layer',
				description: 'Duplicate the selected layer',
				icon: 'content_copy',
				keybind: new Keybind({ key: 'd', ctrl: true, shift: true }),
				condition: { modes: ['paint'] },
				click: duplicateSelectedLayer,
			});

			mergeVisibleAction = new Action('lmp_merge_visible', {
				name: 'Merge Visible Layers',
				description: 'Merge all visible layers into one',
				icon: 'call_merge',
				keybind: new Keybind({ key: 'e', ctrl: true, shift: true }),
				condition: { modes: ['paint'] },
				click: mergeVisibleLayers,
			});

			flattenLayersAction = new Action('lmp_flatten_layers', {
				name: 'Flatten All Layers',
				description: 'Flatten all layers into a single layer',
				icon: 'layers_clear',
				keybind: new Keybind({ key: 'f', ctrl: true, shift: true }),
				condition: { modes: ['paint'] },
				click: flattenAllLayers,
			});

			toggleLockAction = new Action('lmp_toggle_lock', {
				name: 'Toggle Layer Lock',
				description: 'Lock or unlock the selected layer',
				icon: 'lock',
				keybind: new Keybind({ key: 191 }),
				condition: { modes: ['paint'] },
				click: function () {
					var layer = getSelectedLayer();
					if (layer) toggleLayerLock(layer);
				},
			});

			importLayerAction = new Action('lmp_import_layer', {
				name: 'Import Image as Layer',
				description: 'Import an image file as a new layer',
				icon: 'image',
				keybind: new Keybind({ key: 'i', ctrl: true, shift: true }),
				condition: { modes: ['paint'] },
				click: importImageAsLayer,
			});

			mergeDownAction = new Action('lmp_merge_down', {
				name: 'Merge Down',
				description: 'Merge the selected layer into the layer below',
				icon: 'vertical_align_bottom',
				keybind: new Keybind({ key: 'e', ctrl: true }),
				condition: { modes: ['paint'] },
				click: mergeDown,
			});

			// Add to texture menu
			MenuBar.addAction(addLayerAction, 'texture');
			MenuBar.addAction(duplicateLayerAction, 'texture');
			MenuBar.addAction(importLayerAction, 'texture');
			MenuBar.addAction(mergeVisibleAction, 'texture');
			MenuBar.addAction(flattenLayersAction, 'texture');
			MenuBar.addAction(toggleLockAction, 'texture');

			// ---- Persistence: hook into codec save/load ----

			// Compile: inject LMP data into project JSON on save
			codecCompileCb = function (e) {
				if (e.model) {
					// Exit mask edit mode before saving to ensure canvas is restored
					if (maskEditMode.active) exitMaskEdit();
					e.model.layer_manager_pro = serializeLmpData();
				}
			};
			// Parse: read LMP data from project JSON on load
			codecParseCb = function (e) {
				if (e.model && e.model.layer_manager_pro) {
					deserializeLmpData(e.model.layer_manager_pro);
					// Defer cleanup + filter reapplication until textures are fully loaded
					setTimeout(function () {
						for (var texUUID in perTextureData) {
							var tex = Texture.all.find(function (t) { return t.uuid === texUUID; });
							if (tex) cleanupStaleRefs(tex);
						}
						syncLayerOrder();
						reapplyAllFilterStacks();
					}, 300);
				} else {
					clearLmpData();
				}
				updatePanel();
			};

			// Hook into all available codecs that handle .bbmodel
			var codecNames = ['project', 'bedrock', 'bedrock_old', 'java_block'];
			codecNames.forEach(function (name) {
				if (Codecs[name]) {
					Codecs[name].on('compile', codecCompileCb);
					Codecs[name].on('parse', codecParseCb);
				}
			});

			// Also listen for project close/switch to clear state
			function onNewProject() {
				if (maskEditMode.active) exitMaskEdit();
				stopAllExternalEdits();
				stopPsdEdit();
				clearLmpData();
				updatePanel();
			}
			Blockbench.on('close_project', onNewProject);
			eventListeners.push({ event: 'close_project', fn: onNewProject });

			// Listen for texture/layer changes to keep panel updated
			function onUpdate() { updatePanel(); }
			function onTexSwitch() {
				if (maskEditMode.active) exitMaskEdit();
				updatePanel();
			}
			// On undo/redo: clean up stale refs since layer UUIDs may have changed
			function onUndoRedo() {
				var tex = getSelectedTexture();
				if (tex && tex.layers_enabled) {
					cleanupStaleRefs(tex);
					syncLayerOrder();
				}
				updatePanel();
			}
			// Events that should exit mask edit mode (texture switch)
			['select_texture', 'update_texture_selection'].forEach(function (evt) {
				Blockbench.on(evt, onTexSwitch);
				eventListeners.push({ event: evt, fn: onTexSwitch });
			});
			// Undo/redo need special handling to fix stale group references
			['undo', 'redo'].forEach(function (evt) {
				Blockbench.on(evt, onUndoRedo);
				eventListeners.push({ event: evt, fn: onUndoRedo });
			});
			// Other events just update the panel
			['add_texture', 'finish_edit', 'select_mode', 'update_selection'].forEach(function (evt) {
				Blockbench.on(evt, onUpdate);
				eventListeners.push({ event: evt, fn: onUpdate });
			});

			// Periodic fallback update to catch any missed state changes
			if (updateInterval) clearInterval(updateInterval);
			updateInterval = setInterval(function () {
				updatePanel();
			}, 500);

			// Restore LMP data from localStorage (handles plugin reload)
			function _tryRestore() {
				var tex = getSelectedTexture();
				if (!tex || !tex.layers_enabled || tex.layers.length === 0) return;
				_restoring = true;
				if (restoreLmpFromLocalStorage()) {
					console.log('LMP: Restored state from localStorage');
					syncLayerOrder();
				}
				_restoring = false;
				updatePanel();
			}
			// Try immediately if a project is already open
			_tryRestore();
			// Also try when a texture is selected/added (covers late load)
			function _onTexReady() {
				// Only restore if we have no data yet (first load)
				var td = getTexData();
				if (td.treeOrder.length === 0 && Object.keys(td.groups).length === 0) {
					_tryRestore();
				}
			}
			Blockbench.on('select_texture', _onTexReady);
			eventListeners.push({ event: 'select_texture', fn: _onTexReady });
			Blockbench.on('add_texture', _onTexReady);
			eventListeners.push({ event: 'add_texture', fn: _onTexReady });
		},

		onunload: function () {
			// Stop all external edits
			stopAllExternalEdits();
			stopPsdEdit();
			// Remove event listeners
			eventListeners.forEach(function (entry) {
				Blockbench.removeListener(entry.event, entry.fn);
			});
			eventListeners.length = 0;

			// Remove codec listeners
			if (codecCompileCb || codecParseCb) {
				var codecNames = ['project', 'bedrock', 'bedrock_old', 'java_block'];
				codecNames.forEach(function (name) {
					if (Codecs[name] && Codecs[name].events) {
						if (codecCompileCb && Codecs[name].events.compile) {
							var ci = Codecs[name].events.compile.indexOf(codecCompileCb);
							if (ci !== -1) Codecs[name].events.compile.splice(ci, 1);
						}
						if (codecParseCb && Codecs[name].events.parse) {
							var pi = Codecs[name].events.parse.indexOf(codecParseCb);
							if (pi !== -1) Codecs[name].events.parse.splice(pi, 1);
						}
					}
				});
				codecCompileCb = null;
				codecParseCb = null;
			}

			// Clear interval
			if (updateInterval) {
				clearInterval(updateInterval);
				updateInterval = null;
			}

			if (css) css.delete();
			if (layerPanel) layerPanel.delete();
			if (addLayerAction) addLayerAction.delete();
			if (duplicateLayerAction) duplicateLayerAction.delete();
			if (mergeVisibleAction) mergeVisibleAction.delete();
			if (flattenLayersAction) flattenLayersAction.delete();
			if (toggleLockAction) toggleLockAction.delete();
			if (importLayerAction) importLayerAction.delete();
			if (mergeDownAction) mergeDownAction.delete();

			MenuBar.removeAction('texture.lmp_add_layer');
			MenuBar.removeAction('texture.lmp_duplicate_layer');
			MenuBar.removeAction('texture.lmp_import_layer');
			MenuBar.removeAction('texture.lmp_merge_visible');
			MenuBar.removeAction('texture.lmp_flatten_layers');
			MenuBar.removeAction('texture.lmp_merge_down');
			MenuBar.removeAction('texture.lmp_toggle_lock');

			clearLmpData();
		},
	});
})();
