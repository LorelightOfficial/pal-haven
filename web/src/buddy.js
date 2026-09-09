/* A tiny, built-in diagnostic buddy. Not a delivered character model.
 * Lets an empty installation test locomotion and interaction without an import.
 */
import { identity, compose, eulerQuat, multiply, yawMatrix } from "./math.js";
import { sphere, box, cylinder, material } from "./geometry.js";
const ball = sphere(1, 14, 10),
  foot = sphere(1, 10, 7),
  bodyMat = material("#f0e6cc"),
  faceMat = material("#6e8c78"),
  eyeMat = material("#253e34"),
  collarMat = material("#ddab6b"),
  cheekMat = material("#d8b09b");
export const TRAINING_MANIFEST = {
  format: "pal-haven/pal",
  schemaVersion: 1,
  id: "training-buddy",
  name: "Training buddy",
  description:
    "A lightweight built-in test helper. Import your own pals whenever you are ready.",
  model: "builtin",
  units: "meters",
  upAxis: "+Y",
  forwardAxis: "+Z",
  scale: 1,
  animations: {
    idle: "Idle",
    walk: "Walk",
    run: "Run",
    attack: "Attack",
    hit: "Hit",
    faint: "Faint",
    getUp: "Get Up",
    held: "Held",
    pet: "Pet",
    sleep: "Sleep",
    eat: "Eat",
    happy: "Happy",
    jump: "Jump",
    sit: "Sit",
  },
  physics: { radius: 0.38, height: 1.1, groundOffset: 0 },
  behavior: {
    canBePickedUp: true,
    retaliateWhenAttacked: true,
    walkSpeed: 1.1,
    runSpeed: 2.8,
    wanderRadius: 8,
  },
  combat: {
    maxHealth: 100,
    damage: 8,
    cooldown: 1.7,
    range: 1.25,
    hitTime: 0.5,
  },
};
export const TRAINING_CLIPS = Object.values(TRAINING_MANIFEST.animations).map(
  (name) => ({
    name,
    duration:
      name === "Attack"
        ? 0.7
        : name === "Faint"
          ? 1
          : name === "Hit"
            ? 0.45
            : 2,
    loop: ["Idle", "Walk", "Run", "Held", "Sleep", "Eat", "Sit"].includes(name),
  }),
);
export class TrainingBuddy {
  constructor() {
    this.clip = "Idle";
    this.time = 0;
    this.loop = true;
    this.transition = 0;
    this.fade = 0;
    this.before = {};
  }
  duration() {
    return TRAINING_CLIPS.find((c) => c.name === this.clip)?.duration || 2;
  }
  play(clip, { loop = true, restart = false } = {}) {
    if (this.clip === clip && !restart) return;
    this.before = this.pose();
    this.clip = clip;
    this.loop = loop;
    this.time = 0;
    this.fade = 0.18;
  }
  update(dt, { seek } = {}) {
    this.time = seek ?? this.time + dt;
    this.time =
      this.loop && seek === undefined
        ? this.time % this.duration()
        : Math.min(this.time, this.duration());
    this.fade = Math.max(0, this.fade - dt);
  }
  pose() {
    const t = this.time,
      u = t / this.duration(),
      walk = this.clip === "Walk" || this.clip === "Run",
      f = this.clip === "Run" ? 15 : 9;
    return {
      bob: walk ? Math.abs(Math.sin(t * f)) * 0.06 : Math.sin(t * 3) * 0.014,
      step: walk ? Math.sin(t * f) * 0.55 : 0,
      lean:
        this.clip === "Attack"
          ? Math.sin(u * Math.PI) * 0.65
          : this.clip === "Hit"
            ? -Math.sin(u * Math.PI) * 0.35
            : 0,
      sleep:
        this.clip === "Sleep" || this.clip === "Sit"
          ? 0.25
          : this.clip === "Faint"
            ? Math.min(1, u * 2) * 0.4
            : 0,
      tilt: this.clip === "Faint" ? Math.min(1, u * 2) * 1.4 : 0,
      jump: ["Jump", "Happy"].includes(this.clip)
        ? Math.abs(Math.sin(u * Math.PI)) * 0.5
        : 0,
      pet: this.clip === "Pet" ? Math.sin(t * 13) * 0.16 : 0,
    };
  }
  records(root, { wire = false, rig = false, flash = false } = {}) {
    let p = this.pose();
    if (this.fade) {
      const a = 1 - this.fade / 0.18;
      for (const k of Object.keys(p))
        p[k] = (this.before[k] || 0) * (1 - a) + p[k] * a;
    }
    const out = [],
      base = multiply(
        root,
        compose(
          [0, p.bob + p.jump - p.sleep, 0],
          eulerQuat(p.lean, 0, p.tilt),
          [1, 1, 1],
        ),
      );
    const add = (geo, mat, pos, scale, rotation = [0, 0, 0]) =>
      out.push({
        geometry: geo,
        material: mat,
        model: multiply(base, compose(pos, eulerQuat(...rotation), scale)),
        wire,
        flash,
      });
    add(ball, bodyMat, [0, 0.64, 0], [0.5, 0.48, 0.43]);
    for (const [x, y, z, r] of [
      [-0.31, 0.76, 0.16, 0.23],
      [0.31, 0.76, 0.16, 0.23],
      [-0.27, 0.5, 0.15, 0.24],
      [0.27, 0.5, 0.15, 0.24],
      [0, 1.01, 0.05, 0.22],
      [-0.23, 0.92, -0.12, 0.22],
      [0.23, 0.92, -0.12, 0.22],
      [0, 0.62, -0.34, 0.23],
    ])
      add(ball, bodyMat, [x, y, z], [r, r, r]);
    add(ball, faceMat, [0, 0.75, 0.385], [0.285, 0.23, 0.11]);
    add(ball, collarMat, [0, 0.405, 0.13], [0.32, 0.07, 0.3]);
    for (const s of [-1, 1]) {
      add(
        foot,
        faceMat,
        [s * 0.23, 0.16, 0.06],
        [0.17, 0.18, 0.23],
        [p.step * s, 0, 0],
      );
      add(
        foot,
        faceMat,
        [s * 0.51, 0.57, 0.035],
        [0.12, 0.21, 0.12],
        [p.pet + s * p.step * 0.4, 0, s * 0.2],
      );
      add(
        foot,
        faceMat,
        [s * 0.31, 0.97, 0.055],
        [0.1, 0.16, 0.07],
        [0, 0, s * -0.45],
      );
      add(
        ball,
        eyeMat,
        [s * 0.105, 0.78, 0.482],
        [0.027, this.clip === "Sleep" ? 0.009 : 0.033, 0.023],
      );
      add(ball, cheekMat, [s * 0.17, 0.702, 0.467], [0.04, 0.018, 0.015]);
    }
    add(ball, eyeMat, [0, 0.69, 0.489], [0.037, 0.012, 0.012]);
    if (rig) {
      /* helper uses procedural transforms rather than an imported skeleton */
    }
    return out;
  }
  release() {}
}
