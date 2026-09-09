import {
  compose,
  transform,
  norm,
  cross,
  vsub,
  normalMatrix,
  color,
  identity,
} from "./math.js";
export const material = (hex, extra = {}) => ({
  color: [...color(hex), 1],
  roughness: 0.9,
  ...extra,
});
export function mesh(position, normal, indices, extra = {}) {
  return {
    position: new Float32Array(position),
    normal: new Float32Array(normal),
    indices: indices ? new Uint32Array(indices) : undefined,
    ...extra,
  };
}
export function box(w = 1, h = 1, d = 1) {
  const p = [],
    n = [],
    ix = [];
  const faces = [
    [
      [1, 0, 0],
      [
        [1, -1, -1],
        [1, 1, -1],
        [1, 1, 1],
        [1, -1, 1],
      ],
    ],
    [
      [-1, 0, 0],
      [
        [-1, -1, 1],
        [-1, 1, 1],
        [-1, 1, -1],
        [-1, -1, -1],
      ],
    ],
    [
      [0, 1, 0],
      [
        [-1, 1, -1],
        [-1, 1, 1],
        [1, 1, 1],
        [1, 1, -1],
      ],
    ],
    [
      [0, -1, 0],
      [
        [-1, -1, 1],
        [-1, -1, -1],
        [1, -1, -1],
        [1, -1, 1],
      ],
    ],
    [
      [0, 0, 1],
      [
        [1, -1, 1],
        [1, 1, 1],
        [-1, 1, 1],
        [-1, -1, 1],
      ],
    ],
    [
      [0, 0, -1],
      [
        [-1, -1, -1],
        [-1, 1, -1],
        [1, 1, -1],
        [1, -1, -1],
      ],
    ],
  ];
  for (const [normal, corners] of faces) {
    let s = p.length / 3;
    for (const v of corners) {
      p.push((v[0] * w) / 2, (v[1] * h) / 2, (v[2] * d) / 2);
      n.push(...normal);
    }
    ix.push(s, s + 1, s + 2, s, s + 2, s + 3);
  }
  return mesh(p, n, ix);
}
export function sphere(radius = 1, segments = 12, rings = 8) {
  const p = [],
    n = [],
    ix = [];
  for (let y = 0; y <= rings; y++) {
    const t = (y / rings) * Math.PI;
    for (let x = 0; x <= segments; x++) {
      const a = (x / segments) * Math.PI * 2,
        v = [Math.sin(t) * Math.sin(a), Math.cos(t), Math.sin(t) * Math.cos(a)];
      p.push(...v.map((c) => c * radius));
      n.push(...v);
    }
  }
  for (let y = 0; y < rings; y++)
    for (let x = 0; x < segments; x++) {
      const a = y * (segments + 1) + x,
        b = a + segments + 1;
      ix.push(a, b, a + 1, b, b + 1, a + 1);
    }
  return mesh(p, n, ix);
}
export function cylinder(top = 1, bottom = 1, height = 1, segments = 12) {
  let p = [],
    n = [],
    ix = [];
  for (let j = 0; j <= segments; j++) {
    const a = (j / segments) * Math.PI * 2,
      s = Math.sin(a),
      c = Math.cos(a),
      normal = norm([s, (bottom - top) / height, c]);
    p.push(s * bottom, -height / 2, c * bottom, s * top, height / 2, c * top);
    n.push(...normal, ...normal);
  }
  for (let j = 0; j < segments; j++) {
    let a = j * 2;
    ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  for (const [r, y, ny] of [
    [bottom, -height / 2, -1],
    [top, height / 2, 1],
  ]) {
    if (r === 0) continue;
    let start = p.length / 3;
    p.push(0, y, 0);
    n.push(0, ny, 0);
    for (let j = 0; j <= segments; j++) {
      let a = (j / segments) * Math.PI * 2;
      p.push(Math.sin(a) * r, y, Math.cos(a) * r);
      n.push(0, ny, 0);
    }
    for (let j = 0; j < segments; j++)
      if (ny > 0) ix.push(start, start + j + 1, start + j + 2);
      else ix.push(start, start + j + 2, start + j + 1);
  }
  return mesh(p, n, ix);
}
export function ring(outer = 1, inner = 0.94, segments = 48) {
  const p = [],
    n = [],
    ix = [];
  for (let j = 0; j <= segments; j++) {
    let a = (j / segments) * Math.PI * 2;
    for (const r of [inner, outer]) {
      p.push(Math.sin(a) * r, 0, Math.cos(a) * r);
      n.push(0, 1, 0);
    }
  }
  for (let j = 0; j < segments; j++) {
    let a = j * 2;
    ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return mesh(p, n, ix);
}
export function plane(size = 1) {
  return mesh(
    [
      -size / 2,
      0,
      -size / 2,
      -size / 2,
      0,
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      0,
      -size / 2,
    ],
    [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    [0, 1, 2, 0, 2, 3],
  );
}
export function computeNormals(p, indices) {
  const n = new Float32Array(p.length),
    idx = indices || Array.from({ length: p.length / 3 }, (_, i) => i);
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = idx.slice(i, i + 3),
      ab = vsub(p.slice(b * 3, b * 3 + 3), p.slice(a * 3, a * 3 + 3)),
      ac = vsub(p.slice(c * 3, c * 3 + 3), p.slice(a * 3, a * 3 + 3)),
      q = cross(ab, ac);
    for (const k of [a, b, c]) for (let v = 0; v < 3; v++) n[k * 3 + v] += q[v];
  }
  for (let i = 0; i < n.length; i += 3)
    n.set(norm(Array.from(n.slice(i, i + 3))), i);
  return n;
}
export class Batcher {
  constructor() {
    this.groups = new Map();
  }
  add(g, mat, m = identity()) {
    let b = this.groups.get(mat);
    if (!b) {
      b = { p: [], n: [], i: [], c: [], mat };
      this.groups.set(mat, b);
    }
    const offset = b.p.length / 3,
      nm = normalMatrix(m);
    for (let k = 0; k < g.position.length; k += 3) {
      b.p.push(...transform(m, g.position.slice(k, k + 3)));
      const v = g.normal.slice(k, k + 3);
      b.n.push(
        ...norm([
          nm[0] * v[0] + nm[3] * v[1] + nm[6] * v[2],
          nm[1] * v[0] + nm[4] * v[1] + nm[7] * v[2],
          nm[2] * v[0] + nm[5] * v[1] + nm[8] * v[2],
        ]),
      );
      b.c.push(...(g.vertexColor ? g.vertexColor.slice(k, k + 3) : [1, 1, 1]));
    }
    for (const i of g.indices ||
      Array.from({ length: g.position.length / 3 }, (_, i) => i))
      b.i.push(i + offset);
  }
  finish() {
    return [...this.groups.values()].map((b) => ({
      geometry: mesh(b.p, b.n, b.i, { vertexColor: new Float32Array(b.c) }),
      material: b.mat,
      model: identity(),
    }));
  }
}
export function parseSTL(buffer) {
  const bytes = new Uint8Array(buffer),
    v = new DataView(buffer);
  let p = [];
  if (
    buffer.byteLength >= 84 &&
    84 + v.getUint32(80, true) * 50 === buffer.byteLength
  ) {
    const count = v.getUint32(80, true);
    if (count > 160000)
      throw Error(
        "STL exceeds 160,000 triangles. Decimate the landscape first.",
      );
    for (let i = 0; i < count; i++)
      for (let j = 0; j < 9; j++)
        p.push(v.getFloat32(84 + i * 50 + 12 + j * 4, true));
  } else {
    const text = new TextDecoder().decode(bytes);
    if (!/^\s*solid\b/i.test(text))
      throw Error("This is not a supported binary or ASCII STL.");
    const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
    let m;
    while ((m = re.exec(text))) {
      p.push(Number(m[1]), Number(m[2]), Number(m[3]));
      if (p.length > 160000 * 9) throw Error("STL exceeds 160,000 triangles.");
    }
  }
  if (
    !p.length ||
    p.length % 9 ||
    p.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e8)
  )
    throw Error("STL contains invalid or incomplete triangles.");
  const positions = new Float32Array(p);
  return {
    position: positions,
    normal: computeNormals(positions),
    indices: undefined,
  };
}
