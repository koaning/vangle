import { untracked } from "../core/signals.js";
import { TangleElement, validName } from "../core/element.js";

const PAINT_CSS = `
  :host {
    display: block;
    width: fit-content;
    max-width: 100%;
    font: 13px ui-sans-serif, system-ui, sans-serif;
    --line: color-mix(in srgb, currentColor 15%, transparent);
  }
  /* As wide as the canvas: the toolbar wraps instead of widening the element. */
  [part="toolbar"] {
    box-sizing: border-box;
    width: 0;
    min-width: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    padding: 4px;
    border: 1px solid var(--line);
    border-bottom: 0;
    border-radius: 8px 8px 0 0;
    background: var(--tangle-surface);
  }
  .group { display: flex; align-items: center; gap: 2px; }
  .group + .group { padding-left: 6px; border-left: 1px solid var(--line); }
  .group[hidden] { display: none; }
  [part~="button"] {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: none;
    color: inherit;
    cursor: pointer;
    opacity: 0.65;
  }
  [part~="button"]:hover:not(:disabled) { opacity: 1; background: color-mix(in srgb, currentColor 10%, transparent); }
  [part~="button"][aria-pressed="true"] {
    opacity: 1;
    color: var(--tangle-accent);
    background: color-mix(in srgb, var(--tangle-accent) 14%, transparent);
  }
  [part~="button"]:disabled { opacity: 0.25; cursor: default; }
  :focus-visible { outline: 2px solid var(--tangle-accent); outline-offset: 1px; }
  svg { width: 18px; height: 18px; }
  [part="color"] { width: 30px; height: 26px; padding: 0; border: 0; background: none; cursor: pointer; }
  [part="color"][hidden], [part="size"][hidden] { display: none; }
  [part="size"] { width: 96px; margin: 0 4px; accent-color: var(--tangle-accent); }
  [part="paper"] { border: 1px solid var(--line); border-radius: 0 0 8px 8px; overflow: hidden; line-height: 0; }
  [part="paper"].is-clear {
    background-image: repeating-conic-gradient(#d0d0d0 0% 25%, #f0f0f0 0% 50%);
    background-size: 16px 16px;
  }
  canvas { display: block; max-width: 100%; height: auto; touch-action: none; cursor: crosshair; }
  canvas:focus-visible { outline-offset: -2px; }
`;
const PAINT_TOOLS = ["brush", "marker", "eraser", "color"];
const PAINT_UNDO = 20;
// The tools with a thickness slider: [min, max, start] in pixels. The brush is always 2px.
const PAINT_SIZES = { marker: [2, 24, 8], eraser: [4, 60, 20] };
const paintIcon = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const PAINT_ICONS = {
  brush: paintIcon('<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>'),
  marker: paintIcon('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'),
  eraser: paintIcon('<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>'),
  undo: paintIcon('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>'),
  clear: paintIcon('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
};
const PAINT_LABELS = { brush: "Brush", marker: "Marker", eraser: "Eraser" };

function loadImage(src) {
  const img = new Image();
  img.crossOrigin = "anonymous"; // so a CORS-enabled image doesn't block the export
  img.src = src;
  return img.decode().then(() => img);
}

// <t-paint name="art" width="480" height="320" tools="brush marker eraser color"></t-paint>
// A canvas to draw on. The drawing is a variable: a PNG data URL, made when a stroke
// ends. Setting the variable (to a data URL or an image URL) loads that picture, and
// the variable then becomes the canvas's PNG.
export class TPaint extends TangleElement {
  /** The canvas with the ink: transparent where nothing is drawn, without the paper. */
  get canvas() {
    return this._canvas;
  }
  /** The drawing as a PNG data URL, as of the last stroke. */
  get value() {
    return this._value;
  }

  connectedCallback() {
    if (!this.shadowRoot) {
      this.build();
      this._started = this.start();
    }
    this._name = this.hasAttribute("name") ? validName(this) : null;
    const token = (this._token = {});
    const begin = () => {
      if (this._token !== token || !this.isConnected) return;
      if (!this._name) {
        if (this._value === undefined) this.export();
        return;
      }
      // A value the canvas didn't make (set from JS, say) is loaded into it.
      this.watch((scope) => {
        const value = scope.get(this._name);
        untracked(() => {
          if (value === undefined) this.export();
          else if (value !== this._value) this.load(value);
        });
      });
    };
    // Without a src image there's nothing to wait for, so the variable is set right away.
    if (this._started) this._started.then(begin);
    else begin();
  }

  disconnectedCallback() {
    this._token = null;
    super.disconnectedCallback();
  }

  build() {
    let tools = (this.getAttribute("tools") ?? "").split(/[\s,]+/).filter(Boolean);
    if (!tools.length) tools = PAINT_TOOLS;
    if (tools.some((t) => !PAINT_TOOLS.includes(t)) || tools.every((t) => t === "color")) {
      console.error(`tangle: <t-paint> tools are ${PAINT_TOOLS.join(", ")}, with at least one to draw with`, this);
      tools = PAINT_TOOLS;
    }
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${PAINT_CSS}</style>
      <div part="toolbar" role="toolbar">
        <span class="group tools"></span>
        <span class="group"></span>
        <span class="group settings"><input part="color" type="color"><input part="size" type="range"></span>
      </div>
      <div part="paper"><canvas part="canvas" tabindex="0" role="img"></canvas></div>`;
    const [toolGroup, actionGroup, settings] = root.querySelectorAll(".group");
    this._settings = settings;
    this._paper = root.querySelector('[part="paper"]');
    this._canvas = root.querySelector("canvas");
    this._ctx = this._canvas.getContext("2d", { willReadFrequently: true });
    this._colorInput = root.querySelector('[part="color"]');
    this._sizeInput = root.querySelector('[part="size"]');
    this._hasColor = tools.includes("color");
    this._sizes = Object.fromEntries(Object.entries(PAINT_SIZES).map(([tool, [, , start]]) => [tool, start]));
    this._undo = [];

    const button = (label, svg) => {
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("part", "button");
      el.setAttribute("aria-label", label);
      el.title = label;
      el.innerHTML = svg;
      return el;
    };
    this._toolButtons = tools
      .filter((tool) => tool !== "color")
      .map((tool) => {
        const el = button(PAINT_LABELS[tool], PAINT_ICONS[tool]);
        el.dataset.tool = tool;
        el.addEventListener("click", () => this.choose(tool));
        return el;
      });
    toolGroup.append(...this._toolButtons);
    this._undoButton = button("Undo", PAINT_ICONS.undo);
    this._undoButton.addEventListener("click", () => this.undo());
    const clear = button("Clear", PAINT_ICONS.clear);
    clear.addEventListener("click", () => this.clear());
    actionGroup.append(this._undoButton, clear);

    // The color picker needs #rrggbb, which is what a canvas gives back for any opaque CSS color.
    this._ctx.fillStyle = this.getAttribute("color") ?? "#000000";
    this._color = this._colorInput.value = this._ctx.fillStyle.startsWith("#") ? this._ctx.fillStyle : "#000000";
    this._colorInput.setAttribute("aria-label", "Color");
    this._colorInput.addEventListener("input", () => (this._color = this._colorInput.value));
    this._sizeInput.addEventListener("input", () => (this._sizes[this._tool] = Number(this._sizeInput.value)));

    const canvas = this._canvas;
    canvas.setAttribute("aria-label", this.getAttribute("label") ?? this.getAttribute("name") ?? "Drawing");
    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      return [
        ((event.clientX - rect.left) * canvas.width) / rect.width,
        ((event.clientY - rect.top) * canvas.height) / rect.height,
      ];
    };
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || this._stroke) return;
      event.preventDefault();
      canvas.focus({ preventScroll: true, focusVisible: false }); // for Ctrl+Z, without a focus ring
      canvas.setPointerCapture(event.pointerId);
      this._loading = null; // the reader's stroke wins over a picture still loading
      this.snapshot();
      const at = point(event);
      this._stroke = { id: event.pointerId, last: at };
      this.paint(at, at);
    });
    canvas.addEventListener("pointermove", (event) => {
      const stroke = this._stroke;
      if (!stroke || event.pointerId !== stroke.id) return;
      const events = event.getCoalescedEvents?.() ?? [];
      for (const e of events.length ? events : [event]) {
        const at = point(e);
        this.paint(stroke.last, at);
        stroke.last = at;
      }
    });
    const end = (event) => {
      if (!this._stroke || event.pointerId !== this._stroke.id) return;
      this._stroke = null;
      this.export();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    this.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        this.undo();
      }
    });

    this._paper.style.backgroundColor = this.getAttribute("background") ?? "white";
    canvas.width = Number(this.getAttribute("width")) || 480;
    canvas.height = Number(this.getAttribute("height")) || 320;
    this.choose(this._toolButtons[0].dataset.tool);
    this.sync();
  }

  /** Sizes the canvas to the src image and draws it, for Clear to go back to. Null without one. */
  start() {
    this._paper.classList.toggle("is-clear", getComputedStyle(this._paper).backgroundColor === "rgba(0, 0, 0, 0)");
    const src = this.getAttribute("src");
    return src ? this.startWith(src) : null;
  }

  async startWith(src) {
    let img;
    try {
      img = await loadImage(src);
    } catch {
      console.error(`tangle: <t-paint> could not load ${src} (a cross-origin image needs CORS)`, this);
      return;
    }
    // Without a width or height, they follow the image.
    let width = Number(this.getAttribute("width")) || 0;
    let height = Number(this.getAttribute("height")) || 0;
    const ratio = img.naturalWidth / img.naturalHeight;
    if (!width && !height) [width, height] = [img.naturalWidth, img.naturalHeight];
    else if (!height) height = Math.round(width / ratio);
    else if (!width) width = Math.round(height * ratio);
    this._canvas.width = width;
    this._canvas.height = height;
    this._ctx.drawImage(img, 0, 0, width, height);
    this._original = img;
  }

  choose(tool) {
    this._tool = tool;
    for (const el of this._toolButtons) el.setAttribute("aria-pressed", String(el.dataset.tool === tool));
    this._colorInput.hidden = !this._hasColor || tool === "eraser";
    const size = PAINT_SIZES[tool];
    this._sizeInput.hidden = !size;
    if (size) {
      Object.assign(this._sizeInput, { min: size[0], max: size[1], value: this._sizes[tool] });
      this._sizeInput.setAttribute("aria-label", `${PAINT_LABELS[tool]} size`);
    }
    this._settings.hidden = this._colorInput.hidden && this._sizeInput.hidden;
  }

  paint([x0, y0], [x1, y1]) {
    const ctx = this._ctx;
    ctx.save();
    ctx.globalCompositeOperation = this._tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = this._color;
    ctx.lineWidth = this._tool === "brush" ? 2 : this._sizes[this._tool];
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  /** Remembers the canvas, for undo. */
  snapshot() {
    const { width, height } = this._canvas;
    this._undo.push(this._ctx.getImageData(0, 0, width, height));
    if (this._undo.length > PAINT_UNDO) this._undo.shift();
    this.sync();
  }

  undo() {
    const last = this._undo.pop();
    if (!last) return;
    this._loading = null;
    this._ctx.putImageData(last, 0, 0);
    this.export();
  }

  /** Back to the src image, or to an empty canvas. Undo brings the drawing back. */
  clear() {
    this._loading = null;
    this.snapshot();
    const { width, height } = this._canvas;
    this._ctx.clearRect(0, 0, width, height);
    if (this._original) this._ctx.drawImage(this._original, 0, 0, width, height);
    this.export();
  }

  /** Shows a picture: the variable's new value. An empty value clears the canvas. */
  async load(src) {
    const token = (this._loading = {});
    const img = src ? await loadImage(src).catch(() => null) : null;
    if (this._loading !== token) return;
    if (src && !img) return console.error("tangle: <t-paint> could not load the picture", this);
    this.snapshot();
    const { width, height } = this._canvas;
    this._ctx.clearRect(0, 0, width, height);
    if (img) this._ctx.drawImage(img, 0, 0, width, height);
    // Now that the canvas shows it, the variable becomes its PNG, like after a stroke.
    this.export();
  }

  /** Puts the drawing, on its paper, in the variable as a PNG data URL. */
  export() {
    const { width, height } = this._canvas;
    const out = Object.assign(document.createElement("canvas"), { width, height });
    const ctx = out.getContext("2d");
    ctx.fillStyle = getComputedStyle(this._paper).backgroundColor;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(this._canvas, 0, 0);
    try {
      this._value = out.toDataURL("image/png");
    } catch (error) {
      console.error("tangle: <t-paint> can't export a picture from another origin without CORS", error);
      return;
    }
    this.sync();
    if (this._name) this.scope.set(this._name, this._value);
  }

  sync() {
    this._undoButton.disabled = !this._undo.length;
  }
}
