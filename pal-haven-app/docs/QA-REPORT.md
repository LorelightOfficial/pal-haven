# QA report — source release v0.1.0

## What this report does and does not prove

The web application, importers, animation runtime, persistence and package tools were executed in a local sandbox. The Android SDK/Gradle toolchain and an Android phone were not available there. **No APK, JKS signing result or physical-device performance/orientation test is claimed.** The supplied workflow must compile the APK in your GitHub repository, followed by a real device check.

## Executed checks

| Area                                                  | Result                                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| JavaScript syntax, local assets and module references | Passed; `npm run check`                                                                                  |
| Unit regression suite                                 | 30 passed, 0 failed; `npm test`                                                                          |
| GLB parsing                                           | Synthetic fixture plus actual user-supplied GLB parsed successfully                                      |
| Legacy archive import                                 | Complete 40,965,549-byte recovery ZIP accepted; only its 8,305,084-byte GLB stored                       |
| Existing creature                                     | 48,752 triangles, 30,355 vertices, 23 joints, 16 named clips, 3 embedded textures                        |
| Every existing named clip                             | Rendered at a sampled phase; finite bone matrices, zero WebGL errors across all 16                       |
| Single combat mapping                                 | `Attack` selected; `Roll Attack` remains an extra manual lab clip                                        |
| Lab controls                                          | Clip selection, pause/seek, rig, wireframe and facial morph controls exercised                           |
| New-world/spawn flow                                  | Built-in project opened and multiple Training buddy instances added                                      |
| Peaceful combat                                       | Pal HP reduced by player attack, without automatic retaliation                                           |
| Optional retaliation                                  | Damage to player occurred when both switches were enabled                                                |
| Pick/drop                                             | Both actions succeeded in the running world                                                              |
| Sprint lock                                           | Enable and disable checked against live control state                                                    |
| Simultaneous touch input                              | Two touch points moved the player and changed look yaw independently                                     |
| Save/reopen                                           | Three placed pals persisted across a page reload                                                         |
| Basic backup                                          | World exported and restored without overwriting the original                                             |
| Full backup                                           | Imported STL terrain plus an actual GLB pal exported, restored and reopened successfully                 |
| Creature ZIP round trip                               | App-exported `.pal.zip` reimported successfully                                                          |
| Imported landscape                                    | ASCII STL ground created a 50 m project and valid walkable ground                                        |
| UI layout                                             | Rendered and visually checked at 390 px portrait, 844×390 landscape, and larger desktop sizes            |
| UI states                                             | Home, library, field guide, creation dialog, settings, gameplay and isolated lab inspected               |
| UI motion setting                                     | Reduced-motion preference changed the app setting; native browser dialogs/transitions exercised          |
| World-orientation request                             | Browser mock recorded `true` on entry, stayed `true` in the lab, then `false` on exit                    |
| Android resources / workflow structure                | XML, JSON and YAML parsed; ARM64-only split and APK-only tasks inspected                                 |
| Prompt-kit validator                                  | Accepted a synthetic valid fixture and the real app-exported pal ZIP; rejected a multiple-attack mapping |
| Prompt-kit packager                                   | Created and validated a real test ZIP using only whitelisted runtime files                               |

The full model + terrain backup round trip restored one pal with all 16 clips, correct geometry statistics, valid ground and no WebGL error. Test archives and the user's original model are intentionally **not** included in the app-source or prompt-kit ZIPs.

## Visual issues corrected during QA

- Reserved a separate lab rendering viewport so controls no longer cover the creature.
- Made the lab an isolated neutral studio, with readable hint text and framing/zoom controls.
- Corrected the busy overlay's top-layer fullscreen sizing.
- Updated the pal-count HUD immediately after changes.
- Improved meaningful small text / touch targets and shortened the settings eyebrow.
- Fixed stale dialog-close timers and ensured replaced import dialogs release temporary resources.
- Dismissed old toast messages when opening a new dialog.
- Paused hidden home-preview rendering to reduce unnecessary work.

## Parser / logic unit coverage

Matrix transforms/inverses, camera coordinates, quaternion interpolation, skeletal animation, one-shot clamping, STEP/CUBICSPLINE sampling, GLB headers and bounds, external-resource rejection, required compression rejection, cyclic hierarchy rejection, duplicate clips, joint references, single attack mapping, manifest ranges/paths, ZIP traversal/duplicates/encryption/expansion/truncation, STL parsing, wall collision, A* routing, terrain rasterization, retaliation rules and backup field validation.

## Not executed / not guaranteed

- Android Gradle compilation, APK installation, R8 behaviour on device and actual JKS signing.
- Physical orientation changes, Android document-provider interoperability or background lifecycle behaviour on a phone. Only the browser-to-native orientation request path was mocked.
- Measured 30/45/60 fps or memory use on a phone. Those are quality targets, not promises.
- Comprehensive visual quality certification for the old model's every animation; all clips were rendered and structurally sampled, with visual spot checks. This task produced an app, not a remastered character.
- Arbitrary third-party GLBs, unsupported compression/material extensions, every malformed file, caves/multilevel terrain or general rigid-body physics.

See RELEASE-CHECKLIST.md for the remaining real-device checks. This release is a functional personal sandbox / starter application, not a claim of production-engine parity.
