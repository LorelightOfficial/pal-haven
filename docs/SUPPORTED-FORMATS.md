# Supported formats and budgets

## Creature input

- `.pal.zip`: ZIP containing `pal.json` and one embedded GLB referenced by it.
- `.glb`: import directly and confirm mappings in the app.
- Recovery ZIP: must contain exactly one GLB if no `pal.json` is present. Old HTML/JS viewers and unrelated files are ignored.
- STL / OBJ alone are not creatures: they do not carry an exportable skeleton and clips. Use Stage 2 first.

## Supported GLB subset

- glTF 2.0 binary, one embedded BIN buffer, triangle meshes, multiple primitives/materials.
- Float and supported normalized integer accessors; byte strides and sparse accessors.
- Node TRS hierarchies and static matrices; animated transform nodes must use TRS.
- GPU skinning: at most 48 joints per skin; four influences per vertex; inverse-bind matrices.
- Animation channels: translation, rotation, scale, morph weights. LINEAR, STEP and CUBICSPLINE sampling. Unique clip names, 0–180 second duration, at most 64 clips.
- Up to 8 position/normal morph targets per mesh. Targets default to their mesh/node weights; each animated instance is independent.
- Embedded PNG/JPEG base colour and normal maps, UV set 0, vertex RGB colours, opacity/mask, simple scalar roughness, unlit materials.
- Base-colour / normal texture sampling is lightweight; advanced material effects, ORM occlusion/metal/roughness maps and emissive materials are not rendered faithfully. Original data is preserved in the stored binary.

Not supported: external URLs or files, Draco, Meshopt, KTX2, compressed geometry extensions, shader programs, mesh instancing extensions, cloth/simulation caches, procedural materials or automatically inferred animation events.

## Runtime safety limits vs. recommended generation budgets

| Item                     | Import/runtime limit     | Recommended Stage 2 target                    |
| ------------------------ | ------------------------ | --------------------------------------------- |
| Creature GLB             | 192 MiB                     | 2–5 MiB preferred; under 8 MiB if practical   |
| Creature triangles       | 3,000,000                   | 12,000–150,000 stays smooth on phones        |
| Creature vertices        | 6,000,000                   | Under 300,000                                 |
| Skin joints              | 48–128 per skin (GPU tested) | 16–32 for simple pals; no unused controls     |
| Vertex influences        | 4                           | 4 normalized weights, no zero-weight vertices |
| Morph targets            | 64 per mesh                 | 0–4 when useful                               |
| Named animation clips    | 512                         | Only useful, polished motions                 |
| Embedded images          | 128; maximum 8192 px edge   | 1–3 maps, 1024–2048 px                        |
| Primitives               | 4,096                       | 1–8 draws preferred                           |
| Scene nodes              | 16,384                      | Keep the hierarchy minimal                    |
| Active pal instances     | Setting: 12/24/36/48        | Start with 6–12 detailed pals                 |
| Total creature triangles | 6,000,000                   | Well below this on weaker phones              |

Imported textures are downsampled in memory to 4096 px on the HD+ and Ultra HD tiers, 2048 px on HD and 1024 px on Performance. This does not recompress or shrink the saved GLB. Render resolution scales with the same setting (1×, 1.5×, 2.25× or 3×) and every tier runs the simulation at a fixed 60 Hz step while drawing at the screen's refresh rate. World geometry is an additional rendering cost; the 6M check covers creatures, not a guarantee of frame rate or GPU memory safety on every phone.

## Landscapes

Static embedded GLB or binary/ASCII STL; at most 256 MiB and 6,000,000 triangles. Select Y-up or Z-up and 20–150 metres width during creation. The app centres, uniformly scales and rasterizes the terrain into a 96×96 ground grid. A single highest surface is used at each X/Z cell. Vertical walls are conservatively blocked; small features below grid resolution can disappear.

Use one outdoor terrain surface with gentle slopes and an open spawn region. Avoid roofs above floors, caves, interior multi-storey scenes, thin bridges, floating platforms, ceilings and narrow passages. This is not a full physics mesh or multilayer navmesh.

## ZIP safety

Creature/recovery ZIP: at most 256 MiB compressed, 768 MiB declared expanded, 4,096 entries, maximum 256 MiB per entry. `pal.json` is at most 256 KiB; the chosen GLB must still fit its 192 MiB limit. Only the chosen model is inflated from a recovery archive.

World backup ZIP: at most 128 MiB compressed and 256 MiB declared expanded, 4,096 entries; the same per-entry and model limits apply. Native exports also have a 128 MiB cap.

Traversal, absolute paths, duplicate entry names, symlinks, encrypted ZIPs, multipart/ZIP64, invalid manifests and external GLB resources are rejected. Stored/Deflate ZIP entries are supported. Imported code is never executed. These checks reduce risk; they are not a general malware scanner.
