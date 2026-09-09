import test from "node:test";
import assert from "node:assert/strict";
import {
  identity,
  multiply,
  compose,
  transform,
  inverse,
  eulerQuat,
  slerp,
  dot,
  lookAt,
} from "../web/src/math.js";
import {
  loadGLB,
  inspectGLB,
  sampleTrack,
  GLBInstance,
} from "../web/src/glb.js";
import {
  validateManifest,
  defaultManifest,
  autoMap,
  preflightZip,
  slug,
} from "../web/src/packages.js";
import { NavGrid } from "../web/src/navigation.js";
import { parseSTL, plane } from "../web/src/geometry.js";
import { newWorld, sanitizeWorld } from "../web/src/storage.js";
import { shouldRetaliate } from "../web/src/game.js";
import { glbFixture, storedZip } from "./fixtures.mjs";
const approx = (a, b) =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-4));
test("matrix multiplication and inverse", () => {
  const m = compose([1, 2, 3], eulerQuat(0, Math.PI / 2, 0), [2, 2, 2]);
  approx(transform(m, [0, 0, 1]), [3, 2, 3]);
  approx(multiply(m, inverse(m)), identity());
});
test("camera coordinate orientation", () =>
  approx(transform(lookAt([0, 0, 5], [0, 0, 0]), [0, 0, 0]), [0, 0, -5]));
test("quaternion shortest-path interpolation", () => {
  const q = slerp([0, 0, 0, 1], [0, 1, 0, 0], 0.5);
  assert.ok(Math.abs(dot(q, q) - 1) < 1e-5);
  approx(transform(compose([0, 0, 0], q), [0, 0, 1]), [1, 0, 0]);
});
test("GLB geometry, skin and animation parsing", async () => {
  const m = await loadGLB(glbFixture(), { decodeImages: false });
  assert.equal(m.stats.triangles, 1);
  assert.equal(m.stats.joints, 1);
  assert.equal(m.animations.length, 3);
});
test("animation updates bone pose", async () => {
  const i = new GLBInstance(
    await loadGLB(glbFixture(), { decodeImages: false }),
  );
  i.play("Walk", { fade: 0 });
  i.update(0.5);
  assert.ok(Math.abs(i.world[1][13] - 0.05) < 1e-5);
  assert.equal(i.records(identity()).length, 1);
});
test("one-shot animation clamps final frame", async () => {
  const i = new GLBInstance(
    await loadGLB(glbFixture(), { decodeImages: false }),
  );
  i.play("Attack", { loop: false, fade: 0 });
  i.update(10);
  assert.equal(i.time, 1);
});
test("STEP keyframes hold", () =>
  assert.deepEqual(
    sampleTrack(
      {
        times: new Float32Array([0, 1]),
        values: new Float32Array([0, 0, 0, 1, 2, 3]),
        count: 3,
        path: "translation",
        interpolation: "STEP",
      },
      0.7,
    ),
    [0, 0, 0],
  ));
test("CUBICSPLINE Hermite interpolation", () =>
  approx(
    sampleTrack(
      {
        times: new Float32Array([0, 1]),
        values: new Float32Array([
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0,
        ]),
        count: 3,
        path: "translation",
        interpolation: "CUBICSPLINE",
      },
      0.5,
    ),
    [0.5, 0.5, 0.5],
  ));
test("GLB bad headers are rejected", () => {
  assert.throws(() => inspectGLB(new ArrayBuffer(30)));
  const b = glbFixture();
  new DataView(b).setUint32(8, b.byteLength + 4, true);
  assert.throws(() => inspectGLB(b), /length/);
});
test("GLB external URLs are rejected", async () =>
  assert.rejects(
    loadGLB(
      glbFixture((g) => (g.buffers[0].uri = "https://invalid.example/a.bin")),
      { decodeImages: false },
    ),
    /embed|external/i,
  ));
test("required compression extensions are rejected", async () =>
  assert.rejects(
    loadGLB(
      glbFixture(
        (g) => (g.extensionsRequired = ["KHR_draco_mesh_compression"]),
      ),
      { decodeImages: false },
    ),
    /not supported/,
  ));
test("cyclic node graph is rejected", async () =>
  assert.rejects(
    loadGLB(
      glbFixture((g) => (g.nodes[1].children = [0])),
      { decodeImages: false },
    ),
    /Cyclic|hierarchy/,
  ));
test("duplicate clip names are rejected", async () =>
  assert.rejects(
    loadGLB(
      glbFixture((g) => (g.animations[1].name = "Idle")),
      { decodeImages: false },
    ),
    /unique/,
  ));
test("accessor bounds are enforced", async () =>
  assert.rejects(
    loadGLB(
      glbFixture((g) => (g.accessors[0].count = 200000)),
      { decodeImages: false },
    ),
    /outside|bounds/,
  ));
test("joint references are validated", async () =>
  assert.rejects(
    loadGLB(
      glbFixture((g) => (g.skins[0].joints = [999])),
      { decodeImages: false },
    ),
    /joints/,
  ));
test("only one combat attack is auto-mapped", () => {
  const m = autoMap([
    "Idle",
    "Walk",
    "Run",
    "Attack",
    "Roll Attack",
    "Hit Reaction",
    "Get Up",
  ]);
  assert.equal(m.attack, "Attack");
  assert.equal(m.hit, "Hit Reaction");
  assert.ok(!Object.values(m).includes("Roll Attack"));
});
test("manifest defaults are peaceful", async () => {
  const m = await loadGLB(glbFixture(), { decodeImages: false }),
    p = validateManifest(defaultManifest("Test Pal", m), m);
  assert.equal(p.behavior.retaliateWhenAttacked, false);
  assert.equal(p.id, "test-pal");
  assert.equal(slug(" Fluffy & Blue "), "fluffy-blue");
});
test("attack array is not a valid mapping", async () => {
  const m = await loadGLB(glbFixture(), { decodeImages: false }),
    p = defaultManifest("Test", m);
  p.animations.attack = ["Attack", "Other"];
  assert.throws(() => validateManifest(p, m), /exactly one/);
});
test("mandatory mappings are enforced", async () => {
  const m = await loadGLB(glbFixture(), { decodeImages: false }),
    p = defaultManifest("Test", m);
  delete p.animations.walk;
  assert.throws(() => validateManifest(p, m), /walk/);
});
test("manifest paths and scale are bounded", async () => {
  const m = await loadGLB(glbFixture(), { decodeImages: false }),
    p = defaultManifest("Test", m);
  assert.throws(
    () => validateManifest({ ...p, model: "../bad.glb" }, m),
    /safe/,
  );
  assert.throws(() => validateManifest({ ...p, scale: Infinity }, m), /scale/);
});
test("ZIP directory can be read without inflation", () =>
  assert.deepEqual(
    preflightZip(
      storedZip([
        ["pal.json", "{}"],
        ["model.glb", "xx"],
      ]),
    ).map((e) => e.name),
    ["pal.json", "model.glb"],
  ));
test("ZIP traversal and duplicate names are blocked", () => {
  assert.throws(() => preflightZip(storedZip([["../bad", "x"]])), /unsafe/);
  assert.throws(
    () =>
      preflightZip(
        storedZip([
          ["a", "1"],
          ["a", "2"],
        ]),
      ),
    /duplicate/,
  );
});
test("ZIP expansion and truncation limits", () => {
  const b = storedZip([["a", "12345"]]);
  assert.throws(() => preflightZip(b, { maxExpanded: 4 }), /memory/);
  assert.throws(() => preflightZip(b.slice(0, b.byteLength - 2)), /incomplete/);
});
test("encrypted ZIP entries are rejected", () => {
  const b = storedZip([["a", "x"]]),
    v = new DataView(b),
    p = v.getUint32(b.byteLength - 6, true);
  v.setUint16(p + 8, 1, true);
  assert.throws(() => preflightZip(b), /Encrypted/);
});
test("ASCII STL triangles are parsed", () => {
  const t =
    "solid floor\nfacet normal 0 1 0\nouter loop\nvertex -5 0 -5\nvertex -5 0 5\nvertex 5 0 5\nendloop\nendfacet\nendsolid";
  assert.equal(parseSTL(new TextEncoder().encode(t).buffer).position.length, 9);
  assert.throws(() => parseSTL(new TextEncoder().encode("solid empty").buffer));
});
test("collision blocks crossing a wall", () => {
  const n = new NavGrid(20, 25);
  n.heights.fill(0);
  n.obstacles.push({ type: "box", x: 0, z: 0, w: 2, d: 2 });
  assert.equal(n.canStand(20, 0), false);
  assert.ok(n.move([-3, 0, 0], 5, 0, 0.3)[0] < -1.2);
});
test("A* routes around obstacles", () => {
  const n = new NavGrid(20, 31);
  n.heights.fill(0);
  n.obstacles.push({ type: "box", x: 0, z: 0, w: 1, d: 6 });
  assert.equal(n.lineOfSight([-5, 0, 0], [5, 0, 0]), false);
  const p = n.path([-5, 0, 0], [5, 0, 0]);
  assert.ok(p.length > 2 && p.some((v) => Math.abs(v[2]) > 3));
});
test("terrain rasterization supports flat ground", () => {
  const n = new NavGrid(20, 25);
  n.rasterize([{ geometry: plane(20), model: identity() }]);
  assert.ok(n.canStand(0, 0));
  assert.equal(n.ground(0, 0), 0);
});
test("retaliation needs both switches and a living pal", () => {
  const w = newWorld(),
    p = { data: { health: 100, retaliate: true } };
  assert.equal(shouldRetaliate(w, p), false);
  w.environment.retaliation = true;
  assert.equal(shouldRetaliate(w, p), true);
  p.data.retaliate = false;
  assert.equal(shouldRetaliate(w, p), false);
  p.data.retaliate = true;
  p.data.health = 0;
  assert.equal(shouldRetaliate(w, p), false);
});
test("backup validates positions and world type", () => {
  const w = newWorld();
  assert.equal(sanitizeWorld(w, new Set()), w);
  assert.throws(
    () =>
      sanitizeWorld(
        { ...w, player: { ...w.player, position: [Infinity, 0, 0] } },
        new Set(),
      ),
    /positions/,
  );
  assert.throws(
    () => sanitizeWorld({ ...w, type: "bad" }, new Set()),
    /Invalid/,
  );
});
