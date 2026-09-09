/* Single-surface navigation, not arbitrary indoor mesh physics. */
import { clamp, distance2, transform } from "./math.js";
export class NavGrid {
  constructor(width = 80, size = 96) {
    this.width = width;
    this.size = size;
    this.cell = width / (size - 1);
    this.heights = new Float32Array(size * size).fill(NaN);
    this.blocked = new Uint8Array(size * size);
    this.obstacles = [];
  }
  index(x, z) {
    const gx = Math.round((x / this.width + 0.5) * (this.size - 1)),
      gz = Math.round((z / this.width + 0.5) * (this.size - 1));
    return gx < 0 || gz < 0 || gx >= this.size || gz >= this.size
      ? -1
      : gz * this.size + gx;
  }
  point(i) {
    return [
      (i % this.size) * this.cell - this.width / 2,
      this.heights[i],
      Math.floor(i / this.size) * this.cell - this.width / 2,
    ];
  }
  ground(x, z) {
    const fx = (x / this.width + 0.5) * (this.size - 1),
      fz = (z / this.width + 0.5) * (this.size - 1),
      ix = Math.floor(fx),
      iz = Math.floor(fz);
    if (ix < 0 || iz < 0 || ix >= this.size - 1 || iz >= this.size - 1)
      return NaN;
    const a = this.heights[iz * this.size + ix],
      b = this.heights[iz * this.size + ix + 1],
      c = this.heights[(iz + 1) * this.size + ix],
      d = this.heights[(iz + 1) * this.size + ix + 1];
    if (![a, b, c, d].every(Number.isFinite)) return NaN;
    const u = fx - ix,
      v = fz - iz;
    return (
      a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
    );
  }
  canStand(x, z, radius = 0.3) {
    for (const [dx, dz] of [
      [0, 0],
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
    ]) {
      const i = this.index(x + dx, z + dz);
      if (
        i < 0 ||
        this.blocked[i] ||
        !Number.isFinite(this.ground(x + dx, z + dz))
      )
        return false;
    }
    for (const o of this.obstacles) {
      if (
        o.type === "circle" &&
        Math.hypot(x - o.x, z - o.z) < o.radius + radius
      )
        return false;
      if (
        o.type === "box" &&
        Math.abs(x - o.x) < o.w / 2 + radius &&
        Math.abs(z - o.z) < o.d / 2 + radius
      )
        return false;
    }
    return true;
  }
  canMove(from, to, radius = 0.3) {
    if (!this.canStand(to[0], to[2], radius)) return false;
    const a = this.ground(from[0], from[2]),
      b = this.ground(to[0], to[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b - a) > 0.5)
      return false;
    const step = this.cell * 0.7,
      base = this.ground(to[0], to[2]);
    for (const [x, z] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ]) {
      const h = this.ground(to[0] + x, to[2] + z);
      if (Number.isFinite(h) && Math.abs(h - base) / step > 1.05) return false;
    }
    return true;
  }
  move(pos, dx, dz, radius = 0.3) {
    const step = Math.max(0.08, Math.min(radius * 0.5, this.cell * 0.35)),
      n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / step));
    let p = pos.slice();
    for (let i = 0; i < n; i++) {
      const all = [p[0] + dx / n, p[1], p[2] + dz / n],
        x = [p[0] + dx / n, p[1], p[2]],
        z = [p[0], p[1], p[2] + dz / n];
      if (this.canMove(p, all, radius)) p = all;
      else if (this.canMove(p, x, radius)) p = x;
      else if (this.canMove(p, z, radius)) p = z;
    }
    p[1] = this.ground(p[0], p[2]);
    return p;
  }
  nearest(pos, radius = 0.35) {
    if (this.canStand(pos[0], pos[2], radius))
      return [pos[0], this.ground(pos[0], pos[2]), pos[2]];
    let best = null,
      dist = Infinity;
    for (let i = 0; i < this.heights.length; i++) {
      if (!Number.isFinite(this.heights[i]) || this.blocked[i]) continue;
      const p = this.point(i),
        d = distance2(p, pos);
      if (d < dist && this.canStand(p[0], p[2], radius)) {
        best = p;
        dist = d;
      }
    }
    return best;
  }
  lineOfSight(a, b, radius = 0.15) {
    const steps = Math.max(1, Math.ceil(distance2(a, b) / (this.cell * 0.45)));
    let prev = a;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps,
        p = [a[0] + (b[0] - a[0]) * t, 0, a[2] + (b[2] - a[2]) * t];
      if (!this.canMove(prev, p, radius)) return false;
      prev = p;
    }
    return true;
  }
  path(from, to, radius = 0.3) {
    const start = this.index(from[0], from[2]),
      target = this.nearest(to, radius),
      end = target ? this.index(target[0], target[2]) : -1;
    if (start < 0 || end < 0) return [];
    if (this.lineOfSight(from, target, radius)) return [target];
    const open = [start],
      closed = new Set(),
      cost = new Map([[start, 0]]),
      parent = new Map(),
      heuristic = (i) =>
        Math.hypot(
          (i % this.size) - (end % this.size),
          Math.floor(i / this.size) - Math.floor(end / this.size),
        );
    let visits = 0;
    while (open.length && visits++ < 2400) {
      let n = 0;
      for (let i = 1; i < open.length; i++)
        if (
          cost.get(open[i]) + heuristic(open[i]) <
          cost.get(open[n]) + heuristic(open[n])
        )
          n = i;
      const current = open.splice(n, 1)[0];
      if (current === end) {
        const route = [];
        let c = end;
        while (c !== start) {
          route.push(this.point(c));
          c = parent.get(c);
          if (c === undefined) return [];
        }
        return route.reverse();
      }
      closed.add(current);
      const p = this.point(current),
        gx = current % this.size,
        gz = Math.floor(current / this.size);
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ]) {
        const x = gx + dx,
          z = gz + dz;
        if (x < 0 || z < 0 || x >= this.size || z >= this.size) continue;
        const next = z * this.size + x;
        if (closed.has(next)) continue;
        const q = this.point(next);
        if (!this.canMove(p, q, radius) || !this.lineOfSight(p, q, radius))
          continue;
        const score =
          cost.get(current) + Math.hypot(dx, dz) + Math.abs(q[1] - p[1]) * 0.7;
        if (score < (cost.get(next) ?? Infinity)) {
          cost.set(next, score);
          parent.set(next, current);
          if (!open.includes(next)) open.push(next);
        }
      }
    }
    return [];
  }
  rasterize(records) {
    const s = this.size,
      half = this.width / 2,
      cell = this.cell;
    for (const r of records) {
      const g = r.geometry,
        indices =
          g.indices ||
          Array.from({ length: g.position.length / 3 }, (_, i) => i);
      for (let f = 0; f < indices.length; f += 3) {
        const v = [indices[f], indices[f + 1], indices[f + 2]].map((i) =>
          transform(r.model, g.position.slice(i * 3, i * 3 + 3)),
        );
        const [a, b, c] = v,
          den = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        const minX = clamp(
            Math.floor((Math.min(a[0], b[0], c[0]) + half) / cell),
            0,
            s - 1,
          ),
          maxX = clamp(
            Math.ceil((Math.max(a[0], b[0], c[0]) + half) / cell),
            0,
            s - 1,
          ),
          minZ = clamp(
            Math.floor((Math.min(a[2], b[2], c[2]) + half) / cell),
            0,
            s - 1,
          ),
          maxZ = clamp(
            Math.ceil((Math.max(a[2], b[2], c[2]) + half) / cell),
            0,
            s - 1,
          );
        if (Math.abs(den) < 1e-7) {
          /* vertical wall: rasterize its XZ outline conservatively */ if (
            Math.max(...v.map((p) => p[1])) - Math.min(...v.map((p) => p[1])) >
            0.65
          ) {
            for (let e = 0; e < 3; e++) {
              const p = v[e],
                q = v[(e + 1) % 3],
                steps = Math.ceil(distance2(p, q) / (cell * 0.4));
              for (let j = 0; j <= steps; j++) {
                const t = j / Math.max(1, steps),
                  i = this.index(
                    p[0] + (q[0] - p[0]) * t,
                    p[2] + (q[2] - p[2]) * t,
                  );
                if (i >= 0) this.blocked[i] = 1;
              }
            }
          }
          continue;
        }
        for (let z = minZ; z <= maxZ; z++)
          for (let x = minX; x <= maxX; x++) {
            const px = x * cell - half,
              pz = z * cell - half,
              u =
                ((b[2] - c[2]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[2])) /
                den,
              w =
                ((c[2] - a[2]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[2])) /
                den,
              t = 1 - u - w;
            if (u >= -1e-5 && w >= -1e-5 && t >= -1e-5) {
              const h = a[1] * u + b[1] * w + c[1] * t,
                i = z * s + x;
              if (!Number.isFinite(this.heights[i]) || h > this.heights[i])
                this.heights[i] = h;
            }
          }
      }
    }
    if (!this.nearest([0, 0, 0]))
      throw Error(
        "Landscape has no usable walking surface. Supply a single ground mesh with gentle slopes; remove roof layers and vertical barriers at the spawn.",
      );
  }
}
