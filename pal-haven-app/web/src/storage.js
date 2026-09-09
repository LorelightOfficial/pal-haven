/* IndexedDB: asset blobs are stored once and referenced by world instances. */
import { uid, preflightZip, validateManifest, MB } from "./packages.js";
import { loadGLB } from "./glb.js";
const DB_NAME = "pal-haven-v1";
let dbPromise;
export function openDB() {
  if (!dbPromise)
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        for (const name of ["worlds", "assets", "landscapes", "settings"])
          if (!r.result.objectStoreNames.contains(name))
            r.result.createObjectStore(name, { keyPath: "id" });
      };
      r.onsuccess = () => {
        r.result.onversionchange = () => {
          r.result.close();
          dbPromise = null;
        };
        resolve(r.result);
      };
      r.onerror = () => {
        dbPromise = null;
        reject(r.error);
      };
      r.onblocked = () =>
        reject(Error("Close other Pal Haven tabs to finish opening storage."));
    });
  return dbPromise;
}
async function transaction(store, mode, operation) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode),
      s = t.objectStore(store);
    let result;
    try {
      const request = operation(s);
      if (request) {
        request.onsuccess = () => (result = request.result);
        request.onerror = () => reject(request.error);
      }
    } catch (e) {
      t.abort();
      reject(e);
    }
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error || Error("Storage write failed."));
    t.onabort = () =>
      reject(t.error || Error("Storage transaction was cancelled."));
  });
}
export const get = (store, id) =>
  transaction(store, "readonly", (s) => s.get(id));
export const all = (store) => transaction(store, "readonly", (s) => s.getAll());
export const put = (store, value) =>
  transaction(store, "readwrite", (s) => s.put(value));
export const remove = (store, id) =>
  transaction(store, "readwrite", (s) => s.delete(id));
export const defaultSettings = () => ({
  id: "preferences",
  quality: "balanced",
  sensitivity: 1,
  invertY: false,
  showStats: false,
  maxPals: 24,
});
export const newWorld = (name = "Meadow home", type = "meadow") => ({
  id: uid(),
  name,
  type,
  created: Date.now(),
  updated: Date.now(),
  landscapeId: null,
  width: 80,
  player: { position: [0, 0, 10], yaw: Math.PI, pitch: -0.03, health: 100 },
  pals: [],
  environment: { time: 10.5, cycle: false, retaliation: true },
  home: [0, 0, 3],
});
export async function createWorld(world, landscape) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(["worlds", "landscapes"], "readwrite");
    t.objectStore("worlds").put(world);
    if (landscape) t.objectStore("landscapes").put(landscape);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
export async function deleteWorld(world) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(["worlds", "landscapes"], "readwrite");
    t.objectStore("worlds").delete(world.id);
    if (world.landscapeId)
      t.objectStore("landscapes").delete(world.landscapeId);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}
export async function exportWorld(world) {
  const zip = new globalThis.JSZip(),
    header = {
      format: "pal-haven/world",
      schemaVersion: 1,
      world,
      assets: [],
      landscape: null,
    };
  for (const id of new Set(
    world.pals.map((p) => p.assetId).filter((id) => id !== "builtin-training"),
  )) {
    const asset = await get("assets", id);
    if (!asset)
      throw Error(
        "A world asset is missing. Remove missing creatures before exporting.",
      );
    const path = "pals/" + id + "/";
    header.assets.push({ id, path });
    zip.file(
      path + "pal.json",
      JSON.stringify({ ...asset.manifest, model: "model.glb" }, null, 2),
    );
    zip.file(path + "model.glb", await asset.blob.arrayBuffer());
  }
  if (world.landscapeId) {
    const l = await get("landscapes", world.landscapeId);
    if (!l) throw Error("Landscape is missing.");
    const path = "landscape." + l.format;
    header.landscape = {
      path,
      format: l.format,
      name: l.name,
      width: l.width,
      upAxis: l.upAxis,
    };
    zip.file(path, await l.blob.arrayBuffer());
  }
  zip.file("world.json", JSON.stringify(header, null, 2));
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
export function sanitizeWorld(raw, assetIds) {
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof raw.name !== "string" ||
    !raw.name.trim() ||
    raw.name.length > 64 ||
    !["meadow", "courtyard", "imported"].includes(raw.type) ||
    !Array.isArray(raw.pals) ||
    raw.pals.length > 24
  )
    throw Error("Invalid world data.");
  const vector = (v, max = 10000) =>
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => Number.isFinite(n) && Math.abs(n) <= max);
  if (!vector(raw.home) || !vector(raw.player?.position))
    throw Error("World positions are invalid.");
  for (const p of raw.pals) {
    if (!assetIds.has(p.assetId) && p.assetId !== "builtin-training")
      throw Error("World references an unknown creature.");
    if (
      !vector(p.position) ||
      !vector(p.home) ||
      typeof p.name !== "string" ||
      p.name.length > 64 ||
      !Number.isFinite(p.yaw) ||
      !Number.isFinite(p.health) ||
      p.health < 0 ||
      p.health > 10000 ||
      !Number.isFinite(p.scale) ||
      p.scale < 0.1 ||
      p.scale > 8 ||
      !Number.isFinite(p.speed) ||
      p.speed < 0.1 ||
      p.speed > 8 ||
      !Number.isFinite(p.radius) ||
      p.radius < 0.5 ||
      p.radius > 200 ||
      !["roam", "follow", "stay"].includes(p.behavior) ||
      typeof p.retaliate !== "boolean"
    )
      throw Error("World contains invalid creature settings.");
  }
  if (
    !Number.isFinite(raw.width) ||
    raw.width < 10 ||
    raw.width > 200 ||
    !Number.isFinite(raw.environment?.time) ||
    raw.environment.time < 0 ||
    raw.environment.time > 24 ||
    typeof raw.environment.retaliation !== "boolean" ||
    typeof raw.environment.cycle !== "boolean" ||
    !Number.isFinite(raw.player.yaw) ||
    !Number.isFinite(raw.player.pitch) ||
    !Number.isFinite(raw.player.health) ||
    raw.player.health < 0 ||
    raw.player.health > 100
  )
    throw Error("Invalid world environment or player state.");
  return raw;
}
export async function importWorld(file) {
  const bytes = await file.arrayBuffer();
  const entries = preflightZip(bytes, {
    maxCompressed: 128 * MB,
    maxExpanded: 256 * MB,
  });
  const zip = await globalThis.JSZip.loadAsync(bytes),
    entry = entries.find((e) => e.name === "world.json");
  if (!entry || entry.size > 512 * 1024)
    throw Error("Select a Pal Haven .world.zip backup.");
  const h = JSON.parse(await zip.file("world.json").async("string"));
  if (
    h.format !== "pal-haven/world" ||
    h.schemaVersion !== 1 ||
    !Array.isArray(h.assets) ||
    h.assets.length > 24
  )
    throw Error("Unsupported world backup version.");
  const ids = new Set(h.assets.map((a) => a.id));
  if (ids.size !== h.assets.length) throw Error("Duplicate asset IDs.");
  sanitizeWorld(h.world, ids);
  const assets = [],
    mapping = new Map();
  for (const ref of h.assets) {
    if (
      typeof ref.path !== "string" ||
      !/^pals\/[a-zA-Z0-9-]+\/$/.test(ref.path)
    )
      throw Error("Unsafe asset path.");
    const meta = entries.find((e) => e.name === ref.path + "pal.json"),
      model = entries.find((e) => e.name === ref.path + "model.glb");
    if (!meta || meta.size > 65536 || !model || model.size > 24 * MB)
      throw Error("Incomplete creature package in backup.");
    const blob = new Blob([await zip.file(model.name).async("uint8array")], {
        type: "model/gltf-binary",
      }),
      parsed = await loadGLB(await blob.arrayBuffer(), { decodeImages: false }),
      manifest = validateManifest(
        JSON.parse(await zip.file(meta.name).async("string")),
        parsed,
      ),
      id = uid();
    assets.push({ id, manifest, blob, stats: parsed.stats, added: Date.now() });
    mapping.set(ref.id, id);
  }
  let landscape;
  if (h.landscape) {
    const l = h.landscape,
      info = entries.find((e) => e.name === l.path);
    if (
      !["glb", "stl"].includes(l.format) ||
      l.path !== "landscape." + l.format ||
      !info ||
      info.size > 40 * MB ||
      !["Y", "Z"].includes(l.upAxis)
    )
      throw Error("Invalid landscape backup.");
    landscape = {
      id: uid(),
      name: String(l.name).slice(0, 100),
      format: l.format,
      width: h.world.width,
      upAxis: l.upAxis,
      blob: new Blob([await zip.file(l.path).async("uint8array")]),
    };
  }
  if (h.world.type === "imported" && !landscape)
    throw Error("Imported world is missing its landscape.");
  if (landscape) {
    const { importEnvironment } = await import("./environment.js");
    const check = await importEnvironment(landscape);
    check.dispose();
  }
  const w = newWorld(h.world.name + " (restored)", h.world.type);
  w.name = w.name.slice(0, 64);
  w.width = h.world.width;
  w.environment = {
    time: h.world.environment.time,
    retaliation: h.world.environment.retaliation,
    cycle: h.world.environment.cycle,
  };
  w.home = h.world.home.slice();
  w.player = {
    position: h.world.player.position.slice(),
    yaw: h.world.player.yaw,
    pitch: h.world.player.pitch,
    health: h.world.player.health,
  };
  w.landscapeId = landscape?.id || null;
  w.pals = h.world.pals.map((p) => ({
    id: uid(),
    assetId: mapping.get(p.assetId) || p.assetId,
    name: p.name,
    position: p.position.slice(),
    home: p.home.slice(),
    yaw: p.yaw,
    health: p.health,
    scale: p.scale,
    speed: p.speed,
    radius: p.radius,
    behavior: p.behavior,
    retaliate: p.retaliate,
  }));
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const t = db.transaction(["assets", "worlds", "landscapes"], "readwrite");
    for (const a of assets) t.objectStore("assets").put(a);
    if (landscape) t.objectStore("landscapes").put(landscape);
    t.objectStore("worlds").put(w);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  return w;
}
export async function download(blob, name, mime = "application/zip") {
  if (globalThis.PalNative) {
    if (blob.size > 128 * MB)
      throw Error("Export exceeds the 128 MB native limit.");
    const ticket = globalThis.PalNative.beginExport(name, mime, blob.size);
    if (!ticket)
      throw Error(
        "Another export is pending. Finish or cancel the Android save dialog first.",
      );
    try {
      for (let start = 0; start < blob.size; start += 384 * 1024) {
        const bytes = new Uint8Array(
          await blob.slice(start, start + 384 * 1024).arrayBuffer(),
        );
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        if (!globalThis.PalNative.appendExport(ticket, btoa(binary)))
          throw Error("Unable to prepare export. Check free storage.");
      }
      globalThis.PalNative.finishExport(ticket);
    } catch (e) {
      globalThis.PalNative.cancelExport(ticket);
      throw e;
    }
  } else {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
