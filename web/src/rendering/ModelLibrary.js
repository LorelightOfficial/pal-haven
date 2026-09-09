/* Babylon asset containers for imported GLB creatures.
 *
 * One AssetContainer per stored asset id acts as a template. Container
 * contents are deliberately NOT added to the scene, so a template renders
 * nothing; ModelInstance clones from it per creature.
 *
 * Verified against Babylon 9.25.0 with a rigged/textured fixture:
 *   - in a right-handed scene the loader adds a __root__ node with scaling
 *     1,1,1, i.e. no Z flip, so glTF metres/axes survive untouched
 *   - texture V axis needs no correction (invertY stays false)
 *   - glTF winding is front-facing, so imported meshes keep back-face culling
 */

const GLB_MIME = "model/gltf-binary";

export class ModelLibrary {
	constructor(scene) {
		this.scene = scene;
		this.containers = new Map();
		this.pending = new Map();
	}

	/** Load (or reuse) the template container for `key`. */
	async load(key, buffer) {
		const cached = this.containers.get(key);
		if (cached) return cached;
		const inflight = this.pending.get(key);
		if (inflight) return inflight;
		const job = this._read(buffer)
			.then((container) => {
				this.containers.set(key, container);
				this.pending.delete(key);
				return container;
			})
			.catch((error) => {
				this.pending.delete(key);
				throw error;
			});
		this.pending.set(key, job);
		return job;
	}

	has(key) {
		return this.containers.has(key);
	}

	async _read(buffer) {
		if (typeof BABYLON === "undefined")
			throw Error(
				"Babylon.js runtime is missing. vendor/babylon/babylon.js must load before src/app.js.",
			);
		if (!BABYLON.SceneLoader?.IsPluginForExtensionAvailable?.(".glb"))
			throw Error(
				"The glTF loader is missing. vendor/babylon/babylon.glTF2FileLoader.min.js must load before src/app.js.",
			);
		// Assets arrive as IndexedDB blobs, so load through an object URL. The
		// app CSP allows blob: for default-src/connect-src.
		const url = URL.createObjectURL(new Blob([buffer], { type: GLB_MIME }));
		try {
			const container =
				typeof BABYLON.LoadAssetContainerAsync === "function"
					? await BABYLON.LoadAssetContainerAsync(url, this.scene, {
							pluginExtension: ".glb",
						})
					: await BABYLON.SceneLoader.LoadAssetContainerAsync(
							"",
							url,
							this.scene,
							null,
							".glb",
						);
			for (const group of container.animationGroups) group.stop();
			return container;
		} finally {
			URL.revokeObjectURL(url);
		}
	}

	/** Drop a template. Instances already cloned from it stay valid. */
	release(key) {
		const container = this.containers.get(key);
		if (!container) return;
		this.containers.delete(key);
		try {
			container.dispose();
		} catch {
			/* already gone with the scene */
		}
	}

	dispose() {
		for (const key of [...this.containers.keys()]) this.release(key);
		this.pending.clear();
	}
}
