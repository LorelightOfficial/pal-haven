# Changelog

## 0.3.0 — random arrivals, natural behaviour, gamified interface

- Pals appear at a random walkable spot anywhere on the map again, instead of lining up in front of you. Tapping a pal in the library, or importing one, still summons instantly with no questions asked.
- Pals choose their own behaviour: walking is the normal state, with occasional trotting, looking around, grazing, resting, cheering, hopping and stretching in between. Only clips a pal actually ships with are used, and a pal standing next to you favours calm animations instead of walking away.
- New circular minimap in the top-right corner. Every pal is a live blip, the pal you are aiming at is ringed, angry pals turn red, fainted ones grey, off-map pals pin to the rim and your spawn point shows as a marker. It rotates with your view and can be switched off in settings.
- Event banners announce arrivals and knockouts in the middle of the screen.
- Synthesised sound effects for taps, summons, swings, hits, knockouts, petting and blocked actions. Nothing is downloaded; every sound is generated on the device and can be turned off.
- The pal counter now shows the world limit, and the attack button ring glows when the swing is ready.
- Menus gained arcade polish: corner brackets on the hero panel, press feedback on cards and menu rows, a shine sweep across primary buttons and a glow on the active tab, all of it disabled under reduced motion.

## 0.2.0 — fewer limits, smoother world, game-style HUD

- Import ceilings raised roughly 100×: 3M creature triangles (6M for terrain), 6M vertices, 16,384 nodes, 4,096 meshes, 512 clips, 128 embedded images, 4,096 px textures and 192 MiB models. Heavy models now warn instead of failing.
- Tapping a pal in "Add pals" summons it instantly. The quantity / size / behaviour form is now optional and off by default.
- Pals appear in a tidy grid right in front of you instead of at random points on the map. (Reverted in 0.3.0 — random placement is back.)
- Sleep removed. Roaming pals pick new destinations sooner and occasionally trot.
- Fixed-step 60 fps simulation with rendering on every frame, high-performance WebGL context and no frame-rate cap on any quality tier.
- Quality tiers are now resolution tiers: Performance 1×, HD 1.5×, HD+ 2.25× and Ultra HD 3×, with up to 4,096 px textures and adaptive GPU joint counts.
- Longer reach: attack 6.5 m, pick and pet 5.5 m, targeting up to 34 m.
- Auto-run is on by default, and pushing the joystick into the outer ring latches a sprint until you release it.
- Rebuilt heads-up display: glass chips, a larger joystick with a sprint ring, circular action buttons, a target nameplate with a live health bar and a refined crosshair.
- Retaliation works from the first hit, per pal, with no world-level switch to arm first.
- Fainted pals leave physics-nudgeable remains that drift as you walk past, sink and fade after 15 seconds.
- Damage now shows as floating combat numbers over the pal, with hit markers and miss feedback, replacing the "-20 HP" text box.
- Per-world pal limits raised to 12 / 24 / 36 / 48, with sizes up to 4× and roaming radius up to 60 m.

## 0.1.0 — initial personal-sandbox source release

- Local saved world projects, library and GLB/STL terrain import.
- Animated interface with reduced-motion support.
- Independent rigged pal instances, single mapped attack, optional retaliation, roaming and interaction controls.
- Isolated animation lab with playback/scrubbing, rig, wireframe and morph inspection.
- IndexedDB autosave, creature-package export and full world backups.
- Offline Android WebView shell, native file/export bridge and landscape world sessions.
- GitHub Actions workflow for one ARM64-v8a APK, with optional JKS release signing.
- Separate Stage 2 generation prompt kit and canonical package validator.

Known boundaries and unexecuted native checks are documented in `docs/QA-REPORT.md`.
