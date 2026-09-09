/* Atmosphere: procedural sky, distance fog and environment (IBL) lighting.
 *
 * Stage 9. The old renderer had no sky at all - it cleared the framebuffer to
 * environment.sky - and its fog was a smoothstep in the fragment shader.
 * Both are replaced with Babylon's own systems:
 *   - BABYLON.SkyMaterial on an infinite-distance skybox (Rayleigh/Mie
 *     scattering), with the sun driven by environment.js daylight(time)
 *   - scene fog, tinted towards the sky and pushed out as the camera climbs
 *   - a ReflectionProbe of that sky as scene.environmentTexture, so PBR
 *     materials pick up real ambient specular instead of nothing
 *
 * Everything is preset-driven: economy keeps the old flat clear colour and no
 * probe, so the cheapest path stays exactly as cheap as it was.
 */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;

/* Warm horizon tint that fog leans towards at sunrise and sunset. */
const HORIZON_WARM = [1, 0.72, 0.48];

/* SkyMaterial models daylight scattering only. With the sun below the horizon
 * its result is essentially black, and over-exposing it yields warm grey
 * rather than night, so a transparent dome carrying the project's own night
 * sky colour is composited over it. That crossfades smoothly and keeps the
 * night sky, the fog and the water agreeing with each other. */
const NIGHT_ALPHA = 0.92;

export class EnvironmentManager {
  constructor(scene, preset) {
    this.scene = scene;
    this.preset = preset || {};
    this.mode = "none";
    this.skybox = null;
    this.sky = null;
    this.nightBox = null;
    this.night = null;
    this.probe = null;
    this._probeSize = 0;
    this._probeSun = null;
    this._probeWarm = 0;
    this._warned = false;
    this.apply(this.preset);
  }

  get active() {
    return this.mode === "procedural";
  }

  /** Rebuild or drop the sky and probe for a graphics preset. */
  apply(preset) {
    this.preset = preset || {};
    const available = !!(typeof BABYLON !== "undefined" && BABYLON.SkyMaterial);
    const wanted = this.preset.sky === "procedural";
    if (wanted && !available && !this._warned) {
      this._warned = true;
      console.warn(
        "EnvironmentManager: vendor/babylon/babylon.skyMaterial.min.js did not load; falling back to a flat sky.",
      );
    }
    if (wanted && available) this._buildSky();
    else this._dropSky();
    this._configureProbe();
    return this;
  }

  _buildSky() {
    if (this.skybox) return this.skybox;
    /* The box must sit inside the camera's far plane or it is clipped away
     * entirely: the usual size-1000 skybox recipe assumes Babylon's default
     * maxZ of 10000, while this project renders to 260. Sizing it from maxZ
     * also lands the faces just past fogFar, so the sky can never hide ground
     * that is still visible through the haze. */
    const maxZ = (this.scene.activeCamera && this.scene.activeCamera.maxZ) || 260;
    const size = Math.max(40, maxZ / 1.2);
    const box = BABYLON.MeshBuilder.CreateBox("pal-sky", { size }, this.scene);
    box.infiniteDistance = true;
    box.isPickable = false;
    box.applyFog = false;
    box.receiveShadows = false;
    // Always active: an infinite-distance box must not be frustum-culled.
    box.alwaysSelectAsActiveMesh = true;
    // Keeps the sky out of the shadow caster scan in LightingManager.
    box.metadata = { cast: false, sky: true };

    const mat = new BABYLON.SkyMaterial("pal-sky-material", this.scene);
    mat.backFaceCulling = false;
    // Depth testing still applies, so world geometry always wins.
    mat.disableDepthWrite = true;
    mat.useSunPosition = true;
    mat.sunPosition = new BABYLON.Vector3(0, 100, 0);
    mat.turbidity = 8;
    mat.rayleigh = 2;
    mat.mieCoefficient = 0.005;
    mat.mieDirectionalG = 0.82;
    mat.luminance = 1;
    box.material = mat;

    /* The night dome: the same infinite-distance box one size smaller, alpha
     * blended over the scattering sky. Transparent meshes draw after opaque
     * ones within a rendering group, so the order is guaranteed, and depth
     * testing still keeps it behind every piece of world geometry. */
    const dome = BABYLON.MeshBuilder.CreateBox(
      "pal-sky-night",
      { size: size * 0.98 },
      this.scene,
    );
    dome.infiniteDistance = true;
    dome.isPickable = false;
    dome.applyFog = false;
    dome.receiveShadows = false;
    dome.alwaysSelectAsActiveMesh = true;
    dome.metadata = { cast: false, sky: true };

    const nightMat = new BABYLON.StandardMaterial(
      "pal-sky-night-material",
      this.scene,
    );
    nightMat.backFaceCulling = false;
    nightMat.disableLighting = true;
    nightMat.disableDepthWrite = true;
    nightMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    nightMat.specularColor = new BABYLON.Color3(0, 0, 0);
    nightMat.emissiveColor = new BABYLON.Color3(0.075, 0.14, 0.18);
    nightMat.alpha = 0;
    dome.material = nightMat;
    dome.setEnabled(false);

    this.nightBox = dome;
    this.night = nightMat;
    this.skybox = box;
    this.sky = mat;
    this.mode = "procedural";
    this._probeSun = null;
    this._probeWarm = 0;
    return box;
  }

  _dropSky() {
    this._dropProbe();
    if (this.night) {
      try {
        this.night.dispose();
      } catch {
        /* disposed with the scene */
      }
    }
    if (this.nightBox) {
      try {
        this.nightBox.dispose(false, false);
      } catch {
        /* disposed with the scene */
      }
    }
    this.night = null;
    this.nightBox = null;
    if (this.sky) {
      try {
        this.sky.dispose();
      } catch {
        /* disposed with the scene */
      }
    }
    if (this.skybox) {
      try {
        this.skybox.dispose(false, false);
      } catch {
        /* disposed with the scene */
      }
    }
    this.sky = null;
    this.skybox = null;
    this.mode = "none";
  }

  /** Small cube probe of the sky, used as the scene's IBL source. */
  _configureProbe() {
    const tier = this.preset.tier;
    const size =
      this.mode === "procedural" && tier !== "low" ? (tier === "medium" ? 64 : 128) : 0;
    if (!size) {
      this._dropProbe();
      return null;
    }
    if (this.probe && this._probeSize === size) return this.probe;
    this._dropProbe();
    const probe = new BABYLON.ReflectionProbe("pal-sky-ibl", size, this.scene);
    probe.renderList.push(this.skybox);
    // The IBL has to see the night tint too, or ambient stays daylight blue.
    if (this.nightBox) probe.renderList.push(this.nightBox);
    probe.cubeTexture.gammaSpace = true;
    probe.refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    this.scene.environmentTexture = probe.cubeTexture;
    this.scene.environmentIntensity = tier === "medium" ? 0.55 : 0.7;
    this.probe = probe;
    this._probeSize = size;
    this._probeSun = null;
    this._probeWarm = 0;
    return probe;
  }

  _dropProbe() {
    if (!this.probe) return;
    if (this.scene.environmentTexture === this.probe.cubeTexture)
      this.scene.environmentTexture = null;
    try {
      this.probe.dispose();
    } catch {
      /* disposed with the scene */
    }
    this.probe = null;
    this._probeSize = 0;
  }

  /**
   * @param {{sky?:number[], sun?:number[], light?:number, fogNear?:number, fogFar?:number}} environment
   *   The exact object returned by environment.js daylight(time).
   * @param {{eye?:number[]}} camera The gameplay camera record.
   */
  update(environment = {}, camera = null) {
    const sky = environment.sky || [0.76, 0.84, 0.79];
    const level = environment.light ?? 1;
    const sun = environment.sun || [-0.5, 0.9, 0.5];
    const len = Math.hypot(sun[0], sun[1], sun[2]) || 1;
    const sx = sun[0] / len;
    const sy = sun[1] / len;
    const sz = sun[2] / len;

    /* daylight() clamps its sun above the horizon so the old lambert term
     * never went fully black. The sky needs the real thing, so recover the
     * day factor from the light level and let the sun actually set. */
    const day = clamp01((level - 0.22) / 0.78);
    const warmth = 1 - clamp01(sy / 0.45);

    this.scene.clearColor.set(sky[0], sky[1], sky[2], 1);

    /* The pal viewer keeps its flat studio backdrop, so the world sky is
     * switched off while the lab is open. */
    const studio = !!environment.studio;
    if (this.skybox) this.skybox.setEnabled(!studio);

    /* Fade the night dome in over the last of dusk - late enough that the
     * procedural sunset keeps its warm band. environment.sky is the project's
     * own day/night ramp, so the night sky matches the fog exactly. */
    if (this.night && this.nightBox) {
      const nightfall = clamp01((0.35 - day) / 0.35);
      const fade = studio ? 0 : nightfall * nightfall * NIGHT_ALPHA;
      this.night.emissiveColor.set(sky[0], sky[1], sky[2]);
      this.night.alpha = fade;
      this.nightBox.setEnabled(fade > 0.004);
    }

    if (this.sky && !studio) {
      /* Only just below the horizon at midnight: the scattering model goes
       * pure black if the sun sinks far, and the world is still lit (daylight
       * clamps its own sun), so a deep twilight blue reads far better. */
      const y = mix(-0.06, sy, day);
      const l = Math.hypot(sx, y, sz) || 1;
      this.sky.sunPosition.set((sx / l) * 400, (y / l) * 400, (sz / l) * 400);
      // Thicker air at low sun gives the warm sunrise/sunset band for free.
      this.sky.turbidity = mix(14, 6, clamp01(y / 0.5));
      this.sky.rayleigh = mix(0.7, 2.1, day);
      /* SkyMaterial treats luminance as an inverse exposure - the shader
       * uses log2(2 / luminance^4) - so a LOWER value brightens the sky.
       * Opening it up a little at dusk keeps the horizon band alive; the
       * night colour itself comes from the dome, not from over-exposure. */
      this.sky.luminance = mix(0.62, 0.98, day);
      this._refreshProbe(y);
    }

    const near = environment.fogNear ?? 28;
    const far = environment.fogFar ?? 95;
    /* Height-aware haze without a custom shader: climbing lifts you out of
     * the thickest air, so the fog band slides away from the camera. */
    const height = Math.max(0, (camera && camera.eye ? camera.eye[1] : 0) - 1.6);
    const lift = clamp01(height / 40);

    this.scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
    this.scene.fogStart = near * (1 + lift * 0.9);
    this.scene.fogEnd = far * (1 + lift * 0.7);

    const tint = 0.35 * warmth * day;
    this.scene.fogColor.set(
      mix(sky[0], HORIZON_WARM[0], tint),
      mix(sky[1], HORIZON_WARM[1], tint),
      mix(sky[2], HORIZON_WARM[2], tint),
    );
    return this;
  }

  /** Re-render the probe while it warms up, then only when the sun moves. */
  _refreshProbe(sunY) {
    const probe = this.probe;
    if (!probe) return;
    const key = Math.round(sunY * 40);
    if (this._probeWarm < 8) {
      this._probeWarm++;
    } else if (this._probeSun === key) {
      return;
    }
    this._probeSun = key;
    probe.refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  }

  setPreset(preset) {
    return this.apply(preset);
  }

  dispose() {
    this._dropSky();
  }
}
