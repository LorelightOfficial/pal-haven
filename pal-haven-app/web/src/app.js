import { Game } from "./game.js";
import { TRAINING_MANIFEST, TRAINING_CLIPS } from "./buddy.js";
import * as store from "./storage.js";
import {
  inspectCreature,
  validateManifest,
  exportCreature,
  releaseModel,
  SLOTS,
  REQUIRED_SLOTS,
  uid,
  slug,
  MB,
} from "./packages.js";
import { importEnvironment } from "./environment.js";
import {
  $,
  esc,
  icon,
  hydrate,
  toast,
  busy,
  formError,
  showDialog,
  closeDialogs,
  installDialogs,
  onDialogsClosed,
  menuItem,
  options,
} from "./ui.js";
import { clamp } from "./math.js";
let game = null,
  worlds = [],
  assets = [],
  preferences = store.defaultSettings(),
  activeRoute = "worlds",
  saveChain = Promise.resolve(),
  saveTimer,
  worldDraft = null,
  pendingImport = null,
  importInWorld = false,
  ready = false;
const size = (n) =>
  n < MB ? (n / 1024).toFixed(0) + " KB" : (n / MB).toFixed(1) + " MB";
const date = (n) =>
  new Date(n).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const attempt =
  (fn) =>
  async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      console.error(e);
      toast(e.message || String(e));
    }
  };
const pauseForMenu = () => {
  if (game?.mode === "play") game.setPaused(true);
};
function persistSoon() {
  clearTimeout(saveTimer);
  if (game?.mode !== "play") return;
  updateStatus();
  $("save-indicator").textContent = "Unsaved changes";
  saveTimer = setTimeout(() => saveWorld().catch(reportSaveError), 600);
}
function reportSaveError(error) {
  $("save-indicator").textContent = "Not saved — storage error";
  toast("Could not save. Export a backup now. " + error.message);
}
async function saveWorld() {
  if (game?.mode !== "play") return;
  const snapshot = game.snapshot();
  $("save-indicator").textContent = "Saving…";
  saveChain = saveChain
    .catch(() => {})
    .then(() => store.put("worlds", snapshot));
  await saveChain;
  $("save-indicator").textContent = "Saved on device";
  return snapshot;
}
function effect(kind) {
  if (kind === "hurt") {
    $("damage-vignette").classList.remove("active");
    void $("damage-vignette").offsetWidth;
    $("damage-vignette").classList.add("active");
  } else {
    const el = $("interaction-effect");
    el.className = "interaction-effect";
    void el.offsetWidth;
    el.classList.add(kind);
    setTimeout(() => (el.className = "interaction-effect"), 900);
  }
}
function updateStatus() {
  if (!game || game.mode !== "play") return;
  $("hud-pal-count").textContent = game.pals.length;
  $("player-hp").value = game.player.health;
  $("player-health-value").textContent = game.player.health;
  $("pick-label").textContent = game.held ? "Drop" : "Pick";
  $("performance").hidden = !preferences.showStats;
  $("performance").textContent =
    `${game.fps} fps · ${Math.round(game.renderer.stats.triangles / 1000)}k triangles · ${game.pals.length} pals`;
  $("target-badge").hidden = !game.target || !!game.lab;
  if (game.target) {
    $("target-name").textContent = game.target.data.name;
    $("target-health").textContent =
      `${Math.round(game.target.data.health)} / ${game.target.manifest.combat.maxHealth} HP · ${game.target.state}`;
  }
  updateLabControls();
}
function updateLabControls() {
  if (!game?.lab) return;
  const l = game.lab;
  const header = document.querySelector(".lab-header").getBoundingClientRect(),
    panel = document.querySelector(".lab-panel").getBoundingClientRect(),
    rect = game.canvas.getBoundingClientRect();
  l.viewport =
    rect.width > rect.height
      ? {
          x: 0,
          y: header.bottom + 8,
          width: Math.max(80, panel.left - 16),
          height: Math.max(80, rect.height - header.bottom - 32),
        }
      : {
          x: 0,
          y: header.bottom + 8,
          width: rect.width,
          height: Math.max(80, panel.top - header.bottom - 16),
        };
  const duration = l.pal.clips.find((c) => c.name === l.clip)?.duration || 1;
  if (document.activeElement !== $("lab-timeline"))
    $("lab-timeline").value = Math.round((l.time / duration) * 1000);
  $("lab-time").textContent =
    l.time.toFixed(2) + " / " + duration.toFixed(2) + " s";
  const state = l.playing ? "pause" : "play";
  if ($("lab-play").dataset.state !== state) {
    $("lab-play").innerHTML = icon(state);
    $("lab-play").dataset.state = state;
    $("lab-play").setAttribute(
      "aria-label",
      l.playing ? "Pause animation" : "Play animation",
    );
  }
}
async function refreshHub() {
  [worlds, assets] = await Promise.all([
    store.all("worlds"),
    store.all("assets"),
  ]);
  worlds.sort((a, b) => b.updated - a.updated);
  assets.sort((a, b) => b.added - a.added);
  renderWorlds();
  renderLibrary();
}
function route(name) {
  if (!["worlds", "library", "guide"].includes(name) || game?.mode === "play")
    return;
  activeRoute = name;
  for (const n of ["worlds", "library", "guide"])
    $(n + "-route").hidden = n !== name;
  document.querySelectorAll("[data-route]").forEach((b) => {
    b.classList.toggle("active", b.dataset.route === name);
    if (b.closest("nav"))
      b.setAttribute(
        "aria-current",
        b.dataset.route === name ? "page" : "false",
      );
  });
  if (name === "worlds" && game) {
    game.renderer.resize();
    game.draw();
  }
  window.scrollTo({ top: 0, behavior: "instant" });
}
function renderWorlds() {
  $("world-count").textContent = worlds.length;
  $("world-grid").innerHTML =
    worlds
      .map(
        (w, i) =>
          `<article class="world-card" style="animation-delay:${Math.min(i, 5) * 45}ms"><div class="world-image ${esc(w.type)}">${icon(w.type === "imported" ? "file" : w.type === "courtyard" ? "grid" : "landscape")}<span class="world-type">${w.type === "meadow" ? "MEADOW HOME" : w.type === "courtyard" ? "TESTING COURTYARD" : "IMPORTED LANDSCAPE"}</span></div><div class="world-card-content"><h3>${esc(w.name)}</h3><div class="world-meta"><span>${icon("paw")}${w.pals.length} pals</span><span>${icon("clock")}${date(w.updated)}</span></div><div class="world-card-actions"><button class="text-button" data-enter="${esc(w.id)}">Enter world ${icon("arrowRight")}</button><button class="icon-button" data-world-details="${esc(w.id)}" aria-label="Manage ${esc(w.name)}">${icon("dots")}</button></div></div></article>`,
      )
      .join("") +
    `<button class="new-world-tile" id="new-world-tile"><span class="new-icon">${icon("plus")}</span><strong>A fresh little world</strong><small>Choose a landscape. Make it yours.</small></button>`;
  $("new-world-tile").onclick = () => createWorldDialog();
  document
    .querySelectorAll("[data-enter]")
    .forEach((b) => (b.onclick = attempt(() => enterWorld(b.dataset.enter))));
  document
    .querySelectorAll("[data-world-details]")
    .forEach((b) => (b.onclick = () => worldDetails(b.dataset.worldDetails)));
  setTimeout(updateWorldThumbnail, 180);
}
function updateWorldThumbnail() {
  if (game?.mode !== "hub" || activeRoute !== "worlds") return;
  try {
    game.renderer.resize();
    game.draw();
    const c = document.createElement("canvas");
    c.width = 720;
    c.height = 400;
    c.getContext("2d").drawImage(game.canvas, 0, 0, c.width, c.height);
    const image = c.toDataURL("image/jpeg", 0.76);
    document
      .querySelectorAll(".world-image:not(.courtyard):not(.imported)")
      .forEach((el) => {
        let img = el.querySelector("img");
        if (!img) {
          img = document.createElement("img");
          img.alt = "Built-in meadow landscape";
          el.prepend(img);
          const ico = el.querySelector("svg");
          if (ico) ico.remove();
        }
        img.src = image;
      });
  } catch {}
}
function renderLibrary() {
  const built = `<article class="pal-card"><div class="pal-avatar">${icon("paw")}</div><span class="tag">BUILT-IN TEST HELPER</span><h3 style="margin-top:12px">Training buddy</h3><p>A tiny diagnostic pal, ready to test your new world. Not a new model export.</p><div class="pal-card-meta"><span class="tag">14 test motions</span><span class="tag">No download</span></div><button class="button secondary" id="training-info">${icon("info")} About the helper</button></article>`;
  $("library-grid").innerHTML =
    (assets.length
      ? assets
          .map(
            (a) =>
              `<article class="pal-card"><div class="pal-avatar">${icon("paw")}</div><h3>${esc(a.manifest.name)}</h3><p>${esc(a.manifest.description || "Ready for a new world.")}</p><div class="pal-card-meta"><span class="tag">${a.stats.clips} clips</span><span class="tag">${Math.round(a.stats.triangles / 1000)}k triangles</span><span class="tag">${size(a.blob.size)}</span></div><button class="button secondary" data-library-id="${esc(a.id)}">${icon("settings")} Package details</button></article>`,
          )
          .join("")
      : `<div class="empty-state">${icon("package")}<h2>Make room for your first pal.</h2><p>Your creature library starts here. Import your animated GLB or a ZIP, then give it a world to explore.</p><button class="button primary" id="empty-import">${icon("import")} Import your first pal</button></div>`) +
    built;
  $("empty-import")?.addEventListener("click", () => pickPal(false));
  $("training-info").onclick = () =>
    showDialog(
      "modal",
      "Meet the training buddy",
      `<div class="form-stack"><p>This small, procedural helper is included so you can test the app before importing any models. It can roam, follow, retaliate when enabled, be picked up, and demonstrate the lab controls.</p><div class="callout">${icon("info")}<p>Your real creatures use the skeleton and animation clips inside their GLB. The helper does not replace your models, and no generated pal model is bundled with the source.</p></div><button id="training-close" class="button primary full">Got it</button></div>`,
      { eyebrow: "APP TESTING, WITHOUT AN ASSET DOWNLOAD" },
    ) && ($("training-close").onclick = () => closeDialogs());
  document
    .querySelectorAll("[data-library-id]")
    .forEach((b) => (b.onclick = () => libraryDetails(b.dataset.libraryId)));
}
async function enterWorld(id) {
  if (!game)
    throw Error(
      "3D is not available on this device. Update Chrome or Android System WebView.",
    );
  const w = await store.get("worlds", id);
  if (!w) throw Error("World no longer exists.");
  closeDialogs({ immediate: true, resume: false });
  await busy("Opening " + w.name, async () => {
    globalThis.PalNative?.setWorldMode(true);
    document.body.classList.add("playing");
    $("app-shell").hidden = true;
    $("play-screen").hidden = false;
    $("game-slot").append(game.canvas);
    $("hud-world-name").textContent = w.name;
    try {
      await game.open(w);
      $("save-indicator").textContent = "Saved on device";
      updateStatus();
    } catch (error) {
      game.demo();
      $("preview-slot").append(game.canvas);
      $("play-screen").hidden = true;
      $("app-shell").hidden = false;
      document.body.classList.remove("playing");
      globalThis.PalNative?.setWorldMode(false);
      throw error;
    }
  });
  toast("Welcome home. Drag to look; open Pals to add a creature.");
}
async function leaveWorld() {
  if (game?.mode !== "play") return;
  await saveWorld();
  closeDialogs({ immediate: true, resume: false });
  if (game.lab) exitLab();
  await busy("Saving your little world", async () => {
    game.demo();
    $("preview-slot").append(game.canvas);
    $("play-screen").hidden = true;
    $("app-shell").hidden = false;
    document.body.classList.remove("playing", "labbing");
    globalThis.PalNative?.setWorldMode(false);
    await refreshHub();
    route("worlds");
  });
}
function createWorldDialog() {
  worldDraft = { type: "meadow", file: null };
  const body = showDialog(
    "modal",
    "Make a little world",
    `<form id="create-world-form" class="form-stack"><label>World name<input type="text" id="new-world-name" maxlength="64" required placeholder="e.g. Clover valley" value="My little world"></label><div><div class="small-heading" style="margin-top:0">Choose a starting point</div><div class="world-presets"><button type="button" class="preset selected" data-preset="meadow">${icon("landscape")}Meadow home</button><button type="button" class="preset" data-preset="courtyard">${icon("grid")}Test courtyard</button><button type="button" class="preset" data-preset="imported">${icon("import")}Your landscape</button></div></div><div id="landscape-fields" class="form-stack" hidden><button type="button" id="choose-landscape" class="upload-zone">${icon("import")}<span id="landscape-name">Choose a landscape file</span><small>Static GLB or STL · up to 40 MB</small></button><div class="form-grid"><label class="field">World width (metres)<input id="landscape-width" type="number" min="20" max="150" step="1" value="80" required></label><label class="field">Source up axis<select id="landscape-up"><option value="Y">Y up (GLB default)</option><option value="Z">Z up (many STL files)</option></select></label></div><p class="help-copy">The landscape is centred and scaled to this width. Use one outdoor walking surface with gentle slopes. Caves, roofs over floors and stacked levels are not supported.</p></div><div id="preset-description" class="callout">${icon("home")}<p>A gentle meadow with an open shelter, a pond, and a circular testing area. Everything is ready to explore.</p></div><div class="dialog-actions"><button type="button" class="button secondary" id="cancel-create">Cancel</button><button type="submit" class="button primary">Create & enter ${icon("arrowRight")}</button></div></form>`,
    { eyebrow: "YOUR NEXT ADVENTURE STARTS HERE" },
  );
  body.querySelectorAll("[data-preset]").forEach(
    (b) =>
      (b.onclick = () => {
        worldDraft.type = b.dataset.preset;
        body
          .querySelectorAll("[data-preset]")
          .forEach((p) => p.classList.toggle("selected", p === b));
        $("landscape-fields").hidden = worldDraft.type !== "imported";
        $("preset-description").hidden = worldDraft.type === "imported";
        if (worldDraft.type !== "imported")
          $("preset-description").innerHTML =
            icon(worldDraft.type === "meadow" ? "home" : "grid") +
            `<p>${worldDraft.type === "meadow" ? "A gentle meadow with an open shelter, a pond, and a circular testing area. Everything is ready to explore." : "A flat, grid-like courtyard with a testing ring and shelter. An easy place to inspect movement and collision."}</p>`;
      }),
  );
  $("choose-landscape").onclick = () => {
    $("landscape-file").value = "";
    $("landscape-file").click();
  };
  $("cancel-create").onclick = () => closeDialogs();
  $("create-world-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const name = $("new-world-name").value.trim();
      if (!name) throw Error("Give this world a name.");
      const w = store.newWorld(name, worldDraft.type);
      let l = null;
      if (worldDraft.type === "imported") {
        if (!worldDraft.file) throw Error("Choose a landscape file first.");
        const width = Number($("landscape-width").value);
        if (!Number.isFinite(width) || width < 20 || width > 150)
          throw Error("World width must be 20–150 metres.");
        l = {
          id: uid(),
          name: worldDraft.file.name,
          blob: worldDraft.file,
          format: worldDraft.file.name.toLowerCase().endsWith(".stl")
            ? "stl"
            : "glb",
          width,
          upAxis: $("landscape-up").value,
        };
        await busy(
          "Preparing your landscape",
          async () => {
            const env = await importEnvironment(l);
            w.home = env.home.slice();
            w.player.position = env.home.slice();
            env.dispose();
          },
          "Checking the model and building a walkable ground grid.",
        );
        w.landscapeId = l.id;
        w.width = width;
      } else {
        w.home = [-6, 0, -1];
      }
      await store.createWorld(w, l);
      closeDialogs({ immediate: true, resume: false });
      await refreshHub();
      await enterWorld(w.id);
    } catch (error) {
      formError(body, error);
    }
  };
}
function worldDetails(id) {
  const w = worlds.find((w) => w.id === id);
  if (!w) return;
  const body = showDialog(
    "sheet",
    w.name,
    `<div class="stats-row"><div class="stat"><b>${w.pals.length}</b><small>Pals</small></div><div class="stat"><b>${w.width}m</b><small>World width</small></div><div class="stat"><b>${date(w.updated)}</b><small>Last saved</small></div></div><div class="menu-list">${menuItem("details-enter", "Enter world", "Continue from your last save", "play")}${menuItem("details-export", "Export world backup", "Landscape, pals and placements in one ZIP", "archive")}${menuItem("details-rename", "Rename world", "Make this project your own", "folder")}${menuItem("details-delete", "Delete this world", "Does not remove pals from your library", "trash", "danger")}</div>`,
    { eyebrow: "SAVED ON THIS DEVICE" },
  );
  $("details-enter").onclick = attempt(() => enterWorld(id));
  $("details-export").onclick = attempt(() => exportWorldById(id));
  $("details-rename").onclick = () => {
    showDialog(
      "modal",
      "Rename world",
      `<form id="rename-world-form" class="form-stack"><label class="field">World name<input id="rename-world" maxlength="64" required value="${esc(w.name)}"></label><button class="button primary" type="submit">Save name</button></form>`,
    );
    $("rename-world-form").onsubmit = async (e) => {
      e.preventDefault();
      const name = $("rename-world").value.trim();
      if (!name) return;
      await store.put("worlds", { ...w, name });
      closeDialogs();
      await refreshHub();
    };
  };
  $("details-delete").onclick = () =>
    confirmAction(
      "Delete " + w.name + "?",
      "This removes this world and its landscape from the device. Your creature library stays. Export a backup first if you want to keep it.",
      "Delete world",
      async () => {
        await store.deleteWorld(w);
        await refreshHub();
        toast("World deleted.");
      },
    );
}
function confirmAction(title, message, label, fn) {
  showDialog(
    "modal",
    title,
    `<p>${esc(message)}</p><div class="dialog-actions"><button class="button secondary" id="confirm-cancel">Cancel</button><button class="button danger" id="confirm-yes">${esc(label)}</button></div>`,
  );
  $("confirm-cancel").onclick = () => closeDialogs();
  $("confirm-yes").onclick = attempt(async () => {
    await fn();
    closeDialogs();
  });
}
async function exportWorldById(id) {
  if (game?.mode === "play" && game.world.id === id) await saveWorld();
  const w = await store.get("worlds", id);
  await busy("Packing your world", async () => {
    const blob = await store.exportWorld(w);
    await store.download(blob, slug(w.name) + ".world.zip");
  });
  toast(
    globalThis.PalNative
      ? "Choose where to save your world backup."
      : "World backup download started.",
  );
}
function pickPal(inWorld = game?.mode === "play") {
  importInWorld = !!inWorld;
  if (inWorld) pauseForMenu();
  $("pal-file").value = "";
  $("pal-file").click();
}
async function handlePal(file) {
  if (!file) return;
  pauseForMenu();
  const result = await busy(
    "Getting to know your pal",
    () => inspectCreature(file),
    "Reading the embedded model, rig and animation clips. No files leave your device.",
  );
  pendingImport = result;
  showImportDialog(result);
}
function showImportDialog(result) {
  const m = result.manifest,
    stats = result.model.stats;
  const mapping = (slot) =>
    `<label>${slot === "getUp" ? "Get up" : slot[0].toUpperCase() + slot.slice(1)}${REQUIRED_SLOTS.includes(slot) ? " *" : ""}<select data-map="${slot}">${options([["", "— Not mapped —"], ...result.model.animations.map((a) => [a.name, a.name])], m.animations[slot] || "")}</select></label>`;
  const body = showDialog(
    "modal",
    "A new pal is almost home",
    `<form id="import-form"><div class="form-grid"><label class="field">Pal name<input type="text" id="import-name" maxlength="64" value="${esc(m.name)}" required></label><label class="field">Model scale<input type="number" id="import-scale" min="0.01" max="20" step="0.01" value="${m.scale}" required></label></div><div class="stats-row"><div class="stat"><b>${stats.clips}</b><small>Animations</small></div><div class="stat"><b>${stats.joints}</b><small>Joints</small></div><div class="stat"><b>${size(result.blob.size)}</b><small>Stored file</small></div></div>${result.legacy ? '<div class="import-warning">Recovery archive recognised. Only its GLB is saved; the HTML viewer, duplicate textures and source files are not imported.</div>' : ""}${result.warnings.length ? `<div class="import-warning">${result.warnings.map(esc).join("<br>")}</div>` : ""}<div class="small-heading">Connect the core animations</div><p class="help-copy">Map exactly one combat attack. Every other clip remains available in the Animation lab. Missing optional motions fall back to Idle or Walk.</p><div class="mapping-grid" style="margin-top:16px">${["idle", "walk", "run", "attack"].map(mapping).join("")}</div><details><summary>Other animation slots</summary><div class="mapping-grid" style="margin-top:16px">${SLOTS.filter(
      (s) => !["idle", "walk", "run", "attack"].includes(s),
    )
      .map(mapping)
      .join(
        "",
      )}</div></details><label class="toggle-row"><span><strong>Retaliates when attacked</strong><small>Still requires the world's retaliation setting.</small></span><input class="switch" id="import-retaliate" type="checkbox" ${m.behavior.retaliateWhenAttacked ? "checked" : ""}></label><div class="dialog-actions"><button type="button" class="button secondary" id="cancel-import">Cancel</button><button type="submit" class="button primary">Add to library ${icon("check")}</button></div></form>`,
    {
      eyebrow: "IMPORT · REVIEW YOUR PACKAGE",
      onClose: () => {
        releaseModel(result.model);
        if (pendingImport === result) pendingImport = null;
      },
    },
  );
  $("cancel-import").onclick = () => closeDialogs();
  $("import-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const animations = {};
      body.querySelectorAll("[data-map]").forEach((s) => {
        if (s.value) animations[s.dataset.map] = s.value;
      });
      const manifest = validateManifest(
        {
          ...m,
          name: $("import-name").value.trim(),
          id: slug($("import-name").value),
          model: "model.glb",
          scale: Number($("import-scale").value),
          animations,
          behavior: {
            ...m.behavior,
            retaliateWhenAttacked: $("import-retaliate").checked,
          },
        },
        result.model,
      );
      const asset = {
        id: uid(),
        manifest,
        blob: result.blob,
        stats: result.model.stats,
        added: Date.now(),
      };
      await store.put("assets", asset);
      closeDialogs({ immediate: true, resume: false });
      await refreshHub();
      toast(manifest.name + " joined your library.");
      if (importInWorld && game?.mode === "play") spawnDialog(asset.id);
      else {
        route("library");
        if (game?.mode === "play") game.setPaused(false);
      }
    } catch (error) {
      formError(body, error);
    }
  };
}
function libraryDetails(id) {
  const a = assets.find((a) => a.id === id);
  if (!a) return;
  const body = showDialog(
    "sheet",
    a.manifest.name,
    `<p>${esc(a.manifest.description || "Imported and ready for your worlds.")}</p><div class="stats-row"><div class="stat"><b>${a.stats.clips}</b><small>Clips</small></div><div class="stat"><b>${Math.round(a.stats.triangles / 1000)}k</b><small>Triangles</small></div><div class="stat"><b>${size(a.blob.size)}</b><small>File size</small></div></div><div class="callout">${icon("attack")}<p>Combat uses <strong>${esc(a.manifest.animations.attack)}</strong>. Other clips are available for manual preview, not additional attack types.</p></div><div class="small-heading">Your animation map</div><div class="chip-row">${Object.entries(
      a.manifest.animations,
    )
      .map(([k, v]) => `<span class="tag">${esc(k)} → ${esc(v)}</span>`)
      .join(
        "",
      )}</div><div class="menu-list">${menuItem("export-pal", "Export .pal.zip", "A compatible package for this and future worlds", "package")}${menuItem("remove-pal", "Remove from library", "Only possible when no worlds use this pal", "trash", "danger")}</div><p class="help-copy" style="margin-top:20px">${esc(a.manifest.license || "User-provided asset. Confirm rights before sharing.")}</p>`,
    { eyebrow: "CREATURE PACKAGE · VERSION 1" },
  );
  $("export-pal").onclick = attempt(async () => {
    await busy("Packing " + a.manifest.name, async () => {
      const blob = await exportCreature(a);
      await store.download(blob, slug(a.manifest.name) + ".pal.zip");
    });
    toast("Creature package export prepared.");
  });
  $("remove-pal").onclick = attempt(async () => {
    const used = (await store.all("worlds")).filter((w) =>
      w.pals.some((p) => p.assetId === id),
    );
    if (used.length) {
      toast(
        "Remove this pal from " +
          used.map((w) => w.name).join(", ") +
          " before deleting it from the library.",
      );
      return;
    }
    confirmAction(
      "Remove " + a.manifest.name + "?",
      "The stored model will be removed from this device. Keep an exported .pal.zip if you want to import it again.",
      "Remove pal",
      async () => {
        await store.remove("assets", id);
        await refreshHub();
        toast("Pal removed from library.");
      },
    );
  });
}

function worldMenu() {
  pauseForMenu();
  showDialog(
    "sheet",
    game.world.name,
    `<div class="chip-row"><span class="tag">${game.pals.length} pals</span><span class="tag">${game.world.environment.retaliation ? "Retaliation enabled" : "Peaceful by default"}</span></div><div class="menu-list">${menuItem("resume-world", "Back to the world", "Pick up right where you paused", "play")}${menuItem("menu-pals", "Your world pals", "Add, inspect and change your creatures", "paw")}${menuItem("menu-home", "Return home", "Recover health and return to the home point", "home")}${menuItem("menu-save", "Save world", "Keep your latest changes on this device", "save")}${menuItem("menu-backup", "Export world backup", "A ZIP with your project and its assets", "archive")}${menuItem("menu-preferences", "Controls & performance", "Make the app comfortable on your phone", "settings")}${menuItem("menu-exit", "Save & leave world", "Return to your project library", "back")}</div><p class="help-copy" style="margin-top:20px">World simulation pauses while menus are open. Your worlds never require an account or a server.</p>`,
    { eyebrow: "TAKE A LITTLE BREATHER" },
  );
  $("resume-world").onclick = () => closeDialogs();
  $("menu-pals").onclick = attempt(() => managePals());
  $("menu-home").onclick = () => {
    game.resetPlayer();
    persistSoon();
    closeDialogs();
  };
  $("menu-save").onclick = attempt(async () => {
    await saveWorld();
    toast("World saved on this device.");
  });
  $("menu-backup").onclick = attempt(() => exportWorldById(game.world.id));
  $("menu-preferences").onclick = () => settingsDialog();
  $("menu-exit").onclick = attempt(leaveWorld);
}
async function managePals() {
  pauseForMenu();
  assets = await store.all("assets");
  showDialog(
    "sheet",
    "A world of company",
    `<div class="button-row"><button id="add-world-pal" class="button primary">${icon("plus")} Add pals</button><button id="import-world-pal" class="button secondary">${icon("import")} Import</button></div><div class="small-heading">In this world · ${game.pals.length} / ${preferences.maxPals}</div><div id="world-pal-list">${game.pals.length ? game.pals.map((p) => `<div class="pal-instance"><span class="instance-icon">${icon("paw")}</span><div class="instance-info"><strong>${esc(p.data.name)}</strong><small>${esc(p.state)} · ${Math.round(p.data.health)} HP · ${esc(p.data.behavior)}</small></div><button class="icon-button" data-inspect-pal="${esc(p.data.id)}" aria-label="Settings for ${esc(p.data.name)}">${icon("sliders")}</button><button class="icon-button" data-lab-pal="${esc(p.data.id)}" aria-label="Animation lab for ${esc(p.data.name)}">${icon("lab")}</button></div>`).join("") : `<div class="empty-state" style="padding:30px 18px">${icon("paw")}<h3>Room for your first pal.</h3><p>Add a training buddy or choose a creature from your library.</p></div>`}</div><p class="help-copy" style="margin-top:22px">Quantity and behaviour are per world. Removing a pal here does not remove its package from the library.</p>`,
    { eyebrow: "WORLD PALS" },
  );
  $("add-world-pal").onclick = () => chooseSpawnAsset();
  $("import-world-pal").onclick = () => pickPal(true);
  document
    .querySelectorAll("[data-inspect-pal]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          inspectPal(
            game.pals.find((p) => p.data.id === b.dataset.inspectPal),
          )),
    );
  document
    .querySelectorAll("[data-lab-pal]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          enterLab(game.pals.find((p) => p.data.id === b.dataset.labPal))),
    );
}
function chooseSpawnAsset() {
  pauseForMenu();
  showDialog(
    "sheet",
    "Who is coming over?",
    `<p>Choose a pal, then set the quantity and behaviour.</p><div class="menu-list" style="margin-top:20px">${menuItem("spawn-training", "Training buddy", "Built-in helper · no model download", "paw")}${assets.map((a) => `<button class="menu-item" data-spawn="${esc(a.id)}">${icon("paw")}<span><strong>${esc(a.manifest.name)}</strong><small>${a.stats.clips} clips · ${size(a.blob.size)} · ${Math.round(a.stats.triangles / 1000)}k triangles</small></span>${icon("chevron", "chevron")}</button>`).join("")}</div><button id="spawn-import" class="button secondary full" style="margin-top:20px">${icon("import")} Import another pal</button>`,
    { eyebrow: "ADD PALS · CHOOSE A PACKAGE" },
  );
  $("spawn-training").onclick = () => spawnDialog("builtin-training");
  document
    .querySelectorAll("[data-spawn]")
    .forEach((b) => (b.onclick = () => spawnDialog(b.dataset.spawn)));
  $("spawn-import").onclick = () => pickPal(true);
}
function spawnDialog(id) {
  pauseForMenu();
  const asset =
    id === "builtin-training"
      ? { manifest: TRAINING_MANIFEST }
      : assets.find((a) => a.id === id);
  if (!asset) {
    toast("That asset is not available.");
    return;
  }
  const m = asset.manifest,
    body = showDialog(
      "modal",
      "Add " + m.name,
      `<form id="spawn-form" class="form-stack"><p>New pals will appear on open ground in front of you.</p><div class="form-grid"><label>How many?<input id="spawn-count" type="number" min="1" max="${Math.max(1, preferences.maxPals - game.pals.length)}" step="1" value="1" required></label><label>Behaviour<select id="spawn-behavior">${options(
        [
          ["roam", "Roam naturally"],
          ["follow", "Follow me"],
          ["stay", "Stay in place"],
        ],
        "roam",
      )}</select></label></div><label><span class="range-value">Size <output id="spawn-size-value">1.0×</output></span><input id="spawn-size" type="range" min="0.5" max="2.5" step="0.1" value="1"></label><label class="toggle-row"><span><strong>Retaliates when attacked</strong><small>Also turn on World → Allow retaliation.</small></span><input class="switch" id="spawn-retaliation" type="checkbox" ${m.behavior.retaliateWhenAttacked ? "checked" : ""}></label><div class="callout">${icon("attack")}<p>Combat animation: <strong>${esc(m.animations.attack)}</strong>. One attack type for this pal.</p></div><div class="dialog-actions"><button type="button" id="spawn-cancel" class="button secondary">Cancel</button><button type="submit" class="button primary">Add to world ${icon("plus")}</button></div></form>`,
      { eyebrow: "QUANTITY · SIZE · BEHAVIOUR" },
    );
  $("spawn-size").oninput = () => {
    $("spawn-size-value").textContent =
      Number($("spawn-size").value).toFixed(1) + "×";
  };
  $("spawn-cancel").onclick = () => closeDialogs();
  $("spawn-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const count = Number($("spawn-count").value),
        opts = {
          behavior: $("spawn-behavior").value,
          scale: Number($("spawn-size").value),
          retaliate: $("spawn-retaliation").checked,
        };
      await busy("Making room for your pals", () =>
        game.spawn(id, count, opts),
      );
      await saveWorld();
      closeDialogs();
      toast(
        `${count} ${m.name}${count > 1 ? " pals" : ""} added to your world.`,
      );
    } catch (error) {
      formError(body, error);
    }
  };
}
function inspectPal(p) {
  if (!p) return;
  pauseForMenu();
  game.selected = p;
  const d = p.data,
    m = p.manifest;
  showDialog(
    "sheet",
    d.name,
    `<div class="chip-row"><span class="tag">${esc(p.state)}</span><span class="tag">${p.clips.length} animations</span><span class="tag">${Math.round(d.health)} / ${m.combat.maxHealth} HP</span></div><button id="pal-animation-lab" class="button primary full">${icon("lab")} Open animation lab</button><div class="form-stack" style="margin-top:24px"><label>Instance name<input id="pal-name" type="text" maxlength="64" value="${esc(d.name)}"></label><label>Behaviour<select id="pal-behavior">${options(
      [
        ["roam", "Roam naturally"],
        ["follow", "Follow me"],
        ["stay", "Stay in place"],
      ],
      d.behavior,
    )}</select></label><label><span class="range-value">Size <output id="pal-scale-value">${d.scale.toFixed(1)}×</output></span><input id="pal-scale" type="range" min="0.5" max="2.5" step="0.1" value="${d.scale}"></label><label><span class="range-value">Movement speed <output id="pal-speed-value">${d.speed.toFixed(1)}×</output></span><input id="pal-speed" type="range" min="0.5" max="2.5" step="0.1" value="${d.speed}"></label><label><span class="range-value">Roaming radius <output id="pal-radius-value">${d.radius} m</output></span><input id="pal-radius" type="range" min="2" max="30" step="1" value="${d.radius}"></label></div><label class="toggle-row"><span><strong>Retaliates when attacked</strong><small>${game.world.environment.retaliation ? "World retaliation is enabled." : "World retaliation is currently off."}</small></span><input class="switch" id="pal-retaliate" type="checkbox" ${d.retaliate ? "checked" : ""}></label><div class="small-heading">Combat · one attack</div><p class="help-copy">${esc(m.animations.attack)} · ${m.combat.damage} damage · ${m.combat.cooldown}s cooldown</p><div class="button-row" style="margin-top:20px"><button id="pal-revive" class="button secondary">${icon("heart")} Revive</button><button id="pal-recall" class="button secondary">${icon("home")} Recall home</button></div><button id="pal-set-home" class="button quiet full" style="margin-top:10px">${icon("home")} Make this spot their home</button><button id="pal-remove" class="button danger full" style="margin-top:20px">${icon("trash")} Remove from world</button>`,
    { eyebrow: "CREATURE SETTINGS · THIS INSTANCE" },
  );
  $("pal-animation-lab").onclick = () => enterLab(p);
  $("pal-name").onchange = () => {
    const name = $("pal-name").value.trim();
    if (name) {
      d.name = name;
      $("sheet-title").textContent = name;
      persistSoon();
    } else $("pal-name").value = d.name;
  };
  $("pal-behavior").onchange = () => {
    d.behavior = $("pal-behavior").value;
    p.path = [];
    p.goal = null;
    p.timer = 0;
    persistSoon();
  };
  for (const [key, min, max] of [
    ["scale", 0.5, 2.5],
    ["speed", 0.5, 2.5],
    ["radius", 2, 30],
  ])
    $("pal-" + key).oninput = () => {
      let v = clamp(Number($("pal-" + key).value), min, max);
      if (key === "scale") {
        const pos = game.environment.nav.nearest(
          p.position,
          m.physics.radius * m.scale * v,
        );
        if (!pos) return;
        p.data.position = pos;
      }
      d[key] = v;
      $("pal-" + key + "-value").textContent =
        key === "radius" ? v + " m" : v.toFixed(1) + "×";
      persistSoon();
    };
  $("pal-retaliate").onchange = () => {
    d.retaliate = $("pal-retaliate").checked;
    if (!d.retaliate) p.aggro = false;
    persistSoon();
  };
  $("pal-revive").onclick = () => {
    game.revive(p);
    toast(d.name + " is ready again.");
    inspectPal(p);
  };
  $("pal-recall").onclick = () => {
    game.recall(p);
    toast(d.name + " returned home.");
    closeDialogs();
  };
  $("pal-set-home").onclick = () => {
    d.home = d.position.slice();
    p.goal = null;
    persistSoon();
    toast("Home point set here.");
  };
  $("pal-remove").onclick = () =>
    confirmAction(
      "Remove " + d.name + "?",
      "This removes this one instance from the world. Its model remains in your library.",
      "Remove pal",
      async () => {
        game.remove(p);
        await saveWorld();
        toast("Pal removed from this world.");
      },
    );
}
function worldSettings() {
  pauseForMenu();
  const e = game.world.environment;
  showDialog(
    "sheet",
    "Make it your kind of day",
    `<div class="form-stack"><label><span class="range-value">Time of day <output id="day-value">${Math.floor(e.time).toString().padStart(2, "0")}:${Math.floor(
      (e.time % 1) * 60,
    )
      .toString()
      .padStart(
        2,
        "0",
      )}</output></span><input id="day-time" type="range" min="0" max="23.95" step="0.05" value="${e.time}"></label></div><label class="toggle-row"><span><strong>Let the day drift by</strong><small>A gentle day / night cycle while you play.</small></span><input class="switch" id="day-cycle" type="checkbox" ${e.cycle ? "checked" : ""}></label><label class="toggle-row"><span><strong>Allow retaliation</strong><small>Only pals with retaliation enabled will fight back when attacked. They never attack first.</small></span><input class="switch" id="world-retaliation" type="checkbox" ${e.retaliation ? "checked" : ""}></label><div class="callout" style="margin:22px 0">${icon("shield")}<p>Turning this off immediately stops hostile behaviour. Attacks can still reduce health so you can test hit reactions.</p></div><div class="menu-list">${menuItem("world-home-here", "Set my home here", "Use your current spot as the return-home point", "home")}${menuItem("world-revive-all", "Revive every pal", "Restore creature health and clear aggression", "heart")}${menuItem("world-save-now", "Save now", "Keep the latest world changes", "save")}${menuItem("world-performance", "App settings", "Controls, UI motion and mobile quality", "settings")}</div>`,
    { eyebrow: "WORLD SETTINGS" },
  );
  $("day-time").oninput = () => {
    e.time = Number($("day-time").value);
    $("day-value").textContent =
      Math.floor(e.time).toString().padStart(2, "0") +
      ":" +
      Math.floor((e.time % 1) * 60)
        .toString()
        .padStart(2, "0");
    persistSoon();
  };
  $("day-cycle").onchange = () => {
    e.cycle = $("day-cycle").checked;
    persistSoon();
  };
  $("world-retaliation").onchange = () => {
    e.retaliation = $("world-retaliation").checked;
    if (!e.retaliation)
      for (const p of game.pals) {
        p.aggro = false;
        if (p.state === "attack") {
          p.state = "idle";
          p.clip("idle");
        }
      }
    persistSoon();
  };
  $("world-home-here").onclick = () => {
    game.world.home = game.player.position.slice();
    persistSoon();
    toast("Your home point is now here.");
  };
  $("world-revive-all").onclick = () => {
    game.pals.forEach((p) => game.revive(p));
    persistSoon();
    toast("All pals revived.");
  };
  $("world-save-now").onclick = attempt(async () => {
    await saveWorld();
    toast("World saved.");
  });
  $("world-performance").onclick = () => settingsDialog();
}
function settingsDialog() {
  pauseForMenu();
  showDialog(
    "sheet",
    "Find your flow",
    `<div class="form-stack"><label>Rendering quality<select id="pref-quality">${options(
      [
        ["economy", "Economy · 30 fps target"],
        ["balanced", "Balanced · 45 fps target"],
        ["clear", "Clear · 60 fps target"],
      ],
      preferences.quality,
    )}</select><small>Quality controls render resolution and the frame-rate cap. Actual performance depends on your phone and models.</small></label><label>Maximum pals per world<select id="pref-limit">${options(
      [
        [6, "6 · lightest"],
        [12, "12 · recommended"],
        [18, "18 · more demanding"],
        [24, "24 · high-end devices"],
      ],
      preferences.maxPals,
    )}</select><small>Existing pals are never deleted when you lower this limit. A separate 650k creature-triangle budget protects performance.</small></label><label><span class="range-value">Look sensitivity <output id="pref-sensitivity-value">${preferences.sensitivity.toFixed(1)}×</output></span><input id="pref-sensitivity" type="range" min="0.4" max="2.5" step="0.1" value="${preferences.sensitivity}"></label></div><label class="toggle-row"><span><strong>Invert vertical look</strong><small>Drag up to look down.</small></span><input class="switch" type="checkbox" id="pref-invert" ${preferences.invertY ? "checked" : ""}></label><label class="toggle-row"><span><strong>Reduce interface motion</strong><small>Shorter page, menu and button transitions. Your device's reduced-motion setting is also respected.</small></span><input class="switch" type="checkbox" id="pref-motion" ${preferences.reduceMotion ? "checked" : ""}></label><label class="toggle-row"><span><strong>Show performance stats</strong><small>Frame rate, triangle count and pal count.</small></span><input class="switch" type="checkbox" id="pref-stats" ${preferences.showStats ? "checked" : ""}></label><div class="callout" style="margin:22px 0">${icon("save")}<p>All projects live on this device. Export backups before clearing app data, switching phones or uninstalling.</p></div><div class="button-row"><button id="pref-backup-guide" class="button secondary">${icon("archive")} Backup help</button><button id="pref-done" class="button primary">Done ${icon("check")}</button></div>`,
    { eyebrow: "CONTROLS · PERFORMANCE · SMOOTH UI" },
  );
  const apply = attempt(async () => {
    preferences = {
      ...preferences,
      quality: $("pref-quality").value,
      maxPals: Number($("pref-limit").value),
      sensitivity: Number($("pref-sensitivity").value),
      invertY: $("pref-invert").checked,
      reduceMotion: $("pref-motion").checked,
      showStats: $("pref-stats").checked,
    };
    $("pref-sensitivity-value").textContent =
      preferences.sensitivity.toFixed(1) + "×";
    applyPreferences();
    await store.put("settings", preferences);
  });
  for (const id of [
    "pref-quality",
    "pref-limit",
    "pref-invert",
    "pref-motion",
    "pref-stats",
  ])
    $(id).onchange = apply;
  $("pref-sensitivity").oninput = apply;
  $("pref-done").onclick = () => closeDialogs();
  $("pref-backup-guide").onclick = () =>
    toast(
      "World menu → Export world backup. Later use Worlds → Restore world to import that ZIP.",
    );
}
function applyPreferences() {
  document.body.dataset.reducedMotion = String(!!preferences.reduceMotion);
  document.body.dataset.quality = preferences.quality;
  game?.configure(preferences);
}
function enterLab(p) {
  if (!p) return;
  $("toast").hidden = true;
  closeDialogs({ immediate: true, resume: false });
  game.enterLab(p);
  document.body.classList.add("labbing");
  $("lab-controls").hidden = false;
  $("game-controls").hidden = true;
  $("crosshair").hidden = true;
  $("target-badge").hidden = true;
  $("look-hint").hidden = true;
  document.querySelector(".game-top").hidden = true;
  $("performance").hidden = true;
  $("lab-pal-name").textContent = p.data.name;
  $("lab-clip").innerHTML = options(
    p.clips.map((c) => [c.name, c.name]),
    game.lab.clip,
  );
  $("lab-loop").checked = true;
  $("lab-speed").value = "1";
  $("lab-rig").checked = false;
  $("lab-wire").checked = false;
  $("lab-rig").disabled = !p.asset.model?.skins.length;
  $("lab-zoom").max = Math.max(12, p.height * 6);
  $("lab-zoom").value = game.lab.distance;
  const mesh = p.asset.model?.meshes.find((m) =>
      m.primitives.some((p) => p.targets.length),
    ),
    count = mesh?.primitives[0].targets.length || 0;
  $("morph-details").hidden = !count;
  $("morph-controls").innerHTML = Array.from(
    { length: count },
    (_, i) =>
      `<label>${esc(mesh.targetNames[i] || "Expression " + (i + 1))}<input type="range" min="0" max="1" value="0" step="0.01" data-morph="${i}" aria-label="${esc(mesh.targetNames[i] || "Expression " + (i + 1))}"></label>`,
  ).join("");
  document.querySelectorAll("[data-morph]").forEach(
    (input) =>
      (input.oninput = () => {
        if (!game.lab.morphWeights)
          game.lab.morphWeights = new Array(count).fill(0);
        game.lab.morphWeights[Number(input.dataset.morph)] = Number(
          input.value,
        );
      }),
  );
  updateLabControls();
}
function exitLab() {
  game?.exitLab();
  document.body.classList.remove("labbing");
  $("lab-controls").hidden = true;
  $("game-controls").hidden = false;
  $("crosshair").hidden = false;
  $("look-hint").hidden = false;
  document.querySelector(".game-top").hidden = false;
}
function setupLab() {
  $("exit-lab").onclick = exitLab;
  $("lab-clip").onchange = () => {
    game.labSelect($("lab-clip").value);
    $("lab-loop").checked = game.lab.loop;
    updateLabControls();
  };
  $("lab-play").onclick = () => {
    const l = game.lab;
    if (!l) return;
    const duration = l.pal.clips.find((c) => c.name === l.clip)?.duration || 1;
    if (l.time >= duration) l.time = 0;
    l.playing = !l.playing;
    updateLabControls();
  };
  $("lab-timeline").oninput = () => {
    const l = game.lab;
    if (!l) return;
    l.playing = false;
    l.time =
      (Number($("lab-timeline").value) / 1000) *
      (l.pal.clips.find((c) => c.name === l.clip)?.duration || 1);
    updateLabControls();
  };
  $("lab-speed").onchange = () =>
    (game.lab.speed = Number($("lab-speed").value));
  $("lab-loop").onchange = () => (game.lab.loop = $("lab-loop").checked);
  $("lab-rig").onchange = () => (game.lab.rig = $("lab-rig").checked);
  $("lab-wire").onchange = () => (game.lab.wire = $("lab-wire").checked);
  $("lab-zoom").oninput = () =>
    (game.lab.distance = Number($("lab-zoom").value));
  $("reset-morphs").onclick = () => {
    if (game.lab) game.lab.morphWeights = null;
    document.querySelectorAll("[data-morph]").forEach((i) => (i.value = 0));
  };
}
function handleBack() {
  if (!$("busy").hidden) return true;
  if ($("modal").open || $("sheet").open) {
    closeDialogs();
    return true;
  }
  if (game?.lab) {
    exitLab();
    return true;
  }
  if (game?.mode === "play") {
    worldMenu();
    return true;
  }
  if (activeRoute !== "worlds") {
    route("worlds");
    return true;
  }
  return false;
}
async function init() {
  hydrate();
  installDialogs();
  setupLab();
  $("app-settings").innerHTML = icon("settings");
  onDialogsClosed(() => {
    if (game?.mode === "play" && !game.lab) game.setPaused(false);
  });
  try {
    preferences = {
      ...preferences,
      ...(await store.get("settings", "preferences")),
    };
  } catch (error) {
    toast(
      "Local storage is unavailable. Saving will not work until storage is enabled.",
    );
    console.error(error);
  }
  try {
    game = new Game($("scene"), {
      notice: toast,
      effect,
      change: persistSoon,
      status: updateStatus,
      inspect: inspectPal,
    });
  } catch (error) {
    $("webgl-error").hidden = false;
    console.error(error);
    $("quick-enter").disabled = true;
  }
  applyPreferences();
  try {
    const current = await store.all("worlds");
    if (!current.length) {
      const w = store.newWorld();
      w.home = [-6, 0, -1];
      await store.put("worlds", w);
    }
    await refreshHub();
  } catch (error) {
    $("world-grid").innerHTML =
      '<div class="callout warning">Local storage is blocked. Enable site storage or use the Android app to create worlds.</div>';
  }
  document
    .querySelectorAll("[data-route]")
    .forEach((b) => (b.onclick = () => route(b.dataset.route)));
  document.querySelector(".brand").onclick = (e) => {
    e.preventDefault();
    route("worlds");
  };
  $("create-world").onclick = createWorldDialog;
  $("quick-enter").onclick = attempt(() =>
    worlds.length ? enterWorld(worlds[0].id) : createWorldDialog(),
  );
  $("import-pal-hero").onclick = () => pickPal(false);
  $("import-pal-library").onclick = () => pickPal(false);
  $("app-settings").onclick = settingsDialog;
  $("show-controls-settings").onclick = settingsDialog;
  $("pal-file").onchange = attempt((e) => handlePal(e.target.files[0]));
  $("landscape-file").onchange = (e) => {
    const f = e.target.files[0];
    if (!f || !worldDraft) return;
    if (f.size > 40 * MB || !/\.(glb|stl)$/i.test(f.name)) {
      toast("Choose a GLB or STL landscape under 40 MB.");
      return;
    }
    worldDraft.file = f;
    $("landscape-name").textContent = f.name + " · " + size(f.size);
    $("landscape-up").value = f.name.toLowerCase().endsWith(".stl") ? "Z" : "Y";
  };
  $("restore-world").onclick = () => {
    $("world-file").value = "";
    $("world-file").click();
  };
  $("world-file").onchange = attempt(async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    await busy(
      "Restoring your world",
      () => store.importWorld(f),
      "Checking the backup and restoring its local assets.",
    );
    await refreshHub();
    toast("World restored. The original project was not overwritten.");
  });
  if (game) {
    game.controls.bindJoystick($("joystick"), $("joystick-knob"));
    $("sprint-lock").onclick = () => {
      game.controls.sprint = !game.controls.sprint;
      $("sprint-lock").setAttribute(
        "aria-pressed",
        String(game.controls.sprint),
      );
    };
    for (const action of ["attack", "pick", "pet", "inspect"])
      $("action-" + action).onclick = () => game.action(action);
    $("world-menu").onclick = worldMenu;
    $("pause-game").onclick = worldMenu;
    $("manage-pals").onclick = attempt(managePals);
    $("world-settings").onclick = worldSettings;
    $("scene").addEventListener(
      "wheel",
      (e) => {
        if (game.lab) {
          e.preventDefault();
          game.lab.distance = clamp(
            game.lab.distance + e.deltaY * 0.003,
            1,
            Math.max(12, game.lab.pal.height * 6),
          );
          $("lab-zoom").value = game.lab.distance;
        }
      },
      { passive: false },
    );
    $("scene").addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      pauseForMenu();
      toast(
        "Graphics paused. Save a backup, then reload the app to restore the 3D view.",
      );
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("modal").open && !$("sheet").open) {
      e.preventDefault();
      handleBack();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && game?.mode === "play") {
      game.controls.reset();
      saveWorld().catch(reportSaveError);
    }
  });
  window.addEventListener("pal-native-pause", () => {
    if (game?.mode === "play") {
      game.controls.reset();
      saveWorld().catch(reportSaveError);
    }
  });
  window.addEventListener("pagehide", () => {
    if (game?.mode === "play") saveWorld().catch(reportSaveError);
  });
  window.addEventListener("native-export-result", (e) =>
    toast(e.detail?.message || "Export finished."),
  );
  setInterval(() => {
    if (game?.mode === "play" && !game.lab) saveWorld().catch(reportSaveError);
  }, 5000);
  setInterval(updateLabControls, 33);
  window.PalHaven = {
    handleBack,
    get ready() {
      return ready;
    },
    get game() {
      return game;
    },
    get settings() {
      return preferences;
    },
    get worlds() {
      return worlds;
    },
    get assets() {
      return assets;
    },
    refresh: refreshHub,
  };
  ready = true;
  route("worlds");
}
init().catch((error) => {
  console.error(error);
  toast("App could not start: " + error.message);
});
