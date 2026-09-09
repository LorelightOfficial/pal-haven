import { BabylonRenderer } from "./rendering/BabylonRenderer.js";
import { ModelLibrary } from "./rendering/ModelLibrary.js";
import { ModelInstance } from "./rendering/ModelInstance.js";
import { Controls } from "./input.js";
import {
  createEnvironment,
  importEnvironment,
  daylight,
} from "./environment.js";
import { TrainingBuddy, TRAINING_MANIFEST, TRAINING_CLIPS } from "./buddy.js";
import { loadGLB } from "./glb.js";
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
  transform,
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
/* Quality now only decides how sharp the picture is. Every tier draws every
 * animation frame, so the game always runs at the display's refresh rate. */
const qualityRatio = { economy: 1, balanced: 1.5, clear: 2.25, ultra: 3 },
  qualityTexture = { economy: 1024, balanced: 2048, clear: 4096, ultra: 4096 };
const STEP = 1 / 60;
// Interaction reach in metres. Generous on purpose so phone aiming feels fair.
export const REACH = { attack: 6.5, pick: 5.5, pet: 5.5, aim: 34 };
// How long a fainted pal lingers as a physical object before it fades away.
export const REMAINS_SECONDS = 15;
// Retaliation is a per-pal switch only, and it applies from the very first hit.
export function shouldRetaliate(world, pal) {
  return pal.data.retaliate !== false && pal.data.health > 0;
}
/* Randomised behaviour. Walking is the everyday state; now and then a pal
 * stops to play a different animation instead. Only clips the pal actually
 * ships with are chosen, so nothing falls back to a wrong pose. */
const IDLE_ACTIONS = [
  { action: "look", slot: "idle", weight: 5, min: 1.4, span: 2.6, turn: true },
  { action: "graze", slot: "eat", weight: 4, min: 2.4, span: 3.6 },
  { action: "rest", slot: "sit", weight: 3, min: 2.8, span: 4.2 },
  { action: "cheer", slot: "happy", weight: 2, min: 1, span: 1.6 },
  { action: "hop", slot: "jump", weight: 2, min: 0.9, span: 1.2 },
  { action: "stretch", slot: "idle", weight: 2, min: 1.5, span: 2, turn: true },
];
/* `calm` is used for a pal already standing next to you, where walking off
 * would look wrong, so those rolls favour the standing-still animations. */
export function rollAction(p, calm = false) {
  const roll = p.rng();
  if (!calm) {
    if (roll < 0.62)
      return { action: "walk", moves: true, min: 2.6, span: 4.4 };
    if (roll < 0.74)
      return { action: "trot", moves: true, min: 1.6, span: 2.4 };
  } else if (roll < 0.35) {
    return { action: "look", slot: "idle", min: 2, span: 2.5, turn: true };
  }
  const animations = p.manifest?.animations || {},
    pool = IDLE_ACTIONS.filter((a) => a.slot === "idle" || animations[a.slot]),
    total = pool.reduce((s, a) => s + a.weight, 0);
  let pick = p.rng() * total;
  for (const a of pool) {
    pick -= a.weight;
    if (pick <= 0) return a;
  }
  return pool[pool.length - 1];
}
function startAction(p, next) {
  p.action = next.action;
  p.timer = next.min + p.rng() * next.span;
  p.hurry = next.action === "trot";
  if (next.moves) {
    p.actionSlot = null;
    p.turning = 0;
    return;
  }
  p.actionSlot = next.slot;
  p.goal = null;
  p.path = [];
  p.turning = next.turn ? (p.rng() - 0.5) * 1.9 : 0;
  p.state = "act";
  p.clip(next.slot, { restart: true });
}
class Creature {
  constructor(data, asset, scene = null) {
    this.data = data;
    this.manifest = asset.manifest;
    this.asset = asset;
    // Babylon owns imported creature meshes now. The built-in training buddy
    // is procedural geometry, so it keeps being drawn from plain records.
    this.view =
      asset.container && scene
        ? new ModelInstance(asset.container, scene)
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
    this.hurry = false;
    // What this pal is currently doing, and which clip that action plays.
    this.action = "walk";
    this.actionSlot = null;
    this.turning = 0;
    // Remains state: a fainted pal becomes a nudge-able object for a while.
    this.remains = false;
    this.deathTime = 0;
    this.sink = 0;
    this.velocity = [0, 0];
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
    this.renderer = new BabylonRenderer(canvas);
    this.models = new ModelLibrary(this.renderer.scene);
    this.controls = new Controls(canvas, {
      onAction: (a) => this.action(a),
      onLook: (x, y) => this.look(x, y),
    });
    this.settings = {
      quality: "balanced",
      sensitivity: 1,
      invertY: false,
      maxPals: 24,
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
    // Lighting, shadow and material budgets follow the quality preset.
    this.renderer.setQuality?.(settings.quality);
    // Render at (or above) the device's own pixel density for a sharp HD image.
    this.renderer.pixelRatio = Math.min(
      Math.max(1, devicePixelRatio || 1),
      qualityRatio[settings.quality] || 1.5,
    );
    this.renderer.measure(true);
  }
  unload() {
    this.controls.reset();
    this.environment?.dispose();
    for (const p of this.pals) p.view.release(this.renderer);
    for (const a of this.assets.values()) if (a.model) releaseModel(a.model);
    this.models.dispose();
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
    /* Retaliation used to need a world switch AND a per-pal switch, so pals
     * ignored the first hits. One-time migration turns both on. */
    const legacyPeaceful = this.world.environment.retaliation !== true;
    this.world.environment.retaliation = true;
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
          retaliate: legacyPeaceful ? true : data.retaliate !== false,
        },
        asset,
        this.renderer.scene,
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
    const buffer = await raw.blob.arrayBuffer();
    const model = await loadGLB(buffer, {
      maxTextureSize: qualityTexture[this.settings.quality] || 2048,
    });
    // Babylon parses the same bytes for the meshes it actually draws, while
    // glb.js stays the source of the clip list, triangle stats and rig info
    // the lab and HUD read - and it is what validated the file in the first
    // place, so an unsupported model is still rejected before it loads.
    const container = await this.models.load(id, buffer);
    const asset = { ...raw, model, container };
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
      retaliate: manifest.behavior.retaliateWhenAttacked !== false,
    };
  }
  async spawn(assetId, count = 1, opts = {}) {
    if (this.mode !== "play") throw Error("Open a world first.");
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 64 ||
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
    if (total > 6000000)
      throw Error(
        "That would exceed the 6M visible creature triangle budget. Add fewer copies or optimise this model.",
      );
    const nav = this.environment.nav,
      created = [];
    /* Pals turn up anywhere in the world. Each one takes a random walkable
     * spot across the whole map, kept off your toes and off each other. */
    const radius =
        asset.manifest.physics.radius *
        (opts.scale || 1) *
        asset.manifest.scale,
      reach = (nav.width || 80) * 0.46,
      taken = this.pals.map((p) => p.position.slice());
    for (let i = 0; i < count; i++) {
      let pos = null,
        fallback = null,
        best = -Infinity;
      for (let tries = 0; tries < 160; tries++) {
        const angle = Math.random() * Math.PI * 2,
          span = Math.sqrt(Math.random()) * reach,
          candidate = nav.nearest(
            [Math.sin(angle) * span, 0, Math.cos(angle) * span],
            radius,
          );
        if (!candidate) continue;
        const clearance = Math.min(
          distance2(candidate, this.player.position) - 2.5,
          ...taken.map((t) => distance2(candidate, t) - radius - 0.9),
        );
        if (clearance > 1.5) {
          pos = candidate;
          break;
        }
        if (clearance > best) {
          best = clearance;
          fallback = candidate;
        }
      }
      pos = pos || fallback || nav.nearest(this.player.position, radius);
      if (!pos)
        throw Error(
          "This world has no walkable ground yet. Reset the terrain or import a landscape, then try again.",
        );
      taken.push(pos.slice());
      const data = this.makeData(assetId, asset.manifest, pos);
      Object.assign(data, opts);
      data.position = pos;
      data.home = pos.slice();
      data.yaw = Math.random() * Math.PI * 2;
      const p = new Creature(data, asset, this.renderer.scene);
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
      this.cooldown = 0.45;
      this.hooks.effect?.("attack");
      if (
        p &&
        distance2(this.player.position, p.position) <=
          REACH.attack + p.collisionRadius &&
        this.environment.nav.lineOfSight(this.player.position, p.position, 0.1)
      )
        this.hit(p, 20);
      else this.hooks.miss?.();
    } else if (name === "pick") {
      if (this.held) {
        const pos = this.environment.nav.nearest(
          [
            this.player.position[0] + Math.sin(this.player.yaw) * 2.4,
            0,
            this.player.position[2] + Math.cos(this.player.yaw) * 2.4,
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
        distance2(this.player.position, p.position) <
          REACH.pick + p.collisionRadius &&
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
      } else
        this.hooks.notice?.(
          `Aim at a living, pickable pal within ${REACH.pick} m.`,
        );
    } else if (name === "pet") {
      if (
        p &&
        distance2(this.player.position, p.position) <
          REACH.pet + p.collisionRadius &&
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
    const fatal = p.data.health === 0;
    p.state = fatal ? "faint" : "hit";
    p.clip(p.state, { restart: true });
    p.timer = p.view.duration();
    p.attackHit = true;
    // Drop whatever they were doing; they react instead of grazing on.
    p.actionSlot = null;
    p.turning = 0;
    p.aggro = !fatal && shouldRetaliate(this.world, p);
    p.anger = 20;
    this.selected = p;
    if (fatal) {
      // Knock the remains away from the blow, then let physics settle them.
      p.remains = true;
      p.deathTime = 0;
      const away = Math.atan2(
        p.position[0] - this.player.position[0],
        p.position[2] - this.player.position[2],
      );
      p.velocity = [Math.sin(away) * 2.4, Math.cos(away) * 2.4];
    }
    /* Damage is shown as a floating number over the pal, not as a text toast. */
    this.hooks.damage?.({
      amount,
      fatal,
      name: p.data.name,
      point: [p.position[0], p.position[1] + p.height * 0.95, p.position[2]],
    });
    this.hooks.change?.();
  }
  revive(p) {
    p.data.health = p.manifest.combat.maxHealth;
    p.aggro = false;
    p.remains = false;
    p.deathTime = 0;
    p.sink = 0;
    p.velocity = [0, 0];
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
      (this.mode === "hub" && !this.renderer.measure().width)
    )
      return;
    this.elapsed += dt;
    if (this.mode === "play" && !this.paused && !this.lab) {
      // 60 Hz simulation, capped so one hitch cannot snowball into a freeze.
      this.accumulator = Math.min(0.25, this.accumulator + dt);
      let steps = 0;
      while (this.accumulator >= STEP && steps < 5) {
        this.step(STEP);
        this.accumulator -= STEP;
        steps++;
      }
      if (steps >= 5) this.accumulator = 0;
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
    // Draw on every animation frame; the display refresh rate is the only cap.
    this.lastDraw = now;
    this.draw();
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
      this.hooks.status?.(this);
    }
  }
  step(dt) {
    const nav = this.environment.nav,
      faded = [];
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
        this.settleRemains(p, dt);
        p.view.update(dt);
        if (p.remains && p.deathTime > REMAINS_SECONDS) faded.push(p);
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
          playerDistance > 34 ||
          distance2(p.position, p.data.home) > p.data.radius + 34
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
            p.action = running ? "trot" : "walk";
            p.actionSlot = null;
          } else if (p.timer <= 0) startAction(p, rollAction(p, true));
        } else if (p.data.behavior === "roam") {
          /* Walking is normal. When a stretch of walking ends they sometimes
           * play another animation instead of setting off again. */
          if (p.timer <= 0 || (!p.goal && !p.actionSlot)) {
            startAction(p, rollAction(p, false));
            if (!p.actionSlot) {
              const a = p.rng() * Math.PI * 2,
                r = p.data.radius * (0.3 + p.rng() * 0.7);
              p.goal = nav.nearest(
                [
                  p.data.home[0] + Math.sin(a) * r,
                  0,
                  p.data.home[2] + Math.cos(a) * r,
                ],
                p.collisionRadius,
              );
              p.path = [];
              p.pathTimer = 0;
            }
          }
          if (!p.actionSlot && p.goal) {
            if (distance2(p.position, p.goal) > 0.55) {
              goal = p.goal;
              running = !!p.hurry;
            } else if (p.timer > 0.4) p.timer = 0.35;
          }
        }
      }
      if (!goal && p.turning) {
        // Some standing actions include a slow look around.
        p.data.yaw += p.turning * dt;
        p.turning *= Math.max(0, 1 - dt * 0.7);
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
      } else if (p.actionSlot) {
        // Hold the chosen animation instead of snapping back to idle.
        p.state = "act";
        p.clip(p.actionSlot);
      } else {
        p.state = "idle";
        p.clip("idle");
      }
      p.view.update(dt * p.data.speed);
    }
    // Remains that finished sinking are cleared out of the world.
    for (const p of faded) {
      p.remains = false;
      this.hooks.notice?.(`${p.data.name}'s remains faded away.`);
      this.remove(p);
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
        along < REACH.aim &&
        off < Math.max(0.9, p.collisionRadius * 2.1) &&
        along < closest &&
        this.environment.nav.lineOfSight(this.player.position, p.position, 0.08)
      ) {
        target = p;
        closest = along;
      }
    }
    this.target = target;
  }
  /* Fainted pals stay behind as a physical object: walk into them and they get
   * shoved along the ground, then they settle, sink and fade out. */
  settleRemains(p, dt) {
    const nav = this.environment.nav;
    if (p.remains) {
      p.deathTime += dt;
      p.sink = clamp((p.deathTime - (REMAINS_SECONDS - 1.8)) / 1.8, 0, 1);
    }
    const shove = (from, weight) => {
      const reach = p.collisionRadius + 0.42,
        d = distance2(p.position, from);
      if (d > reach) return;
      const angle =
          d > 0.001
            ? Math.atan2(p.position[0] - from[0], p.position[2] - from[2])
            : p.rng() * Math.PI * 2,
        push = (1 - d / reach) * 11 * weight * dt;
      p.velocity[0] += Math.sin(angle) * push;
      p.velocity[1] += Math.cos(angle) * push;
      p.data.yaw = angleLerp(p.data.yaw, angle, 1 - Math.exp(-dt * 3));
    };
    if (this.player.health > 0) shove(this.player.position, 1);
    for (const q of this.pals)
      if (q !== p && q !== this.held && q.data.health > 0)
        shove(q.position, 0.5);
    const damping = Math.exp(-dt * 4.5);
    p.velocity[0] *= damping;
    p.velocity[1] *= damping;
    const speed = Math.hypot(p.velocity[0], p.velocity[1]);
    if (speed < 0.03) {
      p.velocity[0] = p.velocity[1] = 0;
      return;
    }
    const limit = Math.min(speed, 6) / speed,
      before = p.position;
    p.data.position = nav.move(
      before,
      p.velocity[0] * limit * dt,
      p.velocity[1] * limit * dt,
      p.collisionRadius * 0.6,
    );
    if (distance2(before, p.position) < 0.0005) {
      p.velocity[0] *= 0.25;
      p.velocity[1] *= 0.25;
    }
  }
  /* World point -> CSS pixel, so the HUD can float damage numbers over the pal
   * that was actually hit. */
  project(point) {
    const vp = this.renderer.vp;
    if (!vp) return null;
    const clip = transform(vp, point, 1),
      w = vp[3] * point[0] + vp[7] * point[1] + vp[11] * point[2] + vp[15];
    if (!Number.isFinite(w) || w <= 0.0001) return null;
    const rect = this.renderer.measure();
    return {
      x: ((clip[0] / w) * 0.5 + 0.5) * rect.width,
      y: (0.5 - (clip[1] / w) * 0.5) * rect.height,
    };
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
      // Babylon keeps meshes between frames, so a pal left out of the records
      // has to be switched off rather than simply skipped.
      if (this.lab && this.lab.pal !== p) {
        p.view.setEnabled?.(false);
        continue;
      }
      p.view.setEnabled?.(true);
      const sink = p.sink || 0,
        pos = [
          p.position[0],
          p.position[1] +
            p.manifest.physics.groundOffset * p.scale -
            sink * (p.height + 0.5),
          p.position[2],
        ],
        root = yawMatrix(pos, p.data.yaw, p.scale),
        isLab = this.lab?.pal === p;
      const shadowY = this.environment.nav.ground(p.position[0], p.position[2]);
      if (Number.isFinite(shadowY) && sink < 0.98)
        records.push({
          geometry: SHADOW,
          material: SHADOW_MAT,
          model: yawMatrix([p.position[0], shadowY + 0.028, p.position[2]], 0, [
            Math.max(0.25, p.collisionRadius * 1.6) * (1 - sink),
            1,
            Math.max(0.25, p.collisionRadius * 1.5) * (1 - sink),
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
    // The pal viewer keeps a flat studio backdrop instead of the world sky.
    if (this.lab) lighting.studio = true;
    this.renderer.render(records, this.camera, lighting);
  }
}
