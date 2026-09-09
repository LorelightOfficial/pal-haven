export function glbFixture(change = () => {}) {
  const bytes = [],
    g = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ children: [1, 2] }, { name: "Root" }, { mesh: 0, skin: 0 }],
      meshes: [{ primitives: [] }],
      skins: [{ joints: [1] }],
      buffers: [{}],
      bufferViews: [],
      accessors: [],
      animations: [],
    };
  const add = (data, T, type, ct) => {
    while (bytes.length % 4) bytes.push(0);
    const b = new Uint8Array(new T(data).buffer),
      off = bytes.length;
    bytes.push(...b);
    const view =
      g.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: b.length }) -
      1;
    return (
      g.accessors.push({
        bufferView: view,
        componentType: ct,
        count: data.length / { SCALAR: 1, VEC3: 3, VEC4: 4 }[type],
        type,
      }) - 1
    );
  };
  const p = add([-0.25, 0, 0, 0.25, 0, 0, 0, 1, 0], Float32Array, "VEC3", 5126),
    j = add(new Array(12).fill(0), Uint16Array, "VEC4", 5123),
    w = add([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], Float32Array, "VEC4", 5126),
    ix = add([0, 1, 2], Uint16Array, "SCALAR", 5123),
    t = add([0, 1], Float32Array, "SCALAR", 5126),
    v = add([0, 0, 0, 0, 0.1, 0], Float32Array, "VEC3", 5126);
  g.meshes[0].primitives = [
    { attributes: { POSITION: p, JOINTS_0: j, WEIGHTS_0: w }, indices: ix },
  ];
  for (const name of ["Idle", "Walk", "Attack"])
    g.animations.push({
      name,
      samplers: [{ input: t, output: v, interpolation: "LINEAR" }],
      channels: [{ sampler: 0, target: { node: 1, path: "translation" } }],
    });
  g.buffers[0].byteLength = bytes.length;
  change(g);
  const json = new TextEncoder().encode(JSON.stringify(g)),
    jl = (json.length + 3) & ~3,
    bl = (bytes.length + 3) & ~3,
    out = new ArrayBuffer(28 + jl + bl),
    d = new DataView(out),
    a = new Uint8Array(out);
  d.setUint32(0, 0x46546c67, true);
  d.setUint32(4, 2, true);
  d.setUint32(8, a.length, true);
  d.setUint32(12, jl, true);
  d.setUint32(16, 0x4e4f534a, true);
  a.fill(32, 20, 20 + jl);
  a.set(json, 20);
  d.setUint32(20 + jl, bl, true);
  d.setUint32(24 + jl, 0x004e4942, true);
  a.set(bytes, 28 + jl);
  return out;
}
export function storedZip(entries) {
  const chunks = [],
    central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const n = new TextEncoder().encode(name),
      data = new TextEncoder().encode(text),
      local = new Uint8Array(30 + n.length + data.length),
      v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, n.length, true);
    local.set(n, 30);
    local.set(data, 30 + n.length);
    const c = new Uint8Array(46 + n.length),
      d = new DataView(c.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x800, true);
    d.setUint32(20, data.length, true);
    d.setUint32(24, data.length, true);
    d.setUint16(28, n.length, true);
    d.setUint32(42, offset, true);
    c.set(n, 46);
    central.push(c);
    chunks.push(local);
    offset += local.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0),
    end = new Uint8Array(22),
    d = new DataView(end.buffer);
  d.setUint32(0, 0x06054b50, true);
  d.setUint16(8, entries.length, true);
  d.setUint16(10, entries.length, true);
  d.setUint32(12, size, true);
  d.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const c of [...chunks, ...central, end]) {
    out.set(c, at);
    at += c.length;
  }
  return out.buffer;
}
