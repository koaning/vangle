import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SketchViewport, decodeSketch, decodeSketchFragment, encodeSketch, encodeSketchFragment, sketchCopies, sketchGridStep,
  sketchID, sketchLassoed, sketchLine, sketchRounded, sketchScaled, sketchTouched,
} from "../src/core/sketch.js";
import { TSketch } from "../src/elements/t-sketch.js";

const stroke = (id, points, extra = {}) => ({
  id,
  tool: "pen",
  color: { r: 0, g: 0, b: 0, a: 1 },
  swatch: 0,
  width: 2,
  points: points.map(([x, y]) => ({ x, y })),
  ...extra,
});

// A board as the Sketcher app writes it: keys sorted, points as pairs, no swatch when it has none.
const FILE = {
  background: "grid",
  math: [{ id: "M1", latex: "x^2", origin: [0, 0], size: [10, 10], fontSize: 12, color: { r: 0, g: 0, b: 0, a: 1 }, ink: [] }],
  strokes: [
    { color: { a: 1, b: 0.88, g: 0.42, r: 0.05 }, id: "A", points: [[0, 0], [10, 5]], swatch: 2, tool: "pen", width: 2.5 },
    { color: { a: 1, b: 0.1, g: 0.2, r: 0.3 }, id: "B", points: [[1, 1]], tool: "marker", width: 20 },
  ],
  version: 2,
};

test("a board round-trips through JSON, with sorted keys and its math kept", () => {
  const board = decodeSketch(JSON.stringify(FILE));
  assert.equal(board.strokes[1].swatch, null);
  assert.deepEqual(board.strokes[0].points[1], { x: 10, y: 5 });
  assert.equal(JSON.stringify(encodeSketch(board)), JSON.stringify(FILE));
});

test("a version 1 board, without math, is upgraded, and ids are upper case", () => {
  const board = decodeSketch({ version: 1, background: "plain", strokes: [{ ...FILE.strokes[0], id: "abc" }] });
  assert.equal(board.version, 2);
  assert.deepEqual(board.math, []);
  assert.equal(board.strokes[0].id, "ABC");
});

test("a bad board says what's wrong", () => {
  assert.throws(() => decodeSketch("{"), /invalid JSON/);
  assert.throws(() => decodeSketch({ ...FILE, background: "lines" }), /bad background/);
  assert.throws(() => decodeSketch({ ...FILE, strokes: [{ ...FILE.strokes[0], tool: "brush" }] }), /bad tool/);
  assert.throws(() => decodeSketch({ ...FILE, strokes: [{ ...FILE.strokes[0], points: [[1, 2, 3]] }] }), /bad point/);
});

test("copies get fresh ids and move; fragments round-trip", () => {
  const original = stroke("A", [[0, 0], [10, 0]]);
  const [copy] = sketchCopies([original], 5, 5);
  assert.notEqual(copy.id, "A");
  assert.match(copy.id, /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
  assert.match(sketchID(), /^[0-9A-F-]{36}$/);
  assert.deepEqual(copy.points[1], { x: 15, y: 5 });
  assert.deepEqual(decodeSketchFragment(encodeSketchFragment([original])), [original]);
});

test("resizing scales the points and the width about the anchor", () => {
  const s = sketchScaled(stroke("A", [[10, 10], [20, 10]]), 2, { x: 10, y: 10 });
  assert.deepEqual(s.points, [{ x: 10, y: 10 }, { x: 30, y: 10 }]);
  assert.equal(s.width, 4);
});

test("the lasso picks strokes with at least half their points inside", () => {
  const lasso = [[0, 0], [10, 0], [10, 10], [0, 10]].map(([x, y]) => ({ x, y }));
  const strokes = [
    stroke("IN", [[2, 2], [5, 5], [8, 8]]),
    stroke("HALF", [[2, 2], [20, 20]]),
    stroke("OUT", [[2, 2], [20, 20], [30, 30]]),
  ];
  assert.deepEqual(sketchLassoed(lasso, strokes), ["IN", "HALF"]);
});

test("the eraser touches the strokes it sweeps past, counting their width", () => {
  const line = stroke("A", [[0, 0], [100, 0]], { width: 4 });
  assert.ok(sketchTouched(line, { x: 50, y: -50 }, { x: 50, y: 50 }, 1)); // crosses it
  assert.ok(sketchTouched(line, { x: 50, y: 12 }, { x: 60, y: 12 }, 10)); // 12 ≤ 10 + 2
  assert.ok(!sketchTouched(line, { x: 50, y: 13 }, { x: 60, y: 13 }, 10));
  assert.ok(sketchTouched(stroke("D", [[5, 5]]), { x: 0, y: 0 }, { x: 0, y: 0 }, 7)); // 7.07 ≤ 7 + 1
});

test("Shift snaps a line to 15° steps, keeping its projected length", () => {
  const [a, b] = sketchLine({ x: 0, y: 0 }, { x: 100, y: 3 }, { angle: true });
  assert.deepEqual(a, { x: 0, y: 0 });
  assert.deepEqual(b, { x: 100, y: 0 });
  const [, c] = sketchLine({ x: 0, y: 0 }, { x: 2, y: 100 }, { angle: true });
  assert.deepEqual(c, { x: 0, y: 100 });
  const [, d] = sketchLine({ x: 0, y: 0 }, { x: 50, y: 52 }, { angle: true });
  assert.ok(Math.abs(d.x - d.y) < 1e-9 && Math.abs(d.x - 51) < 1e-9);
  assert.equal(sketchLine({ x: 3, y: 4 }, { x: 3, y: 4 }, { angle: true }).length, 1);
});

test("Option snaps both ends to the grid; with Shift, only where the angle holds", () => {
  assert.deepEqual(sketchLine({ x: 5, y: 30 }, { x: 70, y: 40 }, { grid: 24 }), [{ x: 0, y: 24 }, { x: 72, y: 48 }]);
  // 45°, ending near (48, 48): the grid point keeps the angle.
  assert.deepEqual(sketchLine({ x: 1, y: 1 }, { x: 50, y: 46 }, { angle: true, grid: 24 })[1], { x: 48, y: 48 });
  // 15°: no grid point on that line nearby, so the end stays off the grid.
  const [, e] = sketchLine({ x: 0, y: 0 }, { x: 100, y: 27 }, { angle: true, grid: 24 });
  assert.ok(Math.abs(Math.atan2(e.y, e.x) - Math.PI / 12) < 1e-9);
  assert.notEqual(e.x % 24, 0);
});

test("the grid step doubles until it's 12px on screen", () => {
  assert.equal(sketchGridStep(1), 24);
  assert.equal(sketchGridStep(0.5), 24);
  assert.equal(sketchGridStep(0.4), 48);
  assert.equal(sketchGridStep(0.1), 192);
});

test("the viewport zooms about a point and fits content without zooming in", () => {
  const view = new SketchViewport().zoomed(2, { x: 100, y: 50 });
  assert.deepEqual(view.toCanvas({ x: 100, y: 50 }), { x: 100, y: 50 });
  assert.equal(new SketchViewport(undefined, 100).scale, 8);
  const fit = SketchViewport.fitting({ x: 0, y: 0, w: 10, h: 10 }, { w: 400, h: 300 });
  assert.equal(fit.scale, 1);
  assert.deepEqual(fit.toView({ x: 5, y: 5 }), { x: 200, y: 150 });
  assert.equal(SketchViewport.fitting({ x: 0, y: 0, w: 1000, h: 100 }, { w: 400, h: 300 }).scale, 0.32);
});

test("an exported board rounds points to a tenth and widths to a hundredth", () => {
  const board = { ...decodeSketch(FILE), strokes: [stroke("A", [[1.234, 5.678]], { width: 2.3456 })] };
  const [s] = sketchRounded(board).strokes;
  assert.deepEqual(s.points, [{ x: 1.2, y: 5.7 }]);
  assert.equal(s.width, 2.35);
  assert.equal(board.strokes[0].points[0].x, 1.234);
});

test("view mode and preview hide background dots and grid lines", () => {
  const spyCtx = () => {
    const calls = [];
    return {
      calls,
      save() {},
      restore() {},
      beginPath() {},
      clearRect() {},
      fillRect() { calls.push("fillRect"); },
      setTransform() {},
      setLineDash() {},
      moveTo() {},
      lineTo() { calls.push("lineTo"); },
      arc() { calls.push("arc"); },
      fill() { calls.push("fill"); },
      stroke() { calls.push("stroke"); },
      strokeRect() {},
      roundRect() {},
    };
  };
  const renderPaper = (mode, preview, background) => {
    const paper = spyCtx();
    const ink = spyCtx();
    const sketch = Object.assign(new TSketch(), {
      _mode: mode,
      _preview: preview,
      _board: { background, strokes: [], cards: new Map() },
      _view: new SketchViewport(),
      _size: { w: 100, h: 100 },
      _dark: false,
      _paper: "#fbfbf8",
      _accent: "#246bce",
      _erased: new Set(),
      _selection: new Set(),
      _gesture: null,
      _tool: "pen",
      _swatch: 0,
      _widthIndex: 1,
      _paperCanvas: paper,
      _canvas: ink,
      _cardLayer: { style: {} },
      _bar: { hidden: false, style: {} },
      _root: { style: {} },
      prepare: (ctx) => [ctx, 1],
    });
    sketch.render();
    return paper.calls;
  };

  for (const [bg, mark] of [["dots", "arc"], ["grid", "lineTo"]]) {
    assert.ok(renderPaper("edit", false, bg).includes(mark), `edit mode draws ${bg}`);
    assert.deepEqual(renderPaper("view", false, bg), ["fillRect"], `view mode hides ${bg}`);
    assert.deepEqual(renderPaper("edit", true, bg), ["fillRect"], `preview hides ${bg}`);
  }
});
