(function () {
	'use strict';

	// ---- Plugin handles (cleaned up on unload) ----
	let reverseAction;
	let speedAction;
	let menuSeparatorAdded = false;

	// =====================================================================
	//  Helpers
	// =====================================================================

	// Round to a sane precision to avoid floating point drift on keyframe times.
	function round(value) {
		return Math.round(value * 10000) / 10000;
	}

	// Return the currently selected animation, or null with a user message.
	function getActiveAnimation() {
		var anim = (typeof Animation !== 'undefined' && Animation.selected) ? Animation.selected : null;
		if (!anim) {
			Blockbench.showQuickMessage('No animation selected', 1500);
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
		keyframes.forEach(function (kf) { if (kf.time > maxTime) maxTime = kf.time; });
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

	// Refresh the timeline / 3D preview after editing keyframe times.
	function refreshTimeline() {
		try {
			if (typeof updateKeyframeSelection === 'function') updateKeyframeSelection();
		} catch (e) { /* ignore */ }
		try {
			if (typeof Timeline !== 'undefined' && Timeline.updateSize) Timeline.updateSize();
		} catch (e) { /* ignore */ }
		try {
			if (typeof Animator !== 'undefined' && Animator.preview) Animator.preview();
		} catch (e) { /* ignore */ }
	}

	// =====================================================================
	//  Feature: Reverse Animation
	// =====================================================================

	function reverseAnimation() {
		var animation = getActiveAnimation();
		if (!animation) return;

		var keyframes = collectKeyframes(animation);
		if (keyframes.length === 0) {
			Blockbench.showQuickMessage('Animation has no keyframes', 1500);
			return;
		}

		var pivot = getEffectiveLength(animation, keyframes);

		Undo.initEdit({ animations: [animation], keyframes: keyframes });

		keyframes.forEach(function (kf) {
			kf.time = round(Math.max(0, pivot - kf.time));
		});
		sortKeyframes(animation);

		Undo.finishEdit('Reverse animation');
		refreshTimeline();
		Blockbench.showQuickMessage('Animation reversed', 1500);
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
				info: {
					type: 'info',
					text: '100% = original speed. 200% = twice as fast (half the duration). 50% = half speed (double the duration).',
				},
				speed: {
					label: 'Speed (%)',
					type: 'number',
					value: 100,
					min: 1,
					max: 2000,
					step: 5,
				},
				adjust_length: {
					label: 'Adjust animation length',
					type: 'checkbox',
					value: true,
				},
			},
			onConfirm: function (formData) {
				this.hide();
				applySpeed(animation, formData.speed, formData.adjust_length);
			},
		}).show();
	}

	function applySpeed(animation, speedPercent, adjustLength) {
		speedPercent = Number(speedPercent);
		if (!isFinite(speedPercent) || speedPercent <= 0) {
			Blockbench.showQuickMessage('Invalid speed value', 1500);
			return;
		}
		if (speedPercent === 100) {
			Blockbench.showQuickMessage('Speed unchanged (100%)', 1500);
			return;
		}

		// Faster speed -> shorter times. factor = 100 / speed.
		var factor = 100 / speedPercent;

		var keyframes = collectKeyframes(animation);
		if (keyframes.length === 0) {
			Blockbench.showQuickMessage('Animation has no keyframes', 1500);
			return;
		}

		Undo.initEdit({ animations: [animation], keyframes: keyframes });

		keyframes.forEach(function (kf) {
			kf.time = round(kf.time * factor);
		});
		sortKeyframes(animation);

		if (adjustLength && typeof animation.length === 'number' && animation.length > 0) {
			setAnimationLength(animation, animation.length * factor);
		}

		Undo.finishEdit('Apply animation speed');
		refreshTimeline();
		Blockbench.showQuickMessage('Speed applied: ' + speedPercent + '%', 1500);
	}

	// =====================================================================
	//  Plugin registration
	// =====================================================================

	Plugin.register('animation_tools_pro', {
		title: 'Animation Tools Pro',
		author: 'CubrixStudio',
		description: 'Animation helpers for Blockbench: reverse an animation and rescale keyframe timing by a speed percentage.',
		about: 'Animation Tools Pro adds quick utilities to the Blockbench Animate mode:\n\n' +
			'- **Reverse Animation**: mirrors every keyframe in time so the animation plays backwards.\n' +
			'- **Animation Speed**: rescales keyframe timing (and optionally the animation length) by a speed percentage so you can speed up or slow down an animation while keeping its keyframes proportional on the timeline.\n\n' +
			'Both actions operate on the currently selected animation and are fully undoable.',
		icon: 'fast_forward',
		version: '1.0.0',
		variant: 'both',
		min_version: '4.9.0',
		tags: ['Animation', 'Timeline'],

		onload: function () {
			reverseAction = new Action('atp_reverse_animation', {
				name: 'Reverse Animation',
				description: 'Mirror every keyframe in time so the selected animation plays backwards',
				icon: 'swap_horiz',
				category: 'animation',
				condition: { modes: ['animate'] },
				click: reverseAnimation,
			});

			speedAction = new Action('atp_animation_speed', {
				name: 'Animation Speed...',
				description: 'Rescale keyframe timing of the selected animation by a speed percentage',
				icon: 'fast_forward',
				category: 'animation',
				condition: { modes: ['animate'] },
				click: openSpeedDialog,
			});

			// Add to the Animation menu in the menu bar.
			try {
				MenuBar.addAction(reverseAction, 'animation');
				MenuBar.addAction(speedAction, 'animation');
				menuSeparatorAdded = true;
			} catch (e) {
				// Some Blockbench versions name the menu differently; the actions
				// remain available via the Animate-mode toolbars and search.
			}
		},

		onunload: function () {
			if (menuSeparatorAdded) {
				try { MenuBar.removeAction('animation.atp_reverse_animation'); } catch (e) { /* ignore */ }
				try { MenuBar.removeAction('animation.atp_animation_speed'); } catch (e) { /* ignore */ }
			}
			if (reverseAction) reverseAction.delete();
			if (speedAction) speedAction.delete();
			reverseAction = undefined;
			speedAction = undefined;
		},
	});
})();
