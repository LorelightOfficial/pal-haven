/* Scene lighting.
 *
 * Stage 7 target: directional sun + hemispheric ambient + environment light,
 * driven by the existing day/night cycle in environment.js daylight(time).
 *
 * The old renderer baked its lighting into one fragment shader:
 *   shade = mix(GROUND, SKY, n.y*.5+.5) + KEY*max(dot(n,sun),0) + FILL*max(dot(n,fillDir),0)
 * Babylon's HemisphericLight uses exactly the same mix(groundColor, diffuse,
 * dot(n,dir)*.5+.5) formula, so the ambient term ports across one-to-one and
 * the two directional terms become real lights that can also cast shadows.
 *
 * Stage 8 keeps the sun's ShadowGenerator here rather than in a separate
 * manager, so shadow size, filter and reach all follow the same graphics
 * preset as the lights and LOW can drop shadows entirely. Casters are chosen
 * per frame: the nearest preset.shadowCasterLimit meshes within
 * preset.shadowDistance, skipping receive-only surfaces (terrain, water,
 * imported landscapes) and anything unlit, transparent or overlay.
 */

const SKY_TINT = [0.66, 0.7, 0.66];
const GROUND_TINT = [0.4, 0.43, 0.39];
const KEY_TINT = [0.37, 0.34, 0.28];
const FILL_TINT = [0.1, 0.14, 0.17];
const FILL_DIR = [0.7, 0.5, -0.5];

/* Shadowed ground fades towards the ambient sky term instead of going black,
 * which keeps a phone screen readable in daylight. */
const SHADOW_DARKNESS = 0.32;

const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Relative luminance, used to turn the old additive tints into intensities. */
const lum = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

const unit = (c) => {
  const l = lum(c) || 1;
  return new BABYLON.Color3(c[0] / l, c[1] / l, c[2] / l);
};

export class LightingManager {
  constructor(scene, preset) {
    this.scene = scene;
    this.preset = preset;

    this.ambient = new BABYLON.HemisphericLight(
      "ambient",
      new BABYLON.Vector3(0, 1, 0),
      scene,
    );
    this.ambient.diffuse = new BABYLON.Color3(...SKY_TINT);
    this.ambient.groundColor = new BABYLON.Color3(...GROUND_TINT);
    this.ambient.specular = new BABYLON.Color3(0, 0, 0);
    this.ambient.intensity = 1;

    this.sun = new BABYLON.DirectionalLight(
      "sun",
      new BABYLON.Vector3(0.5, -0.9, -0.5),
      scene,
    );
    this.sun.diffuse = unit(KEY_TINT);
    this.sun.specular = new BABYLON.Color3(1, 1, 1);
    this.sun.intensity = lum(KEY_TINT) * 3.4;
    this.sun.shadowMinZ = 1;
    this.sun.shadowMaxZ = preset ? preset.shadowDistance : 45;

    this.fill = new BABYLON.DirectionalLight(
      "fill",
      new BABYLON.Vector3(...norm3(FILL_DIR).map((v) => -v)),
      scene,
    );
    this.fill.diffuse = unit(FILL_TINT);
    this.fill.specular = new BABYLON.Color3(0, 0, 0);
    this.fill.intensity = lum(FILL_TINT) * 3.4;

    this._sunDir = new BABYLON.Vector3(0, -1, 0);

    this.shadows = null;
    this._shadowSize = 0;
    this._casters = [];
    // A fixed ortho frustum is cheaper and steadier than recomputing extends
    // from the caster list every frame.
    this.sun.autoUpdateExtends = false;
    this.sun.shadowFrustumSize = preset ? preset.shadowDistance : 45;
    this._configureShadows();
  }

  /**
   * @param {{sun?:number[], light?:number, sky?:number[]}} environment
   *   The exact object returned by environment.js daylight(time).
   */
  update(environment = {}, camera = null) {
    const sun = norm3(environment.sun || [-0.5, 0.9, 0.5]);
    const level = environment.light ?? 1;

    // environment.sun points towards the sun; a directional light travels away
    // from it.
    this._sunDir.set(-sun[0], -sun[1], -sun[2]);
    this.sun.direction = this._sunDir;

    // Keep the shadow frustum anchored above the camera so a small, sharp map
    // follows the player instead of trying to cover the whole 80m world.
    const cam = this.scene.activeCamera;
    const eye = camera && camera.eye ? camera.eye : null;
    const px = eye ? eye[0] : cam ? cam.position.x : null;
    const py = eye ? eye[1] : cam ? cam.position.y : null;
    const pz = eye ? eye[2] : cam ? cam.position.z : null;
    if (px !== null) {
      const reach = this.sun.shadowMaxZ * 0.5;
      const size = this.sun.shadowFrustumSize || this.sun.shadowMaxZ;
      // Lead the frustum forward so more of a small shadow map lands in front
      // of the player instead of behind them.
      let lx = 0;
      let lz = 0;
      if (eye && camera.target) {
        const dx = camera.target[0] - eye[0];
        const dz = camera.target[2] - eye[2];
        const len = Math.hypot(dx, dz);
        if (len > 1e-4) {
          lx = (dx / len) * size * 0.22;
          lz = (dz / len) * size * 0.22;
        }
      }
      this.sun.position.set(
        px + lx + sun[0] * reach,
        py + Math.max(sun[1], 0.25) * reach,
        pz + lz + sun[2] * reach,
      );
    }

    this.sun.intensity = lum(KEY_TINT) * 3.4 * level;
    this.fill.intensity = lum(FILL_TINT) * 3.4 * level;
    this.ambient.intensity = level;

    // Warmer, dimmer key as the sun drops towards the horizon; the ambient sky
    // term keeps shadowed areas readable instead of going black.
    const height = Math.max(0, Math.min(1, sun[1]));
    const warmth = 1 - Math.min(1, height / 0.45);
    const key = unit(KEY_TINT);
    this.sun.diffuse = new BABYLON.Color3(
      key.r * (1 + 0.22 * warmth),
      key.g * (1 - 0.05 * warmth),
      key.b * (1 - 0.24 * warmth),
    );

    return this;
  }

  /* Shadows -------------------------------------------------------------- */

  /** Create, reconfigure or drop the sun's shadow map for the current preset. */
  _configureShadows() {
    const preset = this.preset || {};
    if (!preset.shadows) {
      this._disposeShadows();
      return null;
    }
    const size = preset.shadowMapSize || 1024;
    if (!this.shadows || this._shadowSize !== size) {
      this._disposeShadows();
      const gen = new BABYLON.ShadowGenerator(size, this.sun);
      gen.setDarkness(SHADOW_DARKNESS);
      // Record meshes are double sided, so lean on a normal offset rather
      // than back-face-only rendering to keep depth acne away.
      gen.bias = 0.0016;
      gen.normalBias = 0.012;
      gen.depthScale = 32;
      gen.transparencyShadow = false;
      gen.forceBackFacesOnly = false;
      this.shadows = gen;
      this._shadowSize = size;
    }
    this._applyFilter();
    return this.shadows;
  }

  _applyFilter() {
    const gen = this.shadows;
    if (!gen) return;
    const filter = (this.preset && this.preset.shadowFilter) || "none";
    gen.usePoissonSampling = false;
    gen.useExponentialShadowMap = false;
    gen.useBlurExponentialShadowMap = false;
    gen.useCloseExponentialShadowMap = false;
    gen.useBlurCloseExponentialShadowMap = false;
    gen.usePercentageCloserFiltering = false;
    gen.useContactHardeningShadow = false;
    gen.useKernelBlur = false;
    if (filter === "exponential") {
      gen.useExponentialShadowMap = true;
    } else if (filter === "blurExponential") {
      gen.useBlurExponentialShadowMap = true;
      gen.useKernelBlur = true;
      gen.blurKernel = 24;
    } else if (filter === "pcf") {
      gen.usePercentageCloserFiltering = true;
      gen.filteringQuality = BABYLON.ShadowGenerator.QUALITY_MEDIUM;
    }
  }

  _disposeShadows() {
    if (!this.shadows) return;
    try {
      this.shadows.dispose();
    } catch {
      /* disposed with the scene */
    }
    this.shadows = null;
    this._shadowSize = 0;
  }

  /**
   * Rebuild this frame's shadow caster list. Called by BabylonRenderer once
   * every record has been positioned, so the distance test sees final
   * transforms.
   * @returns {number} how many meshes cast shadows this frame
   */
  updateShadows(camera = null) {
    const gen = this.shadows;
    if (!gen) return 0;
    const map = gen.getShadowMap();
    if (!map) return 0;
    if (!map.renderList) map.renderList = [];
    const list = map.renderList;
    list.length = 0;

    const preset = this.preset || {};
    const limit = preset.shadowCasterLimit || 12;
    const distance = preset.shadowDistance || 45;
    const reach2 = distance * distance;
    const maxSpan = distance * 1.5;

    const cam = this.scene.activeCamera;
    const eye = camera && camera.eye ? camera.eye : null;
    const ex = eye ? eye[0] : cam ? cam.position.x : 0;
    const ey = eye ? eye[1] : cam ? cam.position.y : 0;
    const ez = eye ? eye[2] : cam ? cam.position.z : 0;

    const found = this._casters;
    found.length = 0;
    for (const mesh of this.scene.meshes) {
      const meta = mesh.metadata;
      if (meta && meta.cast === false) continue;
      if (!mesh.isVisible || !mesh.isEnabled()) continue;
      if (!mesh.getTotalVertices()) continue;

      // Pooled record meshes have no parent, so .position is already world.
      const p = meta && meta.pooled ? mesh.position : mesh.getAbsolutePosition();
      const dx = p.x - ex;
      const dy = p.y - ey;
      const dz = p.z - ez;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > reach2) continue;

      /* Anything wider than the shadow frustum cannot cast usefully and only
       * invites acne, so it receives shadows instead of casting them. */
      const extend = mesh.getBoundingInfo().boundingBox.extendSizeWorld;
      if (extend && Math.max(extend.x, extend.z) * 2 > maxSpan) continue;

      found.push({ mesh, d2 });
    }

    if (found.length > limit) {
      found.sort((a, b) => a.d2 - b.d2);
      found.length = limit;
    }
    for (const item of found) list.push(item.mesh);
    return list.length;
  }

  setPreset(preset) {
    this.preset = preset;
    this.sun.shadowMaxZ = preset.shadowDistance;
    this.sun.shadowFrustumSize = preset.shadowDistance;
    this._configureShadows();
    return this;
  }

  dispose() {
    this._disposeShadows();
    for (const light of [this.ambient, this.sun, this.fill]) {
      try {
        light.dispose();
      } catch {
        /* disposed with the scene */
      }
    }
  }
}
