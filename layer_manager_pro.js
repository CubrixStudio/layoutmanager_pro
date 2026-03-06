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

		Undo.initEdit({ textures: [tex] });

		const canvas = layer.canvas;
		const ctx = layer.ctx;
		const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
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

			case 'contrast':
				const factor = (259 * (80 + 255)) / (255 * (259 - 80));
				for (let i = 0; i < data.length; i += 4) {
					data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128));
					data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128));
					data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128));
				}
				break;

			case 'sepia':
				for (let i = 0; i < data.length; i += 4) {
					const r = data[i], g = data[i + 1], b = data[i + 2];
					data[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
					data[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
					data[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
				}
				break;

			case 'blur':
				applyBoxBlur(imageData, canvas.width, canvas.height, 1);
				break;

			case 'sharpen':
				applySharpen(imageData, canvas.width, canvas.height);
				break;

			default:
				Undo.cancelEdit();
				return;
		}

		ctx.putImageData(imageData, 0, 0);
		Undo.finishEdit('Apply filter: ' + filterName);
		tex.updateLayerChanges(true);
		updatePanel();
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
							<input type="range" min="0" max="1" step="0.01" :value="currentOpacity" @input="setOpacity($event)" />\
							<span>{{ Math.round(currentOpacity * 100) }}%</span>\
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
							<select @change="applyFilter($event)">\
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
						<div v-for="group in groups" :key="group.name" class="lmp-group">\
							<div class="lmp-group-header" @click="toggleGroup(group.name)">\
								<i class="material-icons">folder</i>\
								<span>{{ group.name }}</span>\
								<button @click.stop="deleteGroup(group.name)" title="Delete Group"><i class="material-icons" style="font-size:14px">close</i></button>\
								<button @click.stop="toggleGroupVis(group.name)" title="Toggle Group Visibility"><i class="material-icons" style="font-size:14px">visibility</i></button>\
							</div>\
							<div class="lmp-group-layers">\
								<div v-for="uuid in group.layers" :key="uuid" class="lmp-layer-item lmp-grouped">\
									<span class="lmp-layer-name">{{ getLayerName(uuid) }}</span>\
									<button @click="removeFromGroup(group.name, uuid)" title="Remove from group"><i class="material-icons" style="font-size:14px">remove</i></button>\
								</div>\
							</div>\
						</div>\
						\
						<div v-for="layer in layers" :key="layer.uuid" \
							class="lmp-layer-item" \
							:class="{ selected: isSelected(layer), locked: isLocked(layer) }" \
							@click="selectLayer(layer)">\
							<button class="lmp-vis-btn" @click.stop="toggleVis(layer)" :title="layer.visible ? \'Hide\' : \'Show\'">\
								<i class="material-icons" style="font-size:16px">{{ layer.visible ? "visibility" : "visibility_off" }}</i>\
							</button>\
							<span class="lmp-layer-name" @dblclick="renameLayer(layer)">{{ layer.name }}</span>\
							<button class="lmp-lock-btn" @click.stop="toggleLock(layer)" :title="isLocked(layer) ? \'Unlock\' : \'Lock\'">\
								<i class="material-icons" style="font-size:16px">{{ isLocked(layer) ? "lock" : "lock_open" }}</i>\
							</button>\
							<button class="lmp-del-btn" @click.stop="deleteLayer(layer)" title="Delete Layer">\
								<i class="material-icons" style="font-size:16px">delete</i>\
							</button>\
							<div class="lmp-layer-actions">\
								<select @change="addToGroup($event, layer.uuid)" @click.stop title="Add to group">\
									<option value="">Group...</option>\
									<option v-for="gn in groupNames" :key="gn" :value="gn">{{ gn }}</option>\
								</select>\
							</div>\
						</div>\
					</div>\
					\
					<div v-else class="lmp-empty">\
						<p v-if="!hasTexture">No texture selected.</p>\
						<p v-else>No layers. Click + to add a layer.</p>\
					</div>\
				</div>',

			data: function () {
				return { tick: 0 };
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
				layers: function () {
					this.tick;
					var tex = getSelectedTexture();
					if (!tex || !tex.layers_enabled) return [];
					return tex.layers.slice().reverse();
				},
				groups: function () {
					this.tick;
					var result = [];
					for (var name in layerGroups) {
						result.push({ name: name, layers: layerGroups[name] });
					}
					return result;
				},
				groupNames: function () {
					this.tick;
					return Object.keys(layerGroups);
				},
				currentOpacity: function () {
					this.tick;
					var layer = getSelectedLayer();
					return layer ? layer.opacity : 1;
				},
				currentBlendMode: function () {
					this.tick;
					var layer = getSelectedLayer();
					return layer ? layer.blend_mode : 'default';
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
				setOpacity: function (event) {
					var layer = getSelectedLayer();
					if (!layer) return;
					if (isLayerLocked(layer)) {
						Blockbench.showQuickMessage('Layer is locked', 1500);
						return;
					}
					layer.opacity = parseFloat(event.target.value);
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
				applyFilter: function (event) {
					var val = event.target.value;
					if (val) {
						applyFilter(val);
						event.target.value = '';
					}
					this.tick++;
				},
				getLayerName: function (uuid) {
					var tex = getSelectedTexture();
					if (!tex) return uuid;
					var found = tex.layers.find(function (l) { return l.uuid === uuid; });
					return found ? found.name : '(removed)';
				},
				toggleGroup: function () {
					// Could expand/collapse - for now it's visual
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
						addLayerToGroup(gn, layerUUID);
					}
					event.target.value = '';
					this.tick++;
				},
				removeFromGroup: function (groupName, uuid) {
					removeLayerFromGroup(groupName, uuid);
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
				.layer-manager-pro { padding: 4px; }\
				.lmp-toolbar { display: flex; gap: 2px; margin-bottom: 6px; flex-wrap: wrap; }\
				.lmp-toolbar button { background: var(--color-button); border: none; padding: 3px 6px; cursor: pointer; border-radius: 3px; display: flex; align-items: center; }\
				.lmp-toolbar button:hover { background: var(--color-accent); }\
				.lmp-toolbar button i { font-size: 18px; }\
				\
				.lmp-controls { margin-bottom: 6px; }\
				.lmp-control-row { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }\
				.lmp-control-row label { min-width: 50px; font-size: 12px; }\
				.lmp-control-row input[type="range"] { flex: 1; height: 16px; }\
				.lmp-control-row select { flex: 1; background: var(--color-back); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 3px; padding: 2px; font-size: 11px; }\
				.lmp-control-row span { font-size: 11px; min-width: 35px; text-align: right; }\
				\
				.lmp-layer-list { max-height: 400px; overflow-y: auto; }\
				.lmp-layer-item { display: flex; align-items: center; gap: 2px; padding: 3px 4px; border-radius: 3px; cursor: pointer; margin-bottom: 1px; background: var(--color-back); }\
				.lmp-layer-item:hover { background: var(--color-button); }\
				.lmp-layer-item.selected { background: var(--color-accent); color: var(--color-accent_text); }\
				.lmp-layer-item.locked { opacity: 0.7; }\
				.lmp-layer-item.lmp-grouped { padding-left: 20px; }\
				.lmp-layer-name { flex: 1; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\
				.lmp-layer-item button { background: none; border: none; cursor: pointer; padding: 1px; opacity: 0.7; display: flex; align-items: center; }\
				.lmp-layer-item button:hover { opacity: 1; }\
				.lmp-layer-actions select { background: var(--color-back); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 2px; font-size: 10px; padding: 0 2px; max-width: 60px; }\
				\
				.lmp-group { margin-bottom: 4px; }\
				.lmp-group-header { display: flex; align-items: center; gap: 4px; padding: 3px 4px; background: var(--color-button); border-radius: 3px; cursor: pointer; }\
				.lmp-group-header:hover { background: var(--color-accent); }\
				.lmp-group-header span { flex: 1; font-size: 12px; font-weight: bold; }\
				.lmp-group-header button { background: none; border: none; cursor: pointer; padding: 1px; opacity: 0.7; display: flex; align-items: center; }\
				.lmp-group-header button:hover { opacity: 1; }\
				.lmp-group-layers { padding-left: 4px; }\
				\
				.lmp-empty { padding: 12px; text-align: center; opacity: 0.6; font-size: 12px; }\
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
		},
	});
})();
