/* Babylon-backed replacement for GLBInstance.
 *
 * It keeps GLBInstance's public surface exactly, because game.js depends on
 * more than the methods:
 *   view.play(name, { loop, restart, fade })
 *   view.duration()
 *   view.update(dt, { seek, morphWeights })
 *   view.records(instanceMatrix, { wire, rig, flash })
 *   view.release(renderer)
 *   view.time         <- read directly (combat hit timing, clip completion)
 *   view.previous     <- assigned null directly to cancel a blend
 *
 * Gameplay stays the authority on clip time; Babylon only poses the skeleton.
 * That keeps the existing looping/seek/hit-timing behaviour bit-for-bit and
 * makes the lab's scrub-to-time preview exact.
 *
 * records() returns an empty array: the meshes are real scene meshes owned by
 * Babylon, so the per-frame job is to push the gameplay world matrix onto the
 * instance root rather than to emit draw records.
 */
import { clamp } from "../math.js";

const FLASH_TINT = [1, 0.62, 0.36];
const FLASH_MIX = 0.45;
const DEFAULT_FPS = 60;
let counter = 0;

const smoothstep = (f) => f * f * (3 - 2 * f);

export class ModelInstance {
	constructor(container, scene) {
		this.scene = scene;
		this.id = ++counter;

		// cloneMaterials: true so hit flash and wireframe stay per creature.
		const prefix = `pal${this.id}-`;
		this.entries = container.instantiateModelsToScene(
			(name) => `${prefix}${name}`,
			true,
			{ doNotInstantiate: true },
		);

		// A wrapper node carries the gameplay matrix, so any transform the glTF
		// put on its own root is preserved underneath.
		this.node = new BABYLON.TransformNode(`pal-instance-${this.id}`, scene);
		this.node.rotationQuaternion = new BABYLON.Quaternion();
		for (const root of this.entries.rootNodes) root.parent = this.node;

		this.meshes = [];
		for (const root of this.entries.rootNodes)
			for (const mesh of root.getChildMeshes(false))
				if (mesh.getTotalVertices() > 0) {
					// Creatures receive the sun's shadows as well as casting them;
					// LightingManager rebuilds the caster list every frame.
					mesh.receiveShadows = true;
					this.meshes.push(mesh);
				}

		// instantiateModelsToScene renames the clones, animation groups
		// included, so clips are keyed by the name the glTF (and therefore the
		// pal manifest) actually uses.
		this.clips = new Map();
		this.fps = DEFAULT_FPS;
		const source = container.animationGroups;
		const aligned = source.length === this.entries.animationGroups.length;
		this.entries.animationGroups.forEach((group, index) => {
			group.stop();
			const fps =
				group.targetedAnimations[0]?.animation?.framePerSecond || DEFAULT_FPS;
			this.fps = fps;
			const name = aligned
				? source[index].name
				: group.name.startsWith(prefix)
					? group.name.slice(prefix.length)
					: group.name;
			this.clips.set(name, {
				group,
				from: group.from,
				to: group.to,
				duration: Math.max((group.to - group.from) / fps, 1e-4),
				started: false,
			});
		});

		this.clip = "";
		this.time = 0;
		this.loop = true;
		this.previous = null;
		this.fade = 0;
		this.blendTime = 0;
		this.blendMode = "none";
		this.posed = false;
		this._flash = false;
		this._wire = false;
		this._rig = false;
		this._viewer = null;
		this._matrix = new BABYLON.Matrix();
		this._albedo = new Map();
		this._pose = [];
		this.setEnabled(true);
	}

	clipNames() {
		return [...this.clips.keys()];
	}

	setEnabled(on) {
		this.node.setEnabled(on);
	}

	play(name, { loop = true, restart = false, fade = 0.18 } = {}) {
		if (name === this.clip && !restart) return;
		this.previous =
			fade && this.clip ? { clip: this.clip, time: this.time } : null;
		this.fade = fade;
		this.blendTime = 0;
		this.clip = name;
		this.time = 0;
		this.loop = loop;
	}

	duration() {
		return this.clips.get(this.clip)?.duration || 1;
	}

	update(dt, { seek, morphWeights } = {}) {
		const duration = this.duration();
		this.time = seek === undefined ? this.time + dt : clamp(seek, 0, duration);
		if (seek === undefined && this.loop) this.time %= duration;
		else this.time = Math.min(this.time, duration);

		let blend = 1;
		if (this.previous) {
			this.blendTime += dt;
			blend = smoothstep(clamp(this.blendTime / (this.fade || 0.001), 0, 1));
			if (blend >= 1) this.previous = null;
		}

		const previous = this.previous && this.clips.get(this.previous.clip);
		const current = this.clips.get(this.clip);

		// Babylon resolves weighted blending while animatables run, but gameplay
		// owns the clock here so every group stays paused and seeking writes pose
		// values straight through, which means weights never accumulate. Blend the
		// two sampled poses directly instead, the way legacy blendPoses() did.
		if (previous && current && blend < 1) {
			this._sample(previous, this.previous.time);
			this._capture(previous);
			this._sample(current, this.time);
			this._mix(blend);
		} else if (current) {
			this._sample(current, this.time);
		} else if (previous) {
			this._sample(previous, this.previous.time);
		}

		if (morphWeights) this._morph(morphWeights);
		this.posed = true;
	}

	records(instanceMatrix, { wire = false, rig = false, flash = false } = {}) {
		if (!this.posed) this.update(0);
		BABYLON.Matrix.FromArrayToRef(instanceMatrix, 0, this._matrix);
		this._matrix.decompose(
			this.node.scaling,
			this.node.rotationQuaternion,
			this.node.position,
		);
		if (wire !== this._wire) this._setWire(wire);
		if (flash !== this._flash) this._setFlash(flash);
		if (rig !== this._rig) this._setRig(rig);
		return [];
	}

	release() {
		if (this._viewer) {
			try {
				this._viewer.dispose();
			} catch {
				/* already gone */
			}
			this._viewer = null;
		}
		for (const group of this.entries.animationGroups) group.dispose();
		for (const skeleton of this.entries.skeletons) skeleton.dispose();
		// Recurse into children; materials were cloned for this instance so they
		// are disposed with it.
		this.node.dispose(false, true);
		this.clips.clear();
		this.meshes = [];
	}

	_prepare(info) {
		if (info.started) return;
		info.group.start(false, 1, info.from, info.to);
		info.group.pause();
		info.started = true;
	}

	// Babylon only composes bone matrices for meshes it draws, so a culled
	// creature keeps its last pose until it comes back into view. Gameplay
	// reads `time`, never bone matrices, so that stays invisible.
	_sample(info, seconds) {
		this._prepare(info);
		info.group.goToFrame(info.from + seconds * this.fps);
	}

	// Snapshot whatever the outgoing clip just wrote. Reading the animation
	// targets instead of the bones keeps this correct whether the glTF drives
	// bones directly or through linked transform nodes.
	_capture(info) {
		this._pose.length = 0;
		for (const targeted of info.group.targetedAnimations) {
			const property = targeted.animation?.targetProperty;
			if (!property) continue;
			const value = targeted.target?.[property];
			if (value === undefined || value === null) continue;
			this._pose.push({
				target: targeted.target,
				property,
				value: typeof value === "number" ? value : value.clone(),
			});
		}
	}

	// Same maths as the legacy blendPoses(): lerp translation and scale, slerp
	// rotation, from the outgoing pose towards the pose now written. Values are
	// assigned rather than mutated so the setters mark their node dirty.
	_mix(blend) {
		this.blendMode = "pose";
		for (const entry of this._pose) {
			const current = entry.target[entry.property];
			if (typeof current === "number") {
				entry.target[entry.property] =
					entry.value + (current - entry.value) * blend;
			} else if (current instanceof BABYLON.Quaternion) {
				entry.target[entry.property] = BABYLON.Quaternion.Slerp(
					entry.value,
					current,
					blend,
				);
			} else if (current instanceof BABYLON.Vector3) {
				entry.target[entry.property] = BABYLON.Vector3.Lerp(
					entry.value,
					current,
					blend,
				);
			}
		}
	}

	_morph(weights) {
		for (const mesh of this.meshes) {
			const manager = mesh.morphTargetManager;
			if (!manager) continue;
			for (let i = 0; i < manager.numTargets; i++)
				manager.getTarget(i).influence = weights[i] ?? 0;
		}
	}

	_materials() {
		const seen = new Set();
		for (const mesh of this.meshes) {
			const material = mesh.material;
			if (material && !seen.has(material)) seen.add(material);
		}
		return seen;
	}

	_setWire(wire) {
		this._wire = wire;
		for (const material of this._materials()) material.wireframe = wire;
	}

	_setFlash(flash) {
		this._flash = flash;
		for (const material of this._materials()) {
			const target =
				"albedoColor" in material
					? "albedoColor"
					: "diffuseColor" in material
						? "diffuseColor"
						: null;
			if (!target) continue;
			if (!this._albedo.has(material))
				this._albedo.set(material, material[target].clone());
			const base = this._albedo.get(material);
			material[target] = flash
				? new BABYLON.Color3(
						base.r * (1 - FLASH_MIX) + FLASH_TINT[0] * FLASH_MIX,
						base.g * (1 - FLASH_MIX) + FLASH_TINT[1] * FLASH_MIX,
						base.b * (1 - FLASH_MIX) + FLASH_TINT[2] * FLASH_MIX,
					)
				: base.clone();
		}
	}

	_setRig(rig) {
		this._rig = rig;
		const skeleton = this.entries.skeletons[0];
		const mesh = this.meshes[0];
		if (!skeleton || !mesh) return;
		if (rig && !this._viewer && BABYLON.Debug?.SkeletonViewer) {
			this._viewer = new BABYLON.Debug.SkeletonViewer(
				skeleton,
				mesh,
				this.scene,
				false,
				3,
				{ displayMode: BABYLON.Debug.SkeletonViewer.DISPLAY_LINES },
			);
		}
		if (this._viewer) this._viewer.isEnabled = rig;
	}
}
