/* Bounded, embedded-only glTF 2.0 / GLB loader and animator.
 * No scripts, external URIs or extensions that fetch resources are executed.
 */
import {
  identity,
  compose,
  multiply,
  transform,
  boundsOf,
  clamp,
  slerp,
  norm,
  lerp,
} from "./math.js";
import { computeNormals } from "./geometry.js";
import { MAX_JOINTS } from "./renderer.js";
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMPONENT = {
  5120: [1, "getInt8"],
  5121: [1, "getUint8"],
  5122: [2, "getInt16"],
  5123: [2, "getUint16"],
  5125: [4, "getUint32"],
  5126: [4, "getFloat32"],
};
const fail = (message) => {
  throw new Error(message);
};
const finiteArray = (a, n, label) => {
  if (!Array.isArray(a) || a.length !== n || a.some((x) => !Number.isFinite(x)))
    fail(`Invalid ${label}.`);
  return a;
};
export function inspectGLB(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 28)
    fail("This is not a GLB file.");
  const d = new DataView(buffer);
  if (d.getUint32(0, true) !== 0x46546c67 || d.getUint32(4, true) !== 2)
    fail("Use a glTF 2.0 binary (.glb) file.");
  if (d.getUint32(8, true) !== buffer.byteLength)
    fail("GLB length does not match its header. The file may be incomplete.");
  let json,
    bin,
    offset = 12,
    chunk = 0;
  while (offset + 8 <= buffer.byteLength) {
    const length = d.getUint32(offset, true),
      type = d.getUint32(offset + 4, true);
    offset += 8;
    if (length % 4 || offset + length > buffer.byteLength)
      fail("Invalid GLB chunk bounds.");
    if (chunk === 0 && type !== 0x4e4f534a)
      fail("The first GLB chunk must be JSON.");
    if (type === 0x4e4f534a) {
      if (json) fail("Duplicate GLB JSON chunk.");
      if (length > 8 * 1024 * 1024) fail("GLB metadata is too large.");
      try {
        json = JSON.parse(
          new TextDecoder().decode(new Uint8Array(buffer, offset, length)),
        );
      } catch {
        fail("Invalid GLB JSON.");
      }
    } else if (type === 0x004e4942) {
      if (bin) fail("Duplicate GLB binary chunk.");
      bin = new DataView(buffer, offset, length);
    }
    offset += length;
    chunk++;
  }
  if (
    offset !== buffer.byteLength ||
    !json ||
    !bin ||
    json.asset?.version !== "2.0"
  )
    fail("Incomplete GLB 2.0 data.");
  if (
    json.buffers?.length !== 1 ||
    json.buffers[0].uri ||
    !Number.isInteger(json.buffers[0].byteLength) ||
    json.buffers[0].byteLength > bin.byteLength
  )
    fail("GLB must embed one binary buffer; external files are not supported.");
  return { json, bin };
}
export async function loadGLB(
  buffer,
  { landscape = false, decodeImages = true, maxTextureSize = 4096 } = {},
) {
  if (buffer.byteLength > (landscape ? 256 : 192) * 1024 * 1024)
    fail(`GLB exceeds the ${landscape ? 256 : 192} MB safety limit.`);
  const { json: g, bin } = inspectGLB(buffer),
    warnings = [];
  for (const ext of g.extensionsRequired || [])
    if (!["KHR_materials_unlit", "KHR_mesh_quantization"].includes(ext))
      fail(
        `Required extension ${ext} is not supported. Export a plain, uncompressed GLB with PNG/JPEG textures.`,
      );
  if (
    (g.nodes?.length || 0) > 16384 ||
    (g.meshes?.length || 0) > 4096 ||
    (g.animations?.length || 0) > 512 ||
    (g.images?.length || 0) > 128
  )
    fail(
      "GLB is beyond the structural ceiling (16k nodes, 4k meshes, 512 clips, 128 images).",
    );
  if (!g.meshes?.length || !g.nodes?.length)
    fail("GLB has no mesh or scene nodes.");
  const views = g.bufferViews || [],
    access = g.accessors || [],
    cache = new Map();
  if (
    access.length > 131072 ||
    access.reduce((n, a) => n + (a.count || 0) * (WIDTH[a.type] || 1), 0) >
      600000000
  )
    fail("GLB accessor budget is too large.");
  function view(index) {
    const v = views[index];
    if (
      !v ||
      v.buffer !== 0 ||
      !Number.isInteger(v.byteLength) ||
      v.byteLength < 0 ||
      !Number.isInteger(v.byteOffset || 0) ||
      (v.byteOffset || 0) < 0 ||
      (v.byteOffset || 0) + v.byteLength > g.buffers[0].byteLength
    )
      fail("Invalid GLB buffer view.");
    return v;
  }
  function read(index) {
    if (cache.has(index)) return cache.get(index);
    const a = access[index],
      n = WIDTH[a?.type],
      ct = COMPONENT[a?.componentType];
    if (
      !a ||
      !n ||
      !ct ||
      !Number.isInteger(a.count) ||
      a.count < 0 ||
      a.count > 2000000
    )
      fail("Invalid or unsupported GLB accessor.");
    const [size, get] = ct,
      arr = new Float32Array(a.count * n);
    const normalize = (v) =>
      !a.normalized
        ? v
        : a.componentType === 5120
          ? Math.max(-1, v / 127)
          : a.componentType === 5121
            ? v / 255
            : a.componentType === 5122
              ? Math.max(-1, v / 32767)
              : a.componentType === 5123
                ? v / 65535
                : a.componentType === 5125
                  ? v / 4294967295
                  : v;
    const readValues = (v, local, count, stride, out, start = 0) => {
      if (
        !Number.isInteger(local) ||
        local < 0 ||
        stride < size * n ||
        !Number.isInteger(stride) ||
        local + (count ? (count - 1) * stride + size * n : 0) > v.byteLength
      )
        fail("GLB accessor runs outside its buffer.");
      for (let i = 0; i < count; i++)
        for (let c = 0; c < n; c++)
          out[start + i * n + c] = normalize(
            bin[get]((v.byteOffset || 0) + local + i * stride + c * size, true),
          );
    };
    if (a.bufferView !== undefined) {
      const v = view(a.bufferView);
      readValues(v, a.byteOffset || 0, a.count, v.byteStride || size * n, arr);
    } else if (a.byteOffset) fail("Accessor offset has no buffer view.");
    if (a.sparse) {
      const s = a.sparse,
        ic = COMPONENT[s.indices?.componentType];
      if (
        !ic ||
        ![5121, 5123, 5125].includes(s.indices.componentType) ||
        !Number.isInteger(s.count) ||
        s.count < 0 ||
        s.count > a.count
      )
        fail("Invalid sparse accessor.");
      const iv = view(s.indices.bufferView),
        vo = view(s.values.bufferView),
        io = s.indices.byteOffset || 0;
      if (io < 0 || io + s.count * ic[0] > iv.byteLength)
        fail("Sparse indices exceed buffer bounds.");
      const vals = new Float32Array(s.count * n);
      readValues(vo, s.values.byteOffset || 0, s.count, n * size, vals);
      let prior = -1;
      for (let j = 0; j < s.count; j++) {
        const k = bin[ic[1]]((iv.byteOffset || 0) + io + j * ic[0], true);
        if (k >= a.count || k <= prior) fail("Invalid sparse index ordering.");
        arr.set(vals.subarray(j * n, (j + 1) * n), k * n);
        prior = k;
      }
    }
    if (arr.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e10))
      fail("GLB contains invalid numeric values.");
    cache.set(index, arr);
    return arr;
  }
  const nodes = g.nodes.map((n, i) => ({
    name: typeof n.name === "string" ? n.name.slice(0, 128) : `Node ${i}`,
    parent: -1,
    children: n.children || [],
    translation: finiteArray(
      n.translation || [0, 0, 0],
      3,
      "node translation",
    ).slice(),
    rotation: norm(finiteArray(n.rotation || [0, 0, 0, 1], 4, "node rotation")),
    scale: finiteArray(n.scale || [1, 1, 1], 3, "node scale").slice(),
    matrix: n.matrix
      ? new Float32Array(finiteArray(n.matrix, 16, "node matrix"))
      : null,
    mesh: n.mesh,
    skin: n.skin,
    weights: n.weights || [],
  }));
  for (let i = 0; i < nodes.length; i++)
    for (const c of nodes[i].children) {
      if (
        !Number.isInteger(c) ||
        !nodes[c] ||
        nodes[c].parent !== -1 ||
        c === i
      )
        fail("Invalid node hierarchy.");
      nodes[c].parent = i;
    }
  const visiting = new Set(),
    visited = new Set(),
    order = [];
  function visit(i) {
    if (visiting.has(i)) fail("Cyclic node hierarchy.");
    if (visited.has(i)) return;
    visiting.add(i);
    if (nodes[i].parent !== -1) visit(nodes[i].parent);
    visiting.delete(i);
    visited.add(i);
    order.push(i);
  }
  nodes.forEach((_, i) => visit(i));
  const scene = g.scenes?.[g.scene ?? 0];
  if (!scene?.nodes?.length) fail("GLB requires a default scene.");
  const active = new Set();
  function activate(i) {
    if (!nodes[i]) fail("Scene references a missing node.");
    if (active.has(i)) return;
    active.add(i);
    nodes[i].children.forEach(activate);
  }
  scene.nodes.forEach(activate);
  const skins = (g.skins || []).map((s) => {
    if (
      !s.joints?.length ||
      s.joints.length > MAX_JOINTS ||
      s.joints.some((j) => !nodes[j]) ||
      new Set(s.joints).size !== s.joints.length
    )
      fail(`Rig must contain 1–${MAX_JOINTS} unique joints per skin.`);
    if (
      s.inverseBindMatrices !== undefined &&
      (access[s.inverseBindMatrices]?.type !== "MAT4" ||
        access[s.inverseBindMatrices]?.componentType !== 5126)
    )
      fail("Inverse bind matrices must be float MAT4 values.");
    const data =
      s.inverseBindMatrices === undefined ? null : read(s.inverseBindMatrices);
    if (data && data.length !== s.joints.length * 16)
      fail("Skin inverse bind count is incorrect.");
    return {
      joints: s.joints,
      binds: s.joints.map((_, i) =>
        data ? data.slice(i * 16, i * 16 + 16) : identity(),
      ),
    };
  });
  const images = [],
    imageSizes = [];
  for (const image of g.images || []) {
    if (
      image.uri ||
      image.bufferView === undefined ||
      !["image/png", "image/jpeg"].includes(image.mimeType)
    )
      fail(
        "Embed PNG/JPEG textures inside the GLB. External textures and KTX2 are not supported.",
      );
    const v = view(image.bufferView);
    if (v.byteLength > 18 * 1024 * 1024) fail("Embedded image is too large.");
    if (!decodeImages) {
      images.push(null);
      continue;
    }
    const blob = new Blob(
      [
        new Uint8Array(
          bin.buffer,
          bin.byteOffset + (v.byteOffset || 0),
          v.byteLength,
        ),
      ],
      { type: image.mimeType },
    );
    let bmp;
    try {
      bmp = await createImageBitmap(blob, {
        premultiplyAlpha: "none",
        imageOrientation: "none",
      });
    } catch {
      fail("Cannot decode an embedded texture.");
    }
    if (bmp.width > 8192 || bmp.height > 8192) {
      bmp.close();
      fail("Textures above 8192 px must be resized before import.");
    }
    imageSizes.push([bmp.width, bmp.height]);
    const f = Math.min(1, maxTextureSize / Math.max(bmp.width, bmp.height));
    if (f < 1) {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * f));
      c.height = Math.max(1, Math.round(bmp.height * f));
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      images.push(c);
    } else images.push(bmp);
  }
  const texture = (i) => {
    if (i === undefined) return null;
    const t = g.textures?.[i];
    if (!t || !Number.isInteger(t.source) || !g.images?.[t.source])
      fail("Invalid texture reference.");
    return images[t.source] || null;
  };
  const materials = (g.materials || []).map((m) => {
    const p = m.pbrMetallicRoughness || {};
    if (p.baseColorTexture?.texCoord && p.baseColorTexture.texCoord !== 0)
      warnings.push("Only UV set 0 is rendered.");
    if (m.occlusionTexture || p.metallicRoughnessTexture)
      warnings.push(
        "ORM maps are preserved in storage, but the lightweight renderer uses scalar roughness.",
      );
    return {
      color: finiteArray(p.baseColorFactor || [1, 1, 1, 1], 4, "base colour"),
      texture: texture(p.baseColorTexture?.index),
      normalTexture: texture(m.normalTexture?.index),
      normalScale: clamp(m.normalTexture?.scale ?? 1, 0, 2),
      roughness: clamp(p.roughnessFactor ?? 1, 0, 1),
      transparent: m.alphaMode === "BLEND",
      alphaCutoff: m.alphaMode === "MASK" ? (m.alphaCutoff ?? 0.5) : 0,
      unlit: !!m.extensions?.KHR_materials_unlit,
    };
  });
  const defaultMaterial = { color: [0.83, 0.87, 0.82, 1], roughness: 0.85 };
  let triangles = 0,
    vertices = 0,
    primitiveCount = 0;
  const meshes = g.meshes.map((m, mi) => {
    if (!Array.isArray(m.primitives) || !m.primitives.length)
      fail("Mesh has no primitives.");
    return {
      name: m.name || `Mesh ${mi}`,
      weights: m.weights || [],
      targetNames: m.extras?.targetNames || [],
      primitives: m.primitives.map((p) => {
        primitiveCount++;
        if (primitiveCount > 4096)
          fail("More than 4096 mesh primitives is too expensive for this app.");
        if ((p.mode ?? 4) !== 4)
          fail(
            "Use triangle meshes. Lines and points are not importable as creatures.",
          );
        if (p.extensions?.KHR_draco_mesh_compression)
          fail("Export GLB without Draco compression.");
        const a = p.attributes || {};
        if (access[a.POSITION]?.type !== "VEC3")
          fail("Position accessor must be VEC3.");
        const position = read(a.POSITION);
        if (!position.length) fail("Empty mesh.");
        vertices += position.length / 3;
        let idx = p.indices === undefined ? null : read(p.indices);
        if (
          idx &&
          (access[p.indices]?.type !== "SCALAR" ||
            ![5121, 5123, 5125].includes(access[p.indices]?.componentType) ||
            idx.some(
              (i) => !Number.isInteger(i) || i < 0 || i >= position.length / 3,
            ))
        )
          fail("Invalid triangle indices.");
        if ((idx ? idx.length : position.length / 3) % 3)
          fail("Incomplete mesh triangles.");
        const indices = idx ? new Uint32Array(idx) : undefined;
        triangles += (idx ? idx.length : position.length / 3) / 3;
        const attr = (key, width) => {
          if (a[key] === undefined) return undefined;
          const v = read(a[key]);
          if (v.length !== (position.length / 3) * width)
            fail(`Invalid ${key} vertex count.`);
          return v;
        };
        const normal = attr("NORMAL", 3) || computeNormals(position, indices),
          uv = attr("TEXCOORD_0", 2),
          joints = attr("JOINTS_0", 4),
          weights = attr("WEIGHTS_0", 4);
        if (Boolean(joints) !== Boolean(weights))
          fail("Skin joints and weights must both be provided.");
        if (
          joints?.some((j) => !Number.isInteger(j) || j < 0 || j >= MAX_JOINTS)
        )
          fail(`Vertex joint index exceeds the ${MAX_JOINTS}-joint limit.`);
        if (weights) {
          for (let i = 0; i < weights.length; i += 4) {
            let sum =
              weights[i] + weights[i + 1] + weights[i + 2] + weights[i + 3];
            if (sum < 0.000001 || weights.slice(i, i + 4).some((w) => w < 0))
              fail("Every skinned vertex needs valid weights.");
            for (let k = 0; k < 4; k++) weights[i + k] /= sum;
          }
        }
        let vertexColor;
        if (a.COLOR_0 !== undefined) {
          const c = read(a.COLOR_0),
            width = WIDTH[access[a.COLOR_0].type];
          if (
            ![3, 4].includes(width) ||
            c.length !== (position.length / 3) * width
          )
            fail("Invalid vertex colours.");
          vertexColor = new Float32Array(position.length);
          for (let i = 0; i < position.length / 3; i++)
            vertexColor.set(c.slice(i * width, i * width + 3), i * 3);
        }
        if ((p.targets?.length || 0) > 64)
          fail("A maximum of 64 morph targets is supported per mesh.");
        const targets = (p.targets || []).map((t) => {
          const out = {};
          for (const k of ["POSITION", "NORMAL"])
            if (t[k] !== undefined) {
              const v = read(t[k]);
              if (v.length !== position.length)
                fail("Invalid morph target size.");
              if (v.some((x) => x !== 0)) out[k.toLowerCase()] = v;
            }
          return out;
        });
        if (p.material !== undefined && !materials[p.material])
          fail("Missing material.");
        return {
          position,
          normal,
          uv,
          joints,
          weights,
          vertexColor,
          indices,
          targets,
          material: materials[p.material] || defaultMaterial,
        };
      }),
    };
  });
  if (
    triangles > (landscape ? 6000000 : 3000000) ||
    vertices > (landscape ? 12000000 : 6000000)
  )
    fail(
      `Mesh exceeds the ${landscape ? "6,000,000 landscape" : "3,000,000 creature"} triangle or vertex ceiling.`,
    );
  for (const n of nodes) {
    if (n.mesh !== undefined && !meshes[n.mesh])
      fail("Node references a missing mesh.");
    if (n.skin !== undefined) {
      if (!skins[n.skin] || n.mesh === undefined) fail("Invalid skinned node.");
      for (const p of meshes[n.mesh].primitives) {
        if (!p.joints) fail("Skinned mesh is missing vertex weights.");
        if (p.joints.some((j) => j >= skins[n.skin].joints.length))
          fail("Vertex refers to a missing joint.");
      }
    }
  }
  const names = new Set(),
    animations = (g.animations || []).map((a, i) => {
      const name = (
        typeof a.name === "string" ? a.name : `Animation ${i + 1}`
      ).slice(0, 128);
      if (names.has(name)) fail("Animation names must be unique.");
      names.add(name);
      let duration = 0;
      const tracks = (a.channels || []).map((c) => {
        const s = a.samplers?.[c.sampler],
          node = c.target?.node,
          path = c.target?.path;
        if (
          !s ||
          !nodes[node] ||
          !["translation", "rotation", "scale", "weights"].includes(path)
        )
          fail("Unsupported animation channel.");
        if (nodes[node].matrix && path !== "weights")
          fail("Animated nodes must use TRS, not a matrix.");
        const times = read(s.input),
          values = read(s.output),
          interpolation = s.interpolation || "LINEAR";
        if (
          !["LINEAR", "STEP", "CUBICSPLINE"].includes(interpolation) ||
          access[s.input]?.type !== "SCALAR" ||
          !times.length ||
          times.some((t, j) => t < 0 || (j && t <= times[j - 1]))
        )
          fail("Invalid keyframe timing or interpolation.");
        const count =
          path === "weights"
            ? meshes[nodes[node].mesh]?.primitives[0].targets.length || 0
            : path === "rotation"
              ? 4
              : 3;
        if (
          !count ||
          values.length !==
            times.length * count * (interpolation === "CUBICSPLINE" ? 3 : 1)
        )
          fail("Invalid animation output dimensions.");
        duration = Math.max(duration, times[times.length - 1]);
        return { node, path, times, values, count, interpolation };
      });
      if (duration <= 0 || duration > 180 || !tracks.length)
        fail("Each animation must have a duration between 0 and 180 seconds.");
      return {
        name,
        duration,
        tracks,
        loop:
          typeof a.extras?.loop === "boolean"
            ? a.extras.loop
            : !/(attack|hit|faint|death|jump|get.?up|wave)/i.test(name),
      };
    });
  if (triangles > 400000 && !landscape)
    warnings.push(
      "Heavy creature (over 400k triangles). It still imports \u2014 spawn fewer copies if the frame rate dips.",
    );
  const model = {
    nodes,
    meshes,
    skins,
    order,
    active,
    animations,
    images,
    warnings: [...new Set(warnings)],
    stats: {
      triangles,
      vertices,
      joints: Math.max(0, ...skins.map((s) => s.joints.length)),
      clips: animations.length,
      primitives: primitiveCount,
      textures: images.length,
      imageSizes,
      bytes: buffer.byteLength,
    },
  };
  const pose = restPose(model),
    world = worldMatrices(model, pose),
    points = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!active.has(i) || n.mesh === undefined) continue;
    for (const p of meshes[n.mesh].primitives)
      for (let v = 0; v < p.position.length; v += 3) {
        let point = p.position.slice(v, v + 3);
        if (n.skin !== undefined) {
          const s = skins[n.skin],
            q = [0, 0, 0];
          for (let w = 0; w < 4; w++) {
            const joint = p.joints[(v / 3) * 4 + w],
              weight = p.weights[(v / 3) * 4 + w];
            if (!weight) continue;
            const pos = transform(
              multiply(world[s.joints[joint]], s.binds[joint]),
              point,
            );
            for (let k = 0; k < 3; k++) q[k] += pos[k] * weight;
          }
          point = q;
        } else point = transform(world[i], point);
        points.push(...point);
      }
  }
  model.bounds = boundsOf(points);
  if (
    !Number.isFinite(model.bounds.min[0]) ||
    model.bounds.max.some((v, i) => v - model.bounds.min[i] > 100000)
  )
    fail("Model bounds are invalid.");
  return model;
}
export function restPose(model) {
  return model.nodes.map((n) => ({
    translation: n.translation.slice(),
    rotation: n.rotation.slice(),
    scale: n.scale.slice(),
    weights: (n.weights.length
      ? n.weights
      : model.meshes[n.mesh]?.weights || []
    ).slice(),
  }));
}
export function worldMatrices(model, pose) {
  const world = [];
  for (const i of model.order) {
    const n = model.nodes[i],
      p = pose[i],
      local = n.matrix || compose(p.translation, p.rotation, p.scale);
    world[i] = n.parent < 0 ? local : multiply(world[n.parent], local);
  }
  return world;
}
export function sampleTrack(t, time) {
  const { times, values, count, interpolation } = t;
  let lo = 0,
    hi = times.length - 1;
  while (lo + 1 < hi) {
    const m = (lo + hi) >> 1;
    if (times[m] <= time) lo = m;
    else hi = m;
  }
  if (time <= times[0]) lo = hi = 0;
  else if (time >= times[times.length - 1]) lo = hi = times.length - 1;
  const dt = times[hi] - times[lo],
    f = dt ? clamp((time - times[lo]) / dt, 0, 1) : 0,
    mult = interpolation === "CUBICSPLINE" ? 3 : 1,
    offset = mult === 3 ? count : 0;
  const a = Array.from(
      values.slice(
        lo * count * mult + offset,
        lo * count * mult + offset + count,
      ),
    ),
    b = Array.from(
      values.slice(
        hi * count * mult + offset,
        hi * count * mult + offset + count,
      ),
    );
  if (interpolation === "STEP" || lo === hi) return a;
  if (interpolation === "CUBICSPLINE") {
    const f2 = f * f,
      f3 = f2 * f,
      out = a.map(
        (v, i) =>
          (2 * f3 - 3 * f2 + 1) * v +
          (f3 - 2 * f2 + f) * dt * values[lo * count * 3 + 2 * count + i] +
          (-2 * f3 + 3 * f2) * b[i] +
          (f3 - f2) * dt * values[hi * count * 3 + i],
      );
    return t.path === "rotation" ? norm(out) : out;
  }
  return t.path === "rotation"
    ? slerp(a, b, f)
    : a.map((v, i) => lerp(v, b[i], f));
}
export function samplePose(model, clipName, time) {
  const pose = restPose(model),
    clip = model.animations.find((c) => c.name === clipName);
  if (clip)
    for (const t of clip.tracks) pose[t.node][t.path] = sampleTrack(t, time);
  return pose;
}
function blendPoses(a, b, f) {
  return b.map((p, i) => ({
    translation: p.translation.map((v, k) => lerp(a[i].translation[k], v, f)),
    rotation: slerp(a[i].rotation, p.rotation, f),
    scale: p.scale.map((v, k) => lerp(a[i].scale[k], v, f)),
    weights: p.weights.map((v, k) => lerp(a[i].weights[k] || 0, v, f)),
  }));
}
export class GLBInstance {
  constructor(model) {
    this.model = model;
    this.clip = "";
    this.time = 0;
    this.loop = true;
    this.pose = restPose(model);
    this.previous = null;
    this.blendTime = 0;
    this.meshCopies = new Map();
    this.skinBuffers = model.skins.map(() => {
      const a = new Float32Array(MAX_JOINTS * 16);
      for (let j = 0; j < MAX_JOINTS; j++) a.set(identity(), j * 16);
      return a;
    });
    this.rigGeometry = {
      position: new Float32Array(Math.max(1, model.nodes.length * 2) * 3),
      dynamic: true,
    };
  }
  play(name, { loop = true, restart = false, fade = 0.18 } = {}) {
    if (name === this.clip && !restart) return;
    this.previous = fade ? this.pose : null;
    this.fade = fade;
    this.blendTime = 0;
    this.clip = name;
    this.time = 0;
    this.loop = loop;
  }
  duration() {
    return (
      this.model.animations.find((c) => c.name === this.clip)?.duration || 1
    );
  }
  update(dt, { seek, morphWeights } = {}) {
    const duration = this.duration();
    this.time = seek === undefined ? this.time + dt : clamp(seek, 0, duration);
    if (seek === undefined && this.loop) this.time %= duration;
    else this.time = Math.min(this.time, duration);
    let pose = samplePose(this.model, this.clip, this.time);
    if (this.previous) {
      this.blendTime += dt;
      const f = clamp(this.blendTime / (this.fade || 0.001), 0, 1);
      pose = blendPoses(this.previous, pose, f * f * (3 - 2 * f));
      if (f === 1) this.previous = null;
    }
    if (morphWeights)
      for (let i = 0; i < pose.length; i++)
        if (this.model.nodes[i].mesh !== undefined)
          pose[i].weights = morphWeights.slice();
    this.pose = pose;
    this.world = worldMatrices(this.model, pose);
    for (let i = 0; i < this.model.skins.length; i++) {
      const skin = this.model.skins[i];
      skin.joints.forEach((j, k) =>
        this.skinBuffers[i].set(multiply(this.world[j], skin.binds[k]), k * 16),
      );
    }
  }
  records(instanceMatrix, { wire = false, rig = false, flash = false } = {}) {
    if (!this.world) this.update(0);
    const out = [];
    for (let i = 0; i < this.model.nodes.length; i++) {
      const n = this.model.nodes[i];
      if (n.mesh === undefined || !this.model.active.has(i)) continue;
      for (const [pIndex, p] of this.model.meshes[
        n.mesh
      ].primitives.entries()) {
        let geometry = p;
        if (p.targets.some((t) => t.position || t.normal)) {
          const key = i + ":" + pIndex;
          geometry = this.meshCopies.get(key);
          if (!geometry) {
            geometry = {
              ...p,
              position: p.position.slice(),
              normal: p.normal.slice(),
              dynamic: true,
              last: [],
            };
            this.meshCopies.set(key, geometry);
          }
          const w = this.pose[i].weights;
          if (
            w.some((v, j) => Math.abs(v - (geometry.last[j] || 0)) > 1e-5) ||
            geometry.last.length !== w.length
          ) {
            geometry.position.set(p.position);
            geometry.normal.set(p.normal);
            for (let j = 0; j < p.targets.length; j++) {
              const weight = w[j] || 0;
              if (!weight) continue;
              for (const k of ["position", "normal"])
                if (p.targets[j][k])
                  for (let v = 0; v < p[k].length; v++)
                    geometry[k][v] += p.targets[j][k][v] * weight;
            }
            geometry.dirty = true;
            geometry.last = w.slice();
          }
        }
        out.push({
          geometry,
          material: p.material,
          model:
            n.skin === undefined
              ? multiply(instanceMatrix, this.world[i])
              : instanceMatrix,
          skin: n.skin === undefined ? null : this.skinBuffers[n.skin],
          wire,
          flash,
        });
      }
    }
    if (rig) {
      const lines = [];
      for (const s of this.model.skins) {
        const set = new Set(s.joints);
        for (const j of s.joints) {
          const par = this.model.nodes[j].parent;
          if (set.has(par))
            lines.push(
              ...this.world[par].slice(12, 15),
              ...this.world[j].slice(12, 15),
            );
        }
      }
      if (lines.length) {
        if (this.rigGeometry.position.length !== lines.length)
          this.rigGeometry = {
            position: new Float32Array(lines),
            dynamic: true,
          };
        else this.rigGeometry.position.set(lines);
        this.rigGeometry.dirty = true;
        out.push({
          geometry: this.rigGeometry,
          material: { color: [0.22, 1, 0.82, 1], unlit: true },
          model: instanceMatrix,
          lines: true,
          overlay: true,
        });
      }
    }
    return out;
  }
  release(renderer) {
    for (const g of this.meshCopies.values()) renderer.releaseGeometry(g);
    renderer.releaseGeometry(this.rigGeometry);
  }
}
