/* Column-major matrices; glTF metres, +Y up, +Z creature front. */
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const vadd = (a, b) => a.map((v, i) => v + b[i]);
export const vsub = (a, b) => a.map((v, i) => v - b[i]);
export const vmul = (a, s) => a.map((v) => v * s);
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (v) => {
  const n = Math.hypot(...v) || 1;
  return Array.from(v, (x) => x / n);
};
export const identity = () =>
  new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export function multiply(a, b) {
  const o = new Float32Array(16);
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++)
      o[j * 4 + i] =
        a[i] * b[j * 4] +
        a[4 + i] * b[j * 4 + 1] +
        a[8 + i] * b[j * 4 + 2] +
        a[12 + i] * b[j * 4 + 3];
  return o;
}
export function compose(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q,
    [sx, sy, sz] = s;
  return new Float32Array([
    (1 - 2 * y * y - 2 * z * z) * sx,
    (2 * x * y + 2 * z * w) * sx,
    (2 * x * z - 2 * y * w) * sx,
    0,
    (2 * x * y - 2 * z * w) * sy,
    (1 - 2 * x * x - 2 * z * z) * sy,
    (2 * y * z + 2 * x * w) * sy,
    0,
    (2 * x * z + 2 * y * w) * sz,
    (2 * y * z - 2 * x * w) * sz,
    (1 - 2 * x * x - 2 * y * y) * sz,
    0,
    t[0],
    t[1],
    t[2],
    1,
  ]);
}
export const yawMatrix = (pos, yaw = 0, scale = 1) =>
  compose(
    pos,
    [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
    Array.isArray(scale) ? scale : [scale, scale, scale],
  );
export const eulerQuat = (x = 0, y = 0, z = 0) => {
  const cx = Math.cos(x / 2),
    sx = Math.sin(x / 2),
    cy = Math.cos(y / 2),
    sy = Math.sin(y / 2),
    cz = Math.cos(z / 2),
    sz = Math.sin(z / 2);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
};
export function transform(m, v, w = 1) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * w,
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * w,
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * w,
  ];
}
export function inverse(m) {
  const a = Array.from({ length: 4 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) =>
      c < 4 ? m[c * 4 + r] : Number(c - 4 === r),
    ),
  );
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++)
      if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return identity();
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let k = 0; k < 8; k++) a[c][k] /= d;
    for (let r = 0; r < 4; r++)
      if (r !== c) {
        const f = a[r][c];
        for (let k = 0; k < 8; k++) a[r][k] -= f * a[c][k];
      }
  }
  return new Float32Array(
    Array.from({ length: 16 }, (_, i) => a[i % 4][4 + Math.floor(i / 4)]),
  );
}
export function normalMatrix(m) {
  const a = inverse(m);
  return new Float32Array([
    a[0],
    a[4],
    a[8],
    a[1],
    a[5],
    a[9],
    a[2],
    a[6],
    a[10],
  ]);
}
export function perspective(fov, aspect, near = 0.06, far = 220) {
  const m = new Float32Array(16),
    f = 1 / Math.tan(fov / 2);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}
export function lookAt(eye, target, up = [0, 1, 0]) {
  const z = norm(vsub(eye, target)),
    x = norm(cross(up, z)),
    y = cross(z, x);
  return new Float32Array([
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -dot(x, eye),
    -dot(y, eye),
    -dot(z, eye),
    1,
  ]);
}
export function slerp(a, b, t) {
  let d = dot(a, b);
  if (d < 0) {
    b = Array.from(b, (v) => -v);
    d = -d;
  }
  if (d > 0.9995) return norm(Array.from(a, (v, i) => lerp(v, b[i], t)));
  const theta = Math.acos(clamp(d, -1, 1)),
    sn = Math.sin(theta);
  return Array.from(
    a,
    (v, i) => (v * Math.sin((1 - t) * theta) + b[i] * Math.sin(t * theta)) / sn,
  );
}
export const angleLerp = (a, b, t) =>
  a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
export const distance2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
export function seeded(seed = 1) {
  let n = seed >>> 0;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}
export function boundsOf(points) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], points[i + a]);
      max[a] = Math.max(max[a], points[i + a]);
    }
  return { min, max };
}
export const color = (hex) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
