/* Graphics quality presets for the Babylon renderer.
 *
 * Preset keys deliberately match the four values already persisted by
 * storage.js ("economy" | "balanced" | "clear" | "ultra") so existing saved
 * preferences, the existing settings UI and body[data-quality] keep working
 * without migration. LOW/MEDIUM/HIGH map to economy/balanced/clear, with
 * ultra as an opt-in fourth tier that auto-detection never selects.
 */

export const QUALITY_ORDER = ["economy", "balanced", "clear", "ultra"];

const PRESETS = {
  economy: {
    tier: "low",
    pixelRatio: 1,
    textureSize: 1024,
    antialias: false,
    // shadows
    shadows: false,
    shadowMapSize: 512,
    shadowFilter: "none",
    shadowDistance: 26,
    shadowCasterLimit: 6,
    // atmosphere
    sky: "gradient",
    fogHeight: false,
    // water
    water: "simple",
    waterReflections: false,
    waterRefractions: false,
    // post
    toneMapping: false,
    colorGrading: false,
    bloom: false,
    ssao: false,
    // materials
    rimLight: false,
    normalMaps: false,
    maxSimultaneousLights: 2,
  },
  balanced: {
    tier: "medium",
    pixelRatio: 1.5,
    textureSize: 2048,
    antialias: true,
    shadows: true,
    shadowMapSize: 1024,
    shadowFilter: "exponential",
    shadowDistance: 45,
    shadowCasterLimit: 14,
    sky: "procedural",
    fogHeight: false,
    water: "standard",
    waterReflections: true,
    waterRefractions: false,
    toneMapping: true,
    colorGrading: true,
    bloom: false,
    ssao: false,
    rimLight: true,
    normalMaps: true,
    maxSimultaneousLights: 3,
  },
  clear: {
    tier: "high",
    pixelRatio: 2.25,
    textureSize: 4096,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    shadowFilter: "blurExponential",
    shadowDistance: 65,
    shadowCasterLimit: 24,
    sky: "procedural",
    fogHeight: true,
    water: "full",
    waterReflections: true,
    waterRefractions: true,
    toneMapping: true,
    colorGrading: true,
    /* Bloom needs Babylon's offscreen post-process chain, which still fails
     * the canvas read-back the world thumbnails depend on. Tone mapping and
     * colour grading stay on because they run inside the material shaders.
     * Re-enable once REMAINING-WORK.md section 3.1 is closed. */
    bloom: false,
    ssao: false,
    rimLight: true,
    normalMaps: true,
    maxSimultaneousLights: 4,
  },
  ultra: {
    tier: "ultra",
    pixelRatio: 3,
    textureSize: 4096,
    antialias: true,
    shadows: true,
    shadowMapSize: 4096,
    shadowFilter: "pcf",
    shadowDistance: 90,
    shadowCasterLimit: 40,
    sky: "procedural",
    fogHeight: true,
    water: "full",
    waterReflections: true,
    waterRefractions: true,
    toneMapping: true,
    colorGrading: true,
    /* See the clear tier: the offscreen chain is not verified yet. */
    bloom: false,
    ssao: false,
    rimLight: true,
    normalMaps: true,
    maxSimultaneousLights: 4,
  },
};

/** Resolve a persisted quality string into a full graphics preset. */
export const graphicsPreset = (quality) => {
  const key = QUALITY_ORDER.includes(quality) ? quality : "balanced";
  return { quality: key, ...PRESETS[key] };
};

/* Device probing -----------------------------------------------------------
 * Runs against a throwaway WebGL context so it can be called before the
 * Babylon engine exists. Never auto-selects "ultra": that tier is opt-in.
 */
export function detectQuality(gl = null, nav = typeof navigator === "object" ? navigator : {}) {
  const cores = Number(nav.hardwareConcurrency) || 4;
  const memory = Number(nav.deviceMemory) || 4;
  let renderer = "";
  let maxTexture = 4096;

  if (gl) {
    try {
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      renderer = String(
        (dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || "",
      );
      maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
    } catch {
      /* debug renderer info is optional and blocked on some browsers */
    }
  }

  const name = renderer.toLowerCase();
  const software = /swiftshader|llvmpipe|softwarerasterizer|microsoft basic/.test(name);
  const weak =
    /mali-4\d\d|mali-t[0-7]\d\d|powervr sgx|adreno \(tm\) [1-4]\d\d\b|adreno \(tm\) 5[0-2]\d\b/.test(name);
  const strong =
    /adreno \(tm\) (6[5-9]\d|7\d\d|8\d\d)|mali-g7[6-9]|mali-g[89]\d|immortalis|apple gpu|apple m\d/.test(name);

  let score = 0;
  score += cores >= 8 ? 2 : cores >= 6 ? 1 : cores >= 4 ? 0 : -1;
  score += memory >= 8 ? 2 : memory >= 6 ? 1 : memory >= 4 ? 0 : -2;
  score += maxTexture >= 8192 ? 1 : 0;
  if (strong) score += 2;
  if (weak) score -= 3;
  if (software) score -= 4;

  if (score <= 0) return "economy";
  if (score <= 3) return "balanced";
  return "clear";
}

/** Probe device capability without holding on to the context. */
export function autoDetectQuality() {
  if (typeof document !== "object" || !document.createElement) return "balanced";
  let canvas = null;
  let gl = null;
  try {
    canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    return detectQuality(gl);
  } catch {
    return "balanced";
  } finally {
    try {
      const lose = gl && gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    } catch {
      /* nothing to release */
    }
  }
}
