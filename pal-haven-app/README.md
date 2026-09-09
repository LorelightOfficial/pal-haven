# Pal Haven

**Your own little worlds. A home and testing ground for the creatures you create.**

Stage 1 source project · v0.1.0 · ARM64-v8a Android APK · local-first

## Start here

1. Extract the source ZIP and upload the **contents** of `pal-haven-app/` to your repository root. Include the hidden `.github/` and `.gitignore` files.
2. To get a signed release, add the four JKS secrets described in [Android build instructions](docs/ANDROID-BUILD.md). With no secrets, the workflow builds a debug APK instead.
3. Push any commit, or manually run **Actions → Build ARM64 APK**.
4. Download **Pal-Haven-arm64-v8a-APK** from the completed run's Artifacts, extract the artifact ZIP and install the APK.

**APK only.** The workflow does not build an AAB or additional ABI variants. It creates exactly one APK for its chosen debug/release configuration.

> This download is source, not an APK already compiled on your behalf. The web app is tested locally; the Android SDK build, device orientation behaviour and keystore signing must be verified by your first Actions run and an actual phone. See the QA report for the precise checks performed.

## What is implemented

### The app itself

- A designed world-project home, creature library, field guide and settings.
- Smooth route entrances, sliding menus, modal open/close animations, button feedback and loading transitions. Effects use transform/opacity, with reduced-motion support.
- All runtime code and visuals are bundled. No CDN, API key, account, subscription, analytics or model server is required.
- Native Android file picking and ZIP exports through scoped document dialogs.
- **Entering a world forces Android into landscape mode**, including world menus and the lab. The project home restores normal orientation.

### Worlds and movement

- Create separate named projects in a built-in meadow, a flat testing courtyard, or your own static `.glb` / `.stl` landscape.
- Select landscape width and up axis; terrain is centred, scaled and converted into a walkable single-surface grid.
- First-person touch controls: movement joystick, drag to look, sprint lock, attack, pick/drop, pet and inspect. Keyboard controls work in the browser preview.
- Day/night lighting, an optional time cycle, a home point, health recovery and project settings.
- World and player state autosave locally; complete `.world.zip` backups include landscape, used creature assets and placements.

### Pals

- Import `.pal.zip`, animated `.glb`, or a legacy recovery ZIP with exactly one GLB.
- Confirm the creature name, scale and clip mapping. **One attack clip per creature drives combat.** Extra attack-looking clips remain manual lab previews only.
- Choose spawn quantity, individual size, movement speed, roaming radius and roam/follow/stay behaviour.
- Natural idle/wander/rest transitions, obstacle steering, A* navigation and creature separation.
- Retaliation is optional and requires both the world switch and the creature switch. Pals do not initiate aggression unprovoked.
- Hit reactions, fainting, explicit revival, petting, carrying and dropping.
- A small built-in procedural Training buddy makes a fresh installation testable. No new character-model export is included.

### Animation lab

- Every named clip in an imported GLB can be selected, played, paused, scrubbed, looped or played at different speeds.
- Orbit and zoom; rig and wireframe inspection; up to eight supported morph targets / expressions per mesh.
- Independent skeletal animation instances with smooth clip crossfades. The rest of the world pauses while inspecting.

## Your existing Lamball work

Import `Lamball-Rebuilt/Lamball-Animated.glb` from your earlier archive for the smallest transfer. Alternatively select the entire recovery ZIP; the app locates its single GLB and ignores the viewer HTML, scripts, duplicate textures, STL and documentation.

Your GLB has 23 joints, 16 named clips and 48,752 triangles. `Attack` maps to combat; `Roll Attack` remains a lab clip. Its original binary is about 8.3 million bytes; the app stores that GLB, not the entire 40 MB archive. GPU texture downsampling reduces rendering memory, **not the saved GLB's file size**. This model exceeds the recommended 25k-triangle budget, so start with a few copies on mobile.

The supplied GLB and images were compatibility test inputs only and are not bundled in this source ZIP.

## Browser preview / development

Requires Node 20+ and a modern Chromium browser with WebGL 2:

```sh
npm run serve
```

Open `http://127.0.0.1:4173`. No npm dependency install or build step is required; JSZip is already vendored. Serve the files rather than double-clicking `index.html`, because normal browsers restrict ES modules under `file://`.

```sh
npm run check
npm test
```

The Android APK is the offline, installable mobile target. The browser preview is for development; native orientation locking and Android document dialogs are available in the APK, not guaranteed in a browser tab.

## File map

```text
.github/workflows/android-build.yml   Push/manual ARM64 APK, optional release signing
.github/workflows/check-pull-request.yml   Secret-free source/tests check
.gitignore / .gitattributes            Build output and key-file safeguards
android/                              Java Android shell + Gradle configuration
web/                                  Complete offline app, renderer and UI
web/vendor/                           JSZip and license
web/src/                              Runtime, import, storage, controls and simulation
schema/pal-v1.schema.json              Creature manifest schema
examples/pal.json                      Metadata example, not a character package
tests/                                Parser, navigation, combat and data checks
tools/                                Local server and source validator
docs/                                 Android setup, format, architecture and QA
```

## Scope and device requirements

This is a functional **v0.1 personal testing sandbox**, not a finished production open-world engine. Android 8+ (API 26), an ARM64 phone, OpenGL ES 3 and a recent Android System WebView (110+ recommended) are required. Actual frame rate depends on the device and asset complexity; 30/45/60 fps are selectable targets, not guarantees.

- No auto-rigging or animation generation from STL happens in this app. That is the separate Stage 2 workflow.
- Navigation supports one outdoor ground surface, not stacked floors, caves, moving platforms or general rigid-body physics.
- No multiplayer, flying/swimming controller, ragdoll, cloth, procedural IK, projectile authoring or automatic APK updates.
- The renderer supports base colour, normals, simple roughness, lighting, fog and contact shadows. It is not a full PBR renderer: ORM textures, emissive effects and advanced shader extensions are not reproduced faithfully.
- No Draco, Meshopt, KTX2, external texture files or external resource URLs; export a plain self-contained GLB.
- Import limits and recommended budgets are in [Supported formats](docs/SUPPORTED-FORMATS.md).
- Clearing app data/uninstalling deletes local projects. **Export backups first.** Debug and release builds use different application IDs and have separate storage.

## Stage 2

The separately delivered prompt-kit ZIP contains the reusable generation prompt, a creature-details template, exact package structure, JSON schema and a Python validator. The app's [Pal package v1 contract](docs/PAL-PACKAGE-V1.md) is the source of truth for that kit.

## License and attribution

See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). Rights in imported models and characters remain with their respective owners. This project is independent of Pocketpair / Palworld.
