export const $ = (id) => document.getElementById(id);
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  arrowRight: "M4 12h16m-6-6 6 6-6 6",
  arrowUpRight: "M5 19 19 5M6 5h13v13",
  import: "M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4",
  archive: "M3 4h18v4H3zM5 8v12h14V8M9 12h6",
  package: "m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M8 5l9 5",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6",
  settings:
    "m9 3-.6 2.5-2.2 1.3-2.4-.7-2 3.5 1.8 1.8v2.6l-1.8 1.8 2 3.5 2.4-.7 2.2 1.3L9 23h4l.6-2.5 2.2-1.3 2.4.7 2-3.5-1.8-1.8V12l1.8-1.8-2-3.5-2.4.7-2.2-1.3L13 3zM15 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  sliders:
    "M5 3v5m0 4v9M12 3v10m0 4v4M19 3v3m0 4v11M2 8h6v4H2zM9 13h6v4H9zM16 6h6v4h-6z",
  paw: "M7 17c0-3 3-6 5-6s5 3 5 6-3 3-5 2-5 1-5-2ZM4 8a1.5 2 0 1 0 3 0 1.5 2 0 0 0-3 0M9 5a1.5 2 0 1 0 3 0 1.5 2 0 0 0-3 0M14 5a1.5 2 0 1 0 3 0 1.5 2 0 0 0-3 0M18 9a1.5 2 0 1 0 3 0 1.5 2 0 0 0-3 0",
  landscape: "M3 20 9 8l4 7 3-5 5 10zM16 4a2 2 0 1 0 .01 0",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  home: "m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9",
  menu: "M4 6h16M4 12h16M4 18h16",
  pause: "M8 5v14M16 5v14",
  play: "m8 5 11 7-11 7z",
  heart:
    "M20.5 4.5c-2-2-6-1.5-8.5 2-2.5-3.5-6.5-4-8.5-2S1 10 4 13l8 8 8-8c3-3 2.5-6.5.5-8.5Z",
  run: "M14 4a2 2 0 1 0 .01 0M8 9l4-2 4 4 4 1M12 7l-2 7-4 7M10 14l5 1 1 6M8 9l-3 4-3-1",
  attack: "m14 3 7 0 0 7L8 20l-4-4zM3 21l3-3M4 12l8 8M16 3l5 5",
  inspect: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0M10 6v8M6 10h8",
  hand: "M8 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v5-2a1.5 1.5 0 0 1 3 0v6c0 4-2 7-6 7h-2c-3 0-5-3-6-5l-3-4a1.5 1.5 0 0 1 2-2l3 2",
  clock: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 6v6l4 2",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  save: "M4 3h13l4 4v14H3V3zM7 3v6h9V3M7 21v-8h10v8",
  chevron: "m9 5 7 7-7 7",
  check: "m4 12 5 5L20 6",
  back: "m12 4-8 8 8 8M4 12h16",
  refresh: "M20 7V3l-4 4M4 17v4l4-4M20 7a9 9 0 0 0-15-2M4 17a9 9 0 0 0 15 2",
  file: "M14 2H5v20h14V7zM14 2v6h5M8 13h8M8 17h5",
  info: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 11v6M12 7h.01",
  lab: "M9 3h6M10 3v7L4 20h16l-6-10V3M7 15h10",
  folder: "M3 5h6l2 2h10v13H3z",
};
export const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[name] || paths.paw}"/></svg>`;
export function hydrate(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
    el.removeAttribute("data-icon");
  });
}
let toastTimer;
export function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 4200);
}
let busyDepth = 0;
export async function busy(
  title,
  fn,
  subtitle = "Keeping everything on your device.",
) {
  $("busy-title").textContent = title;
  $("busy-subtitle").textContent = subtitle;
  $("busy").hidden = false;
  if (!$("busy").open) $("busy").showModal();
  $("busy").oncancel = (e) => e.preventDefault();
  busyDepth++;
  try {
    await new Promise((r) => setTimeout(r, 45));
    return await fn();
  } finally {
    if (--busyDepth <= 0) {
      $("busy").close();
      $("busy").hidden = true;
      busyDepth = 0;
    }
  }
}
export function formError(root, error) {
  let node = root.querySelector(".form-error");
  if (!node) {
    node = document.createElement("div");
    node.className = "form-error";
    node.setAttribute("role", "alert");
    root.prepend(node);
  }
  node.textContent = error.message || String(error);
  node.scrollIntoView({ block: "nearest" });
}
let dialogEpoch = 0;
let afterClose = null,
  returnFocus = null;
export function onDialogsClosed(callback) {
  afterClose = callback;
}
export function showDialog(which, title, body, { eyebrow = "", onClose } = {}) {
  const dialog = $(which);
  dialogEpoch++;
  $("toast").hidden = true;
  clearTimeout(toastTimer);
  if (dialog.open) {
    dialog._onClose?.();
    dialog._onClose = null;
  }
  for (const d of [$("modal"), $("sheet")])
    if (d !== dialog && d.open) {
      d.classList.remove("closing");
      d.close();
      d._onClose?.();
      d._onClose = null;
    }
  returnFocus = document.activeElement;
  dialog.classList.remove("closing");
  $(which + "-title").textContent = title;
  $(which + "-eyebrow").textContent = eyebrow;
  $(which + "-body").innerHTML = body;
  dialog._onClose = onClose;
  if (!dialog.open) dialog.showModal();
  hydrate(dialog);
  return $(which + "-body");
}
export function closeDialogs({ immediate = false, resume = true } = {}) {
  const open = [$("modal"), $("sheet")].filter((d) => d.open);
  const reduced =
    matchMedia("(prefers-reduced-motion:reduce)").matches ||
    document.body.dataset.reducedMotion === "true";
  const epoch = dialogEpoch;
  const close = () => {
    if (epoch !== dialogEpoch) return;
    for (const d of open) {
      if (!d.open) continue;
      d.classList.remove("closing");
      d.close();
      d._onClose?.();
      d._onClose = null;
    }
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    if (resume) afterClose?.();
  };
  if (!open.length) {
    if (resume) afterClose?.();
    return;
  }
  if (immediate || reduced) close();
  else {
    open.forEach((d) => d.classList.add("closing"));
    setTimeout(close, 180);
  }
}
export function installDialogs() {
  for (const name of ["modal", "sheet"]) {
    const d = $(name);
    $("close-" + name).onclick = () => closeDialogs();
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      closeDialogs();
    });
    d.addEventListener("click", (e) => {
      if (e.target === d) {
        const r = d.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          closeDialogs();
      }
    });
  }
}
export const menuItem = (id, title, subtitle, ico = "arrowRight", extra = "") =>
  `<button id="${id}" class="menu-item ${extra}">${icon(ico)}<span><strong>${esc(title)}</strong><small>${esc(subtitle)}</small></span>${icon("chevron", "chevron")}</button>`;
export const options = (values, current) =>
  values
    .map((v) => {
      const [value, label] = Array.isArray(v) ? v : [v, v];
      return `<option value="${esc(value)}"${String(value) === String(current) ? " selected" : ""}>${esc(label)}</option>`;
    })
    .join("");
