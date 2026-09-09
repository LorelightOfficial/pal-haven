# Pal Haven creature package v1

The app is Stage 1. This versioned data contract makes future Stage 2 outputs importable without app-specific code in each creature ZIP.

## Deliverable structure

```text
<pal-id>.pal.zip
├── pal.json           Required UTF-8 manifest (at archive root)
├── model.glb          Required self-contained skinned and animated GLB
├── README.txt         Recommended: controls, source rights, measured budget
└── qa.json            Recommended: actual validation results and limitations
```

Do not put source textures, reference images, source STL, OBJ, `.blend`, HTML viewers, scripts or alternate LODs in the import ZIP. Keep editable work in a separate source archive if requested. Textures are embedded inside `model.glb`, not duplicated beside it. A single enclosing folder is accepted by the importer, but root-level files are the preferred contract.

## Manifest

See `examples/pal.json` and `schema/pal-v1.schema.json`. The example is metadata only, not a complete importable creature package: there is intentionally no generated model in the app source.

- `format`: exactly `pal-haven/pal`.
- `schemaVersion`: integer `1`.
- `id`: a stable lowercase ASCII slug, 1–64 characters.
- `name`: a human-readable name, 1–64 characters.
- `model`: relative GLB path; use `model.glb`. No external URLs or traversal.
- `units`: `meters`; `upAxis`: `+Y`; `forwardAxis`: `+Z`.
- `scale`: uniform model multiplier. Prefer 1; apply transforms during export.
- `animations`: maps state slots to exact case-sensitive GLB clip names.

### Animation slots

The importer requires `idle`, `walk`, and **exactly one `attack` string**. The recommended Stage 2 quality bar also supplies `run`, `hit`, `faint`, `getUp`, `held`, `pet` and `sleep`, plus anatomy-appropriate useful motions such as `eat`, `happy`, `jump` and `sit`.

Supported slots are `idle`, `walk`, `run`, `attack`, `hit`, `faint`, `getUp`, `held`, `pet`, `sleep`, `eat`, `happy`, `jump`, `sit`. Omit optional slots that truly do not exist; never point to an absent clip. Missing optional motions fall back to Idle (Run falls back to Walk).

All named GLB clips appear in the lab, including clips not mapped to a state. For example, an imported legacy model can contain `Attack` and `Roll Attack`; only the string at `animations.attack` drives combat. New Stage 2 generation should create just **one** attack type, not a set of alternates.

Locomotion must be in-place. The app owns world movement and AI. Animation root tracks may bob, crouch or perform a small contained lunge, but must not translate the creature across the world. Faint should hold a coherent last pose. Idle/walk/run/sleep must loop without a visible snap. Optional `animation.extras.loop` controls the lab's default loop switch; the gameplay state machine independently controls one-shots.

### Physics and behaviour

`physics.radius` is the base cylindrical footprint, `height` is a framing/carrying height, and `groundOffset` is a vertical correction in model units. They are scaled with `manifest.scale × instance.scale`. Prefer a ground-level origin, `groundOffset: 0`, and accurately measured dimensions. These are simple navigation/carrying values, not a full rigid body or ragdoll.

`behavior.canBePickedUp` is a boolean. `retaliateWhenAttacked` sets the initial instance preference; it should default to **false**. World-level retaliation must also be enabled by the user. `walkSpeed` and `runSpeed` are metres per second; `wanderRadius` is metres. Per-instance controls can multiply or override these defaults.

### Combat timing

`maxHealth`, `damage`, `cooldown` (seconds), `range` (metres) and `hitTime` are numeric. `hitTime` is normalized 0–1 through the mapped attack, not a duration in seconds. For a 0.8-second attack with impact at 0.36 seconds, use `0.45`. Gameplay checks range/line of sight at that moment and applies at most one hit per cycle. Set cooldown at least as long as the clip plus a small recovery gap.

### Export profile

glTF 2.0 binary, +Y up, +Z front, metres, applied object scale. Embedded PNG/JPEG textures. At most 48 joints per skin and four normalized influences per vertex. Bake constraints/IK into ordinary transform keyframes; do not export control rigs. Maximum eight morph targets per mesh. Use simple base-colour / normal material inputs. No Draco, Meshopt, KTX2, external files, scripts, proprietary shaders, cloth caches or animation-only external files.

## Size vs detail

Aim for 12k–25k triangles, 16–32 useful joints, 1–4 draw calls and 512–1024 px textures. Aim for a 2–5 MiB complete package, keeping recognisable silhouette and deformation quality. These are targets, not guarantees for arbitrary input. Record actual triangles, joints, image dimensions, GLB bytes and ZIP bytes in `qa.json`; report trade-offs honestly.

## Compatibility

The app validates supported version, safe paths, real clip names, numeric settings, GLB buffer bounds and rig budgets. It does not infer anatomy from STL, generate missing animations, or guarantee good deformation merely because a ZIP parses. Stage 2 must render and inspect the actual exported model and every clip before calling a package complete.
