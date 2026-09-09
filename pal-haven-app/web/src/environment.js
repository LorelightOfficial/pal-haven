import {
  identity,
  yawMatrix,
  compose,
  eulerQuat,
  multiply,
  transform,
  seeded,
  color,
  clamp,
  lerp,
} from "./math.js";
import {
  mesh,
  box,
  sphere,
  cylinder,
  ring,
  plane,
  Batcher,
  material,
  parseSTL,
  computeNormals,
} from "./geometry.js";
import { NavGrid } from "./navigation.js";
import { loadGLB, GLBInstance, restPose, worldMatrices } from "./glb.js";
export function daylight(time = 10.5) {
  const sunHeight = Math.sin(((time - 6) / 24) * Math.PI * 2),
    level = clamp(sunHeight * 0.7 + 0.45, 0.22, 1),
    night = [0.075, 0.14, 0.18],
    day = [0.76, 0.83, 0.76],
    mix = clamp((sunHeight + 0.2) * 1.4, 0, 1);
  return {
    sky: day.map((v, i) => lerp(night[i], v, mix)),
    sun: [
      Math.cos(((time - 6) / 24) * Math.PI * 2),
      Math.max(0.16, sunHeight),
      0.5,
    ],
    light: level,
    fogNear: 30,
    fogFar: 105,
  };
}
export function createEnvironment(type = "meadow", width = 80) {
  const nav = new NavGrid(width),
    batch = new Batcher(),
    rng = seeded(type === "courtyard" ? 919 : 107);
  const mats = {
      grass: material("#a5b880"),
      wood: material("#b18d64"),
      bark: material("#827151"),
      stone: material("#b7b6a2"),
      wall: material("#e6dfc9"),
      roof: material("#527d70"),
      dark: material("#344e45"),
      glass: material("#abc8bc"),
      sand: material("#d6c7a7"),
      water: material("#83b9b6", { roughness: 0.2 }),
      white: material("#f6efdc"),
      pink: material("#d7a28d"),
      gold: material("#dbc184"),
    },
    leaves = ["#69885d", "#809866", "#8d9f6a", "#719472"].map((h) =>
      material(h),
    );
  const ground = (x, z) =>
    type === "courtyard"
      ? 0
      : Math.sin(x * 0.13) * Math.cos(z * 0.12) * 0.32 +
        Math.max(0, Math.hypot(x, z) - 22) * 0.055;
  for (let i = 0; i < nav.heights.length; i++) {
    const p = nav.point(i);
    nav.heights[i] = ground(p[0], p[2]);
  }
  const n = 80,
    p = [],
    normals = [],
    indices = [],
    colors = [];
  for (let z = 0; z <= n; z++)
    for (let x = 0; x <= n; x++) {
      const px = (x / n - 0.5) * width,
        pz = (z / n - 0.5) * width;
      p.push(px, ground(px, pz), pz);
      const path =
        (Math.abs(px - 1.5) < 1.3 && pz < 13 && pz > -6) ||
        (Math.abs(pz + 3) < 1.15 && px > -8 && px < 13);
      const c =
        type === "courtyard"
          ? color((x + z) % 2 === 0 ? "#c4c6b5" : "#bbbfaa")
          : path
            ? color("#c9bd98")
            : color(
                ["#aaba89", "#a7b583", "#9ead7c", "#b0be8e"][
                  Math.floor(rng() * 4)
                ],
              );
      colors.push(...c);
    }
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      const a = z * (n + 1) + x,
        b = a + n + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = mesh(
    p,
    computeNormals(new Float32Array(p), new Uint32Array(indices)),
    indices,
    { vertexColor: new Float32Array(colors) },
  );
  batch.add(g, material("#ffffff"));
  const add = (geo, mat, x, y, z, yaw = 0, scale = 1) =>
    batch.add(geo, mat, yawMatrix([x, y + ground(x, z), z], yaw, scale));
  // A usable open-front shelter; doorway and porch are not blocked by a solid box.
  const hx = -6,
    hz = -5;
  add(box(6, 0.2, 4.8), mats.sand, hx, 0.11, hz);
  add(box(6, 2.4, 0.18), mats.wall, hx, 1.3, hz - 2.3);
  add(box(0.18, 2.4, 4.7), mats.wall, hx - 2.9, 1.3, hz);
  add(box(0.18, 2.4, 4.7), mats.wall, hx + 2.9, 1.3, hz);
  for (const x of [-2.7, 2.7]) {
    add(box(0.2, 2.4, 0.2), mats.wood, hx + x, 1.3, hz + 2.2);
  }
  add(box(6.3, 0.2, 0.35), mats.wood, hx, 2.45, hz + 2.3);
  const roof = box(6.7, 0.23, 3.1);
  batch.add(
    roof,
    mats.roof,
    compose(
      [hx, ground(hx, hz) + 3, hz - 1.25],
      eulerQuat(0.42, 0, 0),
      [1, 1, 1],
    ),
  );
  batch.add(
    roof,
    mats.roof,
    compose(
      [hx, ground(hx, hz) + 3, hz + 1.25],
      eulerQuat(-0.42, 0, 0),
      [1, 1, 1],
    ),
  );
  add(box(1.1, 0.85, 0.1), mats.glass, hx, 1.6, hz - 2.17);
  add(box(1.3, 0.12, 0.13), mats.wood, hx, 1.15, hz - 2.12);
  add(box(2, 0.35, 1.1), mats.wood, hx - 1.4, 0.55, hz - 0.7);
  add(box(2.1, 0.15, 1.2), mats.gold, hx - 1.4, 0.78, hz - 0.7);
  nav.obstacles.push(
    { type: "box", x: hx, z: hz - 2.3, w: 6, d: 0.22 },
    { type: "box", x: hx - 2.9, z: hz, w: 0.2, d: 4.7 },
    { type: "box", x: hx + 2.9, z: hz, w: 0.2, d: 4.7 },
    { type: "box", x: hx - 1.4, z: hz - 0.7, w: 2, d: 1.1 },
  );
  // Circular testing patch and target posts.
  add(cylinder(5, 5, 0.035, 64), mats.sand, 10, 0.025, -1);
  add(ring(5, 4.94), mats.white, 10, 0.052, -1);
  add(ring(2.8, 2.76), mats.white, 10, 0.055, -1);
  for (const a of [-0.8, 0, 0.8]) {
    const x = 10 + Math.sin(a) * 4,
      z = -1 - Math.cos(a) * 4;
    add(cylinder(0.12, 0.16, 1.2, 10), mats.wood, x, 0.6, z);
    add(cylinder(0.5, 0.5, 0.15, 24), mats.pink, x, 1.25, z);
    nav.obstacles.push({ type: "circle", x, z, radius: 0.23 });
  }
  // Small pond is a land-navigation obstacle.
  if (type === "meadow") {
    add(cylinder(4, 4, 0.05, 48), mats.sand, -13, 0.04, 9, 0, [1.3, 1, 0.85]);
    add(
      cylinder(3.65, 3.65, 0.065, 48),
      mats.water,
      -13,
      0.06,
      9,
      0,
      [1.3, 1, 0.85],
    );
    nav.obstacles.push({ type: "box", x: -13, z: 9, w: 9.4, d: 6.4 });
  }
  for (let i = 0; i < 42; i++) {
    let x = (rng() - 0.5) * (width - 8),
      z = (rng() - 0.5) * (width - 8);
    if (Math.hypot(x, z) < 17) continue;
    const h = 2.5 + rng() * 2.5;
    add(cylinder(0.14, 0.23, h, 8), mats.bark, x, h / 2, z);
    add(sphere(1, 9, 6), leaves[i % 4], x, h + 0.35, z, 0, [
      1.55,
      h * 0.49,
      1.55,
    ]);
    add(
      sphere(1, 9, 6),
      leaves[(i + 1) % 4],
      x + 0.6,
      h + 0.65,
      z + 0.2,
      0,
      [1.0, 1.1, 1.0],
    );
    nav.obstacles.push({ type: "circle", x, z, radius: 0.4 });
  }
  for (let i = 0; i < 28; i++) {
    let a = rng() * Math.PI * 2,
      r = 18 + rng() * 18,
      x = Math.sin(a) * r,
      z = Math.cos(a) * r;
    if (Math.abs(x) > width / 2 - 3 || Math.abs(z) > width / 2 - 3) continue;
    const s = 0.5 + rng() * 0.8;
    add(sphere(1, 6, 4), mats.stone, x, 0.3, z, rng() * 5, [
      s,
      s * 0.65,
      s * 0.85,
    ]);
    nav.obstacles.push({ type: "circle", x, z, radius: s * 0.7 });
  }
  for (let i = 0; i < 70; i++) {
    const a = rng() * Math.PI * 2,
      r = 4 + rng() * 16,
      x = Math.sin(a) * r,
      z = Math.cos(a) * r;
    if (
      !nav.canStand(x, z, 0.4) ||
      Math.abs(x - 1.5) < 1.5 ||
      Math.hypot(x - 10, z + 1) < 5.5
    )
      continue;
    add(cylinder(0.014, 0.018, 0.3, 4), leaves[i % 4], x, 0.15, z);
    add(sphere(0.09, 5, 3), i % 3 ? mats.white : mats.pink, x, 0.32, z);
  }
  // Perimeter markers make the finite walkable area legible.
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2,
      r = width * 0.42,
      x = Math.sin(a) * r,
      z = Math.cos(a) * r;
    add(box(0.12, 0.65, 0.12), mats.wood, x, 0.32, z);
  }
  return {
    records: batch.finish(),
    nav,
    home: [-6, ground(-6, -1), -1],
    training: [10, ground(10, 2), 2],
    dispose() {},
  };
}
export async function importEnvironment(landscape) {
  const width = landscape.width || 80;
  let records, model;
  const bytes = await landscape.blob.arrayBuffer();
  if (landscape.format === "stl") {
    const g = parseSTL(bytes);
    records = [
      { geometry: g, material: material("#b3bea5"), model: identity() },
    ];
  } else {
    model = await loadGLB(bytes, { landscape: true });
    if (model.skins.length || model.animations.length)
      throw Error(
        "Landscape must be static. Remove rigs and animation before landscape export.",
      );
    const world = worldMatrices(model, restPose(model));
    records = [];
    for (let i = 0; i < model.nodes.length; i++) {
      const n = model.nodes[i];
      if (n.mesh !== undefined && model.active.has(i))
        for (const g of model.meshes[n.mesh].primitives)
          records.push({ geometry: g, material: g.material, model: world[i] });
    }
  }
  const up =
      landscape.upAxis === "Z"
        ? compose([0, 0, 0], eulerQuat(-Math.PI / 2, 0, 0))
        : identity(),
    min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const r of records) {
    r.model = multiply(up, r.model);
    for (let i = 0; i < r.geometry.position.length; i += 3) {
      const p = transform(r.model, r.geometry.position.slice(i, i + 3));
      for (let j = 0; j < 3; j++) {
        min[j] = Math.min(min[j], p[j]);
        max[j] = Math.max(max[j], p[j]);
      }
    }
  }
  const span = Math.max(max[0] - min[0], max[2] - min[2]);
  if (!Number.isFinite(span) || span < 0.001)
    throw Error("Landscape has no usable horizontal area. Check the up axis.");
  const scale = (width * 0.94) / span,
    center = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2],
    m = compose(
      center.map((v) => -v * scale),
      [0, 0, 0, 1],
      [scale, scale, scale],
    );
  for (const r of records) r.model = multiply(m, r.model);
  const nav = new NavGrid(width);
  nav.rasterize(records);
  const home = nav.nearest([0, 0, 0]);
  return {
    records,
    nav,
    home,
    training: home,
    dispose() {
      for (const i of model?.images || []) i.close?.();
    },
  };
}
