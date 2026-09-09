/* Material adapter: Pal Haven material records -> Babylon materials.
 *
 * Record shape (from geometry.js material() and glb.js):
 *   { color:[r,g,b,a], roughness, normalScale, alphaCutoff,
 *     texture, normalTexture, transparent, contact, unlit }
 *
 * Mapping:
 *   unlit / lines  -> StandardMaterial with lighting disabled (cheapest)
 *   contact        -> StandardMaterial + procedural radial opacity texture,
 *                     reproducing the old shader's fake contact shadow exactly
 *   everything else-> PBRMaterial (metallic 0, roughness from the record)
 *
 * Materials are cached by record identity plus a variant key, mirroring the
 * old renderer's per-object caches.
 */

const CONTACT_SIZE = 128;
const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class MaterialFactory {
  constructor(scene, preset) {
    this.scene = scene;
    this.preset = preset;
    this.materials = new Map();
    this.textures = new Map();
    this._contactTexture = null;
  }

  setPreset(preset) {
    this.preset = preset;
  }

  /* Textures ------------------------------------------------------------- */

  /** Accepts the ImageBitmap / HTMLCanvasElement that glb.js decodes. */
  texture(source) {
    if (!source) return null;
    const cached = this.textures.get(source);
    if (cached) return cached;

    const width = source.width || 1;
    const height = source.height || 1;
    // invertY false keeps glTF's top-left UV origin, matching the old
    // UNPACK_FLIP_Y_WEBGL=false upload.
    const tex = new BABYLON.DynamicTexture(
      `pal-tex-${this.textures.size}`,
      { width, height },
      this.scene,
      true,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
      BABYLON.Constants.TEXTUREFORMAT_RGBA,
      false,
    );
    const ctx = tex.getContext();
    ctx.drawImage(source, 0, 0, width, height);
    tex.update(false);
    tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = this.preset.tier === "low" ? 1 : 4;
    this.textures.set(source, tex);
    return tex;
  }

  /** exp(-3.8 d^2) * (1 - smoothstep(0.72, 1, d)) baked into an alpha map. */
  contactTexture() {
    if (this._contactTexture) return this._contactTexture;
    const tex = new BABYLON.DynamicTexture(
      "pal-contact-falloff",
      { width: CONTACT_SIZE, height: CONTACT_SIZE },
      this.scene,
      true,
      BABYLON.Texture.BILINEAR_SAMPLINGMODE,
      BABYLON.Constants.TEXTUREFORMAT_RGBA,
      false,
    );
    const ctx = tex.getContext();
    const image = ctx.createImageData(CONTACT_SIZE, CONTACT_SIZE);
    for (let y = 0; y < CONTACT_SIZE; y++) {
      for (let x = 0; x < CONTACT_SIZE; x++) {
        // plane(2) spans -1..1 in local X/Z, which is what the shader sampled.
        const u = ((x + 0.5) / CONTACT_SIZE) * 2 - 1;
        const v = ((y + 0.5) / CONTACT_SIZE) * 2 - 1;
        const d = Math.hypot(u, v);
        const a = Math.exp(-3.8 * d * d) * (1 - smoothstep(0.72, 1, d));
        const i = (y * CONTACT_SIZE + x) * 4;
        image.data[i] = 255;
        image.data[i + 1] = 255;
        image.data[i + 2] = 255;
        image.data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
    tex.update(false);
    tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    tex.hasAlpha = true;
    this._contactTexture = tex;
    return tex;
  }

  /* Materials ------------------------------------------------------------ */

  /**
   * @param {object} record material record (may be undefined)
   * @param {{flash?:boolean, wire?:boolean, lines?:boolean}} variant
   */
  get(record, variant = {}) {
    const m = record || {};
    const flash = !!variant.flash;
    const wire = !!variant.wire;
    const lines = !!variant.lines;
    const key = `${flash ? "f" : ""}${wire ? "w" : ""}${lines ? "l" : ""}` || "base";

    let bucket = this.materials.get(m);
    if (!bucket) {
      bucket = new Map();
      this.materials.set(m, bucket);
    }
    const cached = bucket.get(key);
    if (cached) return cached;

    const built = this._build(m, { flash, wire, lines }, bucket.size);
    bucket.set(key, built);
    return built;
  }

  _build(m, { flash, wire, lines }, index) {
    const color = m.color || [1, 1, 1, 1];
    const alpha = color[3] ?? 1;
    const name = `pal-mat-${this.materials.size}-${index}`;
    // The old shader's hit flash: mix(colour, (1, .62, .36), .45)
    const tint = (c, i) => (flash ? c * 0.55 + [1, 0.62, 0.36][i] * 0.45 : c);
    const rgb = new BABYLON.Color3(tint(color[0], 0), tint(color[1], 1), tint(color[2], 2));

    if (m.contact) {
      const mat = new BABYLON.StandardMaterial(name, this.scene);
      mat.disableLighting = true;
      mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
      mat.emissiveColor = rgb;
      mat.specularColor = new BABYLON.Color3(0, 0, 0);
      mat.opacityTexture = this.contactTexture();
      mat.alpha = alpha;
      mat.backFaceCulling = false;
      mat.separateCullingPass = false;
      mat.disableDepthWrite = true;
      mat.freeze();
      return mat;
    }

    if (m.unlit || lines) {
      const mat = new BABYLON.StandardMaterial(name, this.scene);
      mat.disableLighting = true;
      mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
      mat.emissiveColor = rgb;
      mat.specularColor = new BABYLON.Color3(0, 0, 0);
      mat.alpha = alpha;
      mat.wireframe = wire;
      // The legacy renderer never called gl.enable(gl.CULL_FACE), so every
      // surface was double-sided. Keep that: procedural geometry here is
      // CCW-front, but Batcher output and imported STL winding are not
      // guaranteed, and culling would silently erase flat ground/ring quads.
      mat.backFaceCulling = false;
      if (m.texture) {
        mat.emissiveTexture = this.texture(m.texture);
        mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
      }
      if (m.transparent || alpha < 1) mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      if (lines) mat.fillMode = BABYLON.Material.LineListDrawMode;
      return mat;
    }

    const mat = new BABYLON.PBRMaterial(name, this.scene);
    mat.albedoColor = rgb;
    mat.metallic = 0;
    mat.roughness = m.roughness ?? 0.88;
    mat.alpha = alpha;
    mat.wireframe = wire;
    // Double-sided to match the legacy renderer (it never enabled CULL_FACE).
    // twoSidedLighting flips the normal on back faces so those faces stay lit
    // instead of rendering black under PBR.
    mat.backFaceCulling = false;
    mat.twoSidedLighting = true;
    mat.maxSimultaneousLights = this.preset.maxSimultaneousLights;
    mat.enableSpecularAntiAliasing = true;
    // Keep the stylised look: no IBL-driven reflections on plain props.
    mat.environmentIntensity = 0.45;
    mat.usePhysicalLightFalloff = false;

    if (m.texture) {
      mat.albedoTexture = this.texture(m.texture);
      mat.useAlphaFromAlbedoTexture = !!m.transparent || (m.alphaCutoff ?? 0) > 0;
    }
    if (m.normalTexture && this.preset.normalMaps) {
      mat.bumpTexture = this.texture(m.normalTexture);
      mat.bumpTexture.level = m.normalScale ?? 0.5;
      // glTF tangent space; Babylon needs this for correctly oriented normals.
      mat.invertNormalMapX = false;
      mat.invertNormalMapY = false;
    }

    if ((m.alphaCutoff ?? 0) > 0) {
      mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHATEST;
      mat.alphaCutOff = m.alphaCutoff;
    } else if (m.transparent || alpha < 1) {
      mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    } else {
      mat.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
    }

    return mat;
  }

  releaseTexture(source) {
    const tex = this.textures.get(source);
    if (!tex) return;
    try {
      tex.dispose();
    } catch {
      /* disposed with the scene */
    }
    this.textures.delete(source);
  }

  clear() {
    for (const bucket of this.materials.values()) {
      for (const mat of bucket.values()) {
        try {
          mat.dispose(true, false);
        } catch {
          /* disposed with the scene */
        }
      }
    }
    this.materials.clear();
    for (const tex of this.textures.values()) {
      try {
        tex.dispose();
      } catch {
        /* disposed with the scene */
      }
    }
    this.textures.clear();
  }
}
