(function () {
	'use strict';

	// ---- Plugin handles (cleaned up on unload) ----
	var registeredActions = []; // [{ action, id, menu }]

	// Blockbench face directions and their outward normals (Blockbench axis convention:
	// north = -Z, south = +Z, east = +X, west = -X, up = +Y, down = -Y).
	var FACE_NORMALS = {
		north: [0, 0, -1],
		south: [0, 0, 1],
		east: [1, 0, 0],
		west: [-1, 0, 0],
		up: [0, 1, 0],
		down: [0, -1, 0],
	};
	var FACE_KEYS = Object.keys(FACE_NORMALS);
	var EPS = 1e-4;

	// =====================================================================
	//  Generic helpers
	// =====================================================================

	function round(value, precision) {
		var p = precision || 10000;
		return Math.round(value * p) / p;
	}

	function msg(text, time) {
		Blockbench.showQuickMessage(text, time || 1500);
	}

	function deg2rad(d) { return d * Math.PI / 180; }
	function rad2deg(r) { return r * 180 / Math.PI; }

	// Elements (cubes / meshes) currently selected in the outliner.
	function getSelectedElements() {
		return (typeof Outliner !== 'undefined' && Array.isArray(Outliner.selected)) ? Outliner.selected.slice() : [];
	}

	// Groups currently selected (supports multi-group selection when available).
	function getSelectedGroups() {
		if (typeof Group === 'undefined') return [];
		if (Array.isArray(Group.multi_selected) && Group.multi_selected.length) return Group.multi_selected.slice();
		return Group.selected ? [Group.selected] : [];
	}

	function isCube(el) { return typeof Cube !== 'undefined' && el instanceof Cube; }
	function isMesh(el) { return typeof Mesh !== 'undefined' && el instanceof Mesh; }

	// A rotation is "orthogonal" when every axis is a multiple of 90 degrees.
	function isOrthogonal(rot) {
		if (!rot) return true;
		return rot.every(function (a) { return Math.abs(a / 90 - Math.round(a / 90)) < EPS; });
	}

	function isZeroRotation(rot) {
		return !rot || rot.every(function (a) { return Math.abs(a) < EPS; });
	}

	// THREE rotation order used by an element's mesh (fallback 'ZYX', Blockbench default).
	function getRotationOrder(el) {
		if (el && el.mesh && el.mesh.rotation && el.mesh.rotation.order) return el.mesh.rotation.order;
		return 'ZYX';
	}

	// Build a THREE rotation matrix from Euler degrees + order.
	function rotationMatrix(rotDeg, order) {
		var e = new THREE.Euler(deg2rad(rotDeg[0]), deg2rad(rotDeg[1]), deg2rad(rotDeg[2]), order || 'ZYX');
		return new THREE.Matrix4().makeRotationFromEuler(e);
	}

	// Euler degrees [x,y,z] from a THREE rotation matrix + order.
	function eulerFromMatrix(matrix, order) {
		var e = new THREE.Euler().setFromRotationMatrix(matrix, order || 'ZYX');
		return [round(rad2deg(e.x)), round(rad2deg(e.y)), round(rad2deg(e.z))];
	}

	// Apply a rotation matrix to a point, pivoting around `pivot`.
	function rotateAround(point, matrix, pivot) {
		var v = new THREE.Vector3(point[0] - pivot[0], point[1] - pivot[1], point[2] - pivot[2]);
		v.applyMatrix4(matrix);
		return [round(v.x + pivot[0]), round(v.y + pivot[1]), round(v.z + pivot[2])];
	}

	// Snap a rotated unit vector back to the nearest signed axis (returns [x,y,z] in {-1,0,1}).
	function snapToAxis(vec) {
		var abs = [Math.abs(vec.x), Math.abs(vec.y), Math.abs(vec.z)];
		var maxI = abs[0] >= abs[1] ? (abs[0] >= abs[2] ? 0 : 2) : (abs[1] >= abs[2] ? 1 : 2);
		var out = [0, 0, 0];
		out[maxI] = (vec.getComponent ? vec.getComponent(maxI) : vec.toArray()[maxI]) < 0 ? -1 : 1;
		return out;
	}

	function axisEquals(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }

	// Refresh the viewport after geometry/transform edits.
	function refreshCanvas(elements) {
		try {
			Canvas.updateView({
				elements: elements || getSelectedElements(),
				element_aspects: { transform: true, geometry: true, uv: true, faces: true },
				selection: true,
			});
		} catch (e) {
			try { Canvas.updateAll(); } catch (e2) { /* ignore */ }
		}
	}

	// =====================================================================
	//  Feature 1: Freeze Rotation
	// =====================================================================

	// Bake an orthogonal (90°-multiple) cube rotation into its geometry and faces.
	function freezeCubeOrthogonal(cube) {
		var order = getRotationOrder(cube);
		var R = rotationMatrix(cube.rotation, order);
		var origin = cube.origin.slice();

		// Recompute the axis-aligned box from the 8 rotated corners.
		var from = cube.from, to = cube.to;
		var min = [Infinity, Infinity, Infinity];
		var max = [-Infinity, -Infinity, -Infinity];
		for (var xi = 0; xi < 2; xi++) {
			for (var yi = 0; yi < 2; yi++) {
				for (var zi = 0; zi < 2; zi++) {
					var corner = [xi ? to[0] : from[0], yi ? to[1] : from[1], zi ? to[2] : from[2]];
					var w = rotateAround(corner, R, origin);
					for (var k = 0; k < 3; k++) {
						if (w[k] < min[k]) min[k] = w[k];
						if (w[k] > max[k]) max[k] = w[k];
					}
				}
			}
		}

		// Remap faces: each face moves to the side its normal points to after rotation.
		var oldFaces = {};
		FACE_KEYS.forEach(function (key) {
			if (cube.faces[key]) oldFaces[key] = cube.faces[key].getSaveCopy ? cube.faces[key].getSaveCopy() : JSON.parse(JSON.stringify(cube.faces[key]));
		});
		var newFaceData = {};
		FACE_KEYS.forEach(function (srcKey) {
			if (!oldFaces[srcKey]) return;
			var n = FACE_NORMALS[srcKey];
			var rotN = new THREE.Vector3(n[0], n[1], n[2]).applyMatrix4(R);
			var destAxis = snapToAxis(rotN);
			var destKey = FACE_KEYS.find(function (k) { return axisEquals(FACE_NORMALS[k], destAxis); });
			if (destKey) newFaceData[destKey] = { data: oldFaces[srcKey], rotDelta: faceRotationDelta(srcKey, destKey, R) };
		});

		cube.extend({ from: min, to: max, rotation: [0, 0, 0] });
		if (cube.box_uv) {
			// Per-cube (box) UV: geometry drives UV, so just re-map automatically.
			if (typeof cube.mapAutoUV === 'function') cube.mapAutoUV();
		} else {
			FACE_KEYS.forEach(function (key) {
				var entry = newFaceData[key];
				if (entry) {
					cube.faces[key].extend(entry.data);
					cube.faces[key].rotation = ((cube.faces[key].rotation || 0) + entry.rotDelta + 360) % 360;
				}
			});
		}
	}

	// In-plane texture rotation (multiple of 90°) induced when a face is rotated
	// from srcKey to destKey. Derived by tracking the face's U tangent through R.
	function faceRotationDelta(srcKey, destKey, R) {
		var srcU = faceTangentU(srcKey);
		var rotU = new THREE.Vector3(srcU[0], srcU[1], srcU[2]).applyMatrix4(R);
		var destU = faceTangentU(destKey);
		var destV = faceTangentV(destKey);
		var du = new THREE.Vector3(destU[0], destU[1], destU[2]);
		var dv = new THREE.Vector3(destV[0], destV[1], destV[2]);
		var dotU = round(rotU.dot(du));
		var dotV = round(rotU.dot(dv));
		if (dotU > 0.5) return 0;
		if (dotV > 0.5) return 90;
		if (dotU < -0.5) return 180;
		if (dotV < -0.5) return 270;
		return 0;
	}

	// Canonical U (texture-right) tangent for each face direction.
	function faceTangentU(key) {
		switch (key) {
			case 'north': return [-1, 0, 0];
			case 'south': return [1, 0, 0];
			case 'east': return [0, 0, 1];
			case 'west': return [0, 0, -1];
			case 'up': return [1, 0, 0];
			case 'down': return [1, 0, 0];
		}
		return [1, 0, 0];
	}
	// Canonical V (texture-down) tangent for each face direction.
	function faceTangentV(key) {
		switch (key) {
			case 'up': return [0, 0, 1];
			case 'down': return [0, 0, -1];
			default: return [0, -1, 0];
		}
	}

	// Bake rotation into a mesh's vertices, then zero the rotation.
	function freezeMeshRotation(mesh) {
		if (isZeroRotation(mesh.rotation)) return;
		var order = getRotationOrder(mesh);
		var R = rotationMatrix(mesh.rotation, order);
		var origin = mesh.origin.slice();
		for (var key in mesh.vertices) {
			var v = mesh.vertices[key];
			var w = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(R); // vertices are relative to origin
			mesh.vertices[key] = [round(w.x), round(w.y), round(w.z)];
		}
		mesh.rotation = [0, 0, 0];
		mesh.origin = origin;
	}

	// Freeze a group's rotation onto its direct children, then zero the group rotation.
	function freezeGroupRotation(group) {
		if (isZeroRotation(group.rotation)) return;
		var order = getRotationOrder(group);
		var Rg = rotationMatrix(group.rotation, order);
		var gO = group.origin.slice();

		(group.children || []).forEach(function (child) {
			var newOrigin = rotateAround(child.origin, Rg, gO);
			var delta = [newOrigin[0] - child.origin[0], newOrigin[1] - child.origin[1], newOrigin[2] - child.origin[2]];

			if (isCube(child) || isMesh(child)) {
				var childR = rotationMatrix(child.rotation || [0, 0, 0], getRotationOrder(child));
				var combined = new THREE.Matrix4().multiplyMatrices(Rg, childR);
				child.origin = newOrigin;
				if (isCube(child)) {
					child.from = [child.from[0] + delta[0], child.from[1] + delta[1], child.from[2] + delta[2]];
					child.to = [child.to[0] + delta[0], child.to[1] + delta[1], child.to[2] + delta[2]];
					child.rotation = eulerFromMatrix(combined, getRotationOrder(child));
				} else {
					// Mesh: shift vertices with the origin and fold rotation in.
					child.rotation = eulerFromMatrix(combined, getRotationOrder(child));
				}
			} else if (typeof Group !== 'undefined' && child instanceof Group) {
				var subR = rotationMatrix(child.rotation || [0, 0, 0], getRotationOrder(child));
				var subCombined = new THREE.Matrix4().multiplyMatrices(Rg, subR);
				child.origin = newOrigin;
				child.rotation = eulerFromMatrix(subCombined, getRotationOrder(child));
			}
		});

		group.rotation = [0, 0, 0];
	}

	function freezeRotation() {
		var elements = getSelectedElements();
		var groups = getSelectedGroups();
		if (elements.length === 0 && groups.length === 0) { msg('Select a cube, mesh or group first'); return; }

		// Split cubes into orthogonal (bake in place) and arbitrary (need mesh conversion).
		var orthoCubes = [];
		var arbitraryCubes = [];
		var meshes = [];
		elements.forEach(function (el) {
			if (isCube(el)) {
				if (isZeroRotation(el.rotation)) return;
				if (isOrthogonal(el.rotation)) orthoCubes.push(el); else arbitraryCubes.push(el);
			} else if (isMesh(el)) {
				if (!isZeroRotation(el.rotation)) meshes.push(el);
			}
		});

		var canMesh = (typeof BarItems !== 'undefined' && BarItems.convert_to_mesh);
		if (arbitraryCubes.length && !canMesh) {
			msg('Non-90° rotations need mesh support (unavailable in this format)', 2500);
			arbitraryCubes = [];
		}

		// Phase A — bake orthogonal cubes, meshes and groups in one undo step.
		if (orthoCubes.length || meshes.length || groups.length) {
			// Group freezing edits the group's DIRECT child elements too, so include
			// them in the `elements` aspect; `outliner:true` captures group transforms.
			var affected = orthoCubes.concat(meshes);
			groups.forEach(function (g) {
				(g.children || []).forEach(function (c) {
					if ((isCube(c) || isMesh(c)) && affected.indexOf(c) === -1) affected.push(c);
				});
			});
			Undo.initEdit({ elements: affected, outliner: true });
			orthoCubes.forEach(freezeCubeOrthogonal);
			meshes.forEach(freezeMeshRotation);
			groups.forEach(freezeGroupRotation);
			Undo.finishEdit('Freeze rotation');
			refreshCanvas(affected);
		}

		// Phase B — arbitrary-rotation cubes need mesh conversion. The built-in
		// convert_to_mesh action manages its own undo, so it must run OUTSIDE our
		// undo block; the vertex baking is then its own separate undo step.
		var converted = 0;
		if (arbitraryCubes.length) {
			var before = (typeof Mesh !== 'undefined' && Mesh.all) ? Mesh.all.slice() : [];
			try {
				selected.splice(0, selected.length);
				arbitraryCubes.forEach(function (c) { selected.push(c); });
				BarItems.convert_to_mesh.trigger(); // own undo entry
				var newMeshes = ((typeof Mesh !== 'undefined' && Mesh.all) ? Mesh.all : []).filter(function (m) {
					return before.indexOf(m) === -1;
				});
				if (newMeshes.length) {
					Undo.initEdit({ elements: newMeshes });
					newMeshes.forEach(function (m) { freezeMeshRotation(m); converted++; });
					Undo.finishEdit('Freeze rotation (mesh)');
					refreshCanvas(newMeshes);
				}
			} catch (e) {
				msg('Mesh conversion failed for ' + arbitraryCubes.length + ' cube(s)', 2500);
			}
		}

		var total = orthoCubes.length + meshes.length + groups.length + converted;
		if (total === 0) { msg('Nothing to freeze (no rotation)'); return; }
		var m = 'Froze ' + total + ' item(s)';
		if (converted) m += ' (' + converted + ' converted to mesh)';
		msg(m);
	}

	// =====================================================================
	//  Feature 2: Snap to Grid
	// =====================================================================

	function snapValue(v, step) { return round(Math.round(v / step) * step); }

	function openSnapDialog() {
		if (getSelectedElements().length === 0) { msg('Select at least one element'); return; }
		new Dialog({
			id: 'mh_snap_grid',
			title: 'Snap to Grid',
			form: {
				info: { type: 'info', text: 'Rounds the selected elements to a clean grid. Handy to fix dirty coordinates or make Java-valid rotations.' },
				step: { label: 'Position step', type: 'number', value: 1, min: 0.01, max: 16, step: 0.05 },
				snap_position: { label: 'Snap size (from/to)', type: 'checkbox', value: true },
				snap_origin: { label: 'Snap pivot (origin)', type: 'checkbox', value: true },
				snap_rotation: { label: 'Snap rotation', type: 'checkbox', value: false },
				rotation_step: { label: 'Rotation step', type: 'select', value: '22.5', options: { '90': '90°', '45': '45°', '22.5': '22.5°' } },
			},
			onConfirm: function (formData) {
				this.hide();
				applySnap(formData);
			},
		}).show();
	}

	function applySnap(opts) {
		var elements = getSelectedElements();
		if (elements.length === 0) { msg('No elements selected'); return; }
		var step = Number(opts.step);
		if (!isFinite(step) || step <= 0) { msg('Invalid step'); return; }
		var rotStep = Number(opts.rotation_step);

		Undo.initEdit({ elements: elements });
		elements.forEach(function (el) {
			if (opts.snap_position && el.from && el.to) {
				el.from = el.from.map(function (v) { return snapValue(v, step); });
				el.to = el.to.map(function (v) { return snapValue(v, step); });
			}
			if (opts.snap_origin && el.origin) {
				el.origin = el.origin.map(function (v) { return snapValue(v, step); });
			}
			if (opts.snap_rotation && el.rotation) {
				el.rotation = el.rotation.map(function (v) { return snapValue(v, rotStep); });
			}
		});
		Undo.finishEdit('Snap to grid');
		refreshCanvas(elements);
		msg('Snapped ' + elements.length + ' element(s)');
	}

	// =====================================================================
	//  Feature 3: Array / Repeat
	// =====================================================================

	function openArrayDialog() {
		if (getSelectedElements().length === 0) { msg('Select at least one element'); return; }
		new Dialog({
			id: 'mh_array',
			title: 'Array / Repeat',
			form: {
				info: { type: 'info', text: 'Duplicates the selection N times, each copy offset (and optionally rotated) by a fixed increment.' },
				count: { label: 'Copies', type: 'number', value: 3, min: 1, max: 512, step: 1 },
				offset_x: { label: 'Offset X', type: 'number', value: 16, step: 0.5 },
				offset_y: { label: 'Offset Y', type: 'number', value: 0, step: 0.5 },
				offset_z: { label: 'Offset Z', type: 'number', value: 0, step: 0.5 },
				rot_x: { label: 'Rotation step X', type: 'number', value: 0, step: 1 },
				rot_y: { label: 'Rotation step Y', type: 'number', value: 0, step: 1 },
				rot_z: { label: 'Rotation step Z', type: 'number', value: 0, step: 1 },
				into_group: { label: 'Group the copies', type: 'checkbox', value: false },
			},
			onConfirm: function (formData) {
				this.hide();
				applyArray(formData);
			},
		}).show();
	}

	function applyArray(opts) {
		var bases = getSelectedElements();
		if (bases.length === 0) { msg('No elements selected'); return; }
		var count = Math.round(Number(opts.count));
		if (!isFinite(count) || count < 1) { msg('Invalid copy count'); return; }
		var offset = [Number(opts.offset_x) || 0, Number(opts.offset_y) || 0, Number(opts.offset_z) || 0];
		var rot = [Number(opts.rot_x) || 0, Number(opts.rot_y) || 0, Number(opts.rot_z) || 0];

		Undo.initEdit({ elements: [], outliner: true });
		var created = [];
		bases.forEach(function (base) {
			if (typeof base.duplicate !== 'function') return;
			for (var i = 1; i <= count; i++) {
				var copy = base.duplicate();
				if (!copy) continue;
				var d = [offset[0] * i, offset[1] * i, offset[2] * i];
				if (copy.from) copy.from = [copy.from[0] + d[0], copy.from[1] + d[1], copy.from[2] + d[2]];
				if (copy.to) copy.to = [copy.to[0] + d[0], copy.to[1] + d[1], copy.to[2] + d[2]];
				if (copy.origin) copy.origin = [copy.origin[0] + d[0], copy.origin[1] + d[1], copy.origin[2] + d[2]];
				if (copy.vertices) {
					for (var vk in copy.vertices) {
						copy.vertices[vk] = [copy.vertices[vk][0] + d[0], copy.vertices[vk][1] + d[1], copy.vertices[vk][2] + d[2]];
					}
				}
				if (copy.rotation && (rot[0] || rot[1] || rot[2])) {
					copy.rotation = [copy.rotation[0] + rot[0] * i, copy.rotation[1] + rot[1] * i, copy.rotation[2] + rot[2] * i];
				}
				created.push(copy);
			}
		});

		if (opts.into_group && created.length && typeof Group !== 'undefined') {
			try {
				var g = new Group({ name: 'array' }).init();
				created.forEach(function (c) { c.addTo(g); });
			} catch (e) { /* keep copies ungrouped on failure */ }
		}

		Undo.finishEdit('Array', { elements: created, outliner: true });
		refreshCanvas(created);
		msg('Created ' + created.length + ' cop' + (created.length === 1 ? 'y' : 'ies'));
	}

	// =====================================================================
	//  Feature 4: Align & Distribute
	// =====================================================================

	// Axis-aligned bounds of an element on a given axis index (0=x,1=y,2=z).
	function elementBounds(el, axis) {
		if (el.from && el.to) {
			var a = el.from[axis], b = el.to[axis];
			return { min: Math.min(a, b), max: Math.max(a, b) };
		}
		if (el.vertices) {
			var min = Infinity, max = -Infinity;
			for (var k in el.vertices) {
				var base = el.origin ? el.origin[axis] : 0;
				var v = base + el.vertices[k][axis];
				if (v < min) min = v; if (v > max) max = v;
			}
			return { min: min, max: max };
		}
		var o = el.origin ? el.origin[axis] : 0;
		return { min: o, max: o };
	}

	function translateElement(el, axis, delta) {
		if (el.from) el.from[axis] = round(el.from[axis] + delta);
		if (el.to) el.to[axis] = round(el.to[axis] + delta);
		if (el.origin) el.origin[axis] = round(el.origin[axis] + delta);
	}

	function openAlignDialog() {
		if (getSelectedElements().length < 2) { msg('Select at least 2 elements'); return; }
		new Dialog({
			id: 'mh_align',
			title: 'Align & Distribute',
			form: {
				info: { type: 'info', text: 'Align the selected elements on an axis, or distribute them evenly (needs 3+).' },
				axis: { label: 'Axis', type: 'select', value: '0', options: { '0': 'X', '1': 'Y', '2': 'Z' } },
				mode: { label: 'Mode', type: 'select', value: 'center', options: { min: 'Align Min', center: 'Align Center', max: 'Align Max', distribute: 'Distribute Evenly' } },
			},
			onConfirm: function (formData) {
				this.hide();
				applyAlign(Number(formData.axis), formData.mode);
			},
		}).show();
	}

	function applyAlign(axis, mode) {
		var elements = getSelectedElements();
		if (elements.length < 2) { msg('Select at least 2 elements'); return; }

		var infos = elements.map(function (el) {
			var b = elementBounds(el, axis);
			return { el: el, min: b.min, max: b.max, center: (b.min + b.max) / 2 };
		});

		if (mode === 'distribute') {
			if (infos.length < 3) { msg('Distribute needs at least 3 elements'); return; }
			infos.sort(function (a, b) { return a.center - b.center; });
			var first = infos[0].center, last = infos[infos.length - 1].center;
			var stepD = (last - first) / (infos.length - 1);
			Undo.initEdit({ elements: elements });
			infos.forEach(function (info, i) {
				var target = first + stepD * i;
				translateElement(info.el, axis, target - info.center);
			});
			Undo.finishEdit('Distribute elements');
		} else {
			var targetVal;
			if (mode === 'min') targetVal = Math.min.apply(null, infos.map(function (i) { return i.min; }));
			else if (mode === 'max') targetVal = Math.max.apply(null, infos.map(function (i) { return i.max; }));
			else {
				var lo = Math.min.apply(null, infos.map(function (i) { return i.min; }));
				var hi = Math.max.apply(null, infos.map(function (i) { return i.max; }));
				targetVal = (lo + hi) / 2;
			}
			Undo.initEdit({ elements: elements });
			infos.forEach(function (info) {
				var cur = mode === 'min' ? info.min : (mode === 'max' ? info.max : info.center);
				translateElement(info.el, axis, targetVal - cur);
			});
			Undo.finishEdit('Align elements');
		}

		refreshCanvas(elements);
		msg(mode === 'distribute' ? 'Distributed ' + elements.length + ' elements' : 'Aligned ' + elements.length + ' elements');
	}

	// =====================================================================
	//  Plugin registration
	// =====================================================================

	function register(id, options, click) {
		var action = new Action(id, {
			name: options.name,
			description: options.description,
			icon: options.icon,
			category: 'tools',
			condition: { modes: ['edit'] },
			click: click,
		});
		var menu = 'tools';
		try { MenuBar.addAction(action, menu); } catch (e) { menu = null; }
		registeredActions.push({ action: action, id: id, menu: menu });
	}

	Plugin.register('modeling_helper', {
		title: 'Modeling Helper',
		author: 'CubrixStudio',
		description: 'Modeling helpers for Blockbench: freeze/apply rotation, snap to grid, array/repeat, and align & distribute.',
		about: 'Modeling Helper adds handy utilities to the Blockbench Edit mode, all operating on the current selection and fully undoable:\n\n' +
			'- **Freeze Rotation** — bake an element\'s (or group\'s) rotation into its geometry so the Rotation field returns to 0 without the shape moving. 90° rotations stay as clean cubes; arbitrary angles are converted to a mesh.\n' +
			'- **Snap to Grid** — round position, pivot and rotation of the selection to a clean grid (fixes dirty coordinates, makes Java-valid rotations).\n' +
			'- **Array / Repeat** — duplicate the selection N times with a position offset and optional rotation increment.\n' +
			'- **Align & Distribute** — align selected elements (min/center/max) on an axis, or distribute them evenly.',
		icon: 'view_in_ar',
		version: '1.0.0',
		variant: 'both',
		min_version: '4.9.0',
		tags: ['Modeling', 'Edit'],

		onload: function () {
			register('mh_freeze_rotation', { name: 'Freeze Rotation', description: 'Bake the rotation of the selected cubes / meshes / groups into their geometry', icon: 'ac_unit' }, freezeRotation);
			register('mh_snap_grid', { name: 'Snap to Grid...', description: 'Round position, pivot and rotation of the selection to a grid', icon: 'grid_on' }, openSnapDialog);
			register('mh_array', { name: 'Array / Repeat...', description: 'Duplicate the selection N times with a fixed offset and rotation increment', icon: 'apps' }, openArrayDialog);
			register('mh_align', { name: 'Align & Distribute...', description: 'Align selected elements on an axis or distribute them evenly', icon: 'align_horizontal_center' }, openAlignDialog);
		},

		onunload: function () {
			registeredActions.forEach(function (entry) {
				if (entry.menu) {
					try { MenuBar.removeAction(entry.menu + '.' + entry.id); } catch (e) { /* ignore */ }
				}
				if (entry.action) entry.action.delete();
			});
			registeredActions = [];
		},
	});
})();
