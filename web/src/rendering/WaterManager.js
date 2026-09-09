/* Water.
 *
 * Stage 10. The old renderer had no water at all: ponds were a flat tinted
 * cylinder disc with a low roughness value. This swaps that disc for
 * BABYLON.WaterMaterial - animated waves, two superimposed moving normal
 * maps, Fresnel and a live reflection of the sky and nearby geometry.
 *
 * Gameplay is untouched. environment.js still emits its pond record (and the
 * navigation grid still treats it as an obstacle); the renderer simply hands
 * records whose material carries `water: true` to this manager instead of the
 * geometry pool. On economy the manager stays inactive and the original disc
 * renders exactly as before, so the cheapest path gains nothing to pay for.
 */

const BUMP_URL = "assets/waterbump.png";

/* A radial grid, not a fan: WaterMaterial displaces vertices, so the surface
 * needs interior rings to show wave height without tenting at the centre. */
const RINGS = 6;
const SEGMENTS = 48;

const DEFAULTS = {
  windForce: -3,
  waveHeight: 0.05,
  waveLength: 0.28,
  waveSpeed: 1.4,
  bumpHeight: 0.45,
  colorBlendFactor: 0.26,
  colorBlendFactor2: 0.16,
};

export class WaterManager {
  constructor(scene, preset) {
    this.scene = scene;
    this.preset = preset || {};
    this.mode = "simple";
    this.mesh = null;
    this.material = null;
    this.bump = null;
    this.reflected = 0;
    this.refractions = false;
    this.limit = 8;
    this.options = { ...DEFAULTS };
    this._size = 0;
    this._seen = false;
    this._picks = [];
    this._geometryBounds = new Map();
    this._matrix = new BABYLON.Matrix();
    this._position = new BABYLON.Vector3();
    this._scale = new BABYLON.Vector3();
    this._rotation = new BABYLON.Quaternion();
    this._warned = false;
    this.apply(this.preset);
  }

  get active() {
    return !!(this.mesh && this.material);
  }

  /** Build, rebuild or drop the water surface for a graphics preset. */
  apply(preset) {
    this.preset = preset || {};
    const tier = this.preset.water;
    const available = !!(typeof BABYLON !== "undefined" && BABYLON.WaterMaterial);
    const wanted = tier === "standard" || tier === "full";
    if (wanted && !available && !this._warned) {
      this._warned = true;
      console.warn(
        "WaterManager: vendor/babylon/babylon.waterMaterial.min.js did not load; keeping the flat water disc.",
      );
    }
    if (!wanted || !available) {
      this._drop();
      this.mode = "simple";
      return this;
    }
    const size = tier === "full" ? 512 : 256;
    if (this.material && this.mode === tier && this._size === size) return this;
    this._drop();
    this._build(tier, size);
    return this;
  }

  /** Adjustable wave and colour knobs, e.g. from a settings screen. */
  configure(options = {}) {
    Object.assign(this.options, options);
    const mat = this.material;
    if (!mat) return this;
    const o = this.options;
    mat.windForce = o.windForce;
    mat.waveHeight = o.waveHeight;
    mat.waveLength = o.waveLength;
    mat.waveSpeed = o.waveSpeed;
    mat.bumpHeight = o.bumpHeight;
    mat.colorBlendFactor = o.colorBlendFactor;
    mat.colorBlendFactor2 = o.colorBlendFactor2;
    return this;
  }

  _build(tier, size) {
    const mesh = new BABYLON.Mesh("pal-water", this.scene);
    this._disc(RINGS, SEGMENTS).applyToMesh(mesh, false);
    mesh.isPickable = false;
    // WaterMaterial has no shadow path, and water never casts.
    mesh.receiveShadows = false;
    mesh.rotationQuaternion = new BABYLON.Quaternion();
    mesh.metadata = { cast: false, water: true };
    mesh.setEnabled(false);

    const mat = new BABYLON.WaterMaterial(
      "pal-water-material",
      this.scene,
      new BABYLON.Vector2(size, size),
    );
    this.bump = new BABYLON.Texture(BUMP_URL, this.scene);
    this.bump.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    this.bump.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    mat.bumpTexture = this.bump;
    mat.backFaceCulling = false;
    mat.windDirection = new BABYLON.Vector2(1, 1);
    mat.waterColor = new BABYLON.Color3(0.16, 0.4, 0.42);
    mat.waterColor2 = new BABYLON.Color3(0.22, 0.5, 0.45);
    /* Two superimposed normal maps read as moving wavelets. The pricier
     * separate-Fresnel and bump-affected reflection paths are HIGH only. */
    mat.bumpSuperimpose = true;
    mat.fresnelSeparate = tier === "full";
    mat.bumpAffectsReflection = tier === "full";
    mesh.material = mat;

    this.mesh = mesh;
    this.material = mat;
    this.mode = tier;
    this._size = size;
    this.refractions = tier === "full" && !!this.preset.waterRefractions;
    this.limit = tier === "full" ? 16 : 8;

    // Half-rate mirror on MEDIUM: the reflection is a mirror render pass.
    const rate =
      tier === "full"
        ? BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME
        : BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYTWOFRAMES;
    if (mat.reflectionTexture) mat.reflectionTexture.refreshRate = rate;
    if (mat.refractionTexture) mat.refractionTexture.refreshRate = rate;

    this.configure(this.options);
    return mesh;
  }

  _drop() {
    if (this.material) {
      try {
        this.material.dispose(true, true);
      } catch {
        /* disposed with the scene */
      }
    }
    if (this.mesh) {
      try {
        this.mesh.dispose(false, false);
      } catch {
        /* disposed with the scene */
      }
    }
    this.material = null;
    this.mesh = null;
    this.bump = null;
    this._size = 0;
    this.reflected = 0;
  }

  /** Radial grid disc of unit radius in the XZ plane. */
  _disc(rings, segments) {
    const positions = [0, 0, 0];
    const normals = [0, 1, 0];
    const uvs = [0.5, 0.5];
    for (let r = 1; r <= rings; r++) {
      const radius = r / rings;
      for (let s = 0; s < segments; s++) {
        const a = (s / segments) * Math.PI * 2;
        const x = Math.cos(a) * radius;
        const z = Math.sin(a) * radius;
        positions.push(x, 0, z);
        normals.push(0, 1, 0);
        uvs.push(0.5 + x * 0.5, 0.5 + z * 0.5);
      }
    }
    const indices = [];
    for (let s = 0; s < segments; s++) {
      indices.push(0, 1 + ((s + 1) % segments), 1 + s);
    }
    for (let r = 1; r < rings; r++) {
      const base = 1 + (r - 1) * segments;
      const next = base + segments;
      for (let s = 0; s < segments; s++) {
        const t = (s + 1) % segments;
        indices.push(base + s, base + t, next + s);
        indices.push(base + t, next + t, next + s);
      }
    }
    const data = new BABYLON.VertexData();
    data.positions = positions;
    data.normals = normals;
    data.uvs = uvs;
    data.indices = indices;
    return data;
  }

  /** Cached XZ radius and top height of a record geometry, in local units. */
  _bounds(geometry) {
    let bounds = this._geometryBounds.get(geometry);
    if (bounds) return bounds;
    const p = geometry.position;
    let rx = 0;
    let rz = 0;
    let top = 0;
    for (let i = 0; i < p.length; i += 3) {
      if (Math.abs(p[i]) > rx) rx = Math.abs(p[i]);
      if (p[i + 1] > top) top = p[i + 1];
      if (Math.abs(p[i + 2]) > rz) rz = Math.abs(p[i + 2]);
    }
    bounds = { rx: rx || 1, rz: rz || 1, top };
    this._geometryBounds.set(geometry, bounds);
    return bounds;
  }

  beginFrame() {
    this._seen = false;
  }

  /**
   * Render a water record. Returns false when water is inactive, so the
   * renderer falls back to the original flat disc.
   */
  place(record) {
    if (!this.active || !record.model) return false;
    BABYLON.Matrix.FromArrayToRef(record.model, 0, this._matrix);
    this._matrix.decompose(this._scale, this._rotation, this._position);
    const bounds = this._bounds(record.geometry);
    const mesh = this.mesh;
    /* Sit on the record's top face, not its centre: the pond disc is a thin
     * cylinder whose surface is what the old renderer showed. */
    mesh.position.set(
      this._position.x,
      this._position.y + bounds.top * this._scale.y,
      this._position.z,
    );
    mesh.rotationQuaternion.copyFrom(this._rotation);
    mesh.scaling.set(
      Math.max(bounds.rx * this._scale.x, 0.01),
      1,
      Math.max(bounds.rz * this._scale.z, 0.01),
    );
    // Exact world bounds this frame, so the frustum test below is honest.
    mesh.computeWorldMatrix(true);
    this._seen = true;
    return true;
  }

  /** Triangles the water surface contributes, for the stats HUD. */
  get triangleCount() {
    return this.mesh && this._seen ? RINGS * SEGMENTS * 2 : 0;
  }

  endFrame(camera = null) {
    if (!this.mesh) return 0;
    this.mesh.setEnabled(this._seen);
    /* WaterMaterial registers its mirror and refraction passes as scene
     * render targets, so they cost a pass every frame even when the pond is
     * behind you. Emptying the lists when the water is off screen keeps that
     * to a bare clear - the single biggest water saving on a phone. */
    const planes = this.scene.frustumPlanes;
    const visible =
      this._seen && (!planes || this.mesh.isInFrustum(planes));
    if (!visible) {
      this._clearLists();
      return 0;
    }
    return this._updateReflection(camera);
  }

  _clearLists() {
    const mat = this.material;
    if (!mat) return;
    if (mat.reflectionTexture && mat.reflectionTexture.renderList)
      mat.reflectionTexture.renderList.length = 0;
    if (mat.refractionTexture && mat.refractionTexture.renderList)
      mat.refractionTexture.renderList.length = 0;
    this.reflected = 0;
  }

  /** Rebuild the mirror render list around the water, nearest first. */
  _updateReflection() {
    const mat = this.material;
    if (!mat) return 0;
    const targets = [];
    if (mat.reflectionTexture) targets.push(mat.reflectionTexture);
    if (mat.refractionTexture) {
      if (this.refractions) targets.push(mat.refractionTexture);
      else if (mat.refractionTexture.renderList)
        mat.refractionTexture.renderList.length = 0;
    }
    if (!targets.length) return 0;

    const picks = this._picks;
    picks.length = 0;
    const wx = this.mesh.position.x;
    const wz = this.mesh.position.z;
    const reach = 26 * 26;
    for (const mesh of this.scene.meshes) {
      if (mesh === this.mesh) continue;
      const meta = mesh.metadata;
      const sky = !!(meta && meta.sky);
      // Overlays (selection rings, rig lines) never belong in a reflection.
      if (!sky && mesh.renderingGroupId !== 0) continue;
      if (!mesh.isVisible || !mesh.isEnabled()) continue;
      if (!sky && !mesh.getTotalVertices()) continue;
      if (sky) {
        picks.unshift({ mesh, d2: -1 });
        continue;
      }
      const p = meta && meta.pooled ? mesh.position : mesh.getAbsolutePosition();
      const dx = p.x - wx;
      const dz = p.z - wz;
      const d2 = dx * dx + dz * dz;
      if (d2 > reach) continue;
      picks.push({ mesh, d2 });
    }
    if (picks.length > this.limit) {
      picks.sort((a, b) => a.d2 - b.d2);
      picks.length = this.limit;
    }
    for (const target of targets) {
      if (!target.renderList) target.renderList = [];
      const list = target.renderList;
      list.length = 0;
      for (const pick of picks) list.push(pick.mesh);
    }
    this.reflected = picks.length;
    return picks.length;
  }

  setPreset(preset) {
    return this.apply(preset);
  }

  dispose() {
    this._drop();
    this._geometryBounds.clear();
  }
}
