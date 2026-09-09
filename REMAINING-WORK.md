# Pal Haven - Babylon.js renderer migration: status and remaining work

Last updated: 2026-09-09. Babylon.js 9.25.0, vendored offline (no npm, no internet).

This file is the handoff note. Anyone (person or AI) picking the project up can
read this and know exactly what is done, what is verified, what is left, and how
to prove it.

---

## 1. What changed

The game used to draw through `web/src/renderer.js`: a hand-written,
immediate-mode WebGL2 renderer with a single GLSL program and no scene graph.
`game.js` rebuilt a flat array of draw records every frame and called
`renderer.render(records, camera, environment)`.

That contract is unchanged. What sits behind it is now Babylon.js.
`web/src/rendering/BabylonRenderer.js` is a drop-in replacement exposing the
same public surface (`render`, `resize`, `measure`, `clear`, `uploadTexture`,
`bindGeometry`, `releaseGeometry`, `MAX_JOINTS`, `stats`, `vp`), so gameplay,
world generation, controls, creatures, interactions, saves, packages and the UI
were not rewritten. No gameplay feature was removed or simplified.

Migration was done in the staged order that was requested, with a build + test +
headless runtime gate after every stage.

---

## 2. Done and verified

| Stage | Content | Evidence from the automated gate |
|---|---|---|
| 1 | Full project scan, architecture map, renderer/gameplay dependency map | see section 6 |
| 2 | Babylon Engine + Scene + abstraction, A/B parity against the old renderer | `AB-OK`, max view-projection difference `0.00e+0`, silhouette IoU `0.9995`, identical draws/triangles `9 / 686` |
| 3 | GLB/GLTF loading through Babylon's glTF2 loader, textures, materials, scale, orientation, skeletons | `GLB-OK rest=0.989 walk=0.991`, `__root__` scaling `1,1,1`, UV parity in all four quadrants |
| 4 | World migration: terrain, props, creatures, player, adapter layer instead of rewriting gameplay | `ADAPTER-OK`, IoU `1.0000`, `scene meshes peak 6 -> after release 0` |
| 5 | Camera: right-handed scene, UniversalCamera driven from the existing `{eye, target, fov}` record | `camera fov 68 eye 0.00, 1.62, 10.00`, `pal project` matches the HUD projection |
| 6 | Skeletal animation via AnimationGroups, gameplay keeps owning clip time, manual crossfade | `pose delta 6972` on a hand-scrubbed timeline, `instance clips Idle, Walk` |
| 7 | Lighting: directional sun, hemispheric ambient, fill light, IBL from the sky | `ibl true`, `intensity 0.55` |
| 8 | Real shadows via ShadowGenerator, quality scaling, distance limits, caster budget | `shadow pixels 4852 healed 0`, `casters 10 of limit 14`, `creatures casting true`, `oversized caster false` |
| 9 | Atmosphere: procedural SkyMaterial, night dome, dynamic sun, scene fog, height-aware fog lift | `sky pixels 89269`, `day lum 82.5 / night lum 11.7`, `healed 0`, `fog 30.0 -> 105.0` |
| 10 | Water: Babylon WaterMaterial, animated waves, reflection/refraction, off-screen culling of the mirror pass | `water pixels 35201`, `wave delta 1132` vs control `399`, `rtt 256`, `reflected 8` |
| 11a | Tone mapping (ACES) + colour grading, applied in-shader with zero extra passes | `tone+grade pixels 122632  healed 0`, `exposure 1.12`, `contrast 1.04`, `operator 1`, `in-shader true` |

Also verified every run: no resource leaks (`scene meshes peak 24 -> after unload
3 (base 3)`, `containers after unload 0`), the pal viewer isolation still works,
the studio backdrop replaces the sky in the viewer (`labsky=true`), and
`errors none`.

Build gate every time: `npm run check` -> `Source checks passed: 30 JavaScript
files, 87 unique HTML IDs, all local resources present, ARM64 APK-only
workflow.` and `npm test` -> `tests 31 / pass 31 / fail 0`.

---

## 3. What is NOT finished

### 3.1 Stage 11b - bloom and SSAO (the one open rendering item)

Status: implemented in `web/src/rendering/PostProcessingManager.js`, but
**disabled in the quality presets** until the issue below is fixed, so nothing
ships in a broken state.

What works: tone mapping and colour grading (section 2, stage 11a). Those run on
`scene.imageProcessingConfiguration`, i.e. inside the material shaders, so they
cost no extra render pass and no extra bandwidth. That is the mobile-friendly
path and it is fully verified.

What does not work yet: bloom needs Babylon's offscreen post-process chain
(`DefaultRenderingPipeline`), and SSAO needs `SSAO2RenderingPipeline`. Both are
built correctly (`bloom built true  pipeline pal-post`, `ssao built true`), but
with the chain attached the canvas read-back comes out as a flat clear-coloured
frame (`bloom readback coverage 0.00%`) and `ssao pixels 0`. Two causes were
found and fixed already:

1. `scene.autoClear` is left off after a pipeline lifecycle, so frames draw on
   top of stale pixels. Fixed by re-asserting the flags (`_restoreClear`).
2. `imageProcessingConfiguration.applyByPostProcess` is left on after the
   pipeline is disposed, which tells every material to stop converting to gamma
   space. The symptom is a dark ground with an unchanged sky, because
   `SkyMaterial` has no image processing at all. Fixed in the same helper.

Both fixes are in the code and neither regressed anything, but the flat
read-back remains (`bloom readback coverage 0.00%`) and the scene does not
fully return to the baseline after the pipeline is disposed
(`healed 122378` of 210,800 pixels). The ~89,000 sky pixels are exactly the
ones that do match, so whatever is left over affects lit geometry only, not
the sky - which points at material or prepass state rather than at the
clear or the blit.

Remaining suspect for the flat frame, in priority order:

- Ruled out: a per-frame `engine.resize(true)` recreating the chain's render
  targets. `SceneManager.resize()` only touches the canvas and the engine when
  the computed size actually changed (`SceneManager.js:102`).
- Next suspect: the final blit. Compare an on-screen screenshot taken while the
  chain is attached against the canvas read-back of the same frame. If the
  screenshot is correct and only the read-back is flat, this is a capture
  problem (`preserveDrawingBuffer: false` plus the chain) and the thumbnail
  path in `app.js` should bypass the chain instead; if both are flat, the last
  pass is not reaching the default framebuffer.
- The read-back path (`app.js` uses `drawImage(game.canvas)` -> `toDataURL` for
  world thumbnails) runs with `preserveDrawingBuffer: false`. If the flat frame
  is only a read-back artefact and the screen is fine, the thumbnail capture
  needs to happen while the chain is bypassed instead.

To re-enable once fixed: set `bloom: true` for the `clear` tier and
`bloom: true, ssao: true` for the `ultra` tier in
`web/src/rendering/GraphicsSettings.js`, then re-run the runtime gate and check
`post=` in the title plus the `bloom`/`ssao` lines in the log.

### 3.2 Stage 11c - creature rim lighting (graphics-stack item 8)

Not started. The preset key `rimLight` already exists and is on for medium and
above; nothing consumes it yet. Plan: enable a subtle `PBRMaterial.sheen` on the
cloned creature materials in `web/src/rendering/ModelInstance.js`
(`intensity ~0.12`, warm colour, roughness ~0.5). Sheen is a built-in Babylon
PBR feature, so it needs no custom shader, and it gives the Fresnel-style rim
that makes creatures read against the terrain. Must stay subtle - creatures
should not glow. Gate it with a pixel test on the creature silhouette.

### 3.3 Stage 12 - performance, cleanup and delivery

Nothing here is started.

1. **Delete the old renderer.** `web/src/renderer.js` is no longer used for
   drawing, but `web/src/glb.js` still imports `MAX_JOINTS` from it
   (`glb.js:16`). Move that constant, then delete `renderer.js`. Keep `glb.js`
   itself: it is still the validator/inspector for uploaded packages
   (`packages.js:325`, `storage.js:246`) and the landscape import path in
   `environment.js` feeds its records into `NavGrid.rasterize`.
2. **Instancing.** The world draws 42 trees, 28 rocks, 70 flowers and 24 posts
   as separate records. Move them to thin instances, freeze world matrices on
   static meshes, and cut draw calls (currently `demo draws 82`,
   `play draws 17`).
3. **Quality presets end to end.** `GraphicsSettings.autoDetectQuality()` and
   `detectQuality()` exist and the four tiers are defined, but the settings UI
   (`pref-quality`) should drive automatic detection on first run and the
   manual override afterwards. Confirm the device-pixel-ratio caps per tier.
4. **Texture budget.** Wire `preset.textureSize` into the Babylon texture path
   and switch `loadGLB` to `decodeImages: false` now that Babylon decodes.
5. **Back-face culling.** Currently off everywhere, because the old renderer
   never enabled `gl.CULL_FACE` and some procedural/STL geometry relies on
   double-sided faces. Re-enable culling for glTF-loaded meshes only.
6. **Retire the fake contact shadow entirely.** The painted blob is already
   suppressed inside the real shadow map's reach; decide whether to keep it as
   the far-distance grounding cue or remove `SHADOW`/`SHADOW_MAT` from
   `game.js`.
7. **Night sky tuning.** ACES tone mapping darkened the night sky from
   luminance 30.5 to 11.7. Still readable and still passing the gate, but worth
   lifting `NIGHT_ALPHA` or the night exposure in `EnvironmentManager.js`.
8. **Delete the verification harnesses** before release: `web/__probe.*`,
   `web/__ab.*`, `web/__glb.*`, `web/__adapter.*`, `web/__world.*` and
   `web/__fixtures/`. They are dev-only pages, not referenced by `index.html`,
   and they are the reason `npm run check` counts 30 JS files.
9. **Docs.** Update `docs/ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`,
   `docs/SUPPORTED-FORMATS.md`, `docs/QA-REPORT.md`, and remove the obsolete
   "lightweight renderer uses scalar roughness" warning in `glb.js`.
10. **Payload size.** `web/vendor/babylon/` is 8.3 MB because it is the full UMD
    build, which is what lets the project stay build-step-free and offline. If
    APK size matters, tree-shake with a bundler using the `vendor-packages/`
    tarballs (see section 7) and drop the UMD bundle.

### 3.4 Not yet checked on real hardware

Everything above was verified in headless Chromium with a software GL driver
(SwiftShader). Frame-rate behaviour on a real Android device has not been
measured. Do that before shipping: build the APK, run the three quality tiers,
and check the HUD triangle/draw counters and battery behaviour.

---

## 4. Known issues, small

- **Creature isolation residual.** The gate reports `creature pixels A 2438
  B 1836  healed A 0 B 160`. Pal A restores bit-exactly; pal B leaves ~0.08% of
  the frame different. Most likely the half-rate water mirror texture or the
  lazy IBL probe interacting with frame parity. Not gameplay-visible.
- **`connections`-side note for AI agents:** editing `web/src` with a
  string-replace file editor silently lost writes during this migration. Every
  edit here was applied with a script that asserts a unique match, writes, and
  re-reads from disk. Keep doing that, and always grep for a marker from every
  edit afterwards.

---

## 5. How to verify (offline, no internet needed)

```
npm run check      # source + HTML + workflow checks. Expect 30 JS files, 87 IDs
npm test           # unit tests. Expect tests 31 / pass 31 / fail 0
npm start          # serves web/ on http://127.0.0.1:4173
```

The full runtime gate is a headless page that boots the real `Game` class,
loads a rigged GLB fixture, plays the world, isolates each rendering subsystem
by toggling it for a single frame, and diffs pixels:

```
node tools/serve.mjs &
chromium --headless=new --no-sandbox --enable-unsafe-swiftshader \
  --use-gl=angle --use-angle=swiftshader --window-size=1260,420 \
  --virtual-time-budget=180000 --screenshot=world.png --dump-dom \
  http://127.0.0.1:4173/__world.html
```

The page title is the verdict: `WORLD-OK ...` or `WORLD-FAIL ...`, with per
subsystem numbers (`creature=`, `pose=`, `shadow=`, `sky=`, `water=`, `post=`,
`leak=`). The `<div id="out">` holds the detailed log.

---

## 6. Where things live

```
web/src/rendering/
  GraphicsSettings.js      quality tiers (economy / balanced / clear / ultra) + device detection
  SceneManager.js          Engine + Scene creation, WebGL2 check, sizing, pixel ratio
  CameraManager.js         UniversalCamera driven from the gameplay camera record
  LightingManager.js       sun + ambient + fill, ShadowGenerator, caster selection
  GeometryBridge.js        pools Babylon meshes for the immediate-mode draw records
  MaterialFactory.js       PBR / Standard materials, textures, contact-shadow texture
  EnvironmentManager.js    procedural sky, night dome, IBL probe, scene fog
  WaterManager.js          WaterMaterial pond, waves, reflection list, frustum gating
  PostProcessingManager.js tone mapping, colour grading, bloom, SSAO
  ModelLibrary.js          glTF asset containers (load / release)
  ModelInstance.js         per-creature instance, AnimationGroups, manual pose blend
  BabylonRenderer.js       the drop-in renderer that ties it all together

web/src/renderer.js        OLD renderer - no longer draws, still exports MAX_JOINTS (see 3.3.1)
web/vendor/babylon/        Babylon 9.25.0 UMD bundles, loaded by index.html, 8.3 MB
vendor-packages/           the original npm tarballs (see section 7)
web/assets/waterbump.png   256x256 tileable normal map generated for the water
web/__*.html / __*.js      dev-only verification harnesses (delete at stage 12)
```

Old -> new responsibility map:

| Responsibility | Was | Is now |
|---|---|---|
| WebGL2 + shaders | `renderer.js`, one GLSL program | `BabylonRenderer` + `SceneManager` |
| GLB/GLTF loading | bespoke parser in `glb.js` | `ModelLibrary` (Babylon glTF2 loader) |
| Materials | `geometry.js material()`, not PBR | `MaterialFactory` (PBR) |
| Skeletal animation | CPU pose sampling in `glb.js` | `ModelInstance` (AnimationGroups) |
| Camera | `game.js updateCamera()` | `CameraManager` |
| Lights, day/night | `environment.js daylight()` | `LightingManager` |
| Sky | none, just `gl.clearColor` | `EnvironmentManager` (SkyMaterial + night dome + probe IBL) |
| Water | none, a flat tinted disc | `WaterManager` (WaterMaterial) |
| Fog | fragment-shader smoothstep | scene fog, sky-tinted, height-aware |
| Shadows | fake radial-alpha quad | ShadowGenerator |
| Post-processing | none | `PostProcessingManager` |

---

## 7. The Babylon files you sent

`vendor-packages/` holds the three npm tarballs exactly as supplied:

```
babylonjs-9.25.0.tgz            21,129,389 bytes  md5 4a4cee2fb0a1406e1bacc0bed12598b3
babylonjs-loaders-9.25.0.tgz     3,365,562 bytes  md5 27d6b7aa0c103c3b5f3cd257c30ce5ed
babylonjs-materials-9.25.0.tgz   1,050,544 bytes  md5 e21649033d3ba2f752ea79c10807e3e9
```

The runtime does not read those tarballs. Four files were extracted from them
into `web/vendor/babylon/` and are loaded directly by `web/index.html`, in this
order, before `src/app.js`:

```
babylon.js                       8,316,622 bytes  core engine
babylon.glTF2FileLoader.min.js     275,895 bytes  GLB / glTF loading
babylon.skyMaterial.min.js          22,740 bytes  procedural sky
babylon.waterMaterial.min.js        48,370 bytes  water
```

They are plain `<script defer>` tags, so there is no build step, no bundler and
no network access at runtime. The bundles were checked for `eval` and
`new Function` (zero occurrences) so they satisfy the app's Content Security
Policy. The licence is kept at `web/vendor/BABYLONJS-LICENSE.md`.

The tarballs are kept only so the project can later be rebuilt or tree-shaken
with a bundler offline (section 3.3.10). They can be deleted without affecting
the game.
