/* Geometry adapter: Pal Haven render records -> Babylon meshes.
 *
 * The game is immediate-mode: game.js rebuilds a flat array of records every
 * frame, each carrying its own model matrix, and several records can share one
 * geometry object (the contact-shadow plane and the selection ring are drawn
 * once per pal). Babylon is retained-mode, so this class keeps a pool of
 * meshes per geometry object, hands them out in record order each frame and
 * disables whatever is left over.
 *
 * Geometry objects are used as Map keys by identity, exactly like the old
 * renderer's VBO cache, so geometry.js and glb.js need no changes.
 */

const DYNAMIC_KINDS = ["position", "normal"];

export class GeometryBridge {
  constructor(scene) {
    this.scene = scene;
    this.entries = new Map();
    this._id = 0;
    // Flipped by the renderer from the graphics preset (stage 8 shadows).
    this.receiveShadows = false;
  }

  _vertexData(g) {
    const data = new BABYLON.VertexData();
    data.positions = g.position;
    if (g.normal) data.normals = g.normal;
    if (g.uv) data.uvs = g.uv;

    // The shader took a vec3 vertex colour; Babylon's colour kind is RGBA.
    if (g.vertexColor) {
      const count = g.vertexColor.length / 3;
      const rgba = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        rgba[i * 4] = g.vertexColor[i * 3];
        rgba[i * 4 + 1] = g.vertexColor[i * 3 + 1];
        rgba[i * 4 + 2] = g.vertexColor[i * 3 + 2];
        rgba[i * 4 + 3] = 1;
      }
      data.colors = rgba;
    }

    if (g.joints && g.weights) {
      data.matricesIndices = g.joints;
      data.matricesWeights = g.weights;
    }

    if (g.indices) {
      data.indices = g.indices;
    } else {
      // The old renderer fell back to drawArrays; Babylon always wants indices.
      const count = g.position.length / 3;
      const indices = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
      for (let i = 0; i < count; i++) indices[i] = i;
      data.indices = indices;
    }
    return data;
  }

  _entry(g) {
    let entry = this.entries.get(g);
    if (!entry) {
      const indexCount = g.indices ? g.indices.length : g.position.length / 3;
      entry = {
        id: this._id++,
        pool: [],
        used: 0,
        indexCount,
        vertexCount: g.position.length / 3,
        skinned: !!(g.joints && g.weights),
      };
      this.entries.set(g, entry);
    }
    return entry;
  }

  _createMesh(g, entry) {
    const mesh = new BABYLON.Mesh(`pal-geo-${entry.id}-${entry.pool.length}`, this.scene);
    this._vertexData(g).applyToMesh(mesh, !!g.dynamic);
    mesh.isPickable = false;
    mesh.receiveShadows = this.receiveShadows;
    /* The caster list is rebuilt every frame by LightingManager; `cast` is set by
     * the renderer from each record's material flags. */
    mesh.metadata = { pooled: true, cast: false };
    // Bounding info must stay in sync so Babylon can frustum-cull the world.
    mesh.alwaysSelectAsActiveMesh = false;
    mesh.doNotSyncBoundingInfo = false;
    mesh.rotationQuaternion = new BABYLON.Quaternion();
    mesh.setEnabled(false);
    entry.pool.push(mesh);
    return mesh;
  }

  /** Turn shadow receiving on or off for every pooled mesh. */
  setShadows(on) {
    const flag = !!on;
    if (flag === this.receiveShadows) return;
    this.receiveShadows = flag;
    for (const entry of this.entries.values())
      for (const mesh of entry.pool) mesh.receiveShadows = flag;
  }

  /** Reset the per-frame allocation cursors. */
  beginFrame() {
    for (const entry of this.entries.values()) entry.used = 0;
  }

  /**
   * Hand out a mesh for one record. Returns the Babylon mesh plus the entry so
   * the caller can report triangle counts.
   */
  acquire(g) {
    const entry = this._entry(g);

    // Morph targets and CPU skinning fallbacks rewrite position/normal in place
    // and raise g.dirty; push the new data into every pooled mesh once.
    if (g.dirty && entry.pool.length) {
      for (const mesh of entry.pool) {
        for (const kind of DYNAMIC_KINDS) {
          if (g[kind]) mesh.updateVerticesData(kind === "position" ? BABYLON.VertexBuffer.PositionKind : BABYLON.VertexBuffer.NormalKind, g[kind]);
        }
      }
      g.dirty = false;
    }

    const mesh = entry.pool[entry.used] || this._createMesh(g, entry);
    entry.used++;
    mesh.setEnabled(true);
    return { mesh, entry };
  }

  /** Disable every mesh that no record claimed this frame. */
  endFrame() {
    for (const entry of this.entries.values()) {
      for (let i = entry.used; i < entry.pool.length; i++) {
        if (entry.pool[i].isEnabled(false)) entry.pool[i].setEnabled(false);
      }
    }
  }

  release(g) {
    const entry = this.entries.get(g);
    if (!entry) return;
    for (const mesh of entry.pool) {
      try {
        mesh.dispose(false, false);
      } catch {
        /* already disposed with the scene */
      }
    }
    this.entries.delete(g);
  }

  clear() {
    for (const g of [...this.entries.keys()]) this.release(g);
  }

  get meshCount() {
    let n = 0;
    for (const entry of this.entries.values()) n += entry.pool.length;
    return n;
  }
}
