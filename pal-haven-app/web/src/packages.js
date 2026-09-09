import { loadGLB } from "./glb.js";
export const MB = 1024 * 1024;
export const SLOTS = [
  "idle",
  "walk",
  "run",
  "attack",
  "hit",
  "faint",
  "getUp",
  "held",
  "pet",
  "sleep",
  "eat",
  "happy",
  "jump",
  "sit",
];
export const REQUIRED_SLOTS = ["idle", "walk", "attack"];
export const uid = () => crypto.randomUUID();
export const slug = (s) =>
  String(s)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "creature";
const validPath = (p) =>
  typeof p === "string" &&
  p.length > 0 &&
  p.length < 256 &&
  !p.startsWith("/") &&
  !p.includes("\\") &&
  !p.includes(":") &&
  !p.split("/").some((s) => s === ".." || s === ".") &&
  !/[\x00-\x1f]/.test(p);
export function preflightZip(
  buffer,
  { maxCompressed = 64 * MB, maxExpanded = 160 * MB, maxEntries = 512 } = {},
) {
  if (buffer.byteLength > maxCompressed)
    throw Error(`ZIP exceeds the ${maxCompressed / MB} MB import limit.`);
  const v = new DataView(buffer);
  let end = -1;
  for (
    let i = buffer.byteLength - 22;
    i >= Math.max(0, buffer.byteLength - 65557);
    i--
  )
    if (v.getUint32(i, true) === 0x06054b50) {
      if (i + 22 + v.getUint16(i + 20, true) === buffer.byteLength) {
        end = i;
        break;
      }
    }
  if (end < 0) throw Error("ZIP is incomplete or invalid.");
  const entries = v.getUint16(end + 10, true),
    size = v.getUint32(end + 12, true),
    start = v.getUint32(end + 16, true);
  if (
    v.getUint16(end + 4, true) ||
    v.getUint16(end + 6, true) ||
    entries === 65535 ||
    entries > maxEntries ||
    v.getUint16(end + 8, true) !== entries ||
    start + size !== end
  )
    throw Error(
      "Multipart, ZIP64 or oversized ZIP archives are not supported.",
    );
  let p = start,
    expanded = 0;
  const files = [],
    seen = new Set();
  for (let i = 0; i < entries; i++) {
    if (p + 46 > end || v.getUint32(p, true) !== 0x02014b50)
      throw Error("Invalid ZIP directory.");
    const flags = v.getUint16(p + 8, true),
      method = v.getUint16(p + 10, true),
      packed = v.getUint32(p + 20, true),
      unpacked = v.getUint32(p + 24, true),
      nameLength = v.getUint16(p + 28, true),
      extra = v.getUint16(p + 30, true),
      comment = v.getUint16(p + 32, true),
      attrs = v.getUint32(p + 38, true),
      offset = v.getUint32(p + 42, true);
    if (p + 46 + nameLength + extra + comment > end)
      throw Error("ZIP directory exceeds its bounds.");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(buffer, p + 46, nameLength),
    );
    if (!validPath(name) || seen.has(name))
      throw Error("ZIP contains unsafe or duplicate paths.");
    seen.add(name);
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      ((attrs >>> 16) & 0xf000) === 0xa000 ||
      offset >= start ||
      packed > buffer.byteLength ||
      unpacked > 64 * MB
    )
      throw Error(
        "Encrypted, symlinked or unsupported ZIP entries are not accepted.",
      );
    expanded += unpacked;
    if (expanded > maxExpanded)
      throw Error("ZIP expands beyond the safe memory limit.");
    files.push({ name, size: unpacked, compressed: packed });
    p += 46 + nameLength + extra + comment;
  }
  if (p !== end) throw Error("Unexpected ZIP directory data.");
  return files;
}
export function autoMap(clips) {
  const names = clips.map((c) => (typeof c === "string" ? c : c.name)),
    normalized = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases = {
    idle: ["idle", "idleloop"],
    walk: ["walk", "walking", "walkcycle"],
    run: ["run", "running"],
    attack: ["attack", "attack01", "attack1", "basicattack"],
    hit: ["hit", "hitreaction", "hurt"],
    faint: ["faint", "death", "die"],
    getUp: ["getup", "revive"],
    held: ["held", "pickup", "carry"],
    pet: ["pet", "petted"],
    sleep: ["sleep", "sleeping"],
    eat: ["eat", "eating"],
    happy: ["happy", "celebrate"],
    jump: ["jump"],
    sit: ["sit"],
  };
  const out = {};
  for (const [slot, values] of Object.entries(aliases)) {
    const found = names.find((n) => values.includes(normalized(n)));
    if (found) out[slot] = found;
  }
  return out;
}
export function defaultManifest(name, model) {
  const b = model.bounds,
    height = b.max[1] - b.min[1],
    radius = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) * 0.32;
  return {
    format: "pal-haven/pal",
    schemaVersion: 1,
    id: slug(name),
    name: String(name).slice(0, 64),
    description: "Imported creature",
    model: "model.glb",
    units: "meters",
    upAxis: "+Y",
    forwardAxis: "+Z",
    scale: 1,
    animations: autoMap(model.animations),
    physics: {
      radius: Math.max(0.12, Math.min(2, radius)),
      height: Math.max(0.2, Math.min(8, height)),
      groundOffset: -b.min[1],
    },
    behavior: {
      canBePickedUp: true,
      retaliateWhenAttacked: false,
      walkSpeed: 1.1,
      runSpeed: 2.8,
      wanderRadius: 8,
    },
    combat: {
      maxHealth: 100,
      damage: 8,
      cooldown: 1.8,
      range: 1.3,
      hitTime: 0.45,
    },
  };
}
export function validateManifest(raw, model) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    raw.format !== "pal-haven/pal" ||
    raw.schemaVersion !== 1
  )
    throw Error("pal.json must use pal-haven/pal schemaVersion 1.");
  if (
    typeof raw.name !== "string" ||
    !raw.name.trim() ||
    raw.name.length > 64 ||
    typeof raw.id !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(raw.id)
  )
    throw Error(
      "Creature needs a name (1–64 characters) and a lowercase slug ID.",
    );
  if (!validPath(raw.model) || !raw.model.toLowerCase().endsWith(".glb"))
    throw Error("pal.json model must be a safe relative .glb path.");
  if (raw.units !== "meters" || raw.upAxis !== "+Y" || raw.forwardAxis !== "+Z")
    throw Error(
      "Use metres, +Y up and +Z forward. Apply transforms when exporting.",
    );
  const number = (value, min, max, label, def) => {
    const n = value ?? def;
    if (!Number.isFinite(n) || n < min || n > max)
      throw Error(`${label} must be between ${min} and ${max}.`);
    return n;
  };
  if (
    !raw.animations ||
    typeof raw.animations !== "object" ||
    Array.isArray(raw.animations)
  )
    throw Error("animations must map action slots to clip names.");
  const animations = {};
  for (const [k, v] of Object.entries(raw.animations)) {
    if (!SLOTS.includes(k))
      throw Error(
        `Unknown animation slot: ${k}. Extra clips belong in the GLB, not new combat slots.`,
      );
    if (typeof v !== "string" || !v || v.length > 128)
      throw Error(`Animation ${k} must name exactly one clip.`);
    if (model && !model.animations.some((c) => c.name === v))
      throw Error(`Animation clip “${v}” is missing from the GLB.`);
    animations[k] = v;
  }
  for (const k of REQUIRED_SLOTS)
    if (!animations[k]) throw Error(`Map the ${k} animation before importing.`);
  const p = raw.physics || {},
    b = raw.behavior || {},
    c = raw.combat || {};
  for (const k of ["canBePickedUp", "retaliateWhenAttacked"])
    if (b[k] !== undefined && typeof b[k] !== "boolean")
      throw Error(`behavior.${k} must be true or false.`);
  return {
    format: "pal-haven/pal",
    schemaVersion: 1,
    id: raw.id,
    name: raw.name.trim(),
    description: String(raw.description || "").slice(0, 1000),
    creator: String(raw.creator || "").slice(0, 128),
    license: String(
      raw.license || "User-provided; confirm your rights before sharing.",
    ).slice(0, 1000),
    model: raw.model,
    units: "meters",
    upAxis: "+Y",
    forwardAxis: "+Z",
    scale: number(raw.scale, 0.01, 20, "Model scale", 1),
    animations,
    physics: {
      radius: number(p.radius, 0.08, 3, "Collision radius", 0.4),
      height: number(p.height, 0.1, 12, "Creature height", 1),
      groundOffset: number(p.groundOffset, -10, 10, "Ground offset", 0),
    },
    behavior: {
      canBePickedUp: b.canBePickedUp ?? true,
      retaliateWhenAttacked: b.retaliateWhenAttacked ?? false,
      walkSpeed: number(b.walkSpeed, 0.1, 6, "Walk speed", 1.1),
      runSpeed: number(b.runSpeed, 0.1, 12, "Run speed", 2.8),
      wanderRadius: number(b.wanderRadius, 1, 35, "Wander radius", 8),
    },
    combat: {
      maxHealth: number(c.maxHealth, 1, 10000, "Max health", 100),
      damage: number(c.damage, 0, 1000, "Damage", 8),
      cooldown: number(c.cooldown, 0.4, 20, "Attack cooldown", 1.8),
      range: number(c.range, 0.2, 5, "Attack range", 1.3),
      hitTime: number(c.hitTime, 0, 1, "Attack hit time", 0.45),
    },
  };
}
export async function inspectCreature(file) {
  if (file.size > 64 * MB)
    throw Error(
      "Select a file under 64 MB. Extract the .glb from large recovery archives first.",
    );
  let modelBlob = file,
    rawManifest = null,
    legacy = false,
    fileName = file.name || "Creature.glb";
  if (/\.zip$/i.test(fileName)) {
    const bytes = await file.arrayBuffer(),
      entries = preflightZip(bytes),
      zip = await globalThis.JSZip.loadAsync(bytes);
    const manifests = entries.filter((f) => /(^|\/)pal\.json$/i.test(f.name));
    if (manifests.length > 1)
      throw Error("ZIP contains multiple pals. Import one .pal.zip at a time.");
    if (manifests.length) {
      const entry = manifests[0];
      if (entry.size > 65536) throw Error("pal.json exceeds 64 KB.");
      try {
        rawManifest = JSON.parse(await zip.file(entry.name).async("string"));
      } catch {
        throw Error("Cannot read pal.json.");
      }
      validateManifest(rawManifest);
      const prefix = entry.name.slice(0, entry.name.length - "pal.json".length),
        path = prefix + rawManifest.model,
        info = entries.find((e) => e.name === path);
      if (!info || info.size > 24 * MB)
        throw Error("Manifest model is missing or above 24 MB.");
      modelBlob = new Blob([await zip.file(path).async("uint8array")], {
        type: "model/gltf-binary",
      });
      fileName = path.split("/").pop();
    } else {
      const candidates = entries.filter((e) => /\.glb$/i.test(e.name));
      if (candidates.length !== 1)
        throw Error(
          "Recovery ZIP must contain exactly one GLB. Otherwise extract your chosen .glb and import it directly.",
        );
      if (candidates[0].size > 24 * MB)
        throw Error("Embedded model exceeds 24 MB.");
      modelBlob = new Blob(
        [await zip.file(candidates[0].name).async("uint8array")],
        { type: "model/gltf-binary" },
      );
      fileName = candidates[0].name.split("/").pop();
      legacy = true;
    }
  } else if (!/\.glb$/i.test(fileName))
    throw Error(
      "For creatures, import .pal.zip, a GLB, or your old recovery ZIP. STL/OBJ need rigging and animation in Stage 2 first.",
    );
  const model = await loadGLB(await modelBlob.arrayBuffer());
  if (!model.skins.length)
    throw Error(
      "Creature GLB has no skeleton. Rig it in Stage 2, or import it as a landscape.",
    );
  if (!model.animations.length)
    throw Error(
      "Creature GLB has no animations. Add named clips in Stage 2 first.",
    );
  const name = fileName
    .replace(/(-Animated|-Rigged)?\.glb$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  const manifest = rawManifest
    ? validateManifest(rawManifest, model)
    : defaultManifest(name, model);
  return { model, blob: modelBlob, manifest, legacy, warnings: model.warnings };
}
export async function exportCreature(asset) {
  const zip = new globalThis.JSZip();
  zip.file(
    "pal.json",
    JSON.stringify({ ...asset.manifest, model: "model.glb" }, null, 2),
  );
  zip.file("model.glb", await asset.blob.arrayBuffer());
  zip.file(
    "README.txt",
    "Pal Haven creature package v1. Import this ZIP using Pal library → Import pal.\nSource rights: " +
      asset.manifest.license +
      "\n",
  );
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
export function releaseModel(model) {
  for (const img of model?.images || [])
    if (typeof img.close === "function") img.close();
}
