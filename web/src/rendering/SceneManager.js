/* Babylon engine + scene lifecycle.
 *
 * Owns the single BABYLON.Engine/BABYLON.Scene pair and every global scene
 * flag that the rest of the rendering layer depends on. The most important of
 * those is useRightHandedSystem: Pal Haven's maths (math.js) is right-handed,
 * +Y up, +Z forward, and yaw is atan2(x, z). Babylon defaults to left-handed,
 * which would silently mirror the world, invert aiming and break the nav grid.
 */

import { graphicsPreset } from "./GraphicsSettings.js";

const WEBGL2_ERROR =
  "WebGL 2 is unavailable. Update Android System WebView / Chrome and enable hardware acceleration.";

export class SceneManager {
  constructor(canvas, { quality = "balanced" } = {}) {
    if (typeof BABYLON === "undefined" || !BABYLON.Engine) {
      throw Error(
        "Babylon.js runtime is missing. vendor/babylon/babylon.js must load before src/app.js.",
      );
    }
    this.canvas = canvas;
    this.preset = graphicsPreset(quality);

    this.engine = new BABYLON.Engine(
      canvas,
      this.preset.antialias,
      {
        alpha: false,
        // The old renderer avoided preserveDrawingBuffer for speed and captured
        // world thumbnails synchronously right after a draw. Babylon renders the
        // same way, so the cheaper flag is kept.
        preserveDrawingBuffer: false,
        stencil: false,
        depth: true,
        powerPreference: "high-performance",
        failIfMajorPerformanceCaveat: false,
        audioEngine: false,
        disableWebGL2Support: false,
      },
      // Pixel ratio is driven by the quality preset, not by the device.
      false,
    );

    if (this.engine.webGLVersion < 2) {
      try {
        this.engine.dispose();
      } catch {
        /* disposing a broken engine is best effort */
      }
      throw Error(WEBGL2_ERROR);
    }

    this.scene = new BABYLON.Scene(this.engine);
    this.scene.useRightHandedSystem = true;
    this.scene.clearColor = new BABYLON.Color4(0.76, 0.84, 0.79, 1);
    this.scene.ambientColor = new BABYLON.Color3(1, 1, 1);
    this.scene.autoClear = true;
    this.scene.autoClearDepthAndStencil = true;

    // input.js owns every pointer and key event on this canvas. Babylon must
    // not preventDefault or run picking, or joystick drag and look-drag break.
    this.scene.preventDefaultOnPointerDown = false;
    this.scene.preventDefaultOnPointerUp = false;
    this.scene.skipPointerMovePicking = true;
    this.scene.constantlyUpdateMeshUnderPointer = false;
    this.scene.pointerMovePredicate = () => false;
    this.scene.pointerDownPredicate = () => false;
    this.scene.pointerUpPredicate = () => false;

    // The game drives rendering from its own fixed-step loop in game.js, so
    // Babylon's animation ratio and render loop stay out of the way.
    this.scene.skipFrustumClipping = false;
    this.scene.blockMaterialDirtyMechanism = false;

    this.pixelRatio = 1;
    this.rect = null;
    this.rectTime = -1e9;
    this._onResize = () => this.measure(true);
    for (const type of ["resize", "orientationchange"]) {
      window.addEventListener(type, this._onResize);
    }
  }

  /* Cached layout read: getBoundingClientRect() every frame caused a
   * synchronous reflow and was one of the main phone stutters. */
  measure(force = false) {
    const now = performance.now();
    if (force || !this.rect || !this.rect.width || now - this.rectTime > 500) {
      const r = this.canvas.getBoundingClientRect();
      this.rect = { width: r.width, height: r.height };
      this.rectTime = now;
    }
    return this.rect;
  }

  resize(ratio = this.pixelRatio) {
    this.pixelRatio = ratio;
    const r = this.measure();
    const w = Math.max(1, Math.round(r.width * ratio));
    const h = Math.max(1, Math.round(r.height * ratio));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.engine.resize(true);
    }
    return { width: w, height: h };
  }

  setQuality(quality) {
    this.preset = graphicsPreset(quality);
    return this.preset;
  }

  dispose() {
    for (const type of ["resize", "orientationchange"]) {
      window.removeEventListener(type, this._onResize);
    }
    try {
      this.scene.dispose();
    } catch {
      /* scene may already be gone */
    }
    try {
      this.engine.dispose();
    } catch {
      /* engine may already be gone */
    }
  }
}

export { WEBGL2_ERROR };
