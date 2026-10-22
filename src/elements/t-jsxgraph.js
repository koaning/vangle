import { untracked } from "../core/signals.js";
import { scopeOf, withExtra } from "../core/scope.js";
import { snap } from "../core/format.js";
import { loadJsxgraph } from "../core/load.js";
import { TangleElement } from "../core/element.js";

// ---------------------------------------------------------------------------
// JSXGraph: <t-jsxgraph> runs a script once to build a board. Functions on the
// board can read variables, and points made with point() set them when dragged.
// ---------------------------------------------------------------------------

/** Element defaults that draw in the page's colors, so the board follows the theme. */
function jsxgraphTheme(el) {
  const css = getComputedStyle(el);
  const pct = (name, fallback) => {
    const n = parseFloat(css.getPropertyValue(name));
    return (Number.isFinite(n) ? n : fallback) / 100;
  };
  const font = css.getPropertyValue("--tangle-chart-font").match(/([\d.]+)px/);
  const ink = (color) => ({ strokeColor: color, highlightStrokeColor: color, fillColor: color, highlightFillColor: color });
  const accent = ink("var(--tangle-accent)");
  const grid = pct("--tangle-chart-grid", 12);
  const label = { strokeColor: "currentColor", strokeOpacity: pct("--tangle-chart-text", 60), fontSize: font ? Number(font[1]) : 12 };
  const axis = {
    ...ink("currentColor"), strokeOpacity: Math.min(1, grid * 3), highlightStrokeOpacity: Math.min(1, grid * 3),
    strokeWidth: 1, highlightStrokeWidth: 1, lastArrow: false, withLabel: false,
    ticks: { ...ink("currentColor"), strokeOpacity: grid, highlightStrokeOpacity: grid, majorHeight: -1, minorTicks: 0, label },
  };
  return {
    axis,
    elements: { point: { ...accent, size: 4, withLabel: false, showInfobox: false },
      line: { ...accent, strokeWidth: 2.5, highlightStrokeWidth: 4 },
      curve: { ...accent, strokeWidth: 2.5, highlightStrokeWidth: 4 },
      circle: { ...accent, strokeWidth: 2.5, highlightStrokeWidth: 4, fillOpacity: 0, highlightFillOpacity: 0 },
      polygon: { ...accent, fillOpacity: 0.16, highlightFillOpacity: 0.16 },
      text: { ...ink("currentColor"), fontSize: label.fontSize },
      label: { ...ink("currentColor"), fontSize: label.fontSize } },
  };
}

// An element's own color stays its color on hover: highlight* defaults to it.
const HIGHLIGHT = {
  strokeColor: "highlightStrokeColor", fillColor: "highlightFillColor",
  strokeOpacity: "highlightStrokeOpacity", fillOpacity: "highlightFillOpacity", cssClass: "highlightCssClass",
};

// <t-jsxgraph x="0 100" y="0 100" axis><script type="text/plain">…</script></t-jsxgraph>
// or <t-jsxgraph src="board.js">. The script runs once, with board, JXG and point() in reach.
export class TJsxgraph extends TangleElement {
  connectedCallback() {
    this._source ??= this.hasAttribute("src")
      ? fetch(this.getAttribute("src")).then((r) => {
          if (!r.ok) throw new Error(`${this.getAttribute("src")}: ${r.status}`);
          return r.text();
        })
      : Promise.resolve(this.querySelector("script")?.textContent ?? this.textContent);
    if (!this._target) {
      this._target = document.createElement("div");
      this._target.className = "tangle-jsxgraph is-loading";
      this._target.textContent = "Loading board…";
      this.append(this._target);
    }
    const token = (this._token = {});
    Promise.all([loadJsxgraph(), this._source]).then(
      ([JXG, body]) => {
        if (this._token === token && this.isConnected) this.start(JXG, body);
      },
      (error) => {
        if (this._token === token) this.showError(error);
      },
    );
  }

  disconnectedCallback() {
    this._token = null;
    for (const type of ["pointerdown", "pointermove"]) removeEventListener(type, this._forgetPosition, true);
    if (this._board) this._jxg.JSXGraph.freeBoard(this._board);
    this._board = null;
    super.disconnectedCallback();
  }

  start(JXG, body) {
    const scope = scopeOf(this);
    const range = (attr, fallback) => {
      const [lo, hi] = (this.getAttribute(attr) ?? fallback).trim().split(/[\s,]+/).map(Number);
      return [lo, hi];
    };
    const [x0, x1] = range("x", "-5 5");
    const [y0, y1] = range("y", "-5 5");
    const theme = jsxgraphTheme(this);
    this._target.className = "tangle-jsxgraph";
    this._target.textContent = "";
    this._target.id ||= `tangle-jsxgraph-${++jsxgraphCount}`;
    let board;
    try {
      board = JXG.JSXGraph.initBoard(this._target.id, {
        boundingbox: [x0, y1, x1, y0], keepAspectRatio: false,
        axis: this.hasAttribute("axis"), defaultAxes: { x: theme.axis, y: theme.axis },
        showNavigation: false, showCopyright: false, showInfobox: false,
        pan: { enabled: false }, zoom: { enabled: false },
      });
    } catch (error) {
      this.showError(error);
      return;
    }
    this._jxg = JXG;
    this._board = board;
    // JSXGraph caches where the board is on the page, for a second and for a whole drag. Text above
    // it that changes length moves it, so forget the cached spot before JSXGraph reads a pointer.
    this._forgetPosition = () => (board.cPos = []);
    for (const type of ["pointerdown", "pointermove"]) addEventListener(type, this._forgetPosition, true);
    for (const [type, defaults] of Object.entries(theme.elements)) Object.assign(board.options[type], defaults);
    const create = board.create.bind(board);
    board.create = (type, parents, attributes = {}) => {
      const own = { ...attributes };
      for (const [key, highlight] of Object.entries(HIGHLIGHT)) {
        if (key in own && !(highlight in own)) own[highlight] = own[key];
      }
      return create(type, parents, own);
    };

    // Updates the board makes for the page (below) aren't the reader's, so they don't set variables.
    let quiet = false;
    const quietly = (fn) => {
      quiet = true;
      try {
        fn();
      } finally {
        quiet = false;
      }
    };
    // A coordinate is a variable's name, or a number for one that stays put.
    const read = (coord) => (typeof coord === "number" ? coord : scope.peek(coord));
    const fit = (coord, value) => {
      if (typeof coord === "number") return coord;
      const meta = scope.meta(coord);
      return meta.min == null && meta.max == null && meta.step == null ? value : snap(value, meta);
    };
    const bound = [];
    const point = (x, y, attributes = {}) => {
      const p = board.create("point", [read(x), read(y)], attributes);
      bound.push({ p, x, y });
      // Variable → point, when something else on the page changes it.
      this.watch(() => {
        const at = [x, y].map((coord) => (typeof coord === "number" ? coord : scope.get(coord)));
        if (at[0] !== p.X() || at[1] !== p.Y()) {
          quietly(() => {
            p.setPosition(JXG.COORDS_BY_USER, at);
            board.update();
          });
        }
      });
      return p;
    };
    // Point → variable, after the reader drags (or arrow-keys) anything on the board. The
    // variables snap to their min, max and step, and the points follow them a moment later.
    board.on("update", () => {
      if (quiet) return;
      const values = {};
      let moved = false;
      for (const { p, x, y } of bound) {
        const at = [fit(x, p.X()), fit(y, p.Y())];
        if (typeof x === "string") values[x] = at[0];
        if (typeof y === "string") values[y] = at[1];
        moved ||= at[0] !== p.X() || at[1] !== p.Y();
      }
      untracked(() => scope.setValues(values));
      // A point whose variable changed follows it in its own effect. One that moved without
      // changing it (off a fixed coordinate, or less than a step) goes back here.
      if (moved) {
        queueMicrotask(() => {
          const off = bound.filter(({ p, x, y }) => read(x) !== p.X() || read(y) !== p.Y());
          if (!off.length) return;
          quietly(() => {
            for (const { p, x, y } of off) p.setPosition(JXG.COORDS_BY_USER, [read(x), read(y)]);
            board.update();
          });
        });
      }
    });

    try {
      // Sloppy mode, so `with` is allowed: the script sees the page's variables directly.
      new Function("$scope", `with ($scope) {\n${body}\n}`)(withExtra(scope, { board, JXG, point }));
    } catch (error) {
      this.showError(error);
      return;
    }
    // Functions on the board (coordinates, visible, …) run during an update, so updating inside
    // an effect tracks every variable they read, and the board updates when one changes.
    this.watch(() => quietly(() => board.update()));
  }

  showError(error) {
    this._target.remove();
    this._error ??= Object.assign(document.createElement("div"), { className: "tangle-jsxgraph-error" });
    this._error.textContent = `t-jsxgraph: ${error.message}`;
    this.append(this._error);
  }
}
let jsxgraphCount = 0;
