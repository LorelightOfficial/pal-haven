/* Pal Haven's offline WebGL2 renderer. No CDN or engine runtime dependency.
 * Adapted in part from the mesh-rendering approach in the supplied Buddy3D viewer.
 * Adaptive GPU skinning (48-128 joints by device), per-instance morphs, base/normal textures, fog, contact shadows.
 * Deliberately not a complete glTF/PBR renderer; see docs/SUPPORTED-FORMATS.md.
 */
import {
  identity,
  multiply,
  normalMatrix,
  perspective,
  lookAt,
  clamp,
} from "./math.js";
// Live binding: raised at construction to whatever the GPU can actually link.
export let MAX_JOINTS = 48;
const vertexSource = (jointCount = MAX_JOINTS) => `#version 300 es
precision highp float;
in vec3 position; in vec3 normal; in vec2 uv; in vec4 joints; in vec4 weights; in vec3 vertexColor;
uniform mat4 model, vp; uniform mat3 normalMat; uniform mat4 bones[${jointCount}]; uniform bool skinned;
out vec3 vNormal,vWorld,vLocal,vColor; out vec2 vUV;
void main(){ vec4 p=vec4(position,1.); vec3 n=normal;
 if(skinned){mat4 s=bones[int(joints.x)]*weights.x+bones[int(joints.y)]*weights.y+bones[int(joints.z)]*weights.z+bones[int(joints.w)]*weights.w;p=s*p;n=mat3(s)*n;}
 vec4 world=model*p;vWorld=world.xyz;vNormal=normalMat*n;vUV=uv;vLocal=position;vColor=vertexColor;gl_Position=vp*world;}`;
const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vNormal,vWorld,vLocal,vColor; in vec2 vUV; out vec4 outColor;
uniform vec4 baseColor; uniform vec3 eye,fogColor,sun; uniform float lightLevel,fogNear,fogFar,roughness,normalScale,alphaCutoff;
uniform sampler2D colorMap,normalMap; uniform bool hasColor,hasNormal,unlit,contact,flash;
void main(){vec4 base=baseColor;if(hasColor)base*=texture(colorMap,vUV);base.rgb*=vColor;
 if(base.a<alphaCutoff)discard;
 if(contact){float d=length(vLocal.xz);base.a*=exp(-3.8*d*d)*(1.-smoothstep(.72,1.,d));if(base.a<.005)discard;}
 vec3 n=normalize(vNormal+vec3(0.,.000001,0.));if(!gl_FrontFacing)n=-n;
 if(hasNormal){vec3 q1=dFdx(vWorld),q2=dFdy(vWorld);vec2 st1=dFdx(vUV),st2=dFdy(vUV);float det=st1.x*st2.y-st1.y*st2.x;
 if(abs(det)>1e-10){vec3 T=(q1*st2.y-q2*st1.y)/det,B=(q2*st1.x-q1*st2.x)/det;T=normalize(T-n*dot(n,T));B=normalize(B-n*dot(n,B));vec3 s=texture(normalMap,vUV).rgb*2.-1.;s.xy*=normalScale;n=normalize(T*s.x+B*s.y+n*s.z);}}
 float key=max(dot(n,normalize(sun)),0.),fill=max(dot(n,normalize(vec3(.7,.5,-.5))),0.);vec3 shade=mix(vec3(.40,.43,.39),vec3(.66,.70,.66),n.y*.5+.5)+vec3(.37,.34,.28)*key+vec3(.10,.14,.17)*fill;
 vec3 viewDir=normalize(eye-vWorld);float spec=pow(max(dot(n,normalize(normalize(sun)+viewDir)),0.),mix(96.,8.,roughness))*(1.-roughness)*.2;
 vec3 c=unlit?base.rgb:base.rgb*shade*lightLevel+vec3(spec)*lightLevel;if(flash)c=mix(c,vec3(1.,.62,.36),.45);
 float fog=smoothstep(fogNear,fogFar,distance(eye,vWorld));outColor=vec4(mix(c,fogColor,fog),base.a);}`;
const DIMS = {
  position: 3,
  normal: 3,
  uv: 2,
  joints: 4,
  weights: 4,
  vertexColor: 3,
};
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      // Keeping the drawing buffer alive forced an extra full-screen copy every frame.
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
      desynchronized: true,
      failIfMajorPerformanceCaveat: false,
    });
    if (!this.gl)
      throw new Error(
        "WebGL 2 is unavailable. Update Android System WebView / Chrome and enable hardware acceleration.",
      );
    const gl = this.gl;
    this.geometries = new Map();
    this.textures = new Map();
    this.pixelRatio = 1;
    this.rect = null;
    this.rectTime = -1e9;
    for (const type of ["resize", "orientationchange"])
      window.addEventListener(type, () => this.measure(true));
    this.stats = { draws: 0, triangles: 0 };
    const compile = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw Error(gl.getShaderInfoLog(s));
      return s;
    };
    // Ask the GPU how many bone matrices it can hold, then link the largest shader it accepts.
    const vectors = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) || 256,
      candidates = [
        ...new Set([
          Math.max(48, Math.min(128, Math.floor((vectors - 40) / 4))),
          96,
          64,
          48,
        ]),
      ].sort((a, b) => b - a);
    let linked = null,
      lastError = "";
    for (const count of candidates) {
      const program = gl.createProgram();
      try {
        const vs = compile(gl.VERTEX_SHADER, vertexSource(count)),
          fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
          throw Error(gl.getProgramInfoLog(program) || "Shader link failed.");
        linked = { program, count };
        break;
      } catch (error) {
        lastError = error?.message || String(error);
        gl.deleteProgram(program);
      }
    }
    if (!linked) throw Error(lastError || "Shader program could not be built.");
    this.program = linked.program;
    MAX_JOINTS = linked.count;
    this.maxJoints = linked.count;
    this.u = {};
    for (const k of [
      "model",
      "vp",
      "normalMat",
      "bones",
      "skinned",
      "baseColor",
      "eye",
      "fogColor",
      "sun",
      "lightLevel",
      "fogNear",
      "fogFar",
      "roughness",
      "normalScale",
      "alphaCutoff",
      "colorMap",
      "normalMap",
      "hasColor",
      "hasNormal",
      "unlit",
      "contact",
      "flash",
    ])
      this.u[k] = gl.getUniformLocation(this.program, k);
    this.a = Object.fromEntries(
      Object.keys(DIMS).map((k) => [k, gl.getAttribLocation(this.program, k)]),
    );
    this.identityBones = new Float32Array(MAX_JOINTS * 16);
    for (let j = 0; j < MAX_JOINTS; j++)
      this.identityBones.set(identity(), j * 16);
    this.white = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.white);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
  /* Cached layout read. getBoundingClientRect() on every frame forced a synchronous
   * reflow and was one of the main stutters on phones. */
  measure(force = false) {
    const now = performance.now();
    if (force || !this.rect || !this.rect.width || now - this.rectTime > 500) {
      const r = this.canvas.getBoundingClientRect();
      this.rect = { width: r.width, height: r.height };
      this.rectTime = now;
    }
    return this.rect;
  }
  resize(ratio = this.pixelRatio) {
    this.pixelRatio = ratio;
    const r = this.measure(),
      w = Math.max(1, Math.round(r.width * ratio)),
      h = Math.max(1, Math.round(r.height * ratio));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }
  uploadTexture(source) {
    if (!source) return this.white;
    if (this.textures.has(source)) return this.textures.get(source);
    const gl = this.gl,
      t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.textures.set(source, t);
    return t;
  }
  bindGeometry(g) {
    const gl = this.gl;
    let cache = this.geometries.get(g);
    if (!cache) {
      cache = { buffers: {} };
      for (const k of Object.keys(DIMS)) {
        if (!g[k]) continue;
        const b = gl.createBuffer();
        cache.buffers[k] = b;
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          g[k],
          g.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW,
        );
      }
      if (g.indices) {
        cache.index = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cache.index);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.indices, gl.STATIC_DRAW);
      }
      this.geometries.set(g, cache);
    }
    for (const [k, size] of Object.entries(DIMS)) {
      const loc = this.a[k];
      if (loc < 0) continue;
      if (cache.buffers[k]) {
        gl.bindBuffer(gl.ARRAY_BUFFER, cache.buffers[k]);
        if (g.dirty && (k === "position" || k === "normal"))
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, g[k]);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(loc);
        if (k === "vertexColor") gl.vertexAttrib3f(loc, 1, 1, 1);
        else if (k === "normal") gl.vertexAttrib3f(loc, 0, 1, 0);
        else if (k === "weights") gl.vertexAttrib4f(loc, 1, 0, 0, 0);
        else if (size === 4) gl.vertexAttrib4f(loc, 0, 0, 0, 0);
        else gl.vertexAttrib2f(loc, 0, 0);
      }
    }
    g.dirty = false;
    return cache;
  }
  render(records, camera, environment = {}) {
    const gl = this.gl,
      { u } = this;
    this.resize();
    const sky = environment.sky || [0.76, 0.84, 0.79];
    gl.clearColor(...sky, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    const area = camera.viewport;
    let aspect = this.canvas.width / this.canvas.height;
    if (area) {
      const ratio = this.pixelRatio;
      gl.viewport(
        Math.round(area.x * ratio),
        Math.round((this.measure().height - area.y - area.height) * ratio),
        Math.max(1, Math.round(area.width * ratio)),
        Math.max(1, Math.round(area.height * ratio)),
      );
      aspect = area.width / area.height;
    }
    const vp = multiply(
      perspective(((camera.fov || 65) * Math.PI) / 180, aspect, 0.06, 260),
      lookAt(camera.eye, camera.target),
    );
    this.vp = vp;
    gl.uniformMatrix4fv(u.vp, false, vp);
    gl.uniform3fv(u.eye, camera.eye);
    gl.uniform3fv(u.fogColor, sky);
    gl.uniform3fv(u.sun, environment.sun || [-0.5, 0.9, 0.5]);
    gl.uniform1f(u.lightLevel, environment.light ?? 1);
    gl.uniform1f(u.fogNear, environment.fogNear ?? 28);
    gl.uniform1f(u.fogFar, environment.fogFar ?? 95);
    gl.uniform1i(u.colorMap, 0);
    gl.uniform1i(u.normalMap, 1);
    const opaque = [],
      transparent = [];
    for (const r of records) {
      if (r.visible === false) continue;
      (r.material?.transparent || r.material?.contact
        ? transparent
        : opaque
      ).push(r);
    }
    transparent.sort((a, b) =>
      Math.hypot(...a.model.slice(12, 15).map((v, i) => v - camera.eye[i])) <
      Math.hypot(...b.model.slice(12, 15).map((v, i) => v - camera.eye[i]))
        ? 1
        : -1,
    );
    this.stats.draws = this.stats.triangles = 0;
    for (const r of [...opaque, ...transparent]) {
      const m = r.material || {},
        g = r.geometry,
        cache = this.bindGeometry(g),
        model = r.model || identity();
      gl.uniformMatrix4fv(u.model, false, model);
      gl.uniformMatrix3fv(u.normalMat, false, normalMatrix(model));
      gl.uniformMatrix4fv(u.bones, false, r.skin || this.identityBones);
      gl.uniform1i(u.skinned, !!r.skin);
      gl.uniform4fv(u.baseColor, m.color || [1, 1, 1, 1]);
      gl.uniform1f(u.roughness, m.roughness ?? 0.88);
      gl.uniform1f(u.normalScale, m.normalScale ?? 0.5);
      gl.uniform1f(u.alphaCutoff, m.alphaCutoff ?? 0);
      gl.uniform1i(u.hasColor, !!m.texture);
      gl.uniform1i(u.hasNormal, !!m.normalTexture);
      gl.uniform1i(u.unlit, !!m.unlit);
      gl.uniform1i(u.contact, !!m.contact);
      gl.uniform1i(u.flash, !!r.flash);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.uploadTexture(m.texture));
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.uploadTexture(m.normalTexture));
      gl.depthMask(!m.transparent && !m.contact && !r.overlay);
      if (r.overlay) gl.disable(gl.DEPTH_TEST);
      else gl.enable(gl.DEPTH_TEST);
      let count = g.indices ? g.indices.length : g.position.length / 3,
        mode = r.lines ? gl.LINES : gl.TRIANGLES;
      if (r.wire && !r.lines) {
        if (!cache.edges) {
          const src = g.indices || Array.from({ length: count }, (_, i) => i),
            edges = [];
          for (let i = 0; i < src.length; i += 3)
            edges.push(
              src[i],
              src[i + 1],
              src[i + 1],
              src[i + 2],
              src[i + 2],
              src[i],
            );
          cache.edges = gl.createBuffer();
          cache.edgeCount = edges.length;
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cache.edges);
          gl.bufferData(
            gl.ELEMENT_ARRAY_BUFFER,
            new Uint32Array(edges),
            gl.STATIC_DRAW,
          );
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cache.edges);
        gl.drawElements(gl.LINES, cache.edgeCount, gl.UNSIGNED_INT, 0);
      } else if (g.indices) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cache.index);
        gl.drawElements(
          mode,
          count,
          g.indices instanceof Uint32Array
            ? gl.UNSIGNED_INT
            : gl.UNSIGNED_SHORT,
          0,
        );
      } else gl.drawArrays(mode, 0, count);
      this.stats.draws++;
      if (!r.lines) this.stats.triangles += count / 3;
    }
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    return this.stats;
  }
  releaseGeometry(g) {
    const gl = this.gl,
      c = this.geometries.get(g);
    if (!c) return;
    for (const b of Object.values(c.buffers)) gl.deleteBuffer(b);
    if (c.index) gl.deleteBuffer(c.index);
    if (c.edges) gl.deleteBuffer(c.edges);
    this.geometries.delete(g);
  }
  clear() {
    for (const g of this.geometries.keys()) this.releaseGeometry(g);
    for (const t of this.textures.values()) this.gl.deleteTexture(t);
    this.textures.clear();
  }
}
