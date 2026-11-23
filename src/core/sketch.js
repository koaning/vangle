// The model behind <t-sketch>, without the DOM: a board of strokes in canvas
// coordinates (y down), read and written as JSON in the format of the
// Sketcher app (https://github.com/koaning/sketcher), plus the viewport, hit
// tests, edits and straight-line snapping. Strokes are immutable: edits return
// new strokes, so the renderer can cache a Path2D per stroke object.

export const SKETCH_VERSION = 2;
export const SKETCH_BACKGROUNDS = ["plain", "dots", "grid"];
/** Grid spacing at 100% zoom, in canvas units. */
const SKETCH_GRID = 24;
/** Snapped angles are multiples of 15°. */
const SKETCH_ANGLE_STEP = Math.PI / 12;

const sketchRgba = (r, g, b, a = 1) => ({ r, g, b, a });
/** Ink on paper, slot for slot with the dark palette: black, gray, blue, red, green, yellow. */
export const SKETCH_LIGHT = [
  sketchRgba(0.11, 0.11, 0.12),
  sketchRgba(0.54, 0.54, 0.56),
  sketchRgba(0.05, 0.42, 0.88),
  sketchRgba(0.86, 0.2, 0.2),
  sketchRgba(0.13, 0.56, 0.32),
  sketchRgba(0.98, 0.74, 0.1),
];
/** Chalk on slate: white, gray, sky, coral, mint, yellow. */
export const SKETCH_DARK = [
  sketchRgba(0.95, 0.95, 0.93),
  sketchRgba(0.62, 0.62, 0.64),
  sketchRgba(0.42, 0.72, 1.0),
  sketchRgba(1.0, 0.47, 0.43),
  sketchRgba(0.38, 0.85, 0.56),
  sketchRgba(1.0, 0.85, 0.32),
];

/** A new upper-case UUID. randomUUID needs a secure context (https or localhost); elsewhere, build one. */
export function sketchID() {
  if (crypto.randomUUID) return crypto.randomUUID().toUpperCase();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function emptySketch(background = "dots") {
  return { version: SKETCH_VERSION, strokes: [], math: [], background };
}

/** A palette stroke takes its slot's color in the current theme; other strokes keep theirs. */
export function sketchStrokeColor(stroke, dark) {
  const palette = dark ? SKETCH_DARK : SKETCH_LIGHT;
  const slot = stroke.swatch;
  return slot !== null && slot >= 0 && slot < palette.length ? palette[slot] : stroke.color;
}

export function sketchCss(c, alpha = 1) {
  const to = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgba(${to(c.r)}, ${to(c.g)}, ${to(c.b)}, ${c.a * alpha})`;
}

// ---------------------------------------------------------------------------
// Rectangles: { x, y, w, h }, or null for "nothing".
// ---------------------------------------------------------------------------

export function sketchBoundsOf(points) {
  if (!points.length) return null;
  let minX = points[0].x, minY = points[0].y, maxX = minX, maxY = minY;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function sketchUnion(a, b) {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export const sketchOutset = (r, d) => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

const rectsMeet = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

export const sketchContains = (r, p) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

export const sketchDistance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/** The points' box, outset by half the line width (and a pixel). */
export function sketchStrokeBounds(stroke) {
  const b = sketchBoundsOf(stroke.points);
  return b && sketchOutset(b, stroke.width / 2 + 1);
}

export function sketchContentBounds(strokes) {
  let r = null;
  for (const s of strokes) r = sketchUnion(r, sketchStrokeBounds(s));
  return r;
}

// ---------------------------------------------------------------------------
// The JSON format (Sketcher's `.sketcher` files): points are [x, y] arrays, `swatch` is left out when
// null, ids are upper case, and keys are sorted at every level. The board's
// `math` layer is kept as it is, so a file from the app keeps its typeset math,
// but <t-sketch> doesn't draw it.
// ---------------------------------------------------------------------------

function sketchFail(what) {
  throw new Error(`Not a Sketcher board: bad ${what}`);
}

function sketchNum(v, what) {
  if (typeof v !== "number" || !Number.isFinite(v)) sketchFail(what);
  return v;
}

function sketchObj(v, what) {
  if (typeof v !== "object" || v === null || Array.isArray(v)) sketchFail(what);
  return v;
}

function sketchArr(v, what) {
  if (!Array.isArray(v)) sketchFail(what);
  return v;
}

function decodeSketchStroke(v) {
  const o = sketchObj(v, "stroke");
  if (o.tool !== "pen" && o.tool !== "marker") sketchFail("tool");
  if (typeof o.id !== "string") sketchFail("id");
  const c = sketchObj(o.color, "color");
  return {
    id: o.id.toUpperCase(),
    tool: o.tool,
    color: sketchRgba(sketchNum(c.r, "color"), sketchNum(c.g, "color"), sketchNum(c.b, "color"), sketchNum(c.a, "color")),
    swatch: o.swatch === undefined || o.swatch === null ? null : sketchNum(o.swatch, "swatch"),
    width: sketchNum(o.width, "width"),
    points: sketchArr(o.points, "points").map((p) => {
      if (!Array.isArray(p) || p.length !== 2) sketchFail("point");
      return { x: sketchNum(p[0], "point"), y: sketchNum(p[1], "point") };
    }),
  };
}

/** A board from its JSON (an object or a string). Version 1 boards, without math, are upgraded. */
export function decodeSketch(json) {
  if (typeof json === "string") {
    try {
      json = JSON.parse(json);
    } catch {
      throw new Error("Not a Sketcher board: invalid JSON");
    }
  }
  const o = sketchObj(json, "board");
  sketchNum(o.version, "version");
  if (!SKETCH_BACKGROUNDS.includes(o.background)) sketchFail("background");
  return {
    version: SKETCH_VERSION,
    strokes: sketchArr(o.strokes, "strokes").map(decodeSketchStroke),
    math: o.math === undefined || o.math === null ? [] : sketchArr(o.math, "math"),
    background: o.background,
  };
}

function encodeSketchStroke(s) {
  const out = { color: { a: s.color.a, b: s.color.b, g: s.color.g, r: s.color.r }, id: s.id };
  out.points = s.points.map((p) => [p.x, p.y]);
  if (s.swatch !== null) out.swatch = s.swatch;
  out.tool = s.tool;
  out.width = s.width;
  return out;
}

/** The board as plain JSON, with its keys in sorted order: what `JSON.stringify` makes a file of. */
export function encodeSketch(board) {
  return {
    background: board.background,
    math: board.math,
    strokes: board.strokes.map(encodeSketchStroke),
    version: SKETCH_VERSION,
  };
}

/** Some strokes, for the clipboard. */
export const encodeSketchFragment = (strokes) => ({ math: [], strokes: strokes.map(encodeSketchStroke) });

export function decodeSketchFragment(json) {
  const o = sketchObj(json, "fragment");
  return sketchArr(o.strokes ?? [], "strokes").map(decodeSketchStroke);
}

// ---------------------------------------------------------------------------
// Viewport: view = canvas * scale + offset. Immutable.
// ---------------------------------------------------------------------------

export class SketchViewport {
  static min = 0.1;
  static max = 8;

  constructor(offset = { x: 0, y: 0 }, scale = 1) {
    this.offset = offset;
    this.scale = Math.min(SketchViewport.max, Math.max(SketchViewport.min, scale));
  }

  toView(p) {
    return { x: p.x * this.scale + this.offset.x, y: p.y * this.scale + this.offset.y };
  }

  toCanvas(p) {
    return { x: (p.x - this.offset.x) / this.scale, y: (p.y - this.offset.y) / this.scale };
  }

  rectToView(r) {
    const o = this.toView(r);
    return { x: o.x, y: o.y, w: r.w * this.scale, h: r.h * this.scale };
  }

  rectToCanvas(r) {
    const o = this.toCanvas(r);
    return { x: o.x, y: o.y, w: r.w / this.scale, h: r.h / this.scale };
  }

  panned(dx, dy) {
    return new SketchViewport({ x: this.offset.x + dx, y: this.offset.y + dy }, this.scale);
  }

  /** Zooms by `factor`, keeping the canvas point under `anchor` (in view coordinates) in place. */
  zoomed(factor, anchor) {
    return this.zoomedTo(this.scale * factor, anchor);
  }

  zoomedTo(scale, anchor) {
    const c = this.toCanvas(anchor);
    const s = new SketchViewport(this.offset, scale).scale;
    return new SketchViewport({ x: anchor.x - c.x * s, y: anchor.y - c.y * s }, s);
  }

  /** A viewport that fits `content` into a view of `size`, with padding. It never zooms in past 100%. */
  static fitting(content, size, padding = 40) {
    if (!content || (content.w <= 0 && content.h <= 0) || size.w <= 2 * padding || size.h <= 2 * padding) {
      return new SketchViewport();
    }
    const sx = (size.w - 2 * padding) / Math.max(content.w, 1);
    const sy = (size.h - 2 * padding) / Math.max(content.h, 1);
    const s = new SketchViewport(undefined, Math.min(1, sx, sy)).scale;
    const cx = content.x + content.w / 2, cy = content.y + content.h / 2;
    return new SketchViewport({ x: size.w / 2 - cx * s, y: size.h / 2 - cy * s }, s);
  }
}

/** The grid spacing at a zoom level: doubled until the lines are at least 12px apart on screen. */
export function sketchGridStep(scale) {
  let step = SKETCH_GRID;
  while (step * scale < 12) step *= 2;
  return step;
}

// ---------------------------------------------------------------------------
// Paths: quadratic curves through the midpoints of the segments. A single point
// is a dot (the stroke has round caps).
// ---------------------------------------------------------------------------

export function sketchSmooth(points, sink) {
  const n = points.length;
  if (!n) return sink;
  sink.moveTo(points[0].x, points[0].y);
  if (n <= 2) {
    sink.lineTo(points[n - 1].x, points[n - 1].y);
    return sink;
  }
  for (let i = 1; i < n - 1; i++) {
    const p = points[i], q = points[i + 1];
    sink.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
  }
  sink.lineTo(points[n - 1].x, points[n - 1].y);
  return sink;
}

// ---------------------------------------------------------------------------
// Hit tests
// ---------------------------------------------------------------------------

function pointSegmentDistance(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq)) : 0;
  return Math.hypot(a.x + t * abx - p.x, a.y + t * aby - p.y);
}

function segmentsCross(p1, p2, p3, p4) {
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segmentDistance(a1, a2, b1, b2) {
  if (segmentsCross(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointSegmentDistance(a1, b1, b2),
    pointSegmentDistance(a2, b1, b2),
    pointSegmentDistance(b1, a1, a2),
    pointSegmentDistance(b2, a1, a2),
  );
}

/** Whether the eraser, swept from `e1` to `e2` with this radius, touches the stroke. */
export function sketchTouched(stroke, e1, e2, radius) {
  const reach = radius + stroke.width / 2;
  const bounds = sketchStrokeBounds(stroke);
  const sweep = sketchOutset(sketchBoundsOf([e1, e2]), reach);
  if (!bounds || !rectsMeet(bounds, sweep)) return false;
  const pts = stroke.points;
  if (pts.length === 1) return pointSegmentDistance(pts[0], e1, e2) <= reach;
  for (let i = 0; i < pts.length - 1; i++) {
    if (segmentDistance(pts[i], pts[i + 1], e1, e2) <= reach) return true;
  }
  return false;
}

/** Even-odd point in polygon. The polygon closes itself. */
export function sketchInPolygon(polygon, p) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The ids of the strokes with at least half their points inside the lasso. */
export function sketchLassoed(lasso, strokes) {
  const box = sketchBoundsOf(lasso);
  if (lasso.length < 3 || !box) return [];
  return strokes
    .filter((s) => {
      const b = sketchStrokeBounds(s);
      if (!b || !rectsMeet(b, box)) return false;
      const inside = s.points.reduce((n, p) => n + (sketchInPolygon(lasso, p) ? 1 : 0), 0);
      return inside / s.points.length >= 0.5;
    })
    .map((s) => s.id);
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

export const sketchMoved = (s, dx, dy) => ({ ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) });

/** Scales the points and the line width about `anchor`. */
export function sketchScaled(s, f, anchor) {
  const points = s.points.map((p) => ({ x: anchor.x + (p.x - anchor.x) * f, y: anchor.y + (p.y - anchor.y) * f }));
  return { ...s, points, width: s.width * f };
}

/** Copies of the strokes, moved by (dx, dy), with fresh ids. */
export const sketchCopies = (strokes, dx, dy) => strokes.map((s) => ({ ...sketchMoved(s, dx, dy), id: sketchID() }));

// ---------------------------------------------------------------------------
// Straight lines: Shift snaps the angle to 15° steps, Option/Alt snaps the ends
// to the grid. With both, the end lands on the grid only where that keeps the
// angle (0°, 45°, 90°, …).
// ---------------------------------------------------------------------------

const sketchToGrid = (p, step) => ({ x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step });

/** The end of a line from `start` toward `end` at the nearest 15° angle, as long as `end`'s projection onto it. */
function angleSnapped(start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  if (!dx && !dy) return start;
  const angle = Math.round(Math.atan2(dy, dx) / SKETCH_ANGLE_STEP) * SKETCH_ANGLE_STEP;
  const ux = Math.cos(angle), uy = Math.sin(angle);
  const length = dx * ux + dy * uy;
  // Exact zeros keep horizontal and vertical lines straight.
  return {
    x: start.x + (Math.abs(ux) < 1e-12 ? 0 : ux * length),
    y: start.y + (Math.abs(uy) < 1e-12 ? 0 : uy * length),
  };
}

/** A straight line from `start` to `end`: one point when it has no length, else two. */
export function sketchLine(start, end, { angle = false, grid = null } = {}) {
  let a = start, b = end;
  if (grid) a = sketchToGrid(a, grid);
  if (angle) {
    b = angleSnapped(a, b);
    if (grid) {
      const g = sketchToGrid(b, grid);
      const cross = (b.x - a.x) * (g.y - a.y) - (b.y - a.y) * (g.x - a.x);
      if (Math.abs(cross) < 1e-6 * grid * grid) b = g;
    }
  } else if (grid) {
    b = sketchToGrid(b, grid);
  }
  return a.x === b.x && a.y === b.y ? [a] : [a, b];
}

/** The board with points rounded to a tenth and widths to a hundredth: smaller to paste into a page. */
export function sketchRounded(board) {
  const round = (v, f) => Math.round(v * f) / f;
  const strokes = board.strokes.map((s) => ({
    ...s,
    width: round(s.width, 100),
    points: s.points.map((p) => ({ x: round(p.x, 10), y: round(p.y, 10) })),
  }));
  return { ...board, strokes };
}
