import { clamp } from "./math.js";
// Outer-ring sprint lock: push past LOCK_IN to latch a run, ease back inside LOCK_OUT to drop it.
const SPRINT_LOCK_IN = 0.82,
  SPRINT_LOCK_OUT = 0.45;
export class Controls {
  constructor(canvas, { onAction, onLook, onChange }) {
    this.canvas = canvas;
    this.onAction = onAction;
    this.onLook = onLook;
    this.onChange = onChange;
    this.keys = new Set();
    this.axis = [0, 0];
    this.enabled = false;
    this.sprint = false;
    this.autoSprint = true;
    this.sprintLatched = false;
    this.magnitude = 0;
    this.drag = null;
    this.joyPointer = null;
    const editable = (e) =>
      e.target.closest("input,select,textarea,button,[contenteditable]");
    window.addEventListener("keydown", (e) => {
      if (!this.enabled || editable(e)) return;
      if (
        [
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "ShiftLeft",
          "ShiftRight",
          "Space",
          "KeyE",
          "KeyF",
          "KeyQ",
        ].includes(e.code)
      )
        e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "Space") this.onAction("attack");
      if (e.code === "KeyE") this.onAction("pick");
      if (e.code === "KeyF") this.onAction("pet");
      if (e.code === "KeyQ") this.onAction("inspect");
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.reset());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.reset();
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.enabled) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.drag || this.drag.id !== e.pointerId || !this.enabled) return;
      this.onLook(e.clientX - this.drag.x, e.clientY - this.drag.y);
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
      canvas.addEventListener(name, () => (this.drag = null));
  }
  bindJoystick(el, knob) {
    this.joystick = el;
    this.knob = knob;
    const update = (e) => {
      const r = el.getBoundingClientRect(),
        dx = e.clientX - (r.x + r.width / 2),
        dy = e.clientY - (r.y + r.height / 2),
        max = r.width * 0.3,
        d = Math.hypot(dx, dy),
        scale = d > max ? max / d : 1;
      this.axis = [(dx * scale) / max, (-dy * scale) / max];
      knob.style.transform = `translate(${dx * scale}px,${dy * scale}px)`;
      this.magnitude = clamp(d / max, 0, 1);
      if (this.magnitude >= SPRINT_LOCK_IN) this.sprintLatched = true;
      else if (this.magnitude <= SPRINT_LOCK_OUT) this.sprintLatched = false;
      this.paintSprint();
    };
    el.addEventListener("pointerdown", (e) => {
      if (!this.enabled || this.joyPointer !== null) return;
      e.preventDefault();
      this.joyPointer = e.pointerId;
      el.setPointerCapture(e.pointerId);
      update(e);
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId === this.joyPointer && this.enabled) update(e);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      el.addEventListener(type, (e) => {
        if (e.pointerId === this.joyPointer) {
          this.joyPointer = null;
          this.axis = [0, 0];
          this.magnitude = 0;
          this.sprintLatched = false;
          knob.style.transform = "translate(0,0)";
          this.paintSprint();
        }
      });
  }
  paintSprint() {
    if (!this.joystick) return;
    const moving = this.magnitude > 0.08;
    this.joystick.classList.toggle("is-locked", this.sprintLatched);
    this.joystick.classList.toggle(
      "is-running",
      moving && (this.sprintLatched || this.autoSprint),
    );
    this.joystick.style.setProperty("--joy-force", this.magnitude.toFixed(2));
  }
  movement() {
    let x =
        this.axis[0] +
        (this.keys.has("KeyD") ? 1 : 0) -
        (this.keys.has("KeyA") ? 1 : 0),
      z =
        this.axis[1] +
        (this.keys.has("KeyW") ? 1 : 0) -
        (this.keys.has("KeyS") ? 1 : 0);
    const d = Math.hypot(x, z);
    if (d > 1) {
      x /= d;
      z /= d;
    }
    return {
      x,
      z,
      sprint:
        this.autoSprint ||
        this.sprintLatched ||
        this.sprint ||
        this.keys.has("ShiftLeft") ||
        this.keys.has("ShiftRight"),
    };
  }
  tick(dt) {
    if (!this.enabled) return;
    const x =
        (this.keys.has("ArrowRight") ? 1 : 0) -
        (this.keys.has("ArrowLeft") ? 1 : 0),
      y =
        (this.keys.has("ArrowDown") ? 1 : 0) -
        (this.keys.has("ArrowUp") ? 1 : 0);
    if (x || y) this.onLook(x * dt * 270, y * dt * 270);
  }
  reset() {
    this.keys.clear();
    this.axis = [0, 0];
    this.magnitude = 0;
    this.sprintLatched = false;
    this.drag = null;
    this.joyPointer = null;
    if (this.knob) this.knob.style.transform = "translate(0,0)";
    this.paintSprint();
  }
}
