(function () {
	'use strict';

	// ---- Plugin handles (cleaned up on unload) ----
	var registeredActions = []; // [{ action, menu }]

	// =====================================================================
	//  Generic helpers
	// =====================================================================

	// Round to a sane precision to avoid floating point drift on keyframe times.
	function round(value) {
		return Math.round(value * 10000) / 10000;
	}

	function msg(text, time) {
		Blockbench.showQuickMessage(text, time || 1500);
	}

	// Return the currently selected animation, or null with a user message.
	function getActiveAnimation() {
		var anim = (typeof Animation !== 'undefined' && Animation.selected) ? Animation.selected : null;
		if (!anim) {
			msg('No animation selected');
			return null;
		}
		return anim;
	}

	// List the channel names that hold keyframe arrays for a given animator.
	// BoneAnimator: rotation / position / scale. EffectAnimator: particle / sound / timeline.
	function getAnimatorChannels(animator) {
		if (animator && animator.channels) return Object.keys(animator.channels);
		return ['rotation', 'position', 'scale'];
	}

	// True for bone animators (the ones with transform channels).
	function isBoneAnimator(animator) {
		return !!(animator && (animator.type === 'bone' || (animator.channels && animator.channels.rotation)));
	}

	// Collect every Keyframe across every animator/channel of an animation.
	function collectKeyframes(animation) {
		var keyframes = [];
		if (!animation || !animation.animators) return keyframes;
		for (var uuid in animation.animators) {
			var animator = animation.animators[uuid];
			if (!animator) continue;
			getAnimatorChannels(animator).forEach(function (channel) {
				var arr = animator[channel];
				if (Array.isArray(arr)) {
					arr.forEach(function (kf) { keyframes.push(kf); });
				}
			});
		}
		return keyframes;
	}

	// Re-sort each channel's keyframe array by time (Blockbench expects ascending order).
	function sortKeyframes(animation) {
		if (!animation || !animation.animators) return;
		for (var uuid in animation.animators) {
			var animator = animation.animators[uuid];
			if (!animator) continue;
			getAnimatorChannels(animator).forEach(function (channel) {
				var arr = animator[channel];
				if (Array.isArray(arr)) {
					arr.sort(function (a, b) { return a.time - b.time; });
				}
			});
		}
	}

	// Effective length to use as a pivot: the declared length, but never less than
	// the last keyframe so keyframes can never be pushed to a negative time.
	function getEffectiveLength(animation, keyframes) {
		var maxTime = 0;
		(keyframes || collectKeyframes(animation)).forEach(function (kf) {
			if (kf.time > maxTime) maxTime = kf.time;
		});
		var declared = (typeof animation.length === 'number' && animation.length > 0) ? animation.length : 0;
		return Math.max(declared, maxTime);
	}

	// Set the animation length, preferring the official setter when available.
	function setAnimationLength(animation, length) {
		length = round(Math.max(0, length));
		if (typeof animation.setLength === 'function') {
			animation.setLength(length);
		} else {
			animation.length = length;
		}
	}

	// Returns { keyframes, selectionUsed }: the timeline selection if any, else all keyframes.
	function getSelectionOrAll(animation) {
		var sel = (typeof Timeline !== 'undefined' && Array.isArray(Timeline.selected)) ? Timeline.selected.slice() : [];
		if (sel.length) return { keyframes: sel, selectionUsed: true };
		return { keyframes: collectKeyframes(animation), selectionUsed: false };
	}

	// Copy a keyframe's serializable data (no back-references), optionally with a new time.
	function cloneKeyframeData(kf, time) {
		return {
			time: (time !== undefined ? time : kf.time),
			channel: kf.channel,
			interpolation: kf.interpolation,
			data_points: (kf.data_points || []).map(function (dp) {
				var o = {};
				Object.keys(dp).forEach(function (k) {
					var v = dp[k];
					if (typeof v === 'function') return;
					if (k === 'keyframe' || k === 'uuid' || k === 'parent') return;
					if (v !== null && typeof v === 'object') return; // skip nested refs
					o[k] = v;
				});
				return o;
			}),
			bezier_left_time: kf.bezier_left_time,
			bezier_left_value: kf.bezier_left_value,
			bezier_right_time: kf.bezier_right_time,
			bezier_right_value: kf.bezier_right_value,
		};
	}

	// Create a keyframe on an animator/channel from a cloned data object.
	function createKeyframeFromData(animator, channel, entry) {
		if (typeof animator.createKeyframe !== 'function') return null;
		var data = {
			channel: channel,
			data_points: entry.data_points,
			interpolation: entry.interpolation,
		};
		if (entry.bezier_left_time !== undefined) data.bezier_left_time = entry.bezier_left_time;
		if (entry.bezier_left_value !== undefined) data.bezier_left_value = entry.bezier_left_value;
		if (entry.bezier_right_time !== undefined) data.bezier_right_time = entry.bezier_right_time;
		if (entry.bezier_right_value !== undefined) data.bezier_right_value = entry.bezier_right_value;
		return animator.createKeyframe(data, entry.time, channel, false, false);
	}

	// Refresh the timeline / 3D preview after editing keyframes.
	function refreshTimeline() {
		try { if (typeof updateKeyframeSelection === 'function') updateKeyframeSelection(); } catch (e) { /* ignore */ }
		try { if (typeof Timeline !== 'undefined' && Timeline.updateSize) Timeline.updateSize(); } catch (e) { /* ignore */ }
		try { if (typeof Animator !== 'undefined' && Animator.preview) Animator.preview(); } catch (e) { /* ignore */ }
	}

	// =====================================================================
	//  Feature: Reverse Animation
	// =====================================================================

	function reverseAnimation() {
		var animation = getActiveAnimation();
		if (!animation) return;

		var keyframes = collectKeyframes(animation);
		if (keyframes.length === 0) { msg('Animation has no keyframes'); return; }

		var pivot = getEffectiveLength(animation, keyframes);

		Undo.initEdit({ animations: [animation], keyframes: keyframes });
		keyframes.forEach(function (kf) {
			kf.time = round(Math.max(0, pivot - kf.time));
		});
		sortKeyframes(animation);
		Undo.finishEdit('Reverse animation');

		refreshTimeline();
		msg('Animation reversed');
	}

	// =====================================================================
	//  Feature: Animation Speed
	// =====================================================================

	function openSpeedDialog() {
		var animation = getActiveAnimation();
		if (!animation) return;

		new Dialog({
			id: 'atp_speed',
			title: 'Animation Speed',
			form: {
				info: { type: 'info', text: '100% = original speed. 200% = twice as fast (half the duration). 50% = half speed (double the duration).' },
				speed: { label: 'Speed (%)', type: 'number', value: 100, min: 1, max: 2000, step: 5 },
				adjust_length: { label: 'Adjust animation length', type: 'checkbox', value: true },
			},
			onConfirm: function (formData) {
				this.hide();
				applySpeed(animation, formData.speed, formData.adjust_length);
			},
		}).show();
	}

	function applySpeed(animation, speedPercent, adjustLength) {
		speedPercent = Number(speedPercent);
		if (!isFinite(speedPercent) || speedPercent <= 0) { msg('Invalid speed value'); return; }
		if (speedPercent === 100) { msg('Speed unchanged (100%)'); return; }

		var factor = 100 / speedPercent; // faster speed -> shorter times
		var keyframes = collectKeyframes(animation);
		if (keyframes.length === 0) { msg('Animation has no keyframes'); return; }

		Undo.initEdit({ animations: [animation], keyframes: keyframes });
		keyframes.forEach(function (kf) { kf.time = round(kf.time * factor); });
		sortKeyframes(animation);
		if (adjustLength && typeof animation.length === 'number' && animation.length > 0) {
			setAnimationLength(animation, animation.length * factor);
		}
		Undo.finishEdit('Apply animation speed');

		refreshTimeline();
		msg('Speed applied: ' + speedPercent + '%');
	}

	// =====================================================================
	//  Feature: Stretch to Length (timing in seconds)
	// =====================================================================

	function openStretchDialog() {
		var animation = getActiveAnimation();
		if (!animation) return;
		var current = getEffectiveLength(animation);

		new Dialog({
			id: 'atp_stretch',
			title: 'Stretch to Length',
			form: {
				info: { type: 'info', text: 'Current length: ' + round(current) + 's. All keyframes are rescaled proportionally to fit the target length.' },
				length: { label: 'Target length (s)', type: 'number', value: round(current || 1), min: 0.01, max: 100000, step: 0.05 },
			},
			onConfirm: function (formData) {
				this.hide();
				applyStretch(animation, formData.length);
			},
		}).show();
	}

	function applyStretch(animation, target) {
		target = Number(target);
		if (!isFinite(target) || target <= 0) { msg('Invalid length value'); return; }

		var keyframes = collectKeyframes(animation);
		if (keyframes.length === 0) { msg('Animation has no keyframes'); return; }

		var current = getEffectiveLength(animation, keyframes);
		if (current <= 0) { msg('Animation length is 0'); return; }

		var factor = target / current;
		Undo.initEdit({ animations: [animation], keyframes: keyframes });
		keyframes.forEach(function (kf) { kf.time = round(kf.time * factor); });
		sortKeyframes(animation);
		setAnimationLength(animation, target);
		Undo.finishEdit('Stretch animation');

		refreshTimeline();
		msg('Stretched to ' + round(target) + 's');
	}

	// =====================================================================
	//  Feature: Shift Keyframes (time offset)
	// =====================================================================

	function openShiftDialog() {
		var animation = getActiveAnimation();
		if (!animation) return;
		var sel = getSelectionOrAll(animation);

		new Dialog({
			id: 'atp_shift',
			title: 'Shift Keyframes',
			form: {
				info: { type: 'info', text: sel.selectionUsed ? ('Shifting ' + sel.keyframes.length + ' selected keyframe(s).') : 'No selection — shifting all keyframes.' },
				offset: { label: 'Offset (s)', type: 'number', value: 0, step: 0.05 },
				clamp: { label: 'Clamp to 0 (no negative time)', type: 'checkbox', value: true },
				extend: { label: 'Extend animation length if needed', type: 'checkbox', value: true },
			},
			onConfirm: function (formData) {
				this.hide();
				applyShift(animation, formData.offset, formData.clamp, formData.extend);
			},
		}).show();
	}

	function applyShift(animation, offset, clamp, extend) {
		offset = Number(offset);
		if (!isFinite(offset)) { msg('Invalid offset value'); return; }
		if (offset === 0) { msg('Offset is 0'); return; }

		var sel = getSelectionOrAll(animation);
		var kfs = sel.keyframes;
		if (kfs.length === 0) { msg('Animation has no keyframes'); return; }

		Undo.initEdit({ animations: [animation], keyframes: kfs });
		kfs.forEach(function (kf) {
			var t = kf.time + offset;
			if (clamp && t < 0) t = 0;
			kf.time = round(t);
		});
		sortKeyframes(animation);
		if (extend) {
			var max = 0;
			collectKeyframes(animation).forEach(function (kf) { if (kf.time > max) max = kf.time; });
			if (max > (animation.length || 0)) setAnimationLength(animation, max);
		}
		Undo.finishEdit('Shift keyframes');

		refreshTimeline();
		msg('Shifted by ' + offset + 's');
	}

	// =====================================================================
	//  Feature: Snap to FPS
	// =====================================================================

	function openSnapDialog() {
		var animation = getActiveAnimation();
		if (!animation) return;
		var fps = animation.snapping || 24;
		var hasSelection = (typeof Timeline !== 'undefined' && Timeline.selected && Timeline.selected.length > 0);

		new Dialog({
			id: 'atp_snap',
			title: 'Snap Keyframes to FPS',
			form: {
				info: { type: 'info', text: 'Rounds keyframe times to the nearest frame at the given frame rate.' },
				fps: { label: 'Frame rate (fps)', type: 'number', value: fps, min: 1, max: 240, step: 1 },
				selection_only: { label: 'Selected keyframes only', type: 'checkbox', value: hasSelection },
			},
			onConfirm: function (formData) {
				this.hide();
				applySnap(animation, formData.fps, formData.selection_only);
			},
		}).show();
	}

	function applySnap(animation, fps, selectionOnly) {
		fps = Number(fps);
		if (!isFinite(fps) || fps <= 0) { msg('Invalid frame rate'); return; }

		var kfs = selectionOnly
			? ((typeof Timeline !== 'undefined' && Timeline.selected) ? Timeline.selected.slice() : [])
			: collectKeyframes(animation);
		if (kfs.length === 0) { msg('No keyframes to snap'); return; }

		Undo.initEdit({ animations: [animation], keyframes: kfs });
		kfs.forEach(function (kf) { kf.time = round(Math.round(kf.time * fps) / fps); });
		sortKeyframes(animation);
		Undo.finishEdit('Snap keyframes to fps');

		refreshTimeline();
		msg('Snapped to ' + fps + ' fps');
	}

	// =====================================================================
	//  Feature: Ping-Pong / Bounce
	// =====================================================================

	function pingPongAnimation() {
		var animation = getActiveAnimation();
		if (!animation) return;

		var keyframes = collectKeyframes(animation);
		if (keyframes.length === 0) { msg('Animation has no keyframes'); return; }

		var pivot = getEffectiveLength(animation, keyframes);
		if (pivot <= 0) { msg('Animation length is 0'); return; }

		Undo.initEdit({ animations: [animation] });
		for (var uuid in animation.animators) {
			var animator = animation.animators[uuid];
			if (!animator) continue;
			getAnimatorChannels(animator).forEach(function (channel) {
				var arr = animator[channel];
				if (!Array.isArray(arr)) return;
				var existing = arr.slice(); // snapshot before adding new keyframes
				existing.forEach(function (kf) {
					if (kf.time < pivot - 1e-6) { // skip pivot keyframe to avoid a duplicate
						var data = cloneKeyframeData(kf, round(2 * pivot - kf.time));
						createKeyframeFromData(animator, channel, data);
					}
				});
			});
		}
		setAnimationLength(animation, 2 * pivot);
		sortKeyframes(animation);
		Undo.finishEdit('Ping-pong animation');

		refreshTimeline();
		msg('Ping-pong created');
	}

	// =====================================================================
	//  Feature: Toggle Loop Mode (once / loop / hold)
	// =====================================================================

	function toggleLoopMode() {
		var animation = getActiveAnimation();
		if (!animation) return;

		var modes = ['once', 'loop', 'hold'];
		var cur = animation.loop || 'once';
		var next = modes[(modes.indexOf(cur) + 1) % modes.length];

		Undo.initEdit({ animations: [animation] });
		animation.loop = next;
		Undo.finishEdit('Set loop mode');

		refreshTimeline();
		msg('Loop mode: ' + next);
	}

	// =====================================================================
	//  Feature: Set Easing / Interpolation
	// =====================================================================

	function openInterpolationDialog() {
		var animation = getActiveAnimation();
		if (!animation) return;
		var sel = getSelectionOrAll(animation);

		new Dialog({
			id: 'atp_interp',
			title: 'Set Easing / Interpolation',
			form: {
				info: { type: 'info', text: sel.selectionUsed ? ('Applying to ' + sel.keyframes.length + ' selected keyframe(s).') : 'No selection — applying to all keyframes.' },
				mode: {
					label: 'Interpolation',
					type: 'select',
					value: 'linear',
					options: { linear: 'Linear', catmullrom: 'Smooth (Catmull-Rom)', bezier: 'Bezier', step: 'Step / Hold' },
				},
			},
			onConfirm: function (formData) {
				this.hide();
				applyInterpolation(animation, formData.mode);
			},
		}).show();
	}

	function applyInterpolation(animation, mode) {
		var sel = getSelectionOrAll(animation);
		var kfs = sel.keyframes;
		if (kfs.length === 0) { msg('Animation has no keyframes'); return; }

		Undo.initEdit({ animations: [animation], keyframes: kfs });
		kfs.forEach(function (kf) { kf.interpolation = mode; });
		Undo.finishEdit('Set interpolation');

		refreshTimeline();
		msg('Interpolation: ' + mode);
	}

	// =====================================================================
	//  Feature: Toggle Step / Hold
	// =====================================================================

	function toggleStep() {
		var animation = getActiveAnimation();
		if (!animation) return;
		var sel = getSelectionOrAll(animation);
		var kfs = sel.keyframes;
		if (kfs.length === 0) { msg('Animation has no keyframes'); return; }

		var allStep = kfs.every(function (kf) { return kf.interpolation === 'step'; });
		var target = allStep ? 'linear' : 'step';

		Undo.initEdit({ animations: [animation], keyframes: kfs });
		kfs.forEach(function (kf) { kf.interpolation = target; });
		Undo.finishEdit('Toggle step interpolation');

		refreshTimeline();
		msg(target === 'step' ? 'Step interpolation ON' : 'Step interpolation OFF');
	}

	// =====================================================================
	//  Feature: Clean Redundant Keyframes
	// =====================================================================

	function normalizedDataPoints(kf) {
		return (kf.data_points || []).map(function (dp) {
			var o = {};
			['x', 'y', 'z', 'w', 'effect', 'locator', 'script', 'file'].forEach(function (k) {
				if (dp[k] !== undefined) o[k] = String(dp[k]);
			});
			return o;
		});
	}

	function dataPointsEqual(a, b) {
		return JSON.stringify(normalizedDataPoints(a)) === JSON.stringify(normalizedDataPoints(b));
	}

	function cleanRedundantKeyframes() {
		var animation = getActiveAnimation();
		if (!animation) return;

		Undo.initEdit({ animations: [animation] });
		var removed = 0;
		for (var uuid in animation.animators) {
			var animator = animation.animators[uuid];
			if (!animator) continue;
			getAnimatorChannels(animator).forEach(function (channel) {
				var arr = animator[channel];
				if (!Array.isArray(arr) || arr.length < 3) return;
				arr.sort(function (a, b) { return a.time - b.time; });
				var toRemove = [];
				for (var i = 1; i < arr.length - 1; i++) {
					var prev = arr[i - 1], cur = arr[i], next = arr[i + 1];
					if (dataPointsEqual(prev, cur) && dataPointsEqual(cur, next) && cur.interpolation === prev.interpolation) {
						toRemove.push(cur);
					}
				}
				toRemove.forEach(function (kf) {
					var idx = arr.indexOf(kf);
					if (idx > -1) { arr.splice(idx, 1); removed++; }
				});
			});
		}
		Undo.finishEdit('Clean redundant keyframes');

		refreshTimeline();
		msg(removed > 0 ? ('Removed ' + removed + ' keyframe(s)') : 'No redundant keyframes');
	}

	// =====================================================================
	//  Feature: Mirror Left / Right
	// =====================================================================

	// Compute the symmetric bone name (left <-> right). Returns the same name for
	// self-symmetric bones (e.g. body, head).
	function mirrorBoneName(name) {
		if (!name) return name;
		var pairs = [['left', 'right'], ['Left', 'Right'], ['LEFT', 'RIGHT']];
		for (var i = 0; i < pairs.length; i++) {
			var a = pairs[i][0], b = pairs[i][1];
			if (name.indexOf(a) > -1 || name.indexOf(b) > -1) {
				var T = '\u0001'; // unique sentinel so the two tokens swap cleanly
				return name.split(a).join(T).split(b).join(a).split(T).join(b);
			}
		}
		var suffixes = [['_l', '_r'], ['_L', '_R'], ['.l', '.r'], ['.L', '.R']];
		for (var j = 0; j < suffixes.length; j++) {
			var sa = suffixes[j][0], sb = suffixes[j][1];
			if (name.endsWith(sa)) return name.slice(0, -sa.length) + sb;
			if (name.endsWith(sb)) return name.slice(0, -sb.length) + sa;
		}
		// Single capital L/R suffix preceded by a letter or digit (armL <-> armR).
		if (/[a-zA-Z0-9]L$/.test(name)) return name.slice(0, -1) + 'R';
		if (/[a-zA-Z0-9]R$/.test(name)) return name.slice(0, -1) + 'L';
		return name; // self-symmetric
	}

	// Negate a (possibly molang-expression) value.
	function negateValue(v) {
		if (v === undefined || v === null || v === '') return v;
		var num = Number(v);
		if (!isNaN(num) && isFinite(num)) return -num;
		var s = String(v).trim();
		if (s.indexOf('-(') === 0 && s.lastIndexOf(')') === s.length - 1) return s.slice(2, -1); // unwrap
		return '-(' + s + ')';
	}

	function snapshotBoneAnimator(animator) {
		var out = {};
		['rotation', 'position', 'scale'].forEach(function (ch) {
			if (Array.isArray(animator[ch])) {
				out[ch] = animator[ch].map(function (kf) { return cloneKeyframeData(kf, kf.time); });
			}
		});
		return out;
	}

	// Mirror the axes of a bone snapshot: position.x and rotation.y/z are negated.
	function negateBoneSnapshot(snap) {
		var out = {};
		Object.keys(snap).forEach(function (ch) {
			out[ch] = snap[ch].map(function (entry) {
				var e = JSON.parse(JSON.stringify(entry));
				e.data_points = (e.data_points || []).map(function (dp) {
					var d = {};
					Object.keys(dp).forEach(function (k) { d[k] = dp[k]; });
					if (ch === 'position') {
						d.x = negateValue(d.x);
					} else if (ch === 'rotation') {
						d.y = negateValue(d.y);
						d.z = negateValue(d.z);
					}
					return d;
				});
				return e;
			});
		});
		return out;
	}

	function getOrCreateBoneAnimatorByName(animation, name) {
		for (var uuid in animation.animators) {
			var an = animation.animators[uuid];
			if (an && an.name === name && isBoneAnimator(an)) return an;
		}
		var group = (typeof Group !== 'undefined' && Group.all)
			? Group.all.find(function (g) { return g.name === name; })
			: null;
		if (group && typeof animation.getBoneAnimator === 'function') {
			return animation.getBoneAnimator(group);
		}
		return null;
	}

	function clearBoneAnimator(animator) {
		['rotation', 'position', 'scale'].forEach(function (ch) {
			if (Array.isArray(animator[ch])) animator[ch].length = 0;
		});
	}

	function applyBoneSnapshot(animator, snap) {
		Object.keys(snap).forEach(function (ch) {
			snap[ch].forEach(function (entry) {
				createKeyframeFromData(animator, ch, entry);
			});
		});
	}

	function mirrorLeftRight() {
		var animation = getActiveAnimation();
		if (!animation) return;

		// Snapshot all bone animators (originals).
		var snapshot = {};
		for (var uuid in animation.animators) {
			var an = animation.animators[uuid];
			if (an && isBoneAnimator(an)) snapshot[an.name] = snapshotBoneAnimator(an);
		}
		if (Object.keys(snapshot).length === 0) { msg('No bone animation to mirror'); return; }

		// Compute target data: each target bone receives the negated animation of its counterpart.
		var newData = {};
		Object.keys(snapshot).forEach(function (srcName) {
			var tgtName = mirrorBoneName(srcName);
			newData[tgtName] = negateBoneSnapshot(snapshot[srcName]);
		});

		Undo.initEdit({ animations: [animation] });

		// Clear every animator involved (sources + targets), then apply the new data.
		var involved = {};
		Object.keys(snapshot).forEach(function (n) { involved[n] = true; });
		Object.keys(newData).forEach(function (n) { involved[n] = true; });
		Object.keys(involved).forEach(function (name) {
			var an = getOrCreateBoneAnimatorByName(animation, name);
			if (an) clearBoneAnimator(an);
		});
		Object.keys(newData).forEach(function (name) {
			var an = getOrCreateBoneAnimatorByName(animation, name);
			if (an) applyBoneSnapshot(an, newData[name]);
		});

		sortKeyframes(animation);
		Undo.finishEdit('Mirror animation left/right');

		refreshTimeline();
		msg('Animation mirrored L/R');
	}

	// =====================================================================
	//  Plugin registration
	// =====================================================================

	function register(id, options, click) {
		var action = new Action(id, {
			name: options.name,
			description: options.description,
			icon: options.icon,
			category: 'animation',
			condition: { modes: ['animate'] },
			click: click,
		});
		var menu = 'animation';
		try { MenuBar.addAction(action, menu); } catch (e) { menu = null; }
		registeredActions.push({ action: action, id: id, menu: menu });
	}

	Plugin.register('animation_tools_pro', {
		title: 'Animation Tools Pro',
		author: 'CubrixStudio',
		description: 'Animation helpers for Blockbench: reverse, speed/stretch timing, shift, snap to fps, ping-pong, loop mode, easing, cleanup, and left/right mirroring.',
		about: 'Animation Tools Pro adds quick utilities to the Blockbench Animate mode, all operating on the selected animation and fully undoable:\n\n' +
			'**Timing**\n' +
			'- *Reverse Animation* — play the animation backwards.\n' +
			'- *Animation Speed* — rescale keyframe timing by a speed percentage.\n' +
			'- *Stretch to Length* — rescale the animation to a target duration in seconds.\n' +
			'- *Shift Keyframes* — move keyframes (or the selection) by a time offset.\n' +
			'- *Snap to FPS* — round keyframe times to a frame grid.\n\n' +
			'**Loops & playback**\n' +
			'- *Ping-Pong / Bounce* — append a time-mirrored copy for a back-and-forth loop.\n' +
			'- *Toggle Loop Mode* — cycle once / loop / hold.\n\n' +
			'**Keyframes**\n' +
			'- *Set Easing / Interpolation* — linear / smooth / bezier / step on the selection.\n' +
			'- *Toggle Step / Hold* — quick stepped interpolation toggle.\n' +
			'- *Clean Redundant Keyframes* — remove keyframes identical to their neighbours.\n\n' +
			'**Advanced**\n' +
			'- *Mirror Left/Right* — swap symmetric bones and flip axes (great for walk cycles).',
		icon: 'fast_forward',
		version: '1.1.0',
		variant: 'both',
		min_version: '4.9.0',
		tags: ['Animation', 'Timeline'],

		onload: function () {
			// Timing
			register('atp_reverse_animation', { name: 'Reverse Animation', description: 'Mirror every keyframe in time so the animation plays backwards', icon: 'swap_horiz' }, reverseAnimation);
			register('atp_animation_speed', { name: 'Animation Speed...', description: 'Rescale keyframe timing by a speed percentage', icon: 'fast_forward' }, openSpeedDialog);
			register('atp_stretch_length', { name: 'Stretch to Length...', description: 'Rescale the animation to a target duration in seconds', icon: 'open_in_full' }, openStretchDialog);
			register('atp_shift_keyframes', { name: 'Shift Keyframes...', description: 'Move keyframes (or the selection) by a time offset', icon: 'jump_to_element' }, openShiftDialog);
			register('atp_snap_fps', { name: 'Snap to FPS...', description: 'Round keyframe times to the nearest frame at a given frame rate', icon: 'grid_on' }, openSnapDialog);

			// Loops & playback
			register('atp_ping_pong', { name: 'Ping-Pong / Bounce', description: 'Append a time-mirrored copy of the animation for a back-and-forth loop', icon: 'sync_alt' }, pingPongAnimation);
			register('atp_toggle_loop', { name: 'Toggle Loop Mode', description: 'Cycle the animation loop mode: once / loop / hold', icon: 'repeat' }, toggleLoopMode);

			// Keyframes
			register('atp_set_interpolation', { name: 'Set Easing / Interpolation...', description: 'Set the interpolation/easing of the selected keyframes', icon: 'show_chart' }, openInterpolationDialog);
			register('atp_toggle_step', { name: 'Toggle Step / Hold', description: 'Toggle stepped interpolation on the selected keyframes', icon: 'stairs' }, toggleStep);
			register('atp_clean_keyframes', { name: 'Clean Redundant Keyframes', description: 'Remove keyframes whose value matches both neighbours', icon: 'cleaning_services' }, cleanRedundantKeyframes);

			// Advanced
			register('atp_mirror', { name: 'Mirror Left/Right', description: 'Swap symmetric bones and flip axes (mirror the animation)', icon: 'flip' }, mirrorLeftRight);
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
