import { untracked } from "../core/signals.js";
import { TangleElement, validName } from "../core/element.js";
import {
  SKETCH_BACKGROUNDS, SketchViewport, decodeSketch, decodeSketchFragment, emptySketch, encodeSketch,
  encodeSketchFragment, sketchBoundsOf, sketchContains, sketchContentBounds, sketchCopies, sketchCss, sketchDistance,
  sketchGridStep, sketchID, sketchLassoed, sketchLine, sketchMoved, sketchOutset, sketchScaled, sketchSmooth,
  sketchInPolygon, sketchRounded, sketchStrokeBounds, sketchStrokeColor, sketchTouched, sketchUnion, SKETCH_DARK,
  SKETCH_LIGHT,
} from "../core/sketch.js";

// Ported from the board of Sketcher (https://github.com/koaning/sketcher), without its math layer.

const SKETCH_CSS = `
  /* No font here: the cards inherit from the element, and should look like the page. */
  :host {
    display: block;
    --line: color-mix(in srgb, currentColor 15%, transparent);
    --glass: color-mix(in srgb, var(--tangle-surface, #fff) 80%, transparent);
  }
  * { box-sizing: border-box; }
  .glass { font: 13px ui-sans-serif, system-ui, sans-serif; }
  [part="board"] {
    position: relative;
    height: 400px;
    min-height: 160px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 8px;
    outline: none;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }
  [part="board"]:focus-visible { outline: 2px solid var(--tangle-accent); outline-offset: 1px; }
  /* The board scrolls with two fingers only while it has focus, so show when it does. */
  [part="board"] { transition: border-color 0.15s, box-shadow 0.15s; }
  :host(:focus-within) [part="board"] {
    border-color: var(--tangle-accent);
    box-shadow: 0 0 0 1px var(--tangle-accent);
  }
  canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
  /* Light paper: ink multiplies, like a highlighter on a printed chart. */
  [part="board"]:not(.dark) .ink { mix-blend-mode: multiply; }
  .viewing .ink { pointer-events: none; }
  .cards { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-origin: 0 0; }
  ::slotted(*) { cursor: auto; }
  :host(:fullscreen) { background: var(--tangle-surface, #fff); }
  :host(:fullscreen) [part="board"] { height: 100vh !important; border: 0; border-radius: 0; }
  [part="viewbar"] { position: absolute; right: 8px; bottom: 8px; display: flex; padding: 2px; border-radius: 10px; z-index: 2; }
  .glass {
    background: var(--glass);
    border: 1px solid var(--line);
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.1);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
  [part="palette"] {
    position: absolute;
    left: 8px;
    top: 8px;
    max-width: calc(100% - 16px);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 3px 5px;
    border-radius: 10px;
    z-index: 2;
  }
  .section { display: flex; align-items: center; gap: 1px; }
  .section + .section { padding-left: 4px; border-left: 1px solid var(--line); }
  button {
    all: unset;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    color: inherit;
    cursor: pointer;
  }
  button svg { width: 16px; height: 16px; }
  button:hover:not(:disabled) { background: color-mix(in srgb, currentColor 9%, transparent); }
  button[aria-pressed="true"] {
    color: var(--tangle-accent);
    background: color-mix(in srgb, var(--tangle-accent) 15%, transparent);
  }
  button:disabled { opacity: 0.3; cursor: default; }
  button:focus-visible { outline: 2px solid var(--tangle-accent); }
  .width { width: 20px; }
  .width span { display: block; border-radius: 50%; background: currentColor; }
  .width[aria-pressed="true"] { color: inherit; background: color-mix(in srgb, currentColor 14%, transparent); }
  [part~="swatch"] { width: 22px; border-radius: 50%; }
  [part~="swatch"] span {
    display: block;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 15%, transparent);
  }
  [part~="swatch"][aria-pressed="true"] {
    background: none;
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, currentColor 70%, transparent);
  }
  [part="selection-bar"] { position: absolute; display: flex; padding: 2px; border-radius: 10px; z-index: 2; }
  [part="menu"] {
    position: absolute;
    min-width: 180px;
    padding: 4px;
    border-radius: 8px;
    z-index: 3;
    display: flex;
    flex-direction: column;
  }
  [part="menu"] button {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    width: auto;
    height: auto;
    padding: 4px 9px;
    border-radius: 5px;
  }
  [part="menu"] button:hover:not(:disabled), [part="menu"] button:focus-visible {
    background: var(--tangle-accent);
    color: var(--tangle-surface, #fff);
    outline: none;
  }
  kbd { font: inherit; opacity: 0.55; }
  hr { border: 0; height: 1px; margin: 4px 8px; background: var(--line); }
  [part="toast"] {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    padding: 6px 12px;
    border-radius: 8px;
    z-index: 4;
  }
  [hidden] { display: none !important; }
`;

/** Thin, medium and thick, in screen pixels. */
const SKETCH_WIDTHS = { pen: [1.5, 2.5, 6], marker: [10, 20, 36] };
/** The eraser's radius, and the least distance between two captured points, in screen pixels. */
const SKETCH_ERASER = 10;
const SKETCH_SPACING = 1.5;
const SKETCH_HANDLE = 5;
const SKETCH_UNDO = 500;
/** Highlights are drawn opaque and put down once at this opacity, so overlaps don't darken. */
const SKETCH_MARKER_ALPHA = { light: 0.35, dark: 0.55 };

// Icons in the style of Lucide (https://lucide.dev, ISC license).
const sketchIcon = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const SKETCH_ICONS = {
  pen: sketchIcon('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'),
  marker: sketchIcon('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'),
  eraser: sketchIcon('<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/>'),
  select: sketchIcon('<path d="M3.704 14.467A10 8 0 0 1 2 10a10 8 0 0 1 20 0 10 8 0 0 1-10 8 10 8 0 0 1-5.181-1.158"/><path d="M7 22a5 5 0 0 1-2-3.994"/><circle cx="5" cy="16" r="2"/>'),
  undo: sketchIcon('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: sketchIcon('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  plain: sketchIcon('<rect width="18" height="18" x="3" y="3" rx="2"/>'),
  dots: sketchIcon('<circle cx="6" cy="6" r=".6"/><circle cx="12" cy="6" r=".6"/><circle cx="18" cy="6" r=".6"/><circle cx="6" cy="12" r=".6"/><circle cx="12" cy="12" r=".6"/><circle cx="18" cy="12" r=".6"/><circle cx="6" cy="18" r=".6"/><circle cx="12" cy="18" r=".6"/><circle cx="18" cy="18" r=".6"/>'),
  grid: sketchIcon('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>'),
  eye: sketchIcon('<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>'),
  code: sketchIcon('<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>'),
  fit: sketchIcon('<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>'),
  expand: sketchIcon('<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>'),
  shrink: sketchIcon('<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>'),
  trash: sketchIcon('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
};
const SKETCH_TOOL_NAMES = { pen: "Pen (P)", marker: "Marker (M)", eraser: "Eraser (E)", select: "Select (S)" };
const SKETCH_BACKGROUND_NAMES = { plain: "Plain", dots: "Dots", grid: "Grid" };

const sketchIsMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** A shortcut's label: ⇧⌘E on a Mac, Ctrl+Shift+E elsewhere. */
function sketchKeys(key, { shift = false, mod = true } = {}) {
  if (sketchIsMac) return `${shift ? "⇧" : ""}${mod ? "⌘" : ""}${key}`;
  return [mod ? "Ctrl" : "", shift ? "Shift" : "", key].filter(Boolean).join("+");
}

/** The smoothed path of a stroke, cached per stroke object (strokes don't change). */
const sketchPaths = new WeakMap();
function sketchPath(stroke) {
  let path = sketchPaths.get(stroke);
  if (!path) sketchPaths.set(stroke, (path = sketchSmooth(stroke.points, new Path2D())));
  return path;
}

/** The last strokes copied on this page, for when the system clipboard can't be used. */
let sketchClipboard = null;
/** An offscreen canvas that flattens a group of highlights, reused. */
let sketchScratch = null;

/** Whether a CSS color is light, judging by its red, green and blue. */
function sketchIsLight(color) {
  const [r, g, b] = (color.match(/[\d.]+/g) ?? [0, 0, 0]).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 128;
}

const sketchCursors = new Map();
/** A round cursor with a light and a dark outline, so it shows on any ink. */
function sketchCursor(diameter, fill) {
  const key = `${diameter}|${fill}`;
  let cursor = sketchCursors.get(key);
  if (!cursor) {
    const size = Math.ceil(diameter + 4);
    const c = size / 2, r = diameter / 2;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      (fill ? `<circle cx="${c}" cy="${c}" r="${r}" fill="${fill}"/>` : "") +
      `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2"/>` +
      `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(0,0,0,0.6)" stroke-width="1"/></svg>`;
    cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(c)} ${Math.round(c)}, crosshair`;
    sketchCursors.set(key, cursor);
  }
  return cursor;
}

/**
 * Draws strokes on a context that is in canvas coordinates. Highlights go first,
 * under the pen ink: each color's highlights are stroked opaque into a scratch
 * canvas and put down once, translucent, so overlapping strokes of one color
 * don't get darker. Different colors still mix where they cross.
 */
function sketchDrawInk(ctx, items, dark) {
  const groups = new Map();
  for (const item of items) {
    if (item.stroke.tool !== "marker") continue;
    const color = sketchCss(sketchStrokeColor(item.stroke, dark));
    if (!groups.has(color)) groups.set(color, []);
    groups.get(color).push(item);
  }
  for (const [color, group] of groups) sketchDrawHighlights(ctx, group, color, dark);
  ctx.save();
  ctx.lineCap = ctx.lineJoin = "round";
  for (const { stroke, path } of items) {
    if (stroke.tool !== "pen") continue;
    ctx.strokeStyle = sketchCss(sketchStrokeColor(stroke, dark));
    ctx.lineWidth = stroke.width;
    ctx.stroke(path);
  }
  ctx.restore();
}

function sketchDrawHighlights(ctx, items, color, dark) {
  let bounds = null;
  for (const { stroke } of items) bounds = sketchUnion(bounds, sketchStrokeBounds(stroke));
  if (!bounds) return;
  // The group's box in device pixels, clipped to the target.
  const t = ctx.getTransform();
  const x0 = Math.max(0, Math.floor(t.a * bounds.x + t.e));
  const y0 = Math.max(0, Math.floor(t.d * bounds.y + t.f));
  const x1 = Math.min(ctx.canvas.width, Math.ceil(t.a * (bounds.x + bounds.w) + t.e));
  const y1 = Math.min(ctx.canvas.height, Math.ceil(t.d * (bounds.y + bounds.h) + t.f));
  if (x1 <= x0 || y1 <= y0) return;
  sketchScratch ??= document.createElement("canvas");
  if (sketchScratch.width < ctx.canvas.width) sketchScratch.width = ctx.canvas.width;
  if (sketchScratch.height < ctx.canvas.height) sketchScratch.height = ctx.canvas.height;
  const s = sketchScratch.getContext("2d");
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.clearRect(x0, y0, x1 - x0, y1 - y0);
  s.setTransform(t);
  s.strokeStyle = color;
  s.lineCap = s.lineJoin = "round";
  for (const { stroke, path } of items) {
    s.lineWidth = stroke.width;
    s.stroke(path);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = dark ? SKETCH_MARKER_ALPHA.dark : SKETCH_MARKER_ALPHA.light;
  // Multiply darkens like highlighter on paper; on a dark board it would vanish.
  ctx.globalCompositeOperation = dark ? "source-over" : "multiply";
  ctx.drawImage(sketchScratch, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

/** Dots or grid lines, in view coordinates, so they keep their size on screen. */
function sketchDrawBackground(ctx, background, view, dark, size) {
  if (background === "plain") return;
  const step = sketchGridStep(view.scale);
  const topLeft = view.toCanvas({ x: 0, y: 0 });
  const bottomRight = view.toCanvas({ x: size.w, y: size.h });
  const startX = Math.floor(topLeft.x / step) * step;
  const startY = Math.floor(topLeft.y / step) * step;
  ctx.save();
  ctx.beginPath();
  if (background === "dots") {
    for (let y = startY; y <= bottomRight.y + step; y += step) {
      for (let x = startX; x <= bottomRight.x + step; x += step) {
        const p = view.toView({ x, y });
        ctx.moveTo(p.x + 1.1, p.y);
        ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
      }
    }
    ctx.fillStyle = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.16)";
    ctx.fill();
  } else {
    for (let x = startX; x <= bottomRight.x + step; x += step) {
      const vx = Math.round(view.toView({ x, y: 0 }).x) + 0.5;
      ctx.moveTo(vx, 0);
      ctx.lineTo(vx, size.h);
    }
    for (let y = startY; y <= bottomRight.y + step; y += step) {
      const vy = Math.round(view.toView({ x: 0, y }).y) + 0.5;
      ctx.moveTo(0, vy);
      ctx.lineTo(size.w, vy);
    }
    ctx.strokeStyle = dark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.07)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

/** Children that aren't drawn, so they aren't cards. */
const SKETCH_HIDDEN = new Set(["script", "style", "template", "t-let", "t-var", "t-fetch"]);
/** A card's width without a data-width, in board units. */
const SKETCH_CARD_WIDTH = 280;

const sketchAttr = (v) => String(v).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

// <t-sketch name="board" height="400" background="dots" mode="edit">
//   <p data-x="0" data-y="0">…any HTML, vangle elements included…</p>
// </t-sketch>
// An infinite whiteboard: pen, highlighter, eraser and lasso on a canvas you pan
// and zoom. Its children are cards on the board, which you move and draw around.
// The drawing is a variable: the board as JSON, set once per
// finished stroke or edit. Setting the variable shows that board. In view mode
// the board only pans and zooms; Export makes a view-mode copy to paste into a page.
export class TSketch extends TangleElement {
  /** The board as JSON: `{ background, math, strokes, version }`. */
  get value() {
    return this._value;
  }

  connectedCallback() {
    if (!this.shadowRoot) this.build();
    this.listenToPage();
    this._name = this.hasAttribute("name") ? validName(this) : null;
    if (!this._name) {
      if (this._value === undefined) this.publish();
      return;
    }
    this.watch((scope) => {
      const value = scope.get(this._name);
      untracked(() => {
        if (value === undefined || value === null || value === "") this.publish();
        else if (value !== this._value) this.load(value);
      });
    });
  }

  disconnectedCallback() {
    for (const stop of this._pageListeners ?? []) stop();
    this._pageListeners = [];
    super.disconnectedCallback();
  }

  build() {
    const background = this.getAttribute("background") ?? "dots";
    if (!SKETCH_BACKGROUNDS.includes(background)) {
      console.error(`tangle: <t-sketch> background is ${SKETCH_BACKGROUNDS.join(", ")}`, this);
    }
    this._mode = this.getAttribute("mode") === "view" ? "view" : "edit";
    this._preview = false;
    this._board = { ...emptySketch(SKETCH_BACKGROUNDS.includes(background) ? background : "dots"), cards: new Map() };
    this._view = new SketchViewport();
    this._tool = "pen";
    this._widthIndex = 1;
    this._swatch = 0;
    this._undo = [];
    this._redo = [];
    this._selection = new Set(); // stroke ids, and card elements
    this._erased = new Set();
    this._gesture = null;
    this._touches = new Map();
    this._size = { w: 0, h: 0 };
    this._dark = false;
    this._edits = 0; // boards set or edits made, so a late src file doesn't overwrite them
    this._children = new Map(); // element → { source, card }

    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${SKETCH_CSS}</style>
      <div part="board" tabindex="0" role="application">
        <canvas class="paper"></canvas>
        <div class="cards"><slot></slot></div>
        <canvas part="canvas" class="ink"></canvas>
        <div part="palette" class="glass" role="toolbar"></div>
        <div part="viewbar" class="glass"></div>
        <div part="selection-bar" class="glass" hidden></div>
        <div part="menu" class="glass" role="menu" hidden></div>
        <div part="toast" class="glass" role="status" hidden></div>
      </div>`;
    const $ = (part) => root.querySelector(`[part="${part}"]`);
    this._root = $("board");
    this._paperCanvas = root.querySelector(".paper");
    this._canvas = $("canvas");
    this._cardLayer = root.querySelector(".cards");
    this._ctx = this._canvas.getContext("2d");
    this._palette = $("palette");
    this._viewbar = $("viewbar");
    this._menu = $("menu");
    this._bar = $("selection-bar");
    this._toast = $("toast");
    this._root.setAttribute("aria-label", this.getAttribute("label") ?? this.getAttribute("name") ?? "Whiteboard");
    const height = Number(this.getAttribute("height"));
    if (height > 0) this._root.style.height = `${height}px`;
    this.buildPalette(this._palette);
    this._fitButton = this.button(SKETCH_ICONS.fit, `Zoom to fit (${sketchKeys("0")})`, () => this.zoomToFit());
    this._editButton = this.button(SKETCH_ICONS.pen, "Back to editing (Esc)", () => this.setPreview(false));
    this._screenButtons = [this.button("", "", () => this.toggleFullScreen()), this.button("", "", () => this.toggleFullScreen())];
    this._viewbar.append(this._fitButton, this._screenButtons[1], this._editButton);
    this._palette.lastElementChild.append(this._screenButtons[0]);
    // Full screen or back: fit the board to its new size.
    this.addEventListener("fullscreenchange", () => {
      this._fitLater = true;
      this.refresh();
    });
    this._bar.append(this.button(SKETCH_ICONS.trash, "Delete (⌫)", () => this.deleteSelection()));
    for (const el of [this._palette, this._viewbar, this._bar, this._menu]) {
      el.addEventListener("pointerdown", (e) => e.stopPropagation());
      el.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    this._toast.addEventListener("pointerdown", () => (this._toast.hidden = true));

    // On the board, not the ink canvas: in view mode the ink lets pointers through to the cards.
    const board = this._root;
    board.addEventListener("pointerdown", (e) => this.pointerDown(e));
    board.addEventListener("pointermove", (e) => this.pointerMove(e));
    board.addEventListener("pointerup", (e) => this.pointerUp(e));
    board.addEventListener("pointercancel", (e) => this.pointerCancel(e));
    board.addEventListener("pointerleave", () => {
      if (!this._gesture) this._hover = null;
    });
    board.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    board.addEventListener("contextmenu", (e) => this.contextMenu(e));
    board.addEventListener("keydown", (e) => this.keyDown(e));
    board.addEventListener("keyup", (e) => this.keyUp(e));
    board.addEventListener("focusout", (e) => {
      if (board.contains(e.relatedTarget)) return;
      this._menu.hidden = true;
      this._space = false;
      this.updateCursor();
    });
    // Safari's trackpad pinch comes as gesture events too; the wheel handler zooms.
    board.addEventListener("gesturestart", (e) => e.preventDefault());
    new ResizeObserver(() => this.resized()).observe(board);
    // Cards change size as charts load: keep them in view until the reader does anything
    // with the board or a card, so dragging a number never makes the board jump.
    const settle = () => (this._viewMoved = true);
    this.addEventListener("pointerdown", settle, true);
    this.addEventListener("keydown", settle, true);
    this._cardResize = new ResizeObserver(() => {
      if (!this._viewMoved && this._size.w) this.zoomToFit();
      else this.requestRender();
    });
    new MutationObserver(() => this.readChildren()).observe(this, { childList: true });
    this.readChildren();

    const src = this.getAttribute("src");
    if (src) this.fetchBoard(src);
    this.refresh();
  }

  buildPalette(palette) {
    const section = (buttons) => {
      const el = document.createElement("div");
      el.className = "section";
      el.append(...buttons);
      palette.append(el);
    };
    this._toolButtons = Object.entries(SKETCH_TOOL_NAMES).map(([tool, title]) =>
      this.button(SKETCH_ICONS[tool], title, () => this.setTool(tool)),
    );
    this._widthButtons = ["Thin", "Medium", "Thick"].map((name, i) => {
      const b = this.button("", `${name} ([ and ])`, () => {
        this._widthIndex = i;
        this.refresh();
      });
      b.classList.add("width");
      const d = 3 + i * 2.5;
      b.innerHTML = `<span style="width:${d}px;height:${d}px"></span>`;
      return b;
    });
    this._swatchButtons = SKETCH_LIGHT.map((_, i) => {
      const b = this.button("<span></span>", `Color ${i + 1}`, () => this.setSwatch(i));
      b.setAttribute("part", "button swatch");
      return b;
    });
    this._backgroundButton = this.button("", "", () => {
      const i = SKETCH_BACKGROUNDS.indexOf(this._board.background);
      this.commit({ ...this._board, background: SKETCH_BACKGROUNDS[(i + 1) % SKETCH_BACKGROUNDS.length] });
    });
    this._undoButton = this.button(SKETCH_ICONS.undo, `Undo (${sketchKeys("Z")})`, () => this.undo());
    this._redoButton = this.button(SKETCH_ICONS.redo, `Redo (${sketchKeys("Z", { shift: true })})`, () => this.redo());
    const preview = this.button(SKETCH_ICONS.eye, "Preview: the board as readers see it", () => this.setPreview(true));
    const exportButton = this.button(SKETCH_ICONS.code, "Export: copy the HTML of a view-only board", () => this.copyHTML());
    section(this._toolButtons);
    section(this._widthButtons);
    section(this._swatchButtons);
    section([this._backgroundButton, this._undoButton, this._redoButton]);
    section([preview, exportButton]);
  }

  get fullScreen() {
    return document.fullscreenElement === this;
  }

  toggleFullScreen() {
    if (this.fullScreen) document.exitFullscreen();
    else this.requestFullscreen?.().catch(() => this.showToast("This browser won't show the board full screen"));
  }

  /** A button that doesn't take focus, so keys keep going to the board. */
  button(icon, title, action) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("part", "button");
    b.title = title;
    b.setAttribute("aria-label", title.replace(/ \(.*\)$|: .*$/, ""));
    b.innerHTML = icon;
    b.addEventListener("pointerdown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      action();
    });
    return b;
  }

  /** Clipboard events and theme changes reach the board through the page. */
  listenToPage() {
    if (this._pageListeners?.length) return;
    const stops = (this._pageListeners = []);
    const listen = (target, type, fn) => {
      target.addEventListener(type, fn);
      stops.push(() => target.removeEventListener(type, fn));
    };
    for (const type of ["copy", "cut", "paste"]) {
      listen(document, type, (e) => {
        if (!this.hasFocus || this.viewing) return;
        e.preventDefault();
        this._pendingClipboard = null;
        if (type === "paste") this.paste(e.clipboardData);
        else this.copy(type, e.clipboardData);
      });
    }
    listen(matchMedia("(prefers-color-scheme: dark)"), "change", () => this.themeChanged());
    const observer = new MutationObserver(() => this.themeChanged());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    stops.push(() => observer.disconnect());
    this.themeChanged();
  }

  /** Whether the board itself, not a card on it, has focus. */
  get hasFocus() {
    return !!this.shadowRoot.activeElement;
  }

  /** Whether the reader is only looking: view mode, or a preview of it. */
  get viewing() {
    return this._mode === "view" || this._preview;
  }

  setPreview(on) {
    if (this._mode === "view") return;
    this._preview = on;
    this._selection.clear();
    this.cancelGesture();
    this._root.focus({ preventScroll: true, focusVisible: false });
    this.refresh();
  }

  // -------------------------------------------------------------------------
  // Cards: the board's children, placed in board coordinates
  // -------------------------------------------------------------------------

  /**
   * Takes in children the board hasn't seen. Their HTML is kept as it was when
   * they arrived, before vangle elements in them render, for Export. An inline
   * `<script type="application/json">` is a board to start from.
   */
  readChildren() {
    const seen = new Set();
    let cards = null;
    for (const el of this.children) {
      seen.add(el);
      if (this._children.has(el)) continue;
      const tag = el.localName;
      if (tag === "script" && el.type === "application/json") {
        this._children.set(el, { board: true });
        if (!this._edits) this.loadInline(el.textContent);
        continue;
      }
      const card = !SKETCH_HIDDEN.has(tag);
      this._children.set(el, { source: el.outerHTML, card });
      if (!card) continue;
      cards ??= new Map(this._board.cards);
      const x = Number(el.dataset.x), y = Number(el.dataset.y);
      const width = Number(el.dataset.width) || SKETCH_CARD_WIDTH;
      Object.assign(el.style, { position: "absolute", margin: "0", boxSizing: "border-box", width: `${width}px` });
      // Without a place, a card goes to the right of the others.
      let place = { x, y };
      if (!Number.isFinite(x) || !Number.isFinite(y) || el.dataset.x === undefined || el.dataset.y === undefined) {
        let right = null;
        for (const [, p] of cards) right = Math.max(right ?? -Infinity, p.x + p.w);
        place = { x: right === null ? 0 : right + 40, y: 0 };
      }
      cards.set(el, { ...place, w: width });
      this._cardResize.observe(el);
    }
    for (const el of this._children.keys()) {
      if (seen.has(el)) continue;
      this._children.delete(el);
      this._cardResize.unobserve(el);
      cards ??= new Map(this._board.cards);
      cards.delete(el);
      this._selection.delete(el);
    }
    if (cards) {
      this._board = { ...this._board, cards };
      this.requestRender();
    }
  }

  loadInline(text) {
    try {
      this.setBoard(decodeSketch(text));
      this._edits = 0; // it's where the board starts, so a src may still replace it
    } catch (error) {
      console.error(`tangle: <t-sketch> ${error.message}`, this);
    }
  }

  get cards() {
    return [...this._board.cards.keys()].filter((el) => this._children.get(el)?.card);
  }

  /** A card's box in board coordinates. Its height is what the page lays it out at. */
  cardRect(el) {
    const p = this._board.cards.get(el);
    return { x: p.x, y: p.y, w: el.offsetWidth || p.w, h: el.offsetHeight };
  }

  /** The topmost card under a board point. */
  cardAt(p) {
    const cards = this.cards;
    for (let i = cards.length - 1; i >= 0; i--) if (sketchContains(this.cardRect(cards[i]), p)) return cards[i];
    return null;
  }

  /** The card an event came from, if any. */
  cardOf(e) {
    return e.composedPath().find((node) => this._children.get(node)?.card) ?? null;
  }

  /** The ink and the cards. */
  contentBounds() {
    let r = sketchContentBounds(this._board.strokes);
    for (const el of this.cards) r = sketchUnion(r, this.cardRect(el));
    return r;
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  /**
   * The HTML of a view-only copy of this board: the same attributes, the cards
   * where they are now, and the ink as JSON. Paste it into a page.
   */
  exportHTML() {
    const attrs = [...this.attributes]
      .filter((a) => a.name !== "mode" && a.name !== "src")
      .map((a) => (a.value === "" ? ` ${a.name}` : ` ${a.name}="${sketchAttr(a.value)}"`))
      .join("");
    const lines = [`<t-sketch mode="view"${attrs}>`];
    const template = document.createElement("template");
    for (const [el, child] of this._children) {
      if (child.board) continue;
      let html = child.source;
      const place = this._board.cards.get(el);
      if (child.card && place) {
        template.innerHTML = html;
        const copy = template.content.firstElementChild;
        copy.dataset.x = Math.round(place.x);
        copy.dataset.y = Math.round(place.y);
        html = copy.outerHTML;
      }
      lines.push(`  ${html}`);
    }
    const json = JSON.stringify(encodeSketch(sketchRounded(this._board))).replaceAll("<", "\\u003c");
    lines.push(`  <script type="application/json">${json}</script>`, "</t-sketch>");
    return lines.join("\n");
  }

  copyHTML() {
    const html = this.exportHTML();
    const done = () => this.showToast("Copied the HTML of a view-only board");
    const failed = () => {
      console.log(html);
      this.showToast("Couldn't copy: the HTML is in the console");
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(html).then(done, failed);
    else failed();
  }

  // -------------------------------------------------------------------------
  // The board and its variable
  // -------------------------------------------------------------------------

  /** Loads the src file, unless the board changed while it was on its way. */
  async fetchBoard(src) {
    const edits = this._edits;
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const board = decodeSketch(await response.json());
      if (this._edits !== edits) return;
      this.setBoard(board);
      this.publish();
    } catch (error) {
      console.error(`tangle: <t-sketch> could not load ${src}: ${error.message}`, this);
    }
  }

  /**
   * Shows a board from the variable. Given as a string, it goes back into the
   * variable as JSON; an object stays as it is, so two boards with one name
   * don't keep handing each other new objects.
   */
  load(value) {
    let board;
    try {
      board = decodeSketch(value);
    } catch (error) {
      console.error(`tangle: <t-sketch> ${error.message}`, this);
      return;
    }
    this.setBoard(board);
    if (typeof value === "string") this.publish();
    else this._value = value;
  }

  /** Replaces the ink, and fits the view to the board. The cards stay. Undo starts over. */
  setBoard(board) {
    this._edits++;
    this.cancelGesture();
    this._board = { ...board, cards: this._board.cards };
    this._undo = [];
    this._redo = [];
    this._selection.clear();
    this._viewMoved = false;
    if (this._size.w) this.zoomToFit();
    else this._fitLater = true;
    this.refresh();
  }

  /** Records an edit for undo, and puts the board in the variable. */
  commit(next) {
    this._undo.push(this._board);
    if (this._undo.length > SKETCH_UNDO) this._undo.shift();
    this._redo = [];
    this._board = next;
    this.changed();
  }

  undo() {
    const last = this._undo.pop();
    if (!last) return;
    this._redo.push(this._board);
    this._board = last;
    this.changed();
  }

  redo() {
    const next = this._redo.pop();
    if (!next) return;
    this._undo.push(this._board);
    this._board = next;
    this.changed();
  }

  changed() {
    this._edits++;
    this.cancelGesture();
    const ids = new Set(this._board.strokes.map((s) => s.id));
    for (const item of this._selection) if (!ids.has(item) && !this._board.cards.has(item)) this._selection.delete(item);
    this.refresh();
    this.publish();
  }

  publish() {
    this._value = encodeSketch(this._board);
    if (this._name) this.scope.set(this._name, this._value);
    this.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // -------------------------------------------------------------------------
  // Tools, selection, theme
  // -------------------------------------------------------------------------

  setTool(tool) {
    if (tool !== "select") this._selection.clear();
    this._tool = tool;
    this.refresh();
  }

  /** Picking a color goes back to drawing. */
  setSwatch(i) {
    this._swatch = i;
    if (this._tool === "eraser" || this._tool === "select") this._tool = "pen";
    this._selection.clear();
    this.refresh();
  }

  /** The current tool's line width, in screen pixels. */
  get screenWidth() {
    if (this._tool === "eraser") return SKETCH_ERASER * 2;
    return SKETCH_WIDTHS[this._tool === "marker" ? "marker" : "pen"][this._widthIndex];
  }

  get palette() {
    return this._dark ? SKETCH_DARK : SKETCH_LIGHT;
  }

  /** The selected strokes. */
  get selected() {
    return this._board.strokes.filter((s) => this._selection.has(s.id));
  }

  get selectedCards() {
    return this.cards.filter((el) => this._selection.has(el));
  }

  get selectionBounds() {
    if (!this._selection.size) return null;
    let r = sketchContentBounds(this.selected);
    for (const el of this.selectedCards) r = sketchUnion(r, this.cardRect(el));
    return r;
  }

  selectAll() {
    this._tool = "select";
    this._selection = new Set([...this._board.strokes.map((s) => s.id), ...this.cards]);
    this.refresh();
  }

  /** Deletes the selected strokes. Cards are the page's HTML, so they stay. */
  deleteSelection() {
    if (!this.selected.length) return;
    const strokes = this._board.strokes.filter((s) => !this._selection.has(s.id));
    this._selection.clear();
    this.commit({ ...this._board, strokes });
  }

  clearBoard() {
    if (!this._board.strokes.length) return;
    this._selection.clear();
    this.commit({ ...this._board, strokes: [] });
  }

  /** The page is dark when its text is light. The paper is the page's surface. */
  themeChanged() {
    const style = getComputedStyle(this);
    const dark = sketchIsLight(style.color);
    const paper = style.getPropertyValue("--tangle-surface").trim() || (dark ? "#1e1f22" : "#fbfbf8");
    const accent = style.getPropertyValue("--tangle-accent").trim() || "#246bce";
    if (dark === this._dark && paper === this._paper && accent === this._accent) return;
    Object.assign(this, { _dark: dark, _paper: paper, _accent: accent });
    this.refresh();
  }

  /** Updates the palette and redraws. */
  refresh() {
    const viewing = this.viewing;
    this._root.classList.toggle("viewing", viewing);
    this._root.classList.toggle("dark", this._dark);
    this._palette.hidden = viewing;
    this._viewbar.hidden = !viewing;
    this._editButton.hidden = !this._preview;
    for (const b of this._screenButtons) {
      b.innerHTML = this.fullScreen ? SKETCH_ICONS.shrink : SKETCH_ICONS.expand;
      b.title = this.fullScreen ? "Exit full screen (Esc)" : "Full screen";
      b.setAttribute("aria-label", b.title.replace(/ \(.*\)$/, ""));
    }
    this._toolButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(Object.keys(SKETCH_TOOL_NAMES)[i] === this._tool)));
    this._widthButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === this._widthIndex)));
    const drawing = this._tool === "pen" || this._tool === "marker";
    this._swatchButtons.forEach((b, i) => {
      b.setAttribute("aria-pressed", String(drawing && i === this._swatch));
      b.firstElementChild.style.background = sketchCss(this.palette[i]);
    });
    const bg = this._board.background;
    const next = SKETCH_BACKGROUNDS[(SKETCH_BACKGROUNDS.indexOf(bg) + 1) % SKETCH_BACKGROUNDS.length];
    this._backgroundButton.innerHTML = SKETCH_ICONS[bg];
    this._backgroundButton.title = `Background: ${SKETCH_BACKGROUND_NAMES[bg]} (click for ${SKETCH_BACKGROUND_NAMES[next]})`;
    this._backgroundButton.setAttribute("aria-label", `Background: ${SKETCH_BACKGROUND_NAMES[bg]}`);
    this._undoButton.disabled = !this._undo.length;
    this._redoButton.disabled = !this._redo.length;
    this.requestRender();
  }

  showToast(message) {
    this._toast.textContent = message;
    this._toast.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => (this._toast.hidden = true), 2500);
  }

  // -------------------------------------------------------------------------
  // View
  // -------------------------------------------------------------------------

  get viewCenter() {
    return { x: this._size.w / 2, y: this._size.h / 2 };
  }

  zoomToFit() {
    this._view = SketchViewport.fitting(this.contentBounds(), this._size);
    this.requestRender();
  }

  zoomToActualSize() {
    this._viewMoved = true;
    this._view = this._view.zoomedTo(1, this.viewCenter);
    this.requestRender();
  }

  zoomBy(factor) {
    this._viewMoved = true;
    this._view = this._view.zoomed(factor, this.viewCenter);
    this.requestRender();
  }

  resized() {
    const w = this._root.clientWidth, h = this._root.clientHeight;
    if (w === this._size.w && h === this._size.h) return;
    this._size = { w, h };
    if (w && h && (this._fitLater || !this._sized || !this._viewMoved)) {
      this._sized = true;
      this._fitLater = false;
      this.zoomToFit();
    }
    this.render();
  }

  // -------------------------------------------------------------------------
  // Pointer
  // -------------------------------------------------------------------------

  viewPoint(e) {
    const r = this._root.getBoundingClientRect();
    return { x: e.clientX - r.left - this._root.clientLeft, y: e.clientY - r.top - this._root.clientTop };
  }

  pointerDown(e) {
    // In view mode, the cards are live: their own elements handle the pointer.
    if (this.viewing && this.cardOf(e)) return;
    this._menu.hidden = true;
    this._root.focus({ preventScroll: true, focusVisible: false });
    const v = this.viewPoint(e);
    this._hover = v;
    if (e.pointerType === "touch") {
      this._touches.set(e.pointerId, v);
      if (this._touches.size === 2) {
        // A second finger turns whatever the first one started into a pan and zoom.
        this.cancelGesture();
        this._gesture = { kind: "pinch", last: this.pinchState() };
        return;
      }
      if (this._touches.size > 2) return;
    }
    if (this._gesture || e.button === 2) return;
    try {
      this._root.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer can't be captured.
    }
    const id = e.pointerId;
    if (e.button === 1 || this._space || this.viewing) {
      e.preventDefault();
      this._gesture = { kind: "pan", id, last: v };
      this.requestRender();
      return;
    }
    if (e.button !== 0) return;
    const p = this._view.toCanvas(v);
    // A pen's eraser end reports the eraser button.
    const tool = e.pointerType === "pen" && e.buttons & 32 ? "eraser" : this._tool;
    if (tool === "pen" || tool === "marker") {
      const stroke = {
        id: sketchID(),
        tool,
        color: this.palette[this._swatch],
        swatch: this._swatch,
        width: this.screenWidth / this._view.scale,
        points: [p],
      };
      this._gesture = { kind: "stroke", id, stroke, raw: [p], end: p, shift: e.shiftKey, alt: e.altKey };
    } else if (tool === "eraser") {
      this._erased = new Set();
      this._gesture = { kind: "erase", id, last: p };
      this.erase(p, p);
    } else {
      this.selectDown(id, p);
    }
    this.requestRender();
  }

  pointerMove(e) {
    const v = this.viewPoint(e);
    this._hover = v;
    const g = this._gesture;
    if (e.pointerType === "touch" && this._touches.has(e.pointerId)) {
      this._touches.set(e.pointerId, v);
      if (g?.kind === "pinch") {
        const next = this.pinchState();
        let view = this._view.panned(next.center.x - g.last.center.x, next.center.y - g.last.center.y);
        if (g.last.spread > 0 && next.spread > 0) view = view.zoomed(next.spread / g.last.spread, next.center);
        this._view = view;
        this._viewMoved = true;
        g.last = next;
        this.requestRender();
        return;
      }
    }
    if (!g) return this.updateCursor();
    if (g.kind === "pinch" || g.id !== e.pointerId) return;
    if (g.kind === "pan") {
      this._view = this._view.panned(v.x - g.last.x, v.y - g.last.y);
      this._viewMoved = true;
      g.last = v;
      return this.requestRender();
    }
    // Every sample counts for ink; otherwise browsers send one move per frame.
    const samples = e.getCoalescedEvents?.() ?? [];
    const points = (samples.length ? samples : [e]).map((s) => this._view.toCanvas(this.viewPoint(s)));
    const spacing = SKETCH_SPACING / this._view.scale;
    for (const p of points) {
      if (g.kind === "stroke") {
        if (sketchDistance(g.raw.at(-1), p) >= spacing) g.raw.push(p);
        g.end = p;
      } else if (g.kind === "erase") {
        this.erase(g.last, p);
        g.last = p;
      } else if (g.kind === "lasso") {
        if (sketchDistance(g.points.at(-1), p) >= spacing) g.points.push(p);
      } else if (g.kind === "scale") {
        // The pointer, projected onto the diagonal, so the scale stays uniform.
        const dx = g.start.x - g.anchor.x, dy = g.start.y - g.anchor.y;
        const lengthSq = dx * dx + dy * dy;
        if (lengthSq > 0) {
          const t = ((p.x - g.anchor.x) * dx + (p.y - g.anchor.y) * dy) / lengthSq;
          g.factor = Math.max(0.05, Math.min(20, t));
        }
      } else if (g.kind === "move") {
        g.offset = { x: p.x - g.anchor.x, y: p.y - g.anchor.y };
      }
    }
    if (g.kind === "stroke") this.shapeStroke(g, e.shiftKey, e.altKey);
    this.requestRender();
  }

  /** Freehand, or with Shift or Option/Alt held, a straight line. The keys can change mid-stroke. */
  shapeStroke(g, shift, alt) {
    g.shift = shift;
    g.alt = alt;
    g.stroke.points = shift || alt
      ? sketchLine(g.raw[0], g.end, { angle: shift, grid: alt ? sketchGridStep(this._view.scale) : null })
      : g.raw;
  }

  pointerUp(e) {
    if (e.pointerType === "touch") {
      this._touches.delete(e.pointerId);
      if (this._gesture?.kind === "pinch") {
        if (this._touches.size < 2) this._gesture = null;
        return;
      }
    }
    const g = this._gesture;
    if (!g || g.kind === "pinch" || g.id !== e.pointerId) return;
    this._gesture = null;
    if (g.kind === "stroke") {
      const p = this._view.toCanvas(this.viewPoint(e));
      const last = g.raw.at(-1);
      if (last.x !== p.x || last.y !== p.y) g.raw.push(p);
      g.end = p;
      this.shapeStroke(g, g.shift, g.alt);
      const stroke = { ...g.stroke, points: [...g.stroke.points] };
      this.commit({ ...this._board, strokes: [...this._board.strokes, stroke] });
    } else if (g.kind === "erase") {
      const ids = this._erased;
      this._erased = new Set();
      if (ids.size) this.commit({ ...this._board, strokes: this._board.strokes.filter((s) => !ids.has(s.id)) });
    } else if (g.kind === "lasso") {
      const box = sketchBoundsOf(g.points);
      // A click, not a drag, just clears the selection. A card is picked when its middle is in the lasso.
      if (Math.max(box.w, box.h) * this._view.scale > 4) {
        const cards = this.cards.filter((el) => {
          const r = this.cardRect(el);
          return sketchInPolygon(g.points, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
        });
        this._selection = new Set([...sketchLassoed(g.points, this._board.strokes), ...cards]);
      }
    } else if (g.kind === "move") {
      const { x: dx, y: dy } = g.offset;
      if (Math.hypot(dx, dy) > 0.01) {
        const strokes = this._board.strokes.map((s) => (this._selection.has(s.id) ? sketchMoved(s, dx, dy) : s));
        const cards = new Map(this._board.cards);
        for (const el of this.selectedCards) {
          const p = cards.get(el);
          cards.set(el, { ...p, x: p.x + dx, y: p.y + dy });
        }
        this.commit({ ...this._board, strokes, cards });
      }
    } else if (g.kind === "scale") {
      if (Math.abs(g.factor - 1) > 0.001) {
        const strokes = this._board.strokes.map((s) => (this._selection.has(s.id) ? sketchScaled(s, g.factor, g.anchor) : s));
        this.commit({ ...this._board, strokes });
      }
    }
    this.requestRender();
  }

  pointerCancel(e) {
    this._touches.delete(e.pointerId);
    const g = this._gesture;
    if (g?.kind === "pinch" && this._touches.size < 2) this._gesture = null;
    else if (g && g.kind !== "pinch" && g.id === e.pointerId) this.cancelGesture();
  }

  pinchState() {
    const [a, b] = [...this._touches.values()];
    return { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, spread: sketchDistance(a, b) };
  }

  /** Drops a gesture without committing it: Esc, a second finger, a cancelled pointer. */
  cancelGesture() {
    this._gesture = null;
    this._erased = new Set();
    this.requestRender();
  }

  erase(a, b) {
    const radius = SKETCH_ERASER / this._view.scale;
    for (const s of this._board.strokes) {
      if (!this._erased.has(s.id) && sketchTouched(s, a, b, radius)) this._erased.add(s.id);
    }
  }

  /** The resize handle, in view coordinates. Only ink resizes, so a selection with cards has none. */
  get handleCenter() {
    const bounds = this.selectionBounds;
    if (!bounds || this._tool !== "select" || this.viewing || this.selectedCards.length) return null;
    const r = sketchOutset(this._view.rectToView(this.previewRect(bounds)), 6);
    return { x: r.x + r.w, y: r.y + r.h };
  }

  onHandle(v) {
    const handle = this.handleCenter;
    return !!handle && !!v && sketchDistance(v, handle) <= SKETCH_HANDLE + 6;
  }

  selectDown(id, p) {
    const bounds = this.selectionBounds;
    const card = this.cardAt(p);
    if (bounds && this.onHandle(this._view.toView(p)) && (bounds.w > 0 || bounds.h > 0)) {
      this._gesture = { kind: "scale", id, anchor: { x: bounds.x, y: bounds.y }, start: p, factor: 1 };
    } else if (bounds && sketchContains(sketchOutset(bounds, 8 / this._view.scale), p)) {
      this._gesture = { kind: "move", id, anchor: p, offset: { x: 0, y: 0 } };
    } else if (card) {
      // A card can be grabbed without lassoing it first.
      this._selection = new Set([card]);
      this._gesture = { kind: "move", id, anchor: p, offset: { x: 0, y: 0 } };
    } else {
      this._selection = new Set();
      this._gesture = { kind: "lasso", id, points: [p] };
    }
  }

  /** The live move or resize, as `p * s + t`. */
  get preview() {
    const g = this._gesture;
    if (g?.kind === "move") return { s: 1, tx: g.offset.x, ty: g.offset.y };
    if (g?.kind === "scale") return { s: g.factor, tx: g.anchor.x * (1 - g.factor), ty: g.anchor.y * (1 - g.factor) };
    return null;
  }

  previewRect(r) {
    const t = this.preview;
    return t ? { x: r.x * t.s + t.tx, y: r.y * t.s + t.ty, w: r.w * t.s, h: r.h * t.s } : r;
  }

  // -------------------------------------------------------------------------
  // Clipboard and images
  // -------------------------------------------------------------------------

  copy(kind, data) {
    const strokes = this.selected;
    if (!strokes.length) return;
    sketchClipboard = strokes;
    const json = JSON.stringify(encodeSketchFragment(strokes));
    const text = JSON.stringify({ type: "sketcher-fragment", fragment: encodeSketchFragment(strokes) });
    if (data) {
      data.setData("application/x-sketcher-fragment", json);
      data.setData("text/plain", text);
    } else {
      navigator.clipboard?.writeText(text).catch(() => {});
    }
    if (kind === "cut") this.deleteSelection();
  }

  /** Pastes under the pointer when it's over the board, else next to the original. */
  paste(data) {
    const strokes = this.readClipboard(data);
    if (!strokes?.length) return;
    const bounds = sketchContentBounds(strokes);
    let dx = 16 / this._view.scale, dy = dx;
    if (this._hover && bounds) {
      const target = this._view.toCanvas(this._hover);
      dx = target.x - (bounds.x + bounds.w / 2);
      dy = target.y - (bounds.y + bounds.h / 2);
    }
    const copies = sketchCopies(strokes, dx, dy);
    this._tool = "select";
    this.commit({ ...this._board, strokes: [...this._board.strokes, ...copies] });
    this._selection = new Set(copies.map((s) => s.id));
    this.refresh();
  }

  readClipboard(data) {
    if (data) {
      try {
        const raw = data.getData("application/x-sketcher-fragment");
        if (raw) return decodeSketchFragment(JSON.parse(raw));
      } catch {
        // fall through
      }
      try {
        const parsed = JSON.parse(data.getData("text/plain"));
        if (parsed?.type === "sketcher-fragment") return decodeSketchFragment(parsed.fragment);
      } catch {
        // not ours
      }
      // Something else is on the clipboard: only paste our own copy when nothing at all is.
      if (data.types.length) return null;
    }
    return sketchClipboard;
  }

  /**
   * The strokes (by default all the ink) on paper, cropped to the ink plus
   * padding: a canvas, or null when there's no ink. Cards aren't in it.
   */
  image(strokes = this._board.strokes, scale = 2, padding = 32) {
    const content = sketchContentBounds(strokes);
    if (!content) return null;
    const r = sketchOutset(content, padding);
    const x = Math.floor(r.x), y = Math.floor(r.y);
    const w = Math.ceil(r.x + r.w) - x, h = Math.ceil(r.y + r.h) - y;
    const canvas = Object.assign(document.createElement("canvas"), { width: Math.floor(w * scale), height: Math.floor(h * scale) });
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = this._paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
    sketchDrawInk(ctx, strokes.map((stroke) => ({ stroke, path: sketchPath(stroke) })), this._dark);
    return canvas;
  }

  /** The ink as a PNG data URL, cropped to it, or null when there's none. */
  toPNG({ scale = 2, padding = 32 } = {}) {
    return this.image(this._board.strokes, scale, padding)?.toDataURL("image/png") ?? null;
  }

  exportPNG() {
    const canvas = this.image();
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${this.getAttribute("name") || "sketch"}.png`;
    a.click();
  }

  /** Copies the selected ink, or all of it, to the clipboard as a picture. */
  copyAsImage() {
    const canvas = this.image(this.selected.length ? this.selected : this._board.strokes);
    if (!canvas || !navigator.clipboard?.write) return;
    const blob = new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(
      () => this.showToast("Copied as an image"),
      () => this.showToast("Couldn't copy to the clipboard"),
    );
  }

  // -------------------------------------------------------------------------
  // Wheel, keys and menu
  // -------------------------------------------------------------------------

  /**
   * Ctrl/⌘ + wheel and trackpad pinches zoom. A plain wheel pans once the board
   * has focus; before that it scrolls the page, so a board doesn't trap the scroll.
   */
  wheel(e) {
    const zoom = e.ctrlKey || e.metaKey;
    if (!zoom && !this.matches(":focus-within")) {
      // The page scrolls. Say once in a while how to scroll the board instead.
      const now = performance.now();
      if (!(now - this._hinted < 8000)) {
        this._hinted = now;
        this.showToast("Click the board to pan it with two fingers");
      }
      return;
    }
    e.preventDefault();
    this._menu.hidden = true;
    this._viewMoved = true;
    const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (zoom) this._view = this._view.zoomed(Math.exp(-e.deltaY * lines * 0.01), this.viewPoint(e));
    else this._view = this._view.panned(-e.deltaX * lines, -e.deltaY * lines);
    this.requestRender();
  }

  keyDown(e) {
    // Keys typed into a card are the card's.
    if (!this.shadowRoot.contains(e.composedPath()[0])) return;
    // Keep page shortcuts away while the board has focus.
    e.stopPropagation();
    const mod = sketchIsMac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    if (e.key === "Shift" || e.key === "Alt") {
      const g = this._gesture;
      if (g?.kind === "stroke") {
        this.shapeStroke(g, e.shiftKey, e.altKey);
        this.requestRender();
      }
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      if (!e.repeat) {
        this._space = true;
        this.updateCursor();
      }
      return;
    }
    if (this.viewing) {
      if (e.key === "Escape" && this._preview) this.setPreview(false);
      else if (mod && ["=", "+", "-", "_", "0"].includes(key)) {
        e.preventDefault();
        this.modKey(key, e);
      } else if (e.shiftKey && e.code === "Digit0") this.zoomToActualSize();
      return;
    }
    if (mod) {
      if (this.modKey(key, e)) e.preventDefault();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") {
      if (!this._menu.hidden) this._menu.hidden = true;
      else if (this._gesture && this._gesture.kind !== "pan" && this._gesture.kind !== "pinch") this.cancelGesture();
      else {
        this._selection.clear();
        this.requestRender();
      }
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      if (this._selection.size) {
        e.preventDefault();
        this.deleteSelection();
      }
      return;
    }
    // Shift+0 stands in for ⌘1, which browsers keep for switching tabs.
    if (e.shiftKey && e.code === "Digit0") return this.zoomToActualSize();
    const digit = /^Digit([1-6])$/.exec(e.code);
    if (digit) return this.setSwatch(Number(digit[1]) - 1);
    const tool = { p: "pen", b: "pen", m: "marker", h: "marker", e: "eraser", s: "select" }[key];
    if (tool) return this.setTool(tool);
    if (e.key === "[" || e.key === "]") {
      this._widthIndex = Math.max(0, Math.min(2, this._widthIndex + (e.key === "[" ? -1 : 1)));
      this.refresh();
    }
  }

  /** ⌘ (or Ctrl) shortcuts. Returns whether the key was used. */
  modKey(key, e) {
    switch (key) {
      case "z":
        if (e.shiftKey) this.redo();
        else this.undo();
        return true;
      case "y":
        if (sketchIsMac) return false;
        this.redo();
        return true;
      case "a":
        this.selectAll();
        return true;
      case "=":
      case "+":
        this.zoomBy(1.25);
        return true;
      case "-":
      case "_":
        this.zoomBy(0.8);
        return true;
      case "0":
        this.zoomToFit();
        return true;
      case "backspace":
      case "delete":
        if (!e.shiftKey) return false;
        this.clearBoard();
        return true;
      case "e":
        if (!e.shiftKey) return false;
        this.exportPNG();
        return true;
      case "c":
      case "x":
      case "v":
        if (key === "c" && e.shiftKey) {
          this.copyAsImage();
          return true;
        }
        // Let the browser fire its clipboard event; if it doesn't, use the page's own clipboard.
        this._pendingClipboard = key === "c" ? "copy" : key === "x" ? "cut" : "paste";
        setTimeout(() => {
          const pending = this._pendingClipboard;
          this._pendingClipboard = null;
          if (pending === "paste") this.paste(null);
          else if (pending) this.copy(pending, null);
        });
        return false;
    }
    return false;
  }

  keyUp(e) {
    if (!this.shadowRoot.contains(e.composedPath()[0])) return;
    e.stopPropagation();
    if (e.key === " ") {
      this._space = false;
      this.updateCursor();
    }
    if ((e.key === "Shift" || e.key === "Alt") && this._gesture?.kind === "stroke") {
      this.shapeStroke(this._gesture, e.shiftKey, e.altKey);
      this.requestRender();
    }
  }

  contextMenu(e) {
    // Viewing, the page's own menu is fine.
    if (this.viewing) return;
    e.preventDefault();
    this.cancelGesture();
    const v = this.viewPoint(e);
    const empty = !this._board.strokes.length;
    const entries = this.selected.length
      ? [
          { label: "Cut", keys: sketchKeys("X"), action: () => this.copy("cut", null) },
          { label: "Copy", keys: sketchKeys("C"), action: () => this.copy("copy", null) },
          { label: "Copy as Image", keys: sketchKeys("C", { shift: true }), action: () => this.copyAsImage() },
          "-",
          { label: "Delete", keys: "⌫", action: () => this.deleteSelection() },
        ]
      : [
          { label: "Paste", keys: sketchKeys("V"), disabled: !sketchClipboard, action: () => this.paste(null) },
          { label: "Select All", keys: sketchKeys("A"), action: () => this.selectAll() },
          "-",
          { label: "Zoom to Fit", keys: sketchKeys("0"), action: () => this.zoomToFit() },
          { label: "Actual Size", keys: sketchKeys("0", { shift: true, mod: false }), action: () => this.zoomToActualSize() },
          "-",
          { label: "Preview", keys: "", action: () => this.setPreview(true) },
          { label: "Copy HTML for a Page", keys: "", action: () => this.copyHTML() },
          { label: "Copy as Image", keys: sketchKeys("C", { shift: true }), disabled: empty, action: () => this.copyAsImage() },
          { label: "Export as PNG", keys: sketchKeys("E", { shift: true }), disabled: empty, action: () => this.exportPNG() },
          "-",
          { label: "Clear", keys: sketchKeys("⌫", { shift: true }), disabled: empty, action: () => this.clearBoard() },
        ];
    const menu = this._menu;
    menu.replaceChildren(
      ...entries.map((entry) => {
        if (entry === "-") return document.createElement("hr");
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "menuitem");
        b.textContent = entry.label;
        const kbd = document.createElement("kbd");
        kbd.textContent = entry.keys;
        b.append(kbd);
        b.disabled = !!entry.disabled;
        b.addEventListener("click", (event) => {
          event.stopPropagation();
          menu.hidden = true;
          entry.action();
        });
        return b;
      }),
    );
    menu.hidden = false;
    const x = Math.max(4, Math.min(v.x, this._size.w - menu.offsetWidth - 4));
    const y = Math.max(4, Math.min(v.y, this._size.h - menu.offsetHeight - 4));
    Object.assign(menu.style, { left: `${x}px`, top: `${y}px` });
    this.requestRender();
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  requestRender() {
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = 0;
      this.render();
    });
  }

  /** Sizes a canvas to the board in device pixels and resets its transform. */
  prepare(canvas) {
    const { w, h } = this._size;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [ctx, dpr];
  }

  render() {
    const { w, h } = this._size;
    const view = this._view;
    const dark = this._dark;
    const preview = this.preview;

    // Underneath: the paper, with its dots or grid while editing.
    const [paper] = this.prepare(this._paperCanvas);
    paper.fillStyle = this._paper;
    paper.fillRect(0, 0, w, h);
    if (!this.viewing) sketchDrawBackground(paper, this._board.background, view, dark, this._size);

    // In between: the cards, in board coordinates.
    this._cardLayer.style.transform = `translate(${view.offset.x}px, ${view.offset.y}px) scale(${view.scale})`;
    for (const [el, p] of this._board.cards) {
      const moving = preview && this._selection.has(el);
      el.style.left = `${p.x + (moving ? preview.tx : 0)}px`;
      el.style.top = `${p.y + (moving ? preview.ty : 0)}px`;
    }

    // On top: the ink.
    const [ctx, dpr] = this.prepare(this._canvas);
    ctx.clearRect(0, 0, w, h);
    const px = 1 / view.scale;
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.offset.x, dpr * view.offset.y);
    const visible = view.rectToCanvas({ x: 0, y: 0, w, h });
    const items = [];
    for (const stroke of this._board.strokes) {
      if (this._erased.has(stroke.id)) continue;
      const selected = this._selection.has(stroke.id);
      let item = { stroke, path: sketchPath(stroke) };
      let bounds = sketchStrokeBounds(stroke);
      if (selected && preview) {
        const path = new Path2D();
        path.addPath(item.path, new DOMMatrix([preview.s, 0, 0, preview.s, preview.tx, preview.ty]));
        item = { stroke: { ...stroke, width: stroke.width * preview.s }, path };
        bounds = bounds && this.previewRect(bounds);
      }
      if (!bounds || bounds.x > visible.x + visible.w || bounds.x + bounds.w < visible.x) continue;
      if (bounds.y > visible.y + visible.h || bounds.y + bounds.h < visible.y) continue;
      if (selected) {
        // A halo in the accent color.
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.strokeStyle = this._accent;
        ctx.lineWidth = item.stroke.width + 7 * px;
        ctx.lineCap = ctx.lineJoin = "round";
        ctx.stroke(item.path);
        ctx.restore();
      }
      items.push(item);
    }
    const g = this._gesture;
    if (g?.kind === "stroke") items.push({ stroke: g.stroke, path: sketchSmooth(g.stroke.points, new Path2D()) });
    sketchDrawInk(ctx, items, dark);
    if (!this.viewing) {
      this.drawCardOutlines(ctx, px);
      this.drawSelection(ctx, px);
    }
    this.placeSelectionBar();
    this.updateCursor();
  }

  /** While editing, a faint outline shows where each card is. */
  drawCardOutlines(ctx, px) {
    ctx.save();
    ctx.strokeStyle = this._dark ? "rgba(255, 255, 255, 0.25)" : "rgba(0, 0, 0, 0.2)";
    ctx.lineWidth = px;
    ctx.setLineDash([3 * px, 3 * px]);
    for (const el of this.cards) {
      const r = sketchOutset(this.previewRect(this.cardRect(el)), 4 * px);
      if (!this._selection.has(el)) ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    ctx.restore();
  }

  drawSelection(ctx, px) {
    const g = this._gesture;
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = this._accent;
    if (g?.kind === "lasso" && g.points.length > 1) {
      ctx.beginPath();
      g.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.globalAlpha = 0.06;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.25 * px;
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.stroke();
    }
    const bounds = this.selectionBounds;
    if (bounds) {
      const r = sketchOutset(this.previewRect(bounds), 6 * px);
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 6 * px);
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = px;
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.stroke();
      if (this.handleCenter) {
        ctx.beginPath();
        ctx.arc(r.x + r.w, r.y + r.h, SKETCH_HANDLE * px, 0, Math.PI * 2);
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        ctx.fillStyle = this._paper;
        ctx.fill();
        ctx.lineWidth = 1.5 * px;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  placeSelectionBar() {
    const bar = this._bar;
    const bounds = this.selectionBounds;
    const busy = this._gesture && this._gesture.kind !== "pan" && this._gesture.kind !== "pinch";
    bar.hidden = !bounds || !!busy || this.viewing || !this.selected.length;
    if (bar.hidden) return;
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    const r = this._view.rectToView(bounds);
    let x = r.x + r.w / 2 - bw / 2;
    let y = r.y - bh - 14;
    if (y < 8) y = r.y + r.h + 14;
    x = Math.max(8, Math.min(this._size.w - bw - 8, x));
    y = Math.max(8, Math.min(this._size.h - bh - 8, y));
    Object.assign(bar.style, { left: `${x}px`, top: `${y}px` });
  }

  updateCursor() {
    const cursor = this.cursor();
    if (this._root.style.cursor !== cursor) this._root.style.cursor = cursor;
  }

  cursor() {
    const g = this._gesture;
    if (g?.kind === "pan" || g?.kind === "move") return "grabbing";
    if (this._space || this.viewing) return "grab";
    if (g?.kind === "scale") return "nwse-resize";
    if (this._tool === "eraser") return sketchCursor(SKETCH_ERASER * 2, null);
    if (this._tool === "select") {
      if (this.onHandle(this._hover)) return "nwse-resize";
      return this._hover && this.cardAt(this._view.toCanvas(this._hover)) ? "move" : "crosshair";
    }
    const color = this.palette[this._swatch];
    const marker = this._tool === "marker";
    const alpha = this._dark ? SKETCH_MARKER_ALPHA.dark : SKETCH_MARKER_ALPHA.light;
    return sketchCursor(Math.max(this.screenWidth, 4), sketchCss(color, marker ? alpha : 1));
  }
}
