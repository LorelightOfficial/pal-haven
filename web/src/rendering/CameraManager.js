/* Camera bridge.
 *
 * game.js describes its camera as a plain { eye, target, fov, viewport } record
 * and never touched a camera object, so this class keeps that exact contract
 * and drives a Babylon UniversalCamera from it.
 *
 * All default Babylon camera inputs are removed: input.js owns pointer, touch
 * and keyboard handling on the same canvas, and Babylon's built-in controls
 * would fight it for look-drag and WASD.
 */

export class CameraManager {
  constructor(scene) {
    this.scene = scene;
    this.camera = new BABYLON.UniversalCamera(
      "pal-haven-camera",
      new BABYLON.Vector3(0, 2, 0),
      scene,
    );
    // Matches the old perspective(fov, aspect, 0.06, 260).
    this.camera.minZ = 0.06;
    this.camera.maxZ = 260;
    this.camera.fovMode = BABYLON.Camera.FOVMODE_VERTICAL_FIXED;
    this.camera.upVector = new BABYLON.Vector3(0, 1, 0);
    this.camera.inputs.clear();
    this.camera.inertia = 0;
    this.camera.speed = 0;
    this.camera.checkCollisions = false;
    this.camera.applyGravity = false;
    scene.activeCamera = this.camera;

    this._target = new BABYLON.Vector3(0, 0, 1);
    this._fullViewport = new BABYLON.Viewport(0, 0, 1, 1);
    this.camera.viewport = this._fullViewport;
  }

  /**
   * @param {{eye:number[], target:number[], fov?:number, viewport?:{x:number,y:number,width:number,height:number}}} camera
   * @param {{width:number, height:number}} cssRect CSS-pixel size of the canvas
   */
  sync(camera, cssRect) {
    const eye = camera.eye || [0, 2, 0];
    const target = camera.target || [0, 0, 0];

    this.camera.position.set(eye[0], eye[1], eye[2]);
    this._target.set(target[0], target[1], target[2]);

    // Guard against a degenerate eye===target which would produce NaN rotation.
    if (BABYLON.Vector3.DistanceSquared(this.camera.position, this._target) < 1e-8) {
      this._target.z += 1e-3;
    }
    this.camera.setTarget(this._target);
    this.camera.fov = ((camera.fov || 65) * Math.PI) / 180;

    // The animation lab renders into a sub-rect given in CSS pixels with a
    // top-left origin. Babylon viewports are normalised with a bottom-left
    // origin, so flip Y.
    const area = camera.viewport;
    if (area && cssRect && cssRect.width > 0 && cssRect.height > 0) {
      this.camera.viewport = new BABYLON.Viewport(
        area.x / cssRect.width,
        (cssRect.height - area.y - area.height) / cssRect.height,
        area.width / cssRect.width,
        area.height / cssRect.height,
      );
    } else if (this.camera.viewport !== this._fullViewport) {
      this.camera.viewport = this._fullViewport;
    }

    return this.camera;
  }

  dispose() {
    try {
      this.camera.dispose();
    } catch {
      /* already disposed with the scene */
    }
  }
}
