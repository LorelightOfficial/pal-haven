/* BabylonRenderer - drop-in replacement for the hand-written WebGL2 Renderer.
 *
 * Deliberately keeps the old public surface so game.js, app.js, navigation.js,
 * glb.js and buddy.js need no rewrite:
 *   new BabylonRenderer(canvas)
 *   render(records, camera, environment) -> { draws, triangles }
 *   resize(ratio) / measure(force) / clear()
 *   uploadTexture(source) / bindGeometry(g) / releaseGeometry(g)
 *   .vp .stats .pixelRatio .maxJoints   and the live MAX_JOINTS export
 *
 * this.vp is still built with the project's own math.js perspective/lookAt so
 * game.project() (HUD name plates, damage floaters, the aim reticle) stays
 * bit-identical to the old renderer. Babylon's camera is driven from the same
 * { eye, target, fov } record, and scene.useRightHandedSystem keeps the two in
 * the same coordinate space.
 *
 * Skinned creature meshes are NOT fed through this path. They move to
 * Babylon's own glTF loader, skeletons and AnimationGroups in stage 3/6, so
 * the record.skin bone palette disappears rather than being re-implemented.
 * Everything the game draws as plain geometry - terrain, props, trees, rocks,
 * flowers, the lab floor, contact shadows, selection rings, rig lines - flows
 * through GeometryBridge below.
 */

import { perspective, lookAt, multiply } from "../math.js";
import { SceneManager, WEBGL2_ERROR } from "./SceneManager.js";
import { CameraManager } from "./CameraManager.js";
import { LightingManager } from "./LightingManager.js";
import { GeometryBridge } from "./GeometryBridge.js";
import { MaterialFactory } from "./MaterialFactory.js";
import { EnvironmentManager } from "./EnvironmentManager.js";
import { WaterManager } from "./WaterManager.js";
import { PostProcessingManager } from "./PostProcessingManager.js";

/* Live binding, exactly like the old renderer.js export. Babylon stores bone
 * matrices in a float texture when the device supports it, which lifts the old
 * MAX_VERTEX_UNIFORM_VECTORS ceiling that forced the 48-joint fallback. */
export let MAX_JOINTS = 48;

const GROUP_WORLD = 0;
const GROUP_OVERLAY = 2;

export class BabylonRenderer {
  constructor(canvas, { quality = "balanced" } = {}) {
    this.canvas = canvas;
    this.sceneManager = new SceneManager(canvas, { quality });
    this.engine = this.sceneManager.engine;
    this.scene = this.sceneManager.scene;
    this.preset = this.sceneManager.preset;

    this.cameras = new CameraManager(this.scene);
    this.lighting = new LightingManager(this.scene, this.preset);
    this.geometry = new GeometryBridge(this.scene);
    this.materials = new MaterialFactory(this.scene, this.preset);
    this.environment = new EnvironmentManager(this.scene, this.preset);
    this.water = new WaterManager(this.scene, this.preset);
    this.post = new PostProcessingManager(this.scene, this.preset, this.cameras.camera);

    // Record meshes only receive the sun's shadows when the preset asks.
    this.geometry.setShadows(!!this.preset.shadows);

    // Overlay records used to render with depth testing switched off. The
    // equivalent in a retained scene is a later rendering group that starts
    // with a cleared depth buffer.
    this.scene.setRenderingAutoClearDepthStencil(GROUP_OVERLAY, true, true, false);

    const caps = this.engine.getCaps();
    MAX_JOINTS = caps.textureFloat ? 128 : 48;
    this.maxJoints = MAX_JOINTS;

    this.pixelRatio = 1;
    this.stats = { draws: 0, triangles: 0, shadowCasters: 0 };
    this.vp = multiply(
      perspective((65 * Math.PI) / 180, 1, 0.06, 260),
      lookAt([0, 2, 0], [0, 0, -1]),
    );

    this._model = new BABYLON.Matrix();
    this._skinWarned = false;
  }

  /* Layout / sizing ------------------------------------------------------ */

  measure(force = false) {
    return this.sceneManager.measure(force);
  }

  resize(ratio = this.pixelRatio) {
    this.pixelRatio = ratio;
    return this.sceneManager.resize(ratio);
  }

  /** Swap graphics preset at runtime; mirrors game.configure(settings). */
  setQuality(quality) {
    this.preset = this.sceneManager.setQuality(quality);
    this.lighting.setPreset(this.preset);
    this.materials.setPreset(this.preset);
    this.geometry.setShadows(!!this.preset.shadows);
    this.environment.apply(this.preset);
    this.water.apply(this.preset);
    this.post.apply(this.preset);
    return this.preset;
  }

  /* Resource cache ------------------------------------------------------- */

  uploadTexture(source) {
    return this.materials.texture(source);
  }

  /** Warm the mesh cache for a geometry object before it is first drawn. */
  bindGeometry(g) {
    if (!g || !g.position) return null;
    const { mesh } = this.geometry.acquire(g);
    mesh.setEnabled(false);
    return mesh;
  }

  releaseGeometry(g) {
    this.geometry.release(g);
  }

  clear() {
    this.geometry.clear();
    this.materials.clear();
    this.stats.draws = 0;
    this.stats.triangles = 0;
  }

  /* Frame ---------------------------------------------------------------- */

  render(records = [], camera = {}, environment = {}) {
    this.resize(this.pixelRatio);
    const rect = this.sceneManager.measure();

    // Sky, fog and environment lighting are owned by EnvironmentManager.
    this.environment.update(environment, camera);

    const eye = camera.eye || [0, 2, 0];
    const target = camera.target || [0, 0, 0];
    const fov = camera.fov || 65;
    const area = camera.viewport;
    const aspect = area
      ? area.width / Math.max(1, area.height)
      : Math.max(0.001, rect.width / Math.max(1, rect.height));

    this.vp = multiply(
      perspective((fov * Math.PI) / 180, aspect, 0.06, 260),
      lookAt(eye, target),
    );

    this.cameras.sync(camera, rect);
    /* Babylon cannot clear the default framebuffer outside camera.viewport, so
     * the offscreen post-process chain steps aside for the pal viewer. Tone
     * mapping and colour grading are unaffected: they run in the materials. */
    this.post.setWindowed(!!area);
    this.lighting.update(environment, camera);

    this.geometry.beginFrame();
    this.water.beginFrame();
    let draws = 0;
    let triangles = 0;

    for (const record of records) {
      if (!record || record.visible === false || !record.geometry) continue;
      if (record.skin && !this._skinWarned) {
        this._skinWarned = true;
        console.warn(
          "BabylonRenderer: record.skin is handled by Babylon skeletons, not the geometry bridge.",
        );
      }

      const source = record.material || record.geometry.material;
      const flags = source || {};

      // Ponds and lakes are drawn by WaterManager, not the geometry pool.
      if (flags.water && this.water.place(record)) {
        draws++;
        triangles += this.water.triangleCount;
        continue;
      }

      /* A real shadow map has replaced the painted contact blob near the
       * camera. Past the map's reach the blob is still the only grounding cue,
       * so it keeps drawing out there. */
      if (flags.contact && this.lighting.shadows) {
        const m = record.model;
        if (!m) continue;
        const reach = this.preset.shadowDistance || 45;
        const dx = m[12] - eye[0];
        const dy = m[13] - eye[1];
        const dz = m[14] - eye[2];
        if (dx * dx + dy * dy + dz * dz <= reach * reach) continue;
      }

      const { mesh, entry } = this.geometry.acquire(record.geometry);
      mesh.material = this.materials.get(source, {
        flash: record.flash,
        wire: record.wire,
        lines: record.lines,
      });
      mesh.renderingGroupId = record.overlay ? GROUP_OVERLAY : GROUP_WORLD;

      /* Shadow casting is opt-out: flat receive-only surfaces carry
       * material.shadow === false, and fake or decorative records - contact
       * blobs, selection rings, rig lines, the unlit lab floor - never cast. */
      if (mesh.metadata) {
        mesh.metadata.cast =
          flags.shadow !== false &&
          record.shadow !== false &&
          !record.overlay &&
          !record.lines &&
          !flags.contact &&
          !flags.transparent &&
          !flags.unlit;
      }

      if (record.model) {
        BABYLON.Matrix.FromArrayToRef(record.model, 0, this._model);
        this._model.decompose(mesh.scaling, mesh.rotationQuaternion, mesh.position);
      }

      draws++;
      if (!record.lines) triangles += entry.indexCount / 3;
    }

    this.geometry.endFrame();
    this.stats.waterReflections = this.water.endFrame(camera);
    this.stats.shadowCasters = this.lighting.updateShadows(camera);
    this.scene.render();

    this.stats.draws = draws;
    this.stats.triangles = triangles;
    return { draws, triangles };
  }

  dispose() {
    this.clear();
    this.post.dispose();
    this.environment.dispose();
    this.water.dispose();
    this.sceneManager.dispose();
  }
}

export { WEBGL2_ERROR };
