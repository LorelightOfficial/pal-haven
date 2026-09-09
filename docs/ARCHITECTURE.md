# Architecture

## A small offline application, not a remote website

`web/` is a zero-build-step ES-module application. JSZip is the only bundled third-party runtime library. There are no CDN scripts, online fonts, API keys, analytics, accounts or cloud model requests.

`android/` is a Java Android shell. It intercepts the app's trusted HTTPS asset origin and serves bundled files from `web/`. The release manifest requests no network or broad storage permissions. Android System WebView provides the device-native WebGL implementation.

## Main components

- `app.js`, `ui.js`, `styles.css`: routes, dialogs, saved-project UI and smooth transform/opacity motion. The system reduced-motion preference and an app setting reduce interface transitions.
- `game.js`: fixed-step simulation, first-person camera, entity state machine, optional retaliation, one-hit-per-attack timing, carrying, lab mode and snapshots.
- `input.js`: independent pointer IDs for joystick and look; key reset on blur/cancel; keyboard alternatives.
- `glb.js`: bounded GLB parsing, interleaved/sparse accessors, skeletons, clip sampling, crossfades and per-instance morphs.
- `renderer.js`: WebGL2 GPU skinning (48 joints), base/normal maps, vertex colour, simple lighting, fog, wireframe and contact shadows.
- `environment.js`, `geometry.js`, `navigation.js`: procedural starter terrain, static GLB/STL import, ground-grid rasterization, A*, obstacle steering and local creature separation.
- `packages.js`: manifest validation, ZIP central-directory preflight and legacy archive compatibility.
- `storage.js`: IndexedDB, asset deduplication by internal reference, autosave, package exports and full world backups.
- `MainActivity.java`: trusted-origin asset routing, Android document picker, chunked ZIP export, app background notification, immersive mode and landscape-only world sessions.

## Creature states

Idle / walk / run / follow / held / hit / attack / faint / get-up / pet. There is no sleep state. Behaviour comes from a weighted roller (`rollAction`): walking is the normal action, with occasional trotting, looking around, grazing, resting, cheering, hopping and stretching, and only the clips a pal actually ships with are eligible. New pals are placed at a random walkable point anywhere on the map, clear of the player and of each other. Every pal retaliates from the very first hit unless its own switch is turned off, and pals never initiate aggression on their own. A normalized `combat.hitTime` delivers at most one hit during the single mapped attack. A fainted pal stays as nudgeable remains for about 15 seconds, drifting when the player or another pal pushes past it, then sinks and leaves the world; revive it before that to keep it.

Menus pause simulation. The animation lab pauses all world AI and scrubs only the chosen pal. UI transitions do not change save timing or creature state. Android landscape locking remains active for in-world menus and the lab.

## Persistence

IndexedDB stores `worlds`, `assets`, `landscapes` and `settings`. An imported GLB is stored once; instances keep references and small settings snapshots. Autosave is every five seconds and on important changes, save/exit, and background events. Abrupt OS termination can still lose the most recent unsaved interval. No server backup exists: export `.world.zip` regularly.

World restoration validates data before a single multi-store transaction. Restored projects and assets get fresh internal UUIDs rather than overwriting existing data. Imported package JSON is not evaluated as code. Third-party HTML/JS in recovery ZIPs is ignored.

## Deliberate scope

This is a v0.1 personal test sandbox, not a production open-world engine. Ground navigation is single-surface, not general rigid-body physics or a multilayer navmesh. There is no networking, VR, multiplayer, procedural auto-rigging, ragdoll, cloth, swimming, flying controller, projectile editor or photorealistic PBR pipeline. Add those as explicit future systems rather than pretending the current lightweight renderer supports them.
