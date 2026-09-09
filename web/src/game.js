import { Renderer } from "./renderer.js";
import { Controls } from "./input.js";
import {
  createEnvironment,
  importEnvironment,
  daylight,
} from "./environment.js";
import { TrainingBuddy, TRAINING_MANIFEST, TRAINING_CLIPS } from "./buddy.js";
import { loadGLB, GLBInstance } from "./glb.js";
import { get } from "./storage.js";
import { uid, releaseModel } from "./packages.js";
import {
  clamp,
  lerp,
  angleLerp,
  distance2,
  yawMatrix,
  compose,
  eulerQuat,
  multiply,
  identity,
  norm,
  dot,
  vsub,
  vmul,
  seeded,
} from "./math.js";
import { plane, ring, material } from "./geometry.js";
const LAB_FLOOR = plane(180),
  LAB_MATERIAL = material("#e8ecdd", { unlit: true });
const SHADOW = plane(2),
  SELECT_RING = ring(1, 0.945, 40),
  SHADOW_MAT = {
    color: [0.14, 0.23, 0.16, 0.32],
    unlit: true,
    contact: true,
    transparent: true,
  };
const qualityRatio = { economy: 0.75, balanced: 1, clear: 1.5 },
  qualityFPS = { economy: 30, balanced: 45, clear: 60 };
export function shouldRetaliate(world, pal) {
  return (
    !!world.environment.retaliation && pal.data.retaliate && pal.data.health > 0
  );
}
class Creature {
  constructor(data, asset) {
    this.data = data;
    this.manifest = asset.manifest;
    this.asset = asset;
    this.view = asset.model
      ? new GLBInstance(asset.model)
      : new TrainingBuddy();
    this.state = data.health > 0 ? "idle" : "faint";
    this.goal = null;
    this.path = [];
    this.pathTimer = 0;
    this.timer = 1;
    this.cooldown = 0;
    this.aggro = false;
    this.anger = 0;
    this.flash = 0;
    this.attackHit = false;
    this.elapsed = 0;
    this.rng = seeded(
      data.id.split("").reduce((s, c) => s + c.charCodeAt(0), 17),
    );
  }
  get position() {
    return this.data.position;
  }
  get scale() {
    return this.manifest.scale * this.data.scale;
  }
  get height() {
    return this.manifest.physics.height * this.scale;
  }
  get collisionRadius() {
    return this.manifest.physics.radius * this.scale;
  }
  get clips() {
    return this.asset.model?.animations || TRAINING_CLIPS;
  }
  clip(slot, { restart = false } = {}) {
    const name =
      this.manifest.animations[slot] ||
      this.manifest.animations[slot === "run" ? "walk" : "idle"];
    this.view.play(name, {
      loop: ![
        "attack",
        "hit",
        "faint",
        "getUp",
        "pet",
        "happy",
        "jump",
      ].includes(slot),
      restart,
    });
  }
  snapshot() {
    return {
      ...this.data,
      position: this.position.slice(),
      home: this.data.home.slice(),
    };
  }
}
export class Game {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.renderer = new Renderer(canvas);
    this.controls = new Controls(canvas, {
      onAction: (a) => this.action(a),
      onLook: (x, y) => this.look(x, y),
    });
    this.settings = {
      quality: "balanced",
      sensitivity: 1,
      invertY: false,
      maxPals: 12,
    };
    this.assets = new Map();
    this.pals = [];
    this.mode = "hub";
    this.paused = true;
    this.camera = { eye: [22, 14, 26], target: [-1, 0, -3], fov: 43 };
    this.lastTime = 0;
    this.accumulator = 0;
    this.lastDraw = 0;
    this.fps = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.elapsed = 0;
    this.cooldown = 0;
    this.held = null;
    this.target = null;
    this.selected = null;
    this.lab = null;
    this.demo();
    this.frame = (now) => {
      this.raf = requestAnimationFrame(this.frame);
      this.tick(now);
    };
    this.raf = requestAnimationFrame(this.frame);
  }
  configure(settings) {
    this.settings = settings;
    this.renderer.pixelRatio = Math.min(
      devicePixelRatio || 1,
      qualityRatio[settings.quality] || 1,
    );
  }
  unload() {
    this.controls.reset();
    this.environment?.dispose();
    for (const p of this.pals) p.view.release(this.renderer);
    for (const a of this.assets.values()) if (a.model) releaseModel(a.model);
    this.renderer.clear();
    this.assets.clear();
    this.pals = [];
    this.held = null;
    this.target = null;
    this.selected = null;
    this.lab = null;
  }
  demo() {
    this.unload();
    this.environment = createEnvironment();
    this.mode = "hub";
    this.paused = true;
    this.controls.enabled = false;
    this.world = null;
    this.camera = { eye: [22, 14, 26], target: [-1, 0, -2], fov: 43 };
    for (const [i, pos] of [
      [0, [0.8, 0, 3]],
      [1, [-2, 0, 1.8]],
      [2, [3, 0, -0.7]],
    ]) {
      const data = this.makeData("builtin-training", TRAINING_MANIFEST, [
        pos[0],
        this.environment.nav.ground(pos[0], pos[2]),
        pos[2],
      ]);
      data.yaw = 0.45 + i * 0.5;
      const p = new Creature(data, { manifest: TRAINING_MANIFEST });
      p.clip("idle");
      this.pals.push(p);
    }
  }
  async open(world) {
    this.unload();
    this.world = structuredClone(world);
    this.mode = "loading";
    this.paused = true;
    const landscape = world.landscapeId
      ? await get("landscapes", world.landscapeId)
      : null;
    if (world.type === "imported" && !landscape)
      throw Error(
        "This world is missing its landscape file. Restore a backup or create a new world.",
      );
    this.environment = landscape
      ? await importEnvironment(landscape)
      : createEnvironment(world.type, world.width);
    this.world.home =
      this.environment.nav.nearest(world.home) || this.environment.home.slice();
    const nav = this.environment.nav;
    this.player = {
      ...world.player,
      position:
        nav.nearest(world.player.position) || nav.nearest(this.world.home),
      health: world.player.health || 100,
    };
    for (const data of world.pals) {
      const asset = await this.loadAsset(data.assetId);
      const pos = nav.nearest(
        data.position,
        asset.manifest.physics.radius * data.scale * asset.manifest.scale,
      );
      if (!pos) throw Error("A saved creature no longer fits this landscape.");
      const p = new Creature(
        {
          ...data,
          position: pos,
          home: nav.nearest(data.home) || this.world.home.slice(),
        },
        asset,
      );
      p.clip(p.data.health > 0 ? "idle" : "faint");
      this.pals.push(p);
    }
    this.mode = "play";
    this.paused = false;
    this.controls.enabled = true;
    this.cooldown = 0;
    this.updateCamera();
    this.hooks.change?.();
  }
  async loadAsset(id) {
    if (id === "builtin-training") return { manifest: TRAINING_MANIFEST };
    if (this.assets.has(id)) return this.assets.get(id);
    const raw = await get("assets", id);
    if (!raw)
      throw Error(
        "A creature used by this world is missing from your library.",
      );
    const model = await loadGLB(await raw.blob.arrayBuffer(), {
      maxTextureSize: this.settings.quality === "economy" ? 512 : 1024,
    });
    const asset = { ...raw, model };
    this.assets.set(id, asset);
    return asset;
  }
  makeData(assetId, manifest, position) {
    return {
      id: uid(),
      assetId,
      name: manifest.name,
      position: position.slice(),
      home: position.slice(),
      yaw: 0,
      health: manifest.combat.maxHealth,
      scale: 1,
      speed: 1,
      radius: manifest.behavior.wanderRadius,
      behavior: "roam",
      retaliate: manifest.behavior.retaliateWhenAttacked,
    };
  }
  async spawn(assetId, count = 1, opts = {}) {
    if (this.mode !== "play") throw Error("Open a world first.");
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 24 ||
      this.pals.length + count > this.settings.maxPals
    )
      throw Error(
        `This world is limited to ${this.settings.maxPals} pals. Remove some, or change the limit in Settings.`,
      );
    const asset = await this.loadAsset(assetId),
      tri = asset.model?.stats.triangles || 4800,
      total =
        this.pals.reduce(
          (s, p) => s + (p.asset.model?.stats.triangles || 4800),
          0,
        ) +
        tri * count;
    if (total > 650000)
      throw Error(
        "That would exceed the 650k visible creature triangle budget. Add fewer copies or optimize this model.",
      );
    const nav = this.environment.nav,
      created = [];
    const direction = [Math.sin(this.player.yaw), 0, Math.cos(this.player.yaw)],
      base = [
        this.player.position[0] + direction[0] * 3,
        0,
        this.player.position[2] + direction[2] * 3,
      ];
    for (let i = 0; i < count; i++) {
      const angle = i * 2.399,
        rad = count === 1 ? 0 : Math.sqrt(i) * 1.35,
        pos = nav.nearest(
          [base[0] + Math.sin(angle) * rad, 0, base[2] + Math.cos(angle) * rad],
          asset.manifest.physics.radius *
            (opts.scale || 1) *
            asset.manifest.scale,
        );
      if (!pos)
        throw Error("There is not enough walkable space for this creature.");
      const data = this.makeData(assetId, asset.manifest, pos);
      Object.assign(data, opts);
      data.position = pos;
      data.home = pos.slice();
      data.yaw = this.player.yaw + Math.PI;
      const p = new Creature(data, asset);
      p.clip("idle");
      created.push(p);
    }
    this.pals.push(...created);
    this.selected = created[0];
    this.hooks.change?.();
    return created;
  }
  snapshot() {
    if (!this.world) return null;
    return {
      ...this.world,
      updated: Date.now(),
      player: { ...this.player, position: this.player.position.slice() },
      pals: this.pals.map((p) => p.snapshot()),
    };
  }
  look(x, y) {
    if (this.lab) {
      this.lab.yaw -= x * 0.006;
      this.lab.pitch = clamp(this.lab.pitch + y * 0.004, -0.1, 1.1);
      return;
    }
    if (this.mode !== "play" || this.paused) return;
    this.player.yaw -= x * 0.004 * this.settings.sensitivity;
    this.player.pitch = clamp(
      this.player.pitch -
        y *
          0.0033 *
          this.settings.sensitivity *
          (this.settings.invertY ? -1 : 1),
      -1.2,
      1.15,
    );
  }
  setPaused(value) {
    this.paused = value;
    this.controls.enabled = (!value && this.mode === "play") || !!this.lab;
    this.controls.reset();
  }
  action(name) {
    if (this.mode !== "play" || this.paused || this.lab) return;
    const p = this.target;
    if (name === "attack") {
      if (this.cooldown > 0) return;
      this.cooldown = 0.65;
      this.hooks.effect?.("attack");
      if (
        p &&
        distance2(this.player.position, p.position) <=
          2.6 + p.collisionRadius &&
        this.environment.nav.lineOfSight(this.player.position, p.position, 0.1)
      )
        this.hit(p, 20);
      else this.hooks.notice?.("Aim at a nearby pal to test your attack.");
    } else if (name === "pick") {
      if (this.held) {
        const pos = this.environment.nav.nearest(
          [
            this.player.position[0] + Math.sin(this.player.yaw) * 2,
            0,
            this.player.position[2] + Math.cos(this.player.yaw) * 2,
          ],
          this.held.collisionRadius,
        );
        if (!pos) {
          this.hooks.notice?.("Move to open ground before dropping.");
          return;
        }
        this.held.data.position = pos;
        this.held.data.home = pos.slice();
        this.held.state = "idle";
        this.held.clip("idle");
        this.held = null;
        this.hooks.change?.();
      } else if (
        p &&
        distance2(this.player.position, p.position) < 2.8 &&
        p.manifest.behavior.canBePickedUp &&
        p.data.health > 0
      ) {
        this.held = p;
        p.aggro = false;
        p.state = "held";
        p.clip("held");
        this.hooks.notice?.(
          "Picked up " + p.data.name + ". Tap Drop to place them.",
        );
      } else this.hooks.notice?.("Aim at a living, pickable pal within 2.8 m.");
    } else if (name === "pet") {
      if (
        p &&
        distance2(this.player.position, p.position) < 2.8 &&
        p.data.health > 0
      ) {
        p.aggro = false;
        p.state = "pet";
        p.clip("pet", { restart: true });
        p.timer = p.view.duration();
        this.hooks.effect?.("pet");
        this.hooks.notice?.(p.data.name + " is feeling friendly.");
      } else this.hooks.notice?.("Move closer to pet a pal.");
    } else if (name === "inspect") {
      if (p) this.hooks.inspect?.(p);
      else this.hooks.notice?.("Aim at a pal, or select one from World pals.");
    }
  }
  hit(p, amount) {
    if (p.data.health <= 0 || p === this.held) return;
    p.data.health = Math.max(0, p.data.health - amount);
    p.flash = 0.25;
    p.state = p.data.health === 0 ? "faint" : "hit";
    p.clip(p.state, { restart: true });
    p.timer = p.view.duration();
    p.attackHit = true;
    p.aggro = shouldRetaliate(this.world, p);
    p.anger = 12;
    this.selected = p;
    this.hooks.notice?.(
      p.data.health === 0
        ? p.data.name + " fainted. Revive from their settings."
        : `${p.data.name} −${amount} HP${p.aggro ? " · retaliating" : ""}`,
    );
    this.hooks.change?.();
  }
  revive(p) {
    p.data.health = p.manifest.combat.maxHealth;
    p.aggro = false;
    p.state = "getUp";
    p.clip("getUp", { restart: true });
    p.timer = p.view.duration();
    this.hooks.change?.();
  }
  remove(p) {
    if (this.held === p) this.held = null;
    if (this.selected === p) this.selected = null;
    if (this.target === p) this.target = null;
    p.view.release(this.renderer);
    this.pals = this.pals.filter((q) => q !== p);
    this.hooks.change?.();
  }
  recall(p) {
    if (this.held === p) this.held = null;
    const pos = this.environment.nav.nearest(
      this.world.home,
      p.collisionRadius,
    );
    if (!pos) return;
    p.data.position = pos;
    p.data.home = pos.slice();
    p.aggro = false;
    p.goal = null;
    p.path = [];
    p.state = p.data.health > 0 ? "idle" : "faint";
    p.clip(p.state);
    this.hooks.change?.();
  }
  resetPlayer() {
    this.player.position =
      this.environment.nav.nearest(this.world.home) ||
      this.environment.home.slice();
    this.player.health = 100;
    this.player.pitch = 0;
    for (const p of this.pals) {
      p.aggro = false;
      p.anger = 0;
    }
    this.hooks.change?.();
    this.hooks.notice?.("Back at home, fully recovered.");
  }
  enterLab(p) {
    this.selected = p;
    this.lab = {
      pal: p,
      clip: p.clips[0]?.name || "Idle",
      time: 0,
      speed: 1,
      playing: true,
      loop: true,
      yaw: 0.5,
      pitch: 0.25,
      distance: Math.max(2.2, p.height * 2.75),
      rig: false,
      wire: false,
      morphWeights: null,
    };
    p.view.play(this.lab.clip, { loop: true, restart: true, fade: 0 });
    this.paused = true;
    this.controls.enabled = true;
    this.controls.reset();
  }
  exitLab() {
    if (this.lab) {
      this.lab.pal.clip(this.lab.pal.data.health > 0 ? "idle" : "faint", {
        restart: true,
      });
      this.lab = null;
    }
    this.setPaused(false);
  }
  labSelect(name) {
    if (!this.lab) return;
    const clip = this.lab.pal.clips.find((c) => c.name === name);
    if (!clip) return;
    Object.assign(this.lab, {
      clip: name,
      time: 0,
      playing: true,
      loop: clip.loop,
    });
    this.lab.pal.view.play(name, { loop: clip.loop, restart: true, fade: 0 });
  }
  tick(now) {
    const dt = this.lastTime ? Math.min(0.1, (now - this.lastTime) / 1000) : 0;
    this.lastTime = now;
    if (
      document.hidden ||
      (this.mode === "hub" && !this.canvas.getBoundingClientRect().width)
    )
      return;
    this.elapsed += dt;
    if (this.mode === "play" && !this.paused && !this.lab) {
      this.accumulator = Math.min(0.2, this.accumulator + dt);
      while (this.accumulator >= 1 / 30) {
        this.step(1 / 30);
        this.accumulator -= 1 / 30;
      }
    } else this.accumulator = 0;
    if (this.mode === "hub") {
      for (const p of this.pals) p.view.update(dt);
    }
    if (this.lab) {
      const l = this.lab,
        duration = l.pal.clips.find((c) => c.name === l.clip)?.duration || 1;
      if (l.playing) {
        l.time += dt * l.speed;
        if (l.time >= duration) {
          if (l.loop) l.time %= duration;
          else {
            l.time = duration;
            l.playing = false;
          }
        }
      }
      l.pal.view.previous = null;
      l.pal.view.update(0, { seek: l.time, morphWeights: l.morphWeights });
    }
    this.controls.tick(dt);
    if (this.mode === "play") this.updateCamera();
    const budget = 1000 / (qualityFPS[this.settings.quality] || 45);
    if (now - this.lastDraw >= budget - 1) {
      this.lastDraw = now;
      this.draw();
      this.fpsFrames++;
    }
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
      this.hooks.status?.(this);
    }
  }
  step(dt) {
    const nav = this.environment.nav;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.world.environment.cycle)
      this.world.environment.time =
        (this.world.environment.time + dt * 0.015) % 24;
    if (this.player.health <= 0) {
      this.deadTime = (this.deadTime || 0) + dt;
      if (this.deadTime > 1.8) {
        this.deadTime = 0;
        this.resetPlayer();
      }
      return;
    }
    const m = this.controls.movement(),
      speed = m.sprint ? 6 : 3,
      dx =
        (Math.sin(this.player.yaw) * m.z - Math.cos(this.player.yaw) * m.x) *
        speed *
        dt,
      dz =
        (Math.cos(this.player.yaw) * m.z + Math.sin(this.player.yaw) * m.x) *
        speed *
        dt;
    this.player.position = nav.move(this.player.position, dx, dz, 0.27);
    for (const p of this.pals) {
      p.cooldown = Math.max(0, p.cooldown - dt);
      p.pathTimer -= dt;
      p.flash = Math.max(0, p.flash - dt);
      p.timer -= dt;
      p.elapsed += dt;
      if (p === this.held) {
        const dir = [Math.sin(this.player.yaw), 0, Math.cos(this.player.yaw)];
        p.data.position = [
          this.player.position[0] + dir[0] * 1.3,
          this.player.position[1] + 1.02 - p.height * 0.5,
          this.player.position[2] + dir[2] * 1.3,
        ];
        p.data.yaw = this.player.yaw + Math.PI;
        p.view.update(dt);
        continue;
      }
      if (p.data.health <= 0) {
        p.state = "faint";
        p.view.update(dt);
        continue;
      }
      if (p.aggro && !shouldRetaliate(this.world, p)) {
        p.aggro = false;
        p.state = "idle";
        p.clip("idle");
      }
      if (["hit", "pet", "getUp"].includes(p.state)) {
        p.view.update(dt);
        if (p.timer <= 0) {
          p.state = "idle";
          p.clip("idle");
        }
        continue;
      }
      if (p.state === "attack") {
        p.view.update(dt);
        if (
          !p.attackHit &&
          p.view.time / p.view.duration() >= p.manifest.combat.hitTime
        ) {
          p.attackHit = true;
          if (
            p.aggro &&
            this.player.health > 0 &&
            distance2(p.position, this.player.position) <=
              p.manifest.combat.range * p.data.scale + 0.45 &&
            nav.lineOfSight(p.position, this.player.position, 0.1)
          ) {
            this.player.health = Math.max(
              0,
              this.player.health - p.manifest.combat.damage,
            );
            this.hooks.effect?.("hurt");
            this.hooks.change?.();
          }
        }
        if (p.view.time >= p.view.duration() - 0.001) {
          p.state = "idle";
          p.clip("idle");
        }
        continue;
      }
      let goal = null,
        running = false;
      const playerDistance = distance2(p.position, this.player.position);
      if (p.aggro) {
        p.anger -= dt;
        if (
          p.anger <= 0 ||
          playerDistance > 20 ||
          distance2(p.position, p.data.home) > p.data.radius + 20
        ) {
          p.aggro = false;
          p.goal = p.data.home.slice();
        } else if (
          playerDistance <=
          p.manifest.combat.range * p.data.scale + 0.12
        ) {
          if (p.cooldown <= 0) {
            p.state = "attack";
            p.attackHit = false;
            p.clip("attack", { restart: true });
            p.cooldown = Math.max(
              p.manifest.combat.cooldown,
              p.view.duration(),
            );
            p.view.update(dt);
            continue;
          }
        } else {
          goal = this.player.position;
          running = true;
        }
      }
      if (!p.aggro) {
        if (p.data.behavior === "follow") {
          if (playerDistance > 2.2 + p.collisionRadius) {
            goal = this.player.position;
            running = playerDistance > 5;
          }
        } else if (p.data.behavior === "roam") {
          if (p.state === "sleep" && p.timer > 0) {
            p.view.update(dt);
            continue;
          }
          if (p.timer <= 0 || !p.goal) {
            if (p.goal && p.rng() < 0.18 && p.manifest.animations.sleep) {
              p.state = "sleep";
              p.clip("sleep");
              p.timer = 3 + p.rng() * 4;
              p.goal = null;
            } else {
              const a = p.rng() * Math.PI * 2,
                r = p.rng() * p.data.radius;
              p.goal = nav.nearest(
                [
                  p.data.home[0] + Math.sin(a) * r,
                  0,
                  p.data.home[2] + Math.cos(a) * r,
                ],
                p.collisionRadius,
              );
              p.timer = 4 + p.rng() * 6;
              p.state = "idle";
            }
          }
          if (p.state === "sleep" && p.timer > 0) {
            p.view.update(dt);
            continue;
          }
          if (p.goal && distance2(p.position, p.goal) > 0.55) goal = p.goal;
        }
      }
      if (goal) {
        const radius = p.collisionRadius;
        let target = goal;
        if (p.pathTimer <= 0 || !p.path.length) {
          p.path = nav.path(p.position, goal, radius);
          p.pathTimer = 0.9 + p.rng() * 0.5;
        }
        while (p.path.length && distance2(p.position, p.path[0]) < 0.38)
          p.path.shift();
        if (p.path.length) target = p.path[0];
        else if (!nav.lineOfSight(p.position, goal, radius))
          target = p.position;
        const d = distance2(p.position, target),
          speed =
            (running
              ? p.manifest.behavior.runSpeed
              : p.manifest.behavior.walkSpeed) * p.data.speed;
        if (d > 0.05) {
          let vx = (target[0] - p.position[0]) / d,
            vz = (target[2] - p.position[2]) / d;
          const step = Math.min(d, speed * dt),
            before = p.position;
          p.data.position = nav.move(before, vx * step, vz * step, radius);
          const moved = distance2(before, p.position);
          if (moved > 0.0005) {
            p.data.yaw = angleLerp(
              p.data.yaw,
              Math.atan2(vx, vz),
              1 - Math.exp(-dt * 8),
            );
            p.state = running ? "run" : "walk";
            p.clip(p.state);
          } else {
            p.state = "idle";
            p.clip("idle");
            p.pathTimer = 0;
          }
        } else {
          p.state = "idle";
          p.clip("idle");
        }
      } else {
        p.state = "idle";
        p.clip("idle");
      }
      p.view.update(dt * p.data.speed);
    }
    // Local separation supplements A*; stationary fainted pals are not rigid bodies.
    for (let i = 0; i < this.pals.length; i++)
      for (let j = i + 1; j < this.pals.length; j++) {
        const a = this.pals[i],
          b = this.pals[j];
        if (
          a === this.held ||
          b === this.held ||
          a.data.health <= 0 ||
          b.data.health <= 0
        )
          continue;
        const d = distance2(a.position, b.position),
          min = (a.collisionRadius + b.collisionRadius) * 0.8;
        if (d < min) {
          const angle =
              d > 0.001
                ? Math.atan2(
                    a.position[0] - b.position[0],
                    a.position[2] - b.position[2],
                  )
                : (i + j) * 1.7,
            strength = (min - d) * Math.min(1, dt * 3);
          a.data.position = nav.move(
            a.position,
            Math.sin(angle) * strength,
            Math.cos(angle) * strength,
            a.collisionRadius,
          );
          b.data.position = nav.move(
            b.position,
            -Math.sin(angle) * strength,
            -Math.cos(angle) * strength,
            b.collisionRadius,
          );
        }
      }
  }
  updateCamera() {
    if (this.lab) {
      const l = this.lab,
        p = l.pal,
        target = [
          p.position[0],
          p.position[1] + p.height * 0.52,
          p.position[2],
        ],
        d = l.distance;
      this.camera = {
        eye: [
          target[0] + Math.sin(l.yaw) * Math.cos(l.pitch) * d,
          target[1] + Math.sin(l.pitch) * d,
          target[2] + Math.cos(l.yaw) * Math.cos(l.pitch) * d,
        ],
        target,
        fov: 42,
        viewport: l.viewport,
      };
      this.target = p;
      return;
    }
    const eye = [
        this.player.position[0],
        this.player.position[1] + 1.62,
        this.player.position[2],
      ],
      dir = [
        Math.sin(this.player.yaw) * Math.cos(this.player.pitch),
        Math.sin(this.player.pitch),
        Math.cos(this.player.yaw) * Math.cos(this.player.pitch),
      ];
    this.camera = { eye, target: eye.map((v, i) => v + dir[i]), fov: 68 };
    let closest = Infinity,
      target = null;
    for (const p of this.pals) {
      if (p === this.held) continue;
      const center = [
          p.position[0],
          p.position[1] + p.height * 0.55,
          p.position[2],
        ],
        delta = vsub(center, eye),
        along = dot(delta, dir),
        off = Math.sqrt(Math.max(0, dot(delta, delta) - along * along));
      if (
        along > 0 &&
        along < 8 &&
        off < Math.max(0.3, p.collisionRadius * 1.2) &&
        along < closest &&
        this.environment.nav.lineOfSight(this.player.position, p.position, 0.08)
      ) {
        target = p;
        closest = along;
      }
    }
    this.target = target;
  }
  draw() {
    if (!this.environment || this.mode === "loading") return;
    const records = this.lab
      ? [
          {
            geometry: LAB_FLOOR,
            material: LAB_MATERIAL,
            model: yawMatrix(this.lab.pal.position),
          },
        ]
      : this.environment.records.slice();
    for (const p of this.pals) {
      if (this.lab && this.lab.pal !== p) continue;
      const pos = [
          p.position[0],
          p.position[1] + p.manifest.physics.groundOffset * p.scale,
          p.position[2],
        ],
        root = yawMatrix(pos, p.data.yaw, p.scale),
        isLab = this.lab?.pal === p;
      const shadowY = this.environment.nav.ground(p.position[0], p.position[2]);
      if (Number.isFinite(shadowY))
        records.push({
          geometry: SHADOW,
          material: SHADOW_MAT,
          model: yawMatrix([p.position[0], shadowY + 0.028, p.position[2]], 0, [
            Math.max(0.25, p.collisionRadius * 1.6),
            1,
            Math.max(0.25, p.collisionRadius * 1.5),
          ]),
        });
      records.push(
        ...p.view.records(root, {
          wire: isLab && this.lab.wire,
          rig: isLab && this.lab.rig,
          flash: p.flash > 0,
        }),
      );
      if (
        (this.target === p || isLab) &&
        p !== this.held &&
        Number.isFinite(shadowY)
      )
        records.push({
          geometry: SELECT_RING,
          material: material("#e9f0c1", { unlit: true }),
          model: yawMatrix(
            [p.position[0], shadowY + 0.045, p.position[2]],
            0,
            Math.max(0.45, p.collisionRadius * 1.5),
          ),
        });
    }
    const lighting = daylight(
      this.lab ? 11 : (this.world?.environment.time ?? 10.5),
    );
    if (this.lab) lighting.sky = [0.9, 0.925, 0.865];
    this.renderer.render(records, this.camera, lighting);
  }
}
