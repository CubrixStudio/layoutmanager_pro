(function () {
	'use strict';

	let layerPanel;
	let importLayerAction;
	let addLayerAction;
	let duplicateLayerAction;
	let mergeVisibleAction;
	let flattenLayersAction;
	let toggleLockAction;
	let css;
	let updateInterval;
	const eventListeners = [];

	// Track locked layers and layer groups (folders)
	const lockedLayers = new Set();
	const layerGroups = {}; // { groupName: [layerUUIDs] }

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

		layer.ctx.putImageData(working, 0, 0);
		if (tex) tex.updateLayerChanges(true);
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

	function getSelectedLayer() {
		const tex = getSelectedTexture();
		if (!tex || !tex.layers_enabled) return null;
		return TextureLayer.selected || tex.getActiveLayer();
	}

	function isLayerLocked(layer) {
		return layer && lockedLayers.has(layer.uuid);
	}

	function ensureLayersEnabled(texture) {
		if (!texture) return false;
		if (!texture.layers_enabled) {
			texture.activateLayers(true);
		}
		return texture.layers_enabled;
	}

	// ---- Layer Group (Folder) Management ----

	function createLayerGroup(name) {
		if (!name) {
			Blockbench.textPrompt('New Layer Group', 'Group 1', function (value) {
				if (value) {
					layerGroups[value] = [];
					Blockbench.showQuickMessage('Created group: ' + value, 1500);
					updatePanel();
				}
			});
		} else {
			layerGroups[name] = [];
			updatePanel();
		}
	}

	function addLayerToGroup(groupName, layerUUID) {
		if (!layerGroups[groupName]) return;
		if (layerGroups[groupName].indexOf(layerUUID) === -1) {
			layerGroups[groupName].push(layerUUID);
		}
		updatePanel();
	}

	function removeLayerFromGroup(groupName, layerUUID) {
		if (!layerGroups[groupName]) return;
		const idx = layerGroups[groupName].indexOf(layerUUID);
		if (idx !== -1) {
			layerGroups[groupName].splice(idx, 1);
		}
		updatePanel();
	}

	function deleteLayerGroup(groupName) {
		delete layerGroups[groupName];
		updatePanel();
	}

	function toggleGroupVisibility(groupName) {
		const tex = getSelectedTexture();
		if (!tex || !tex.layers_enabled) return;
		const uuids = layerGroups[groupName] || [];
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

	// ---- Lock Management ----

	function toggleLayerLock(layer) {
		if (!layer) return;
		if (lockedLayers.has(layer.uuid)) {
			lockedLayers.delete(layer.uuid);
			Blockbench.showQuickMessage('Layer unlocked: ' + layer.name, 1000);
		} else {
			lockedLayers.add(layer.uuid);
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
		newLayer.offset = [layer.offset[0], layer.offset[1]];
		newLayer.opacity = layer.opacity;
		newLayer.blend_mode = layer.blend_mode;
		newLayer.visible = layer.visible;
		// Copy pixel data
		newLayer.ctx.drawImage(layer.canvas, 0, 0);
		newLayer.addForEditing();

		Undo.finishEdit('Duplicate layer');
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
			merged.ctx.globalAlpha = l.opacity;
			merged.ctx.drawImage(l.canvas, l.offset[0], l.offset[1]);
		});
		merged.ctx.globalAlpha = 1;

		// Remove visible layers
		for (let i = visibleLayers.length - 1; i >= 0; i--) {
			visibleLayers[i].remove(false);
		}

		merged.addForEditing();
		Undo.finishEdit('Merge visible layers');
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
				flattened.ctx.globalAlpha = l.opacity;
				flattened.ctx.drawImage(l.canvas, l.offset[0], l.offset[1]);
			}
		});
		flattened.ctx.globalAlpha = 1;

		// Remove all existing layers
		const toRemove = tex.layers.slice();
		for (let i = toRemove.length - 1; i >= 0; i--) {
			toRemove[i].remove(false);
		}

		flattened.addForEditing();
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

					Undo.finishEdit('Import image as layer');
					tex.updateLayerChanges(true);
					updatePanel();
				};
				img.src = file.content;
			}
		);
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

	// ---- Panel UI ----

	function updatePanel() {
		if (layerPanel && layerPanel.inside_vue) {
			layerPanel.inside_vue.tick++;
		}
	}

	function getLayerGroupName(uuid) {
		for (var name in layerGroups) {
			if (layerGroups[name].indexOf(uuid) !== -1) return name;
		}
		return null;
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
						<button @click="flattenAll" title="Flatten All"><i class="material-icons">layers_clear</i></button>\
						<button @click="createGroup" title="Create Group"><i class="material-icons">create_new_folder</i></button>\
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
					<div v-if="hasTexture && hasLayers" class="lmp-layer-list">\
						<template v-for="item in layerTree">\
							\
							<div v-if="item.type === \'group\'" :key="\'g-\' + item.name" class="lmp-group" :class="{ collapsed: isCollapsed(item.name) }">\
								<div class="lmp-group-header" @click="toggleCollapse(item.name)">\
									<i class="material-icons lmp-chevron">{{ isCollapsed(item.name) ? "chevron_right" : "expand_more" }}</i>\
									<i class="material-icons lmp-folder-icon">{{ isCollapsed(item.name) ? "folder" : "folder_open" }}</i>\
									<span class="lmp-group-name" @dblclick.stop="renameGroup(item.name)">{{ item.name }}</span>\
									<span class="lmp-group-count">{{ item.layers.length }}</span>\
									<button @click.stop="toggleGroupVis(item.name)" :title="item.allVisible ? \'Hide group\' : \'Show group\'" class="lmp-grp-btn">\
										<i class="material-icons">{{ item.allVisible ? "visibility" : "visibility_off" }}</i>\
									</button>\
									<button @click.stop="deleteGroup(item.name)" title="Delete group" class="lmp-grp-btn">\
										<i class="material-icons">close</i>\
									</button>\
								</div>\
								<div v-if="!isCollapsed(item.name)" class="lmp-group-body">\
									<div v-for="layer in item.layers" :key="layer.uuid"\
										class="lmp-layer-item lmp-grouped"\
										:class="{ selected: isSelected(layer), locked: isLocked(layer) }"\
										@click="selectLayer(layer)">\
										<button class="lmp-btn" @click.stop="toggleVis(layer)" :title="layer.visible ? \'Hide\' : \'Show\'">\
											<i class="material-icons">{{ layer.visible ? "visibility" : "visibility_off" }}</i>\
										</button>\
										<span class="lmp-layer-name" @dblclick.stop="renameLayer(layer)">{{ layer.name }}</span>\
										<button class="lmp-btn" @click.stop="toggleLock(layer)" :title="isLocked(layer) ? \'Unlock\' : \'Lock\'">\
											<i class="material-icons">{{ isLocked(layer) ? "lock" : "lock_open" }}</i>\
										</button>\
										<button class="lmp-btn" @click.stop="removeFromGroup(item.name, layer.uuid)" title="Remove from group">\
											<i class="material-icons">logout</i>\
										</button>\
										<button class="lmp-btn lmp-btn-danger" @click.stop="deleteLayer(layer)" title="Delete">\
											<i class="material-icons">delete</i>\
										</button>\
									</div>\
								</div>\
							</div>\
							\
							<div v-else :key="\'l-\' + item.layer.uuid"\
								class="lmp-layer-item"\
								:class="{ selected: isSelected(item.layer), locked: isLocked(item.layer) }"\
								@click="selectLayer(item.layer)">\
								<button class="lmp-btn" @click.stop="toggleVis(item.layer)" :title="item.layer.visible ? \'Hide\' : \'Show\'">\
									<i class="material-icons">{{ item.layer.visible ? "visibility" : "visibility_off" }}</i>\
								</button>\
								<span class="lmp-layer-name" @dblclick.stop="renameLayer(item.layer)">{{ item.layer.name }}</span>\
								<button class="lmp-btn" @click.stop="toggleLock(item.layer)" :title="isLocked(item.layer) ? \'Unlock\' : \'Lock\'">\
									<i class="material-icons">{{ isLocked(item.layer) ? "lock" : "lock_open" }}</i>\
								</button>\
								<select v-if="groupNames.length" class="lmp-group-select" @change="addToGroup($event, item.layer.uuid)" @click.stop title="Move to group">\
									<option value="">Group...</option>\
									<option v-for="gn in groupNames" :key="gn" :value="gn">{{ gn }}</option>\
								</select>\
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
							<div v-for="f in selectedFilters" :key="f.id" class="lmp-filter-item" :class="{ disabled: !f.enabled }">\
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
				};
			},
			computed: {
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
					return Object.keys(layerGroups);
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
					var groupedUUIDs = new Set();
					for (var gn in layerGroups) {
						layerGroups[gn].forEach(function (uuid) { groupedUUIDs.add(uuid); });
					}

					var tree = [];
					var insertedGroups = {};

					allLayers.forEach(function (layer) {
						var group = getLayerGroupName(layer.uuid);
						if (group) {
							if (!insertedGroups[group]) {
								var groupLayers = [];
								var allVisible = true;
								(layerGroups[group] || []).forEach(function (uuid) {
									var l = allLayers.find(function (x) { return x.uuid === uuid; });
									if (l) {
										groupLayers.push(l);
										if (!l.visible) allVisible = false;
									}
								});
								tree.push({ type: 'group', name: group, layers: groupLayers, allVisible: allVisible });
								insertedGroups[group] = true;
							}
						} else {
							tree.push({ type: 'layer', layer: layer });
						}
					});

					// Add empty groups that have no layers yet
					for (var name in layerGroups) {
						if (!insertedGroups[name]) {
							tree.push({ type: 'group', name: name, layers: [], allVisible: true });
						}
					}

					return tree;
				},
			},
			methods: {
				addLayer: addNewLayer,
				duplicateLayer: duplicateSelectedLayer,
				importImage: importImageAsLayer,
				mergeVisible: mergeVisibleLayers,
				flattenAll: flattenAllLayers,
				createGroup: function () {
					createLayerGroup();
				},
				selectLayer: function (layer) {
					layer.select();
					this.tick++;
				},
				isSelected: function (layer) {
					return TextureLayer.selected === layer;
				},
				isLocked: function (layer) {
					return isLayerLocked(layer);
				},
				isCollapsed: function (groupName) {
					return !!this.collapsed[groupName];
				},
				toggleCollapse: function (groupName) {
					this.$set(this.collapsed, groupName, !this.collapsed[groupName]);
				},
				toggleVis: function (layer) {
					layer.toggleVisibility();
					var tex = getSelectedTexture();
					if (tex) tex.updateLayerChanges(true);
					this.tick++;
				},
				toggleLock: function (layer) {
					toggleLayerLock(layer);
					this.tick++;
				},
				deleteLayer: function (layer) {
					if (isLayerLocked(layer)) {
						Blockbench.showQuickMessage('Layer is locked', 1500);
						return;
					}
					// Remove from any group
					var gn = getLayerGroupName(layer.uuid);
					if (gn) removeLayerFromGroup(gn, layer.uuid);
					layer.remove(true);
					var tex = getSelectedTexture();
					if (tex) tex.updateLayerChanges(true);
					this.tick++;
				},
				renameLayer: function (layer) {
					Blockbench.textPrompt('Rename Layer', layer.name, function (value) {
						if (value) {
							layer.name = value;
							updatePanel();
						}
					});
				},
				renameGroup: function (oldName) {
					Blockbench.textPrompt('Rename Group', oldName, function (value) {
						if (value && value !== oldName && !layerGroups[value]) {
							layerGroups[value] = layerGroups[oldName];
							delete layerGroups[oldName];
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
					layer.opacity = parseInt(event.target.value, 10);
					var tex = getSelectedTexture();
					if (tex) tex.updateLayerChanges(true);
					this.tick++;
				},
				setBlendMode: function (event) {
					var layer = getSelectedLayer();
					if (!layer) return;
					if (isLayerLocked(layer)) {
						Blockbench.showQuickMessage('Layer is locked', 1500);
						return;
					}
					layer.blend_mode = event.target.value;
					var tex = getSelectedTexture();
					if (tex) tex.updateLayerChanges(true);
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
				toggleGroupVis: function (groupName) {
					toggleGroupVisibility(groupName);
					this.tick++;
				},
				deleteGroup: function (groupName) {
					deleteLayerGroup(groupName);
					this.tick++;
				},
				addToGroup: function (event, layerUUID) {
					var gn = event.target.value;
					if (gn) {
						// Remove from any existing group first
						var oldGroup = getLayerGroupName(layerUUID);
						if (oldGroup) removeLayerFromGroup(oldGroup, layerUUID);
						addLayerToGroup(gn, layerUUID);
					}
					event.target.value = '';
					this.tick++;
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
				.lmp-layer-list { overflow-y: auto; }\
				\
				/* Layer items */\
				.lmp-layer-item { display: flex; align-items: center; gap: 3px; padding: 4px 6px; border-radius: 4px; cursor: pointer; margin-bottom: 1px; background: var(--color-back); border: 1px solid transparent; transition: all 0.12s; }\
				.lmp-layer-item:hover { background: var(--color-button); border-color: var(--color-border); }\
				.lmp-layer-item.selected { background: var(--color-accent); color: var(--color-accent_text); border-color: var(--color-accent); }\
				.lmp-layer-item.locked { opacity: 0.55; }\
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
				/* Group select on ungrouped layers */\
				.lmp-group-select { background: var(--color-button); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 3px; font-size: 10px; padding: 1px 2px; max-width: 65px; cursor: pointer; }\
				.lmp-layer-item.selected .lmp-group-select { background: rgba(255,255,255,0.15); border-color: rgba(255,255,255,0.2); color: inherit; }\
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
				condition: { modes: ['paint'] },
				click: addNewLayer,
			});

			duplicateLayerAction = new Action('lmp_duplicate_layer', {
				name: 'Duplicate Layer',
				description: 'Duplicate the selected layer',
				icon: 'content_copy',
				condition: { modes: ['paint'] },
				click: duplicateSelectedLayer,
			});

			mergeVisibleAction = new Action('lmp_merge_visible', {
				name: 'Merge Visible Layers',
				description: 'Merge all visible layers into one',
				icon: 'call_merge',
				condition: { modes: ['paint'] },
				click: mergeVisibleLayers,
			});

			flattenLayersAction = new Action('lmp_flatten_layers', {
				name: 'Flatten All Layers',
				description: 'Flatten all layers into a single layer',
				icon: 'layers_clear',
				condition: { modes: ['paint'] },
				click: flattenAllLayers,
			});

			toggleLockAction = new Action('lmp_toggle_lock', {
				name: 'Toggle Layer Lock',
				description: 'Lock or unlock the selected layer',
				icon: 'lock',
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
				condition: { modes: ['paint'] },
				click: importImageAsLayer,
			});

			// Add to texture menu
			MenuBar.addAction(addLayerAction, 'texture');
			MenuBar.addAction(duplicateLayerAction, 'texture');
			MenuBar.addAction(importLayerAction, 'texture');
			MenuBar.addAction(mergeVisibleAction, 'texture');
			MenuBar.addAction(flattenLayersAction, 'texture');
			MenuBar.addAction(toggleLockAction, 'texture');

			// Listen for texture/layer changes to keep panel updated
			function onUpdate() { updatePanel(); }
			var events = [
				'select_texture',
				'update_texture_selection',
				'add_texture',
				'finish_edit',
				'undo',
				'redo',
				'select_mode',
				'update_selection'
			];
			events.forEach(function (evt) {
				Blockbench.on(evt, onUpdate);
				eventListeners.push({ event: evt, fn: onUpdate });
			});

			// Periodic fallback update to catch any missed state changes
			updateInterval = setInterval(function () {
				updatePanel();
			}, 500);
		},

		onunload: function () {
			// Remove event listeners
			eventListeners.forEach(function (entry) {
				Blockbench.removeListener(entry.event, entry.fn);
			});
			eventListeners.length = 0;

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

			MenuBar.removeAction('texture.lmp_add_layer');
			MenuBar.removeAction('texture.lmp_duplicate_layer');
			MenuBar.removeAction('texture.lmp_import_layer');
			MenuBar.removeAction('texture.lmp_merge_visible');
			MenuBar.removeAction('texture.lmp_flatten_layers');
			MenuBar.removeAction('texture.lmp_toggle_lock');

			lockedLayers.clear();
			for (var key in layerGroups) {
				delete layerGroups[key];
			}
			for (var key in layerFilterStacks) {
				delete layerFilterStacks[key];
			}
		},
	});
})();
