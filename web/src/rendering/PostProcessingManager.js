/* PostProcessingManager - stage 11 of the Babylon.js migration.
 *
 * The old renderer had no post-processing whatsoever: renderer.js wrote
 * gamma-space colour straight to the default framebuffer. This module adds the
 * configurable pipeline the graphics target asks for - tone mapping, colour
 * grading, bloom, and optional ambient occlusion - built from Babylon's own
 * systems. There is no custom GLSL in here.
 *
 * Two decisions keep this affordable on a phone:
 *
 *  1. Tone mapping and colour grading are configured on
 *     scene.imageProcessingConfiguration, so every PBR and Standard material
 *     applies them inside the shader it is already running. That costs zero
 *     extra passes and zero extra bandwidth. Routing the whole frame through a
 *     DefaultRenderingPipeline just to grade it would have cost a full
 *     offscreen buffer plus a blit on every device, including the low tier.
 *  2. The DefaultRenderingPipeline is therefore only built when an effect
 *     genuinely needs an offscreen buffer, i.e. bloom, and it is built with
 *     imageProcessingEnabled = false so the grade is never applied twice.
 *     Babylon flips ImageProcessingConfiguration.applyByPostProcess whenever an
 *     ImageProcessingPostProcess exists; keeping that post-process out of the
 *     chain leaves the cheap in-shader path in charge.
 *
 * Anti-aliasing: attaching a pipeline routes the scene through an offscreen
 * texture, which bypasses the canvas MSAA SceneManager asked for. FXAA is used
 * in that case instead of MSAA on the render target - one cheap pass, and it
 * cannot collide with the depth prepass SSAO2 needs.
 *
 * Viewport: Babylon renders the scene into a full-canvas texture and blits the
 * result through camera.viewport. The projection maths stay correct (the
 * aspect is taken from the sub-rect and the blit maps NDC back onto it), but
 * the default framebuffer outside the sub-rect is never cleared, which would
 * smear stale pixels around the pal viewer's preview area. The viewer is a
 * studio shot of one creature and needs neither bloom nor SSAO, so the
 * pipelines are detached while a sub-rect is active - see setWindowed.
 */

const EXPOSURE = 1.12;
const CONTRAST = 1.04;

/* Deliberately gentle: a consistent warm-highlight / cool-shadow grade that
 * lifts shadows instead of crushing them. The target is "cinematic but
 * natural", not the dark teal-and-orange look. */
const GRADE = {
  globalSaturation: 6,
  highlightsHue: 40,
  highlightsDensity: 12,
  highlightsSaturation: -6,
  shadowsHue: 210,
  shadowsDensity: 10,
  shadowsExposure: 6,
};

/* Subtle by design: only sky, sunlit highlights and emissive effects reach
 * past the threshold. */
const BLOOM = { threshold: 0.86, weight: 0.15, kernel: 32, scale: 0.5 };

const SSAO = {
  ssaoRatio: 0.5,
  blurRatio: 0.5,
  radius: 1.4,
  totalStrength: 0.7,
  base: 0.18,
  samples: 8,
  maxZ: 40,
  minZAspect: 0.3,
};

function acesOperator() {
  const cfg =
    typeof BABYLON !== "undefined"
      ? BABYLON.ImageProcessingConfiguration
      : null;
  return cfg && typeof cfg.TONEMAPPING_ACES === "number"
    ? cfg.TONEMAPPING_ACES
    : 1;
}

export class PostProcessingManager {
  constructor(scene, preset = {}, camera = null) {
    this.scene = scene;
    this.camera = camera || scene.activeCamera;
    this.preset = preset || {};

    this.pipeline = null;
    this.ssao = null;
    this.curves = null;

    this.toneMapping = false;
    this.colorGrading = false;
    this.bloom = false;
    this.windowed = false;
    this._warned = false;

    // Everything this module changes on the scene is restored by dispose().
    const ip = scene.imageProcessingConfiguration;
    this._defaults = {
      toneMappingEnabled: ip.toneMappingEnabled,
      toneMappingType: ip.toneMappingType,
      exposure: ip.exposure,
      contrast: ip.contrast,
      colorCurvesEnabled: ip.colorCurvesEnabled,
      colorCurves: ip.colorCurves,
      autoClear: scene.autoClear,
      autoClearDepthAndStencil: scene.autoClearDepthAndStencil,
    };

    this.apply(this.preset);
  }

  get active() {
    return !!(this.toneMapping || this.colorGrading || this.bloom || this.ssao);
  }

  /** Which effects are live right now - used by the HUD and the gate. */
  describe() {
    return {
      toneMapping: this.toneMapping,
      colorGrading: this.colorGrading,
      bloom: this.bloom,
      ssao: !!this.ssao,
      windowed: this.windowed,
      pipeline: this.pipeline ? this.pipeline.name : null,
      inShader: !this.scene.imageProcessingConfiguration.applyByPostProcess,
    };
  }

  apply(preset = this.preset) {
    this.preset = preset || {};
    this._imageProcessing(this.preset);
    this._configureBloom(!!this.preset.bloom);
    this._configureSsao(!!this.preset.ssao);
    this._restoreClear();
    return this.describe();
  }

  setPreset(preset) {
    return this.apply(preset);
  }

  /** Follow CameraManager if it ever swaps the active camera. */
  setCamera(camera) {
    if (!camera || camera === this.camera) return;
    const mgr = this.scene.postProcessRenderPipelineManager;
    if (mgr) {
      for (const p of [this.pipeline, this.ssao]) {
        if (!p) continue;
        if (this.camera) mgr.detachCamerasFromRenderPipeline(p.name, this.camera);
        if (!this.windowed) mgr.attachCamerasToRenderPipeline(p.name, camera);
      }
    }
    this.camera = camera;
  }

  /* Tone mapping + colour grading: in-shader, no extra pass ---------------- */

  _imageProcessing(preset) {
    const ip = this.scene.imageProcessingConfiguration;
    const tone = !!preset.toneMapping;
    const grade = !!preset.colorGrading;

    ip.toneMappingEnabled = tone;
    if (tone) {
      ip.toneMappingType = acesOperator();
      ip.exposure = EXPOSURE;
      ip.contrast = CONTRAST;
    } else {
      ip.exposure = this._defaults.exposure;
      ip.contrast = this._defaults.contrast;
    }

    if (grade) {
      if (!this.curves) {
        this.curves = new BABYLON.ColorCurves();
        for (const key of Object.keys(GRADE)) this.curves[key] = GRADE[key];
      }
      ip.colorCurves = this.curves;
      ip.colorCurvesEnabled = true;
    } else {
      ip.colorCurvesEnabled = false;
      ip.colorCurves = this._defaults.colorCurves;
    }

    this.toneMapping = tone;
    this.colorGrading = grade;
  }

  /* Bloom ----------------------------------------------------------------- */

  _configureBloom(wanted) {
    let on = wanted;
    if (on && !(typeof BABYLON !== "undefined" && BABYLON.DefaultRenderingPipeline)) {
      this._warn(
        "vendor/babylon/babylon.js did not expose DefaultRenderingPipeline; skipping bloom.",
      );
      on = false;
    }

    if (!on) {
      if (this.pipeline) {
        this.pipeline.dispose();
        this.pipeline = null;
      }
      this.bloom = false;
      return;
    }

    if (!this.pipeline) {
      this.pipeline = new BABYLON.DefaultRenderingPipeline(
        "pal-post",
        false,
        this.scene,
        this.windowed || !this.camera ? [] : [this.camera],
      );
      // The grade stays in the material shaders - see the header note.
      this.pipeline.imageProcessingEnabled = false;
      this.pipeline.sharpenEnabled = false;
      this.pipeline.grainEnabled = false;
      this.pipeline.chromaticAberrationEnabled = false;
      this.pipeline.depthOfFieldEnabled = false;
      this.pipeline.samples = 1;
      this.pipeline.fxaaEnabled = this.preset.antialias !== false;
    }

    this.pipeline.bloomEnabled = true;
    this.pipeline.bloomThreshold = BLOOM.threshold;
    this.pipeline.bloomWeight = BLOOM.weight;
    this.pipeline.bloomKernel = BLOOM.kernel;
    this.pipeline.bloomScale = BLOOM.scale;
    this.bloom = true;
  }

  /* Ambient occlusion - highest tier only, and only where supported ------- */

  _configureSsao(wanted) {
    const ctor =
      typeof BABYLON !== "undefined" ? BABYLON.SSAO2RenderingPipeline : null;
    let on = wanted;
    if (on && !(ctor && ctor.IsSupported)) {
      this._warn(
        "SSAO2 is unsupported on this device; skipping ambient occlusion.",
      );
      on = false;
    }

    if (!on) {
      if (this.ssao) {
        this.ssao.dispose();
        this.ssao = null;
      }
      return;
    }

    if (this.ssao) return;

    this.ssao = new ctor(
      "pal-ssao",
      this.scene,
      { ssaoRatio: SSAO.ssaoRatio, blurRatio: SSAO.blurRatio },
      this.windowed || !this.camera ? [] : [this.camera],
    );
    this.ssao.radius = SSAO.radius;
    this.ssao.totalStrength = SSAO.totalStrength;
    this.ssao.base = SSAO.base;
    this.ssao.samples = SSAO.samples;
    this.ssao.maxZ = SSAO.maxZ;
    this.ssao.minZAspect = SSAO.minZAspect;
    this.ssao.expensiveBlur = false;
  }

  /* Sub-rect cameras run without the offscreen chain ---------------------- */

  setWindowed(on) {
    const next = !!on;
    if (next === this.windowed) return this.windowed;
    this.windowed = next;

    this._restoreClear();
    const mgr = this.scene.postProcessRenderPipelineManager;
    if (!mgr || !this.camera) return this.windowed;

    for (const p of [this.pipeline, this.ssao]) {
      if (!p) continue;
      if (next) mgr.detachCamerasFromRenderPipeline(p.name, this.camera);
      else mgr.attachCamerasToRenderPipeline(p.name, this.camera);
    }
    this._restoreClear();
    return this.windowed;
  }

  /* DefaultRenderingPipeline switches scene.autoClear off while it is
   * attached so its own first pass can own the clear, and it does not reliably
   * hand the flag back when the pipeline is disposed or detached. A scene left
   * with autoClear off draws every frame on top of stale pixels, which reads as
   * a frozen canvas. Re-assert the flags after every pipeline change. */
  _restoreClear() {
    this.scene.autoClear = this._defaults.autoClear;
    this.scene.autoClearDepthAndStencil = this._defaults.autoClearDepthAndStencil;
    /* Babylon sets applyByPostProcess while an ImageProcessingPostProcess sits
     * in the chain: it tells every material to stop converting to gamma space
     * and hand that job to the post-process. This module never keeps such a
     * post-process, so the flag has to be off, or the scene renders in linear
     * space - dark ground with an unchanged sky, because SkyMaterial has no
     * image processing at all. */
    const ip = this.scene.imageProcessingConfiguration;
    if (ip && !(this.pipeline && this.pipeline.imageProcessingEnabled)) {
      ip.applyByPostProcess = false;
    }
  }

  _warn(message) {
    if (this._warned) return;
    this._warned = true;
    console.warn("PostProcessingManager: " + message);
  }

  dispose() {
    this._configureBloom(false);
    this._configureSsao(false);

    const ip = this.scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = this._defaults.toneMappingEnabled;
    ip.toneMappingType = this._defaults.toneMappingType;
    ip.exposure = this._defaults.exposure;
    ip.contrast = this._defaults.contrast;
    ip.colorCurvesEnabled = this._defaults.colorCurvesEnabled;
    ip.colorCurves = this._defaults.colorCurves;

    this._restoreClear();
    this.curves = null;
    this.toneMapping = false;
    this.colorGrading = false;
    this.windowed = false;
  }
}
