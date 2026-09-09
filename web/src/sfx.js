/* Tiny synthesised interface and world sounds.
 *
 * No audio files ship with the app, so every sound here is generated with the
 * Web Audio API the moment it is needed. The context is created lazily on the
 * first real tap, which keeps mobile autoplay policies happy, and every call
 * is wrapped so a device without Web Audio simply stays silent.
 */
let ctx = null,
  master = null,
  enabled = true;
const VOLUME = 0.2;
function ensure() {
  if (!enabled) return null;
  try {
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
      master = ctx.createGain();
      master.gain.value = VOLUME;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch {
    ctx = null;
    return null;
  }
}
export function setEnabled(value) {
  enabled = value !== false;
  if (master) master.gain.value = enabled ? VOLUME : 0;
}
// Called from the first pointer event so later sounds can play instantly.
export function unlock() {
  ensure();
}
function tone({
  freq = 440,
  to = 0,
  type = "sine",
  delay = 0,
  length = 0.12,
  gain = 0.5,
}) {
  const audio = ensure();
  if (!audio) return;
  const at = audio.currentTime + delay,
    osc = audio.createOscillator(),
    amp = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to && to !== freq)
    osc.frequency.exponentialRampToValueAtTime(to, at + length);
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.02, length / 3));
  amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(amp).connect(master);
  osc.start(at);
  osc.stop(at + length + 0.02);
}
function noise({ length = 0.16, gain = 0.4, cutoff = 900, sweep = 0 }) {
  const audio = ensure();
  if (!audio) return;
  const at = audio.currentTime,
    frames = Math.max(1, Math.floor(audio.sampleRate * length)),
    buffer = audio.createBuffer(1, frames, audio.sampleRate),
    data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++)
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = audio.createBufferSource(),
    filter = audio.createBiquadFilter(),
    amp = audio.createGain();
  src.buffer = buffer;
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(cutoff, at);
  if (sweep) filter.frequency.exponentialRampToValueAtTime(sweep, at + length);
  amp.gain.setValueAtTime(gain, at);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
  src.connect(filter).connect(amp).connect(master);
  src.start(at);
}
/* Each sound is a couple of short blips. Nothing here loops or lingers, so it
 * never competes with whatever music the player already has going. */
export function play(kind) {
  if (!enabled) return;
  try {
    switch (kind) {
      case "tap":
        tone({ freq: 520, to: 660, type: "triangle", length: 0.05, gain: 0.2 });
        break;
      case "confirm":
        tone({ freq: 620, type: "triangle", length: 0.09, gain: 0.3 });
        tone({
          freq: 930,
          delay: 0.07,
          type: "triangle",
          length: 0.12,
          gain: 0.24,
        });
        break;
      case "back":
        tone({
          freq: 420,
          to: 280,
          type: "triangle",
          length: 0.11,
          gain: 0.24,
        });
        break;
      case "enter":
        tone({ freq: 300, to: 600, type: "sawtooth", length: 0.3, gain: 0.16 });
        tone({
          freq: 700,
          delay: 0.16,
          type: "sine",
          length: 0.35,
          gain: 0.16,
        });
        break;
      case "spawn":
        tone({ freq: 480, to: 720, type: "sine", length: 0.18, gain: 0.28 });
        tone({
          freq: 720,
          delay: 0.13,
          to: 1080,
          type: "sine",
          length: 0.22,
          gain: 0.22,
        });
        break;
      case "swing":
        noise({ length: 0.12, gain: 0.16, cutoff: 2400, sweep: 500 });
        break;
      case "hit":
        noise({ length: 0.16, gain: 0.42, cutoff: 1500, sweep: 220 });
        tone({ freq: 190, to: 90, type: "square", length: 0.12, gain: 0.22 });
        break;
      case "faint":
        tone({ freq: 420, to: 120, type: "sawtooth", length: 0.5, gain: 0.24 });
        noise({ length: 0.34, gain: 0.24, cutoff: 900, sweep: 160 });
        break;
      case "hurt":
        tone({ freq: 240, to: 110, type: "square", length: 0.24, gain: 0.26 });
        break;
      case "pet":
        tone({ freq: 660, to: 880, type: "sine", length: 0.14, gain: 0.22 });
        tone({ freq: 990, delay: 0.1, type: "sine", length: 0.16, gain: 0.16 });
        break;
      case "pick":
        tone({ freq: 380, to: 520, type: "triangle", length: 0.1, gain: 0.24 });
        break;
      case "deny":
        tone({ freq: 200, to: 150, type: "square", length: 0.09, gain: 0.18 });
        break;
      default:
        break;
    }
  } catch {
    /* Sound is decoration; never let it break the world. */
  }
}
