import { untracked } from "../core/signals.js";
import { Formula, scopeOf, evalWith } from "../core/scope.js";
import { partsTex, toTex } from "../core/tex.js";
import { formatValue } from "../core/format.js";
import { loadKatex } from "../core/load.js";
import { hover, active, keyOf, PARAM, syncClasses, occurrence, decorate, relocate } from "../core/interaction.js";
import { TangleElement, declareMeta } from "../core/element.js";
import { formulaDag, cardTex, noteParts, variablesRead } from "../core/formulas.js";
import { dagReach, rectUnion, landingSide, trackOrder, packRow } from "../core/dag.js";
import { svgNode } from "./t-debug.js";

// ---------------------------------------------------------------------------
// <t-formula-dag>: formulas in rows, one row per dependency depth, with an
// arrow from each formula's output symbol to every place another formula
// uses it (\use{name}). Formulas can carry draggable numbers (\tangle),
// live results (\val), notes (\note), and a value of their own.
// ---------------------------------------------------------------------------

const DAG_HEAD_LEN = 7; // arrowhead length, px
const DAG_HEAD_HALF = 3.5; // arrowhead half-width
const DAG_LAND_GAP = 3; // between an arrow tip and the ink it points at
const DAG_SIDE_GAP = 12; // how far beside a formula a side-landing arrow comes down
const DAG_SIDE_PAD = 4; // vertical clearance a side landing keeps from glyphs
const DAG_CORNER = 7; // radius of an arrow's turns
const DAG_NOTE_PAD_Y = 4; // card edge to a row of note labels
const DAG_NOTE_ARROW_SPACE = 22; // formula to a row of note labels
const DAG_NOTE_GAP = 12; // between two labels in a row
const DAG_NOTE_CLEARANCE = 3; // between a note arrow's end and what it touches
const DAG_NOTE_HEAD_LEN = 6;
const DAG_NOTE_HEAD_HALF = 3.5;
const DAG_LANE_CLEARANCE = 8; // labels keep this far from a DAG arrow passing by
const DAG_NOTE_SIDE_SPACE = 20; // a left-hand note's label to the output symbol
const DAG_KATEX = {
  displayMode: true,
  throwOnError: true,
  trust: (ctx) => ctx.command === "\\htmlData" || ctx.command === "\\htmlClass",
  strict: (code) => (code === "htmlExtension" ? "ignore" : "warn"),
};

/** KaTeX's leaf boxes: glyph text, rules (fraction bars) and SVGs (radicals). Struts are skipped. */
function glyphLeaves(root) {
  const out = [];
  const walk = (node) => {
    if (node instanceof SVGElement) return out.push(node);
    const cls = node.classList;
    if (cls.contains("pstrut") || cls.contains("strut") || cls.contains("vlist-s")) return;
    if (!node.children.length) {
      const r = node.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push(node);
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(root);
  return out;
}

// A text box spans the font's whole ascent and descent, well past the ink.
// Measure the glyphs on a canvas and trim the box to the ink, so arrows land
// on the symbol rather than on the empty space above it.
let dagCanvas = null;
const dagMetrics = new Map(); // font + text -> TextMetrics
function inkRect(el) {
  const r = el.getBoundingClientRect();
  const text = el.textContent;
  if (el instanceof SVGElement || !text || !text.trim()) return r;
  const cs = getComputedStyle(el);
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const key = `${font}\n${text}`;
  let m = dagMetrics.get(key);
  if (!m) {
    dagCanvas ??= document.createElement("canvas").getContext("2d");
    dagCanvas.font = font;
    m = dagCanvas.measureText(text);
    // Before the KaTeX fonts load the metrics are for a fallback font: don't keep those.
    if (document.fonts?.status !== "loading") dagMetrics.set(key, m);
  }
  if (!m.fontBoundingBoxAscent) return r;
  const baseline = r.top + m.fontBoundingBoxAscent;
  return {
    left: r.left,
    right: r.right,
    top: baseline - m.actualBoundingBoxAscent,
    bottom: baseline + m.actualBoundingBoxDescent,
  };
}

const dagDiv = (className) => Object.assign(document.createElement("div"), { className });

// <t-formula-dag name="picked">
//   <script type="text/plain">
//   {
//     formulas: {
//       mu: String.raw`\mu = \frac{1}{n}\sum_i x_i`,
//       z: { tex: String.raw`z = \frac{\tangle{x} - \use{mu}}{\sigma}`, value: "(x - mu) / sigma" },
//     },
//   }
//   </script>
// </t-formula-dag>
export class TFormulaDag extends TangleElement {
  connectedCallback() {
    if (this._model === undefined) {
      try {
        this._model = this.readSpec();
      } catch (error) {
        this._model = null;
        this.showError(error);
      }
    }
    if (!this._model) return;
    if (!this._root) {
      this._root = dagDiv("tangle-dag is-loading");
      this._root.textContent = "Loading formulas…";
      this.append(this._root);
    }
    const token = (this._token = {});
    loadKatex().then(
      (katex) => {
        if (this._token === token && this.isConnected) this.start(katex);
      },
      (error) => {
        if (this._token === token) this.showError(new Error(`t-formula-dag: could not load KaTeX: ${error.message}`));
      },
    );
  }

  disconnectedCallback() {
    this._token = null;
    this._resize?.disconnect();
    super.disconnectedCallback();
  }

  /** Evaluate the spec, check it, and define each formula's value in the scope. */
  readSpec() {
    const scope = this.scope;
    const source = this.querySelector(":scope > script")?.textContent ?? "";
    if (!source.trim()) {
      throw new Error('t-formula-dag: put the spec in a <script type="text/plain"> inside it');
    }
    let spec;
    try {
      // Once, untracked: only a formula's value is reactive. Functions in the
      // spec close over the scope, so `() => v * t` reads v and t when it runs.
      spec = untracked(() => evalWith(scope, source, {}));
    } catch (error) {
      throw new Error(`t-formula-dag: the spec: ${error.message}`);
    }
    const model = formulaDag(spec);
    for (const p of model.params) {
      const { value, ...meta } = p.config;
      declareMeta(scope, p.name, meta, value);
    }
    for (const f of model.formulas) {
      if (f.value == null) continue;
      const def = scope.slot(f.name).def.peek();
      if (def !== undefined && !(def instanceof Formula)) {
        console.warn(`t-formula-dag: formula "${f.name}" replaces the variable of the same name`, this);
      }
      scope.define(f.name, f.value);
    }
    this._byName = new Map(model.formulas.map((f) => [f.name, f]));
    return model;
  }

  showError(error) {
    this._root?.remove();
    this._root = null;
    this._error ??= dagDiv("tangle-dag-error");
    this._error.textContent = error.message;
    this.append(this._error);
  }

  // ---- the edges, as data -------------------------------------------------

  /** [producer, consumer] pairs: which formula's output each formula uses. */
  get edges() {
    return (this._model?.edges ?? []).map((e) => [...e]);
  }
  /** The formulas `name` uses, directly or not. */
  upstream(name) {
    return [...dagReach(name, this.adjacency(1, 0))];
  }
  /** The formulas that use `name`, directly or not. */
  downstream(name) {
    return [...dagReach(name, this.adjacency(0, 1))];
  }
  adjacency(from, to) {
    const next = new Map();
    for (const e of this._model?.edges ?? []) {
      if (!next.has(e[from])) next.set(e[from], []);
      next.get(e[from]).push(e[to]);
    }
    return next;
  }

  // ---- building -------------------------------------------------------------

  start(katex) {
    const scope = this.scope;
    const model = this._model;
    this._katex = katex;
    this._cards = new Map(); // name -> { card, stage, tex, tints, noteArrows, labels, caption }
    this._lanes = new Map(); // waypoint -> lane element
    this._rows = [];
    this._rowOf = new Map();
    this._lastTex = new Map();
    this._edgeEls = [];
    this._blocks = {}; // card -> { top: [x], bottom: [x] }: where DAG arrows cross its label rows
    this._focused = null;
    this._noteHover = null;
    this._producers = new Set(model.edges.map(([src]) => src));
    // What Reset goes back to: the values once everything on the page has declared.
    this._initial = Object.fromEntries(model.params.map((p) => [p.name, scope.peek(p.name)]));

    const root = this._root;
    root.className = "tangle-dag";
    const board = (this._board = dagDiv("tangle-dag-board"));
    for (const layer of model.layers) {
      const row = dagDiv("tangle-dag-row");
      for (const id of layer) {
        this._rowOf.set(id, this._rows.length);
        if (this._byName.has(id)) {
          row.append(this.buildCard(this._byName.get(id)));
        } else {
          // An empty lane for an edge that skips this row.
          const lane = dagDiv("tangle-dag-lane");
          this._lanes.set(id, lane);
          row.append(lane);
        }
      }
      this._rows.push(row);
      board.append(row);
    }
    this._svg = svgNode("svg", { class: "tangle-dag-edges", "aria-hidden": "true" });
    board.append(this._svg);
    root.replaceChildren(board);
    const footer = this.buildFooter();
    if (footer) root.append(footer);

    for (const f of model.formulas) this.watch(() => this.renderCard(f, scope));
    this.watch(() => {
      hover.value, active.value;
      untracked(() => this.syncLinks(scope));
    });
    const name = this.getAttribute("name");
    if (name) {
      this.watch(() => {
        const picked = scope.get(name);
        for (const [id, { card }] of this._cards) card.classList.toggle("is-selected", id === picked);
      });
    }

    if (!this._listening) {
      this._listening = true;
      root.addEventListener("pointerover", (event) => this.noteHoverAt(event.target));
      root.addEventListener("focusin", (event) => this.noteHoverAt(event.target));
      root.addEventListener("pointerleave", () => this.setNoteHover(null));
    }
    this._resize = new ResizeObserver(() => this.relayoutSoon());
    this._resize.observe(root);
    document.fonts?.ready.then(() => {
      dagMetrics.clear();
      this.relayoutSoon();
    });
    this.relayout();
  }

  buildCard(f) {
    const card = dagDiv("tangle-dag-card");
    card.dataset.node = f.name;
    const stage = dagDiv("tangle-dag-stage");
    const tints = svgNode("svg", { class: "tangle-dag-tints", "aria-hidden": "true" });
    const tex = dagDiv("tangle-dag-tex");
    const noteArrows = svgNode("svg", { class: "tangle-dag-note-arrows", "aria-hidden": "true" });
    stage.append(tints, tex, noteArrows);
    const labels = new Map();
    for (const [name, note] of Object.entries(this._model.notes)) {
      if (note.formula !== f.name) continue;
      const label = dagDiv("tangle-dag-note");
      label.dataset.note = name;
      this.noteContent(label, note.text);
      stage.append(label);
      labels.set(name, label);
    }
    const caption = dagDiv("tangle-dag-caption");
    caption.textContent = f.label;
    card.append(stage, caption);
    card.addEventListener("mouseenter", () => this.focus(f.name));
    card.addEventListener("mouseleave", () => this.focus(null));
    const name = this.getAttribute("name");
    if (name) {
      card.classList.add("is-pickable");
      card.addEventListener("click", (event) => {
        if (event.target.closest(`${PARAM}, .tangle-dag-note`)) return;
        const scope = this.scope;
        scope.set(name, scope.peek(name) === f.name ? null : f.name);
      });
    }
    this._cards.set(f.name, { card, stage, tex, tints, noteArrows, labels, caption });
    return card;
  }

  /** Note text: plain, with **bold** and $math$. Built as DOM, never as HTML. */
  noteContent(el, text) {
    for (const part of noteParts(text)) {
      if (part.math !== undefined) {
        const span = document.createElement("span");
        this._katex.render(part.math, span, { throwOnError: false });
        el.append(span);
      } else if (part.bold !== undefined) {
        el.append(Object.assign(document.createElement("strong"), { textContent: part.bold }));
      } else {
        el.append(part.text);
      }
    }
  }

  /** The legend (one chip per number, then one per formula value) and Reset. */
  buildFooter() {
    const model = this._model;
    const scope = this.scope;
    const valued = model.formulas.filter((f) => f.value != null);
    const legend = model.legend && (model.params.length || valued.length);
    const reset = model.reset && model.params.length;
    if (!legend && !reset) return null;
    const footer = dagDiv("tangle-dag-footer");
    if (legend) {
      const strip = dagDiv("tangle-dag-legend");
      if (model.params.length) {
        const row = dagDiv("tangle-dag-legend-row");
        for (const p of model.params) {
          const chip = dagDiv("tangle-dag-chip");
          const symbol = dagDiv("tangle-dag-chip-symbol");
          this._katex.render(p.symbol, symbol, { throwOnError: false });
          const label = dagDiv("tangle-dag-chip-label");
          const value = dagDiv("tangle-dag-chip-value");
          chip.append(symbol, label, value);
          this.makeDraggable(p.name, chip);
          this.watch(() => {
            const meta = scope.meta(p.name);
            label.textContent = meta.label ?? "";
            value.textContent = formatValue(scope.get(p.name), meta.format, meta.step);
          });
          row.append(chip);
        }
        strip.append(row);
      }
      if (valued.length) {
        const row = dagDiv("tangle-dag-legend-row");
        for (const f of valued) {
          const chip = dagDiv("tangle-dag-chip is-output");
          chip.dataset.tangleHover = keyOf(scope, f.name);
          const symbol = dagDiv("tangle-dag-chip-symbol");
          this._katex.render(f.symbol, symbol, { throwOnError: false });
          if (f.color) symbol.style.setProperty("--tangle-dag-c", f.color);
          chip.append(symbol);
          if (f.label !== f.name) {
            const label = dagDiv("tangle-dag-chip-label");
            label.textContent = f.label;
            chip.append(label);
          }
          const value = dagDiv("tangle-dag-chip-value");
          chip.append(value);
          this.watch(() => {
            try {
              value.textContent = formatValue(scope.get(f.name), f.format);
              chip.classList.remove("is-error");
              chip.title = "";
            } catch (error) {
              value.textContent = "⚠";
              chip.classList.add("is-error");
              chip.title = error?.message ?? String(error);
            }
          });
          row.append(chip);
        }
        strip.append(row);
      }
      footer.append(strip);
    }
    if (reset) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tangle-dag-reset";
      button.textContent = "Reset";
      button.addEventListener("click", () => scope.setValues(this._initial));
      this.watch(() => {
        const changed = model.params.some((p) => !Object.is(scope.get(p.name), this._initial[p.name]));
        button.classList.toggle("is-changed", changed);
      });
      footer.append(button);
    }
    return footer;
  }

  // ---- rendering a card -----------------------------------------------------

  /** The name of the variable being dragged or edited, if it's in this scope. */
  activeName(scope) {
    const key = active.value;
    const prefix = `${scope.id}:`;
    return key && key.startsWith(prefix) ? key.slice(prefix.length) : null;
  }

  /** A formula shows its value instead of its symbol while a variable it reads is changing. */
  revealed(name, scope) {
    const f = this._byName.get(name);
    const changing = this.activeName(scope);
    if (f.value == null || !changing) return false;
    return untracked(() => {
      try {
        scope.get(name); // so its dependencies are known
      } catch {}
      return variablesRead(scope, name).has(changing);
    });
  }

  valueTex(name, scope) {
    try {
      return toTex(scope.get(name), this._byName.get(name).format);
    } catch {
      return "\\text{?}";
    }
  }

  renderCard(f, scope) {
    const tex = cardTex(f, {
      symbol: (n) => this._byName.get(n).symbol,
      revealed: (n) => this.revealed(n, scope),
      valueTex: (n) => this.valueTex(n, scope),
      markers: (parts, text) => partsTex(parts, scope, text),
    });
    untracked(() => {
      if (this._lastTex.get(f.name) === tex) return;
      this._lastTex.set(f.name, tex);
      const { tex: target } = this._cards.get(f.name);
      // Remember which number had keyboard focus; rendering replaces it.
      const focused = document.activeElement;
      const refocus = target.contains(focused) && focused.matches(PARAM) ? occurrence(focused) : null;
      try {
        this._katex.render(tex, target, DAG_KATEX);
        target.classList.remove("is-error");
        target.title = "";
      } catch (error) {
        target.textContent = f.tex;
        target.classList.add("is-error");
        target.title = error.message;
        console.error(`t-formula-dag: formula "${f.name}": ${error.message}`, this);
      }
      this.decorateCard(f, target, scope);
      if (refocus) relocate(refocus, focused.dataset.tangleParam)?.focus({ preventScroll: true });
      this.relayoutSoon();
    });
  }

  /** Color and wire up the markers in a freshly rendered card. */
  decorateCard(f, target, scope) {
    const html = target.querySelector(".katex-html");
    if (!html) return;
    const out = html.querySelector("[data-fdag-out]");
    if (out) {
      out.dataset.tangleHover = keyOf(scope, f.name);
      if (f.color) out.style.setProperty("--tangle-dag-c", f.color);
    }
    for (const use of html.querySelectorAll("[data-fdag-use]")) {
      const producer = this._byName.get(use.dataset.fdagUse);
      use.dataset.tangleHover = keyOf(scope, producer.name);
      if (producer.color) use.style.setProperty("--tangle-dag-c", producer.color);
    }
    for (const el of html.querySelectorAll(PARAM)) {
      decorate(el, scope, el.dataset.tangleParam);
      syncClasses(el, scope, el.dataset.tangleParam);
    }
    for (const term of html.querySelectorAll("[data-note]")) {
      const note = this._model.notes[term.dataset.note];
      term.classList.add("tangle-dag-term");
      term.tabIndex = 0;
      term.setAttribute("aria-label", note.text);
    }
    this.colorNotes(scope);
    this.syncLinks(scope);
    this.spaceNumbersAfterDigits(html);
  }

  /** A note takes its own color, else the color of the number it wraps, else the note gray. */
  noteColor(note, scope) {
    if (note.color) return note.color;
    if (note.param) return scope.meta(note.param).color ?? "currentColor";
    return "var(--tangle-dag-note)";
  }

  colorNotes(scope) {
    for (const el of this._root.querySelectorAll("[data-note]")) {
      const note = this._model.notes[el.dataset.note];
      if (note) el.style.setProperty("--tangle-dag-c", this.noteColor(note, scope));
    }
  }

  // A number shown right after a digit reads as one number (2σ with σ = 1.7
  // shows as "21.7"): give such a number a small gap.
  spaceNumbersAfterDigits(html) {
    const walker = document.createTreeWalker(html, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    let previous = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent.trim();
      if (!text) continue;
      const marker = node.parentElement.closest("[data-tangle-param], [data-fdag-use], [data-fdag-out]");
      if (marker && !seen.has(marker)) {
        seen.add(marker);
        marker.classList.toggle("tangle-dag-gap", /[0-9.]$/.test(previous) && /^[0-9.]/.test(text));
      }
      previous = text;
    }
  }

  /** Light up what's under the pointer everywhere it shows: a number, or a formula's output. */
  syncLinks(scope) {
    if (!this._root) return;
    const key = hover.peek();
    for (const el of this._root.querySelectorAll(".katex-html [data-tangle-param]")) {
      syncClasses(el, scope, el.dataset.tangleParam);
    }
    for (const el of this._root.querySelectorAll("[data-tangle-hover]")) {
      el.classList.toggle("is-hot", key === el.dataset.tangleHover);
    }
    this.applyNoteHover();
  }

  // ---- notes --------------------------------------------------------------

  /** The note that explains a number: the one wrapping exactly that \tangle. */
  noteForParam(param) {
    return Object.entries(this._model.notes).find(([, note]) => note.param === param)?.[0] ?? null;
  }

  noteHoverAt(target) {
    const label = target.closest?.(".tangle-dag-note");
    if (label) return this.setNoteHover(label.dataset.note);
    const param = target.closest?.(PARAM);
    const paramNote = param ? this.noteForParam(param.dataset.tangleParam) : null;
    if (paramNote) return this.setNoteHover(paramNote);
    this.setNoteHover(target.closest?.(".katex-html [data-note]")?.dataset.note ?? null);
  }

  setNoteHover(name) {
    this._noteHover = name;
    this.applyNoteHover();
  }

  /** The highlighted note (a dragged number's beats the hovered one) lifts; the others fade. */
  applyNoteHover() {
    if (!this._board) return;
    const changing = untracked(() => this.activeName(this.scope));
    const name = (changing && this.noteForParam(changing)) || this._noteHover;
    const on = Boolean(name) && name in this._model.notes;
    this._root.classList.toggle("has-note-hover", on);
    for (const el of this._board.querySelectorAll("[data-note]")) {
      el.classList.toggle("is-hovered", on && el.dataset.note === name);
    }
  }

  /** Lay out the notes of card `id` around the arrow columns in this._blocks. */
  layoutNotes(id) {
    const { stage, tex, tints, noteArrows, labels } = this._cards.get(id);
    tints.replaceChildren();
    noteArrows.replaceChildren();
    stage.style.padding = "";
    if (!labels.size) return;
    const notes = this._model.notes;
    const scope = this.scope;
    const blocks = this._blocks[id] ?? { top: [], bottom: [] };

    const base = () => stage.getBoundingClientRect();
    const rel = (r, b = base()) => ({
      left: r.left - b.left,
      right: r.right - b.left,
      top: r.top - b.top,
      bottom: r.bottom - b.top,
      cx: r.left - b.left + (r.right - r.left) / 2,
      cy: r.top - b.top + (r.bottom - r.top) / 2,
    });
    const html = tex.querySelector(".katex-html");
    const termOf = (name) => html?.querySelector(`[data-note="${name}"]`);
    const termBox = (term) => rel(rectUnion(glyphLeaves(term).map(inkRect)) ?? term.getBoundingClientRect());

    // 1. A side per note: parts above the formula's middle go up, parts below
    //    go down, and a note on the output symbol goes left (arrows come in
    //    above it and leave below it). The rest take the side fewer arrows
    //    cross, then balance.
    const texBox = rel(tex.getBoundingClientRect());
    // The formula's own width: the tex box stretches with the card.
    const ink = html && rectUnion(glyphLeaves(html).map(inkRect));
    const formulaW = ink ? rel(ink).right - texBox.left : texBox.right - texBox.left;
    const out = html?.querySelector("[data-fdag-out]");
    const items = [];
    const counts = { top: 0, bottom: 0 };
    const undecided = [];
    for (const [name, label] of labels) {
      const term = termOf(name);
      // A live value can stand in for a noted part: hide its note meanwhile.
      label.style.display = term ? "" : "none";
      if (!term) continue;
      label.style.setProperty("--tangle-dag-c", this.noteColor(notes[name], scope));
      const box = termBox(term);
      const item = {
        name,
        side: notes[name].side,
        label,
        cx: box.cx - texBox.left,
        leftRel: box.left - texBox.left,
        cyRel: box.cy - texBox.top,
      };
      if (item.side === "auto" && out?.contains(term)) item.side = "left";
      label.classList.toggle("is-left", item.side === "left");
      item.w = label.offsetWidth;
      item.h = label.offsetHeight;
      items.push(item);
      if (item.side === "auto") {
        const offset = box.cy - texBox.cy;
        if (offset < -4) item.side = "top";
        else if (offset > 4) item.side = "bottom";
        else undecided.push(item);
      }
      if (item.side === "top" || item.side === "bottom") counts[item.side]++;
    }
    const crossing = (item, side) =>
      blocks[side].filter(
        (x) => x > item.cx - item.w / 2 - DAG_LANE_CLEARANCE && x < item.cx + item.w / 2 + DAG_LANE_CLEARANCE,
      ).length;
    for (const item of undecided) {
      const top = crossing(item, "top");
      const bottom = crossing(item, "bottom");
      item.side = top !== bottom ? (top < bottom ? "top" : "bottom") : counts.top <= counts.bottom ? "top" : "bottom";
      counts[item.side]++;
    }

    // 2. One row of labels per side, clear of the DAG arrows passing through
    //    it (x relative to the formula's left edge).
    const heights = {};
    let minX = 0;
    let maxX = formulaW;
    for (const side of ["top", "bottom"]) {
      const row = items.filter((item) => item.side === side).sort((a, b) => a.cx - b.cx);
      const sideBlocks = blocks[side].map((x) => ({ left: x - DAG_LANE_CLEARANCE, right: x + DAG_LANE_CLEARANCE }));
      packRow(row, sideBlocks, DAG_NOTE_GAP);
      heights[side] = row.length ? Math.max(...row.map((item) => item.h)) : 0;
      for (const item of row) {
        minX = Math.min(minX, item.x);
        maxX = Math.max(maxX, item.x + item.w);
      }
    }
    // Left-hand labels stack, centered on their terms' height.
    const lefts = items.filter((item) => item.side === "left");
    let needTop = 0;
    let needBottom = 0;
    if (lefts.length) {
      const stack = lefts.reduce((sum, item) => sum + item.h, 0) + (DAG_NOTE_GAP / 2) * (lefts.length - 1);
      const cy = lefts.reduce((sum, item) => sum + item.cyRel, 0) / lefts.length;
      const edge = Math.min(...lefts.map((item) => item.leftRel)) - DAG_NOTE_SIDE_SPACE;
      let y = cy - stack / 2;
      for (const item of lefts) {
        item.x = edge - item.w;
        item.yRel = y;
        y += item.h + DAG_NOTE_GAP / 2;
        minX = Math.min(minX, item.x);
      }
      const texH = texBox.bottom - texBox.top;
      needTop = Math.max(0, -(cy - stack / 2)) + (cy - stack / 2 < 0 ? DAG_NOTE_PAD_Y : 0);
      needBottom = Math.max(0, cy + stack / 2 - texH) + (cy + stack / 2 > texH ? DAG_NOTE_PAD_Y : 0);
    }
    const band = (side) => (heights[side] ? DAG_NOTE_ARROW_SPACE + heights[side] + DAG_NOTE_PAD_Y : 0);
    // Labels wider than the formula widen the card instead of spilling out.
    stage.style.paddingTop = `${Math.max(band("top"), needTop)}px`;
    stage.style.paddingBottom = `${Math.max(band("bottom"), needBottom)}px`;
    stage.style.paddingLeft = `${-minX}px`;
    stage.style.paddingRight = `${maxX - formulaW}px`;

    // 3. The padding moved the formula: measure again and place the labels.
    const formula = rel(tex.getBoundingClientRect());
    for (const item of items) {
      const top =
        item.side === "left"
          ? formula.top + item.yRel
          : item.side === "top"
            ? formula.top - DAG_NOTE_ARROW_SPACE - item.h
            : formula.bottom + DAG_NOTE_ARROW_SPACE;
      item.label.style.left = `${formula.left + item.x}px`;
      item.label.style.top = `${top}px`;
    }

    // 4. A soft tint behind every noted part.
    for (const node of html?.querySelectorAll("[data-note]") ?? []) {
      const note = notes[node.dataset.note];
      if (!note) continue;
      const box = termBox(node);
      const rect = svgNode("rect", {
        class: "tangle-dag-tint",
        x: box.left - 3,
        y: box.top - 3,
        width: box.right - box.left + 6,
        height: box.bottom - box.top + 6,
        rx: 4,
      });
      rect.dataset.note = node.dataset.note;
      rect.style.setProperty("--tangle-dag-c", this.noteColor(note, scope));
      tints.append(rect);
    }

    // 5. A gentle curve from each label to its term, with an open chevron, so
    //    notes read differently from the DAG's filled arrows.
    for (const item of items) {
      const term = termBox(termOf(item.name));
      const label = rel(item.label.getBoundingClientRect());
      let paths;
      if (item.side === "left") {
        const from = { x: label.right + DAG_NOTE_CLEARANCE, y: (label.top + label.bottom) / 2 };
        const to = { x: term.left - DAG_NOTE_CLEARANCE - 2, y: term.cy };
        const midX = (from.x + to.x) / 2;
        const backX = to.x - DAG_NOTE_HEAD_LEN;
        paths = [
          `M ${from.x} ${from.y} C ${midX} ${from.y} ${midX} ${to.y} ${to.x} ${to.y}`,
          `M ${backX} ${to.y - DAG_NOTE_HEAD_HALF} L ${to.x} ${to.y} L ${backX} ${to.y + DAG_NOTE_HEAD_HALF}`,
        ];
      } else {
        const top = item.side === "top";
        const fromX = Math.max(label.left + 8, Math.min(term.cx, label.right - 8));
        const from = { x: fromX, y: top ? label.bottom + DAG_NOTE_CLEARANCE : label.top - DAG_NOTE_CLEARANCE };
        const to = { x: term.cx, y: top ? term.top - DAG_NOTE_CLEARANCE - 3 : term.bottom + DAG_NOTE_CLEARANCE + 3 };
        const midY = (from.y + to.y) / 2;
        const backY = to.y - (Math.sign(to.y - from.y) || 1) * DAG_NOTE_HEAD_LEN;
        paths = [
          `M ${from.x} ${from.y} C ${from.x} ${midY} ${to.x} ${midY} ${to.x} ${to.y}`,
          `M ${to.x - DAG_NOTE_HEAD_HALF} ${backY} L ${to.x} ${to.y} L ${to.x + DAG_NOTE_HEAD_HALF} ${backY}`,
        ];
      }
      const group = svgNode("g", { class: "tangle-dag-note-arrow" });
      group.dataset.note = item.name;
      group.style.setProperty("--tangle-dag-c", this.noteColor(notes[item.name], scope));
      for (const d of paths) group.append(svgNode("path", { d }));
      noteArrows.append(group);
    }
  }

  // ---- layout -----------------------------------------------------------------

  // Notes move formulas and arrows move notes: lay the notes out around the
  // last known arrow columns, draw the arrows, and again if the columns moved.
  relayout() {
    if (!this._board || !this.isConnected) return;
    const before = JSON.stringify(this._blocks);
    for (const id of this._cards.keys()) this.layoutNotes(id);
    this.draw();
    if (JSON.stringify(this._blocks) !== before) {
      for (const id of this._cards.keys()) this.layoutNotes(id);
      this.draw();
    }
    this.applyNoteHover();
  }

  relayoutSoon() {
    if (this._relayoutQueued) return;
    this._relayoutQueued = true;
    requestAnimationFrame(() => {
      this._relayoutQueued = false;
      this.relayout();
    });
  }

  draw() {
    const svg = this._svg;
    svg.replaceChildren();
    this._edgeEls = [];
    const base = this._board.getBoundingClientRect();
    const rel = (r) => ({ left: r.left - base.left, right: r.right - base.left, top: r.top - base.top, bottom: r.bottom - base.top });
    const box = (node) => rel(node.getBoundingClientRect());
    const cards = this._cards;
    const producers = this._producers;
    const rowBoxes = this._rows.map(box);
    const htmlOf = (id) => cards.get(id).tex.querySelector(".katex-html");

    // Per card: the ink box of every glyph, and of the formula as a whole.
    const glyphs = new Map();
    const formulaInk = new Map();
    const texLeft = new Map();
    for (const [id, parts] of cards) {
      const html = htmlOf(id);
      const g = html ? glyphLeaves(html).map((el) => ({ el, ...rel(inkRect(el)) })) : [];
      glyphs.set(id, g);
      formulaInk.set(id, rectUnion(g) ?? box(parts.card));
      texLeft.set(id, box(parts.tex).left);
    }
    const inkOf = (id, node) => rectUnion(glyphs.get(id).filter((g) => node.contains(g.el))) ?? box(node);

    // A formula's outgoing arrows share one stem, dropping from under its output symbol.
    const stems = new Map();
    for (const id of cards.keys()) {
      const out = htmlOf(id)?.querySelector("[data-fdag-out]");
      const sym = out ? inkOf(id, out) : formulaInk.get(id);
      stems.set(id, { x: (sym.left + sym.right) / 2, top: sym.bottom + DAG_LAND_GAP, width: sym.right - sym.left });
    }
    // A caption sits right of its formula's stem, never across it.
    for (const id of producers) {
      const { card, caption } = cards.get(id);
      const pad = parseFloat(getComputedStyle(card).paddingLeft) || 0;
      const margin = `${Math.max(0, Math.round(stems.get(id).x - box(card).left - pad + 8))}px`;
      if (caption.style.marginLeft !== margin) caption.style.marginLeft = margin;
    }
    const blocks = {};
    const block = (id, side, x) => (blocks[id] ??= { top: [], bottom: [] })[side].push(Math.round(x - texLeft.get(id)));
    for (const id of producers) block(id, "bottom", stems.get(id).x);

    // 1. Every arrow's columns: the x it holds in each row it passes.
    const arrows = [];
    for (const route of this._model.routes) {
      const src = route[0];
      const dst = route[route.length - 1];
      const ink = formulaInk.get(dst);
      const uses = [...(htmlOf(dst)?.querySelectorAll(`[data-fdag-use="${src}"]`) ?? [])];
      for (const use of uses.length ? uses : [null]) {
        let landing;
        if (!use) {
          // The use is hidden (a live value stands in): land on the formula.
          const x = (ink.left + ink.right) / 2;
          landing = { side: "top", x, tip: { x, y: ink.top - DAG_LAND_GAP } };
        } else {
          const sym = inkOf(dst, use);
          const cx = (sym.left + sym.right) / 2;
          const cy = (sym.top + sym.bottom) / 2;
          // Keep clear of the target's other glyphs and of its own stem.
          const others = glyphs.get(dst).filter((g) => !use.contains(g.el));
          if (producers.has(dst)) {
            const st = stems.get(dst);
            others.push({ left: st.x - st.width / 2, right: st.x + st.width / 2, top: st.top, bottom: box(cards.get(dst).card).bottom });
          }
          const side = landingSide(sym, others, stems.get(src).x, DAG_SIDE_PAD);
          if (side === "top") landing = { side, x: cx, tip: { x: cx, y: sym.top - DAG_LAND_GAP } };
          else if (side === "right") landing = { side, x: ink.right + DAG_SIDE_GAP, tip: { x: sym.right + DAG_LAND_GAP, y: cy } };
          else landing = { side, x: ink.left - DAG_SIDE_GAP, tip: { x: sym.left - DAG_LAND_GAP, y: cy } };
        }
        block(dst, "top", landing.x);
        // A long edge threads one lane per row it skips. Lanes sit at
        // different x in each row: straighten them into one vertical line
        // when that line clears every formula in those rows.
        const waypoints = route.slice(1, -1);
        let laneXs = waypoints.map((wp) => {
          const lane = box(this._lanes.get(wp));
          return (lane.left + lane.right) / 2;
        });
        if (laneXs.length > 1) {
          const passed = waypoints
            .flatMap((wp) => [...this._rows[this._rowOf.get(wp)].children])
            .filter((n) => n.classList.contains("tangle-dag-card"))
            .map(box);
          const clear = (x) => passed.every((b) => x < b.left - 6 || x > b.right + 6);
          const straight = [Math.max(...laneXs), Math.min(...laneXs)].find(clear);
          if (straight !== undefined) laneXs = laneXs.map(() => straight);
        }
        arrows.push({ src, dst, row: this._rowOf.get(src), xs: [stems.get(src).x, ...laneXs, landing.x], landing });
      }
    }
    this._blocks = blocks;

    // 2. Each gap between two rows gets one horizontal track per producer that
    //    jogs sideways there, shared by its arrows. Stack them with the fewest crossings.
    const segs = new Map(); // gap -> Map(src -> [{ from, to }])
    for (const a of arrows) {
      a.xs.forEach((x, k) => {
        if (k === a.xs.length - 1 || Math.abs(a.xs[k + 1] - x) < 1) return;
        const gap = a.row + k;
        if (!segs.has(gap)) segs.set(gap, new Map());
        const bySrc = segs.get(gap);
        if (!bySrc.has(a.src)) bySrc.set(a.src, []);
        bySrc.get(a.src).push({ from: x, to: a.xs[k + 1] });
      });
    }
    const tracks = new Map();
    for (const [gap, bySrc] of segs) {
      const seed = [...bySrc.keys()].sort((p, q) => stems.get(p).x - stems.get(q).x);
      tracks.set(gap, trackOrder(seed, bySrc));
    }
    const trackY = (gap, src) => {
      const top = rowBoxes[gap].bottom;
      const list = tracks.get(gap);
      return top + ((rowBoxes[gap + 1].top - top) * (list.indexOf(src) + 1)) / (list.length + 1);
    };

    // 3. Draw: down, a rounded jog along the track, down again; then into the
    //    symbol from above or, when something covers it, from the side.
    for (const a of arrows) {
      const { tip, side } = a.landing;
      let d = `M ${a.xs[0]} ${stems.get(a.src).top}`;
      a.xs.forEach((x, k) => {
        if (k === a.xs.length - 1) return;
        const next = a.xs[k + 1];
        if (Math.abs(next - x) < 1) return;
        const ty = trackY(a.row + k, a.src);
        const s = Math.sign(next - x);
        const r = Math.min(DAG_CORNER, Math.abs(next - x) / 2);
        d += ` L ${x} ${ty - r} Q ${x} ${ty}, ${x + s * r} ${ty}`;
        d += ` L ${next - s * r} ${ty} Q ${next} ${ty}, ${next} ${ty + r}`;
      });
      const last = a.xs[a.xs.length - 1];
      let dir = { x: 0, y: 1 };
      if (side !== "top") {
        const s = side === "right" ? -1 : 1; // the direction of travel into the symbol
        d += ` L ${last} ${tip.y - DAG_CORNER} Q ${last} ${tip.y}, ${last + s * DAG_CORNER} ${tip.y}`;
        dir = { x: s, y: 0 };
      }
      // Stop the line at the arrowhead's base so it doesn't poke through.
      d += ` L ${tip.x - dir.x * DAG_HEAD_LEN * 0.8} ${tip.y - dir.y * DAG_HEAD_LEN * 0.8}`;
      const bx = tip.x - dir.x * DAG_HEAD_LEN;
      const by = tip.y - dir.y * DAG_HEAD_LEN;
      const head =
        `M ${tip.x} ${tip.y} L ${bx - dir.y * DAG_HEAD_HALF} ${by + dir.x * DAG_HEAD_HALF} ` +
        `L ${bx + dir.y * DAG_HEAD_HALF} ${by - dir.x * DAG_HEAD_HALF} Z`;
      const color = this._byName.get(a.src).color;
      const els = [svgNode("path", { d, class: "tangle-dag-edge" }), svgNode("path", { d: head, class: "tangle-dag-head" })];
      for (const el of els) el.style.setProperty("--tangle-dag-c", color);
      svg.append(...els);
      this._edgeEls.push({ src: a.src, dst: a.dst, els });
    }
    this.focus(this._focused);
  }

  // ---- hover --------------------------------------------------------------

  /** Hovering a card keeps it, everything upstream and everything downstream; the rest dims. */
  focus(name) {
    this._focused = name;
    const dim = (el, on) => el.classList.toggle("is-dim", on);
    if (!name) {
      for (const { card } of this._cards.values()) dim(card, false);
      for (const e of this._edgeEls) e.els.forEach((el) => dim(el, false));
      return;
    }
    const ups = dagReach(name, this.adjacency(1, 0)).add(name);
    const downs = dagReach(name, this.adjacency(0, 1)).add(name);
    for (const [id, { card }] of this._cards) dim(card, !ups.has(id) && !downs.has(id));
    for (const e of this._edgeEls) {
      const keep = (ups.has(e.src) && ups.has(e.dst)) || (downs.has(e.src) && downs.has(e.dst));
      e.els.forEach((el) => dim(el, !keep));
    }
  }
}
