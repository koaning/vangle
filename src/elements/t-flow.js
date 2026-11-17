import { untracked, effect, watchers, graphVersion } from "../core/signals.js";
import { Formula, scopeOf, evalWith } from "../core/scope.js";
import { loadKatex } from "../core/load.js";
import { TangleElement } from "../core/element.js";
import { noteParts } from "../core/formulas.js";
import { dagReach, DAG_WAYPOINT } from "../core/dag.js";
import {
  flowSpec, flowInfer, flowReduce, flowEdges, flowGraph, flowPlace, flowPortPoint, flowOrthoRoute,
  flowRounded, flowHead, flowAlong, flowSlots, flowTracks, flowHits, flowMid, flowPad, flowOverlaps,
  FLOW_FLIP, FLOW_CORNER, FLOW_HEAD_LEN,
} from "../core/flow.js";
import { svgNode } from "./t-debug.js";

// ---------------------------------------------------------------------------
// <t-flow>: live elements laid out as a DAG. Each child is a node; an arrow
// runs from one node to another when the second reads a variable the first
// defines. A spec in a <script type="text/plain"> adds, restyles or drops
// arrows, and places, labels, annotates and folds the nodes.
// ---------------------------------------------------------------------------

// Children that aren't nodes: they show nothing (t-var, t-let and t-fetch
// still define variables, which the arrows look through).
const FLOW_SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "LINK", "META", "T-VAR", "T-LET", "T-FETCH"]);
const FLOW_PADDING = { across: 24, along: 14 }; // around the board, in frame terms
const FLOW_GAP = 3; // between an arrow tip and the node it points at
const FLOW_SHIFT = { after: "0", before: "-100%", center: "-50%" };
const FLOW_CHEVRON = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 3.75 L5 6.25 L7.5 3.75"/></svg>';
const flowDiv = (className, text) => {
  const el = Object.assign(document.createElement("div"), { className });
  if (text != null) el.textContent = text;
  return el;
};
const flowCalm = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The variables the elements in `root` define in `scope`, in document order. */
function flowNamesIn(root, scope) {
  const out = [];
  const add = (name) => name && !out.includes(name) && out.push(name);
  for (const el of [root, ...root.querySelectorAll("*")]) {
    const tag = el.localName;
    if (!tag.startsWith("t-") || tag === "t-out" || tag === "t-tag" || scopeOf(el) !== scope) continue;
    add(el.getAttribute("name"));
    if (tag === "t-fetch" || tag === "t-codecell") {
      add(el.getAttribute("error"));
      add(el.getAttribute("loading"));
    }
    if (tag === "t-formula-dag") {
      for (const f of el._model?.formulas ?? []) if (f.value != null) add(f.name);
      for (const p of el._model?.params ?? []) add(p.name);
    }
  }
  return out;
}

// <t-flow>
//   <p>Angle <t-num name="angle" min="5" max="85">35</t-num>°</p>
//   <t-codecell name="path">…reads angle…</t-codecell>
//   <t-obsplot>…reads path…</t-obsplot>
//   <script type="text/plain">{ nodes: { path: { label: "simulate" } } }</script>
// </t-flow>
export class TFlow extends TangleElement {
  connectedCallback() {
    // The children have to be there: wait for them if the page is still loading.
    if (document.readyState === "loading" && this._model === undefined) {
      document.addEventListener("DOMContentLoaded", () => this.isConnected && this.connectedCallback(), { once: true });
      return;
    }
    if (this._model === undefined) {
      try {
        this.build();
      } catch (error) {
        this._model = null;
        this.showError(error);
      }
    }
    if (!this._model) return;
    this._valueFx = new Map();
    this._resize = new ResizeObserver(() => this.schedule("layout"));
    for (const item of this._items.values()) this._resize.observe(item);
    this._stopGraph = effect(() => {
      graphVersion.value;
      untracked(() => this.schedule("graph"));
    });
    this.schedule("graph");
  }

  disconnectedCallback() {
    this._resize?.disconnect();
    this._stopGraph?.();
    for (const stop of this._valueFx?.values() ?? []) stop();
    this._valueFx?.clear();
    cancelAnimationFrame(this._frame);
    this._frame = null;
    super.disconnectedCallback();
  }

  showError(error) {
    this._error ??= flowDiv("tangle-flow-error");
    this._error.textContent = error.message;
    if (!this._error.isConnected) this.prepend(this._error);
  }

  // ---- the arrows, as data --------------------------------------------------

  /** [from, to] pairs: the arrows drawn, by node id. */
  get edges() {
    return (this._edges ?? []).map((e) => [e.src, e.dst]);
  }
  /** The nodes that feed `id`, directly or not. */
  upstream(id) {
    return [...dagReach(id, this.adjacency("dst", "src"))];
  }
  /** The nodes `id` feeds, directly or not. */
  downstream(id) {
    return [...dagReach(id, this.adjacency("src", "dst"))];
  }
  adjacency(from, to) {
    const next = new Map();
    for (const e of this._edges ?? []) {
      if (!next.has(e[from])) next.set(e[from], []);
      next.get(e[from]).push(e[to]);
    }
    return next;
  }

  // ---- building -------------------------------------------------------------

  /** Read the spec, then wrap each child in an absolutely placed item. Runs once. */
  build() {
    const scope = this.scope;
    const kids = [...this.children].filter((el) => !FLOW_SKIP.has(el.tagName) && !el.classList.contains("tangle-flow-error"));
    const ids = kids.map((el, i) => {
      if (el.id) return el.id;
      const names = flowNamesIn(el, scope);
      return names.length === 1 ? names[0] : `n${i}`;
    });
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) throw new Error(`t-flow: two nodes are both "${dup}"; give one of them an id="…"`);
    const source = this.querySelector(':scope > script[type="text/plain"]')?.textContent ?? "";
    let spec = {};
    if (source.trim()) {
      try {
        spec = untracked(() => evalWith(scope, source, {}));
      } catch (error) {
        throw new Error(`t-flow: the spec: ${error.message}`);
      }
    }
    const model = flowSpec(spec, ids);
    this._ids = ids;
    this._edges = [];
    this._defines = new Map();
    this._folded = new Set([
      ...ids.filter((id) => model.nodes.get(id).fold === "closed"),
      ...model.groups.filter((g) => g.collapsed).map((g) => g.id),
    ]);

    const T = model.direction === "right";
    const root = flowDiv("tangle-flow");
    root.dataset.direction = model.direction;
    const board = flowDiv("tangle-flow-board");
    const svg = svgNode("svg", { class: "tangle-flow-svg", "aria-hidden": "true" });
    const frame = svgNode("g", T ? { transform: "matrix(0 1 1 0 0 0)" } : {});
    this._frames = svgNode("g", {});
    this._canvas = svgNode("g", {});
    frame.append(this._frames, this._canvas);
    svg.append(frame);
    board.append(svg);

    this._items = new Map();
    this._nodes = new Map();
    this._bodies = new Map();
    this._notes = new Map();
    this._folds = new Map();
    if (kids.length) kids[0].before(root);
    else this.append(root);
    kids.forEach((el, i) => {
      const id = ids[i];
      const opts = model.nodes.get(id);
      const body = flowDiv("tangle-flow-body");
      if (opts.width) body.style.width = opts.width;
      body.append(el);
      const node = flowDiv("tangle-flow-node");
      node.append(body);
      if (opts.label) node.append(flowDiv("tangle-flow-caption", opts.label));
      if (opts.fold) {
        // Folded, a node shows only its caption: the id stands in when it has none.
        if (!opts.label) node.append(flowDiv("tangle-flow-caption tangle-flow-fold-label", id));
        node.append(this.foldButton(id, opts.label ?? id));
      }
      const item = flowDiv("tangle-flow-item");
      item.dataset.flowNode = id;
      item.append(node);
      if (opts.note) {
        const note = flowDiv("tangle-flow-note");
        this.noteContent(note, opts.note);
        item.append(note);
        this._notes.set(id, note);
      }
      board.append(item);
      this._items.set(id, item);
      this._nodes.set(id, node);
      this._bodies.set(id, body);
    });

    // A group folds into a pill that waits, hidden, until it's needed; open, it has a tab.
    this._tabs = new Map();
    const tabs = flowDiv("tangle-flow-tabs");
    for (const g of model.groups) {
      const node = flowDiv("tangle-flow-node is-folded is-pill");
      node.append(flowDiv("tangle-flow-caption", g.label), this.foldButton(g.id, g.label));
      const item = flowDiv("tangle-flow-item");
      item.dataset.flowNode = g.id;
      item.append(node);
      board.append(item);
      this._items.set(g.id, item);
      this._nodes.set(g.id, node);
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "tangle-flow-tab";
      tab.innerHTML = FLOW_CHEVRON;
      tab.append(g.label);
      tab.setAttribute("aria-label", `Hide ${g.label}`);
      tab.addEventListener("click", () => this.toggle(g.id));
      tabs.append(tab);
      this._tabs.set(g.id, tab);
    }
    this._labels = flowDiv("tangle-flow-labels");
    board.append(this._labels, tabs);
    root.append(board);
    this._root = root;
    this._board = board;
    this._model = model;
    this.applyFolds();
  }

  foldButton(id, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tangle-flow-fold";
    button.innerHTML = FLOW_CHEVRON;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggle(id);
    });
    this._folds.set(id, { button, label });
    return button;
  }

  /** Note text: plain, with **bold** and $math$ (KaTeX loads only for notes that have some). */
  noteContent(el, text) {
    for (const part of noteParts(text)) {
      if (part.math !== undefined) {
        const span = document.createElement("span");
        span.textContent = part.math;
        el.append(span);
        loadKatex().then((katex) => {
          katex.render(part.math, span, { throwOnError: false });
          this.schedule("layout");
        }, () => {});
      } else if (part.bold !== undefined) {
        el.append(Object.assign(document.createElement("strong"), { textContent: part.bold }));
      } else {
        el.append(part.text);
      }
    }
  }

  // ---- what reads what ------------------------------------------------------

  /** The id of the node `el` sits in (in this flow, not one nested in it). */
  nodeOf(el) {
    let item = el.closest?.(".tangle-flow-item");
    while (item && item.parentElement !== this._board) item = item.parentElement?.closest(".tangle-flow-item");
    return item?.dataset.flowNode;
  }

  /** Work out the arrows from what each node reads and defines right now; lay out again if they changed. */
  updateGraph() {
    const scope = this.scope;
    const nodes = untracked(() => {
      const names = new Map(); // a variable's def signal and cell -> its name
      for (const [name, slot] of scope.slots) {
        names.set(slot.def, name);
        names.set(slot.cell, name);
      }
      const formulaReads = new Map();
      for (const [name, slot] of scope.slots) {
        if (!(slot.def.peek() instanceof Formula)) continue;
        formulaReads.set(name, [...slot.cell.deps].map((d) => names.get(d)).filter((n) => n !== undefined && n !== name));
      }
      const reads = new Map(this._ids.map((id) => [id, new Set()]));
      for (const el of watchers) {
        const id = this.nodeOf(el);
        if (!reads.has(id)) continue;
        for (const e of el._effects ?? []) {
          for (const d of e.deps) if (names.has(d)) reads.get(id).add(names.get(d));
        }
      }
      const nodes = this._ids.map((id) => ({ id, defines: flowNamesIn(this._bodies.get(id), scope), reads: reads.get(id) }));
      nodes.formulaReads = formulaReads;
      return nodes;
    });
    this._defines = new Map(nodes.map((n) => [n.id, n.defines]));
    this.watchValues();
    const edges = flowEdges(flowReduce(flowInfer(nodes, nodes.formulaReads)), this._model, this._ids);
    const key = JSON.stringify(edges);
    if (key === this._edgesKey) return;
    this._edgesKey = key;
    this._edges = edges;
    this.schedule("layout");
  }

  /** One effect per variable a node defines: what reads what can change with the values. */
  watchValues() {
    const scope = this.scope;
    for (const names of this._defines.values()) {
      for (const name of names) {
        if (this._valueFx.has(name)) continue;
        let first = true;
        this._valueFx.set(name, effect(() => {
          try {
            scope.get(name);
          } catch {} // a failing formula still counts as a change
          if (first) {
            first = false;
            return;
          }
          untracked(() => this.schedule("graph"));
        }));
      }
    }
  }

  /** Run updateGraph and/or relayout on the next frame, once however often it's asked. */
  schedule(what) {
    (this._need ??= new Set()).add(what);
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => {
      const need = this._need;
      this._need = new Set();
      if (this.isConnected && this._model) {
        if (need.has("graph")) this.updateGraph();
        if (this._need.delete("layout") || need.has("layout")) this.relayout();
      }
      this._frame = null;
      // Whatever that asked for again waits for the next frame.
      const rest = [...this._need];
      this._need = new Set();
      for (const w of rest) this.schedule(w);
    });
  }

  // ---- folding ----------------------------------------------------------------

  applyFolds() {
    const model = this._model;
    const away = new Set();
    for (const g of model.groups) {
      if (this._folded.has(g.id)) g.members.forEach((m) => away.add(m));
      else away.add(g.id);
    }
    for (const [id, item] of this._items) {
      item.classList.toggle("is-away", away.has(id));
      const node = this._nodes.get(id);
      if (!node.classList.contains("is-pill")) node.classList.toggle("is-folded", this._folded.has(id));
    }
    for (const [id, { button, label }] of this._folds) {
      const open = !this._folded.has(id);
      button.setAttribute("aria-expanded", String(open));
      button.setAttribute("aria-label", `${open ? "Hide" : "Show"} ${label}`);
    }
  }

  /** Fold `id` (a node or a group) if it's open, open it if it's folded. */
  toggle(id) {
    if (!this._model) return;
    if (this._folded.has(id)) this._folded.delete(id);
    else this._folded.add(id);
    const wasAway = new Set([...this._items].filter(([, item]) => item.classList.contains("is-away")).map(([k]) => k));
    const animate = !flowCalm();
    if (animate) {
      // The nodes that stay glide to their new places; the arrows fade out and back.
      this._root.classList.add("is-moving");
      clearTimeout(this._moving);
      this._moving = setTimeout(() => this._root.classList.remove("is-moving"), 240);
    }
    this.applyFolds();
    this.relayout();
    if (animate) {
      for (const [k, item] of this._items) {
        if (wasAway.has(k) && !item.classList.contains("is-away")) {
          item.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, delay: 40, easing: "ease-out", fill: "backwards" });
        }
      }
    }
  }

  // ---- layout -----------------------------------------------------------------

  relayout() {
    if (!this._board || !this.isConnected) return;
    const model = this._model;
    const T = model.direction === "right";
    let graph;
    try {
      graph = flowGraph(this._ids, this._edges, model, this._folded);
      this._graphError?.remove();
    } catch (error) {
      this._graphError ??= flowDiv("tangle-flow-error");
      this._graphError.textContent = error.message;
      this._root.before(this._graphError);
      graph = flowGraph(this._ids, [], model, this._folded);
    }
    this._graph = graph;
    const style = getComputedStyle(this._root);
    const px = (name, fallback) => {
      const v = parseFloat(style.getPropertyValue(name));
      return Number.isFinite(v) ? v : fallback;
    };
    const sizes = new Map();
    const size = (id) => {
      if (!sizes.has(id)) {
        const item = this._items.get(id);
        const [w, h] = [item.offsetWidth, item.offsetHeight];
        sizes.set(id, T ? { w: h, h: w } : { w, h });
      }
      return sizes.get(id);
    };
    const place = flowPlace(graph.rows, size, {
      align: model.align,
      nodeGap: px("--tangle-flow-node-gap", 40),
      layerGap: px("--tangle-flow-layer-gap", 56),
    });
    const { across, along } = FLOW_PADDING;
    const shift = (b) => ({ left: b.left + across, right: b.right + across, top: b.top + along, bottom: b.bottom + along });
    this._pos = new Map();
    for (const [id, b] of place.pos) {
      const f = shift(b);
      this._pos.set(id, f);
      if (id.startsWith(DAG_WAYPOINT)) continue;
      const item = this._items.get(id);
      item.style.left = `${T ? f.top : f.left}px`;
      item.style.top = `${T ? f.left : f.top}px`;
    }
    this._rowBoxes = place.rowBoxes.map((r) => ({ top: r.top + along, bottom: r.bottom + along }));
    const [w, h] = [place.width + 2 * across, place.height + 2 * along];
    this._board.style.width = `${T ? h : w}px`;
    this._board.style.height = `${T ? w : h}px`;
    this.draw();
  }

  /** A box measured on the board, in frame terms. */
  frameBox(left, top, width, height) {
    const b = { left, right: left + width, top, bottom: top + height };
    return this._model.direction === "right" ? { left: b.top, right: b.bottom, top: b.left, bottom: b.right } : b;
  }

  draw() {
    const T = this._model.direction === "right";
    const graph = this._graph;
    this._canvas.replaceChildren();
    this._frames.replaceChildren();
    this._labels.replaceChildren();
    const fside = (side) => (T ? FLOW_FLIP[side] : side);

    // Every node's box (not its note's), every note's, every lane's.
    const boxOf = new Map();
    const noteBox = new Map();
    for (const [id, f] of this._pos) {
      if (id.startsWith(DAG_WAYPOINT)) {
        boxOf.set(id, f);
        continue;
      }
      const item = this._items.get(id);
      const node = this._nodes.get(id);
      const [x, y] = [parseFloat(item.style.left), parseFloat(item.style.top)];
      boxOf.set(id, this.frameBox(x + node.offsetLeft, y + node.offsetTop, node.offsetWidth, node.offsetHeight));
      const note = this._notes.get(id);
      if (note) noteBox.set(id, this.frameBox(x + note.offsetLeft, y + note.offsetTop, note.offsetWidth, note.offsetHeight));
    }
    const rowOf = graph.rowOf;
    const rowBoxes = this._rowBoxes;
    const lines = []; // every polyline drawn, so later arrows and labels keep clear of them
    const pending = []; // labels to place once every arrow is down

    // Arrows are drawn one source at a time, each line over a halo of the
    // background, so where a later arrow crosses an earlier one there's a gap.
    const bySource = new Map();
    const drawEdge = (r, d, head) => {
      if (!bySource.has(r.src)) {
        const g = svgNode("g", {});
        const halos = svgNode("g", {});
        const strokes = svgNode("g", {});
        g.append(halos, strokes);
        this._canvas.append(g);
        bySource.set(r.src, { halos, strokes });
      }
      const { halos, strokes } = bySource.get(r.src);
      const line = svgNode("path", { class: "tangle-flow-edge", d });
      const tip = svgNode("path", { class: "tangle-flow-head", d: head });
      if (r.edge.color) {
        line.style.stroke = r.edge.color;
        tip.style.fill = tip.style.stroke = r.edge.color;
      }
      if (r.edge.dashed) line.style.strokeDasharray = "5 4";
      halos.append(svgNode("path", { class: "tangle-flow-halo", d }));
      strokes.append(line, tip);
    };

    const shown = graph.routes.filter((r) => boxOf.has(r.src) && boxOf.has(r.dst));
    const ported = shown.filter((r) => r.ported);
    const arrows = shown
      .filter((r) => !r.ported)
      .map((r) => ({ r, xs: [flowMid(boxOf.get(r.src)), ...r.chain.slice(1, -1).map((w) => flowMid(boxOf.get(w)))] }));
    const ends = ported.map((r) => ({
      r,
      exit: r.exit ? { side: fside(r.exit.side), at: r.exit.at } : { side: "bottom", at: null },
      enter: r.enter ? { side: fside(r.enter.side), at: r.enter.at } : { side: "top", at: null },
    }));

    // 1. Each arrow landing on a node's top edge gets its own slot there, ordered by where it comes from.
    const incoming = new Map();
    const land = (dst, entry) => (incoming.get(dst) ?? incoming.set(dst, []).get(dst)).push(entry);
    for (const a of arrows) land(a.r.dst, { a, from: a.xs.at(-1) });
    for (const e of ends) {
      if (e.enter.side !== "top" || e.enter.at != null) continue;
      const s = boxOf.get(e.r.src);
      const from = e.exit.side === "left" ? s.left : e.exit.side === "right" ? s.right : s.left + (e.exit.at ?? 0.5) * (s.right - s.left);
      land(e.r.dst, { e, from });
    }
    for (const [dst, list] of incoming) {
      const b = boxOf.get(dst);
      list.sort((p, q) => p.from - q.from);
      const xs = flowSlots(list.map((l) => l.from), b.left, b.right);
      list.forEach((item, k) => {
        if (item.e) item.e.enter.at = (xs[k] - b.left) / (b.right - b.left);
        else {
          item.a.xs.push(xs[k]);
          item.a.labelLeft = list.length > 1 && k < (list.length - 1) / 2;
        }
      });
    }

    // 2. One horizontal track per source in each gap it jogs through, so the
    //    arrows from one node share a bus, stacked with the fewest crossings.
    const jogs = new Map();
    for (const a of arrows) {
      a.xs.forEach((x, k) => {
        if (k === a.xs.length - 1 || Math.abs(a.xs[k + 1] - x) < 1) return;
        const gap = rowOf.get(a.r.chain[k]);
        if (!jogs.has(gap)) jogs.set(gap, new Map());
        const bySrc = jogs.get(gap);
        if (!bySrc.has(a.r.src)) bySrc.set(a.r.src, []);
        bySrc.get(a.r.src).push({ from: x, to: a.xs[k + 1] });
      });
    }
    const tracks = new Map();
    for (const [gap, bySrc] of jogs) {
      const seed = [...bySrc.keys()].sort((p, q) => flowMid(boxOf.get(p)) - flowMid(boxOf.get(q)));
      tracks.set(gap, flowTracks(seed, bySrc));
    }
    const trackY = (gap, src) => {
      const top = rowBoxes[gap].bottom;
      const list = tracks.get(gap);
      return top + ((rowBoxes[gap + 1].top - top) * (list.indexOf(src) + 1)) / (list.length + 1);
    };

    // 3. Down out of the source, along the track, down into the target.
    for (const a of arrows) {
      const y0 = boxOf.get(a.r.src).bottom;
      let d = `M ${a.xs[0]} ${y0}`;
      const line = [{ x: a.xs[0], y: y0 }];
      let lastY = rowBoxes[rowOf.get(a.r.dst) - 1]?.bottom ?? y0;
      a.xs.forEach((x, k) => {
        if (k === a.xs.length - 1) return;
        const next = a.xs[k + 1];
        if (Math.abs(next - x) < 1) return;
        const ty = trackY(rowOf.get(a.r.chain[k]), a.r.src);
        const s = Math.sign(next - x);
        const r = Math.min(FLOW_CORNER, Math.abs(next - x) / 2);
        d += ` L ${x} ${ty - r} Q ${x} ${ty} ${x + s * r} ${ty}`;
        d += ` L ${next - s * r} ${ty} Q ${next} ${ty} ${next} ${ty + r}`;
        line.push({ x, y: ty }, { x: next, y: ty });
        lastY = Math.max(lastY, ty);
      });
      const end = a.xs.at(-1);
      const tip = { x: end, y: boxOf.get(a.r.dst).top - FLOW_GAP };
      d += ` L ${end} ${tip.y - FLOW_HEAD_LEN * 0.8}`;
      line.push(tip);
      lines.push(line);
      drawEdge(a.r, d, flowHead(tip, [0, 1]));
      if (a.r.edge.label) {
        const m = (lastY + tip.y) / 2;
        const side = (left) => ({ x: left ? end - 6 : end + 6, y: m, h: left ? "before" : "after", v: "center" });
        pending.push({ text: a.r.edge.label, options: [side(a.labelLeft), side(!a.labelLeft), ...flowAlong(line)] });
      }
    }

    // 4. Arrows with ports: an elbow route between the named sides, around
    //    every other node, note and arrow. Ends sharing a side spread along it.
    const shared = new Map();
    for (const e of ends) {
      for (const [k, id, far] of [["exit", e.r.src, e.r.dst], ["enter", e.r.dst, e.r.src]]) {
        if (e[k].at != null) continue;
        const key = `${id} ${e[k].side}`;
        (shared.get(key) ?? shared.set(key, []).get(key)).push({ end: e[k], far });
      }
    }
    for (const list of shared.values()) {
      const horiz = ["top", "bottom"].includes(list[0].end.side);
      const c = (id) => (horiz ? flowMid(boxOf.get(id)) : (boxOf.get(id).top + boxOf.get(id).bottom) / 2);
      list.sort((p, q) => c(p.far) - c(q.far));
      list.forEach((x, k) => (x.end.at = list.length === 1 ? 0.5 : 0.2 + (0.6 * (k + 0.5)) / list.length));
    }
    const nodeBoxes = [...boxOf].filter(([id]) => !id.startsWith(DAG_WAYPOINT));
    for (const e of ends) {
      const a = flowPortPoint(boxOf.get(e.r.src), e.exit.side, e.exit.at, 0);
      const b = flowPortPoint(boxOf.get(e.r.dst), e.enter.side, e.enter.at, FLOW_GAP);
      const obstacles = [
        ...nodeBoxes.filter(([id]) => id !== e.r.src && id !== e.r.dst).map(([, box]) => flowPad(box, 4)),
        ...[...noteBox.values()].map((box) => flowPad(box, 4)),
      ];
      const pts = flowOrthoRoute(a, b, obstacles, lines);
      lines.push(pts);
      const dir = [-b.nx, -b.ny];
      const stop = { x: b.x - dir[0] * FLOW_HEAD_LEN * 0.8, y: b.y - dir[1] * FLOW_HEAD_LEN * 0.8 };
      drawEdge(e.r, flowRounded([...pts.slice(0, -1), stop]), flowHead(b, dir));
      if (e.r.edge.label) pending.push({ text: e.r.edge.label, options: flowAlong(pts) });
    }

    // 5. Labels: the first spot that clears the arrows, nodes, notes and labels so far.
    const base = this._board.getBoundingClientRect();
    const measure = (el) => {
      const r = el.getBoundingClientRect();
      return this.frameBox(r.left - base.left, r.top - base.top, r.width, r.height);
    };
    const putLabel = (el, o) => {
      const [x, y, h, v] = T ? [o.y, o.x, o.v, o.h] : [o.x, o.y, o.h, o.v];
      Object.assign(el.style, { left: `${x}px`, top: `${y}px`, transform: `translate(${FLOW_SHIFT[h]}, ${FLOW_SHIFT[v]})` });
    };
    const blockers = [...nodeBoxes.map(([, box]) => box), ...noteBox.values()];
    for (const { text, options } of pending) {
      if (!options.length) continue;
      const el = flowDiv("tangle-flow-label", text);
      this._labels.append(el);
      let pick = null;
      for (const o of options) {
        putLabel(el, o);
        const r = flowPad(measure(el), 2);
        const clash = blockers.some((b) => flowOverlaps(r, b)) || lines.some((l) => l.some((q, i) => i && flowHits(l[i - 1], q, r)));
        if (!clash) {
          pick = o;
          break;
        }
      }
      putLabel(el, pick ?? options[0]);
      blockers.push(measure(el));
    }

    // 6. Open groups: a faint dashed frame around their nodes, and a tab on its top-right corner that folds them.
    for (const g of this._model.groups) {
      const tab = this._tabs.get(g.id);
      const boxes = this._folded.has(g.id) ? [] : g.members.flatMap((id) => [boxOf.get(id), noteBox.get(id)]).filter(Boolean);
      tab.classList.toggle("is-away", !boxes.length);
      if (!boxes.length) continue;
      const f = flowPad({
        left: Math.min(...boxes.map((b) => b.left)),
        right: Math.max(...boxes.map((b) => b.right)),
        top: Math.min(...boxes.map((b) => b.top)),
        bottom: Math.max(...boxes.map((b) => b.bottom)),
      }, 12);
      this._frames.append(svgNode("rect", {
        class: "tangle-flow-frame", x: f.left, y: f.top, width: f.right - f.left, height: f.bottom - f.top, rx: 12,
      }));
      // The tab sits on a corner of the frame (on the real board): the first
      // one, from the top right, that no arrow runs through.
      const real = T ? { left: f.top, right: f.bottom, top: f.left, bottom: f.right } : f;
      const corners = [
        [real.right - 14, real.top, "-100%"], [real.right - 14, real.bottom, "-100%"],
        [real.left + 14, real.top, "0"], [real.left + 14, real.bottom, "0"],
      ];
      let pick = corners[0];
      for (const corner of corners) {
        Object.assign(tab.style, { left: `${corner[0]}px`, top: `${corner[1]}px`, transform: `translate(${corner[2]}, -50%)` });
        const r = flowPad(measure(tab), 3);
        if (!lines.some((l) => l.some((q, i) => i && flowHits(l[i - 1], q, r)))) {
          pick = corner;
          break;
        }
      }
      Object.assign(tab.style, { left: `${pick[0]}px`, top: `${pick[1]}px`, transform: `translate(${pick[2]}, -50%)` });
      blockers.push(measure(tab));
    }

    // 7. Notes: a short arrow from the note onto its node.
    for (const [id, n] of noteBox) {
      const c = boxOf.get(id);
      if (!c) continue;
      const y = Math.max(c.top + 8, Math.min(c.bottom - 8, (n.top + n.bottom) / 2));
      const [from, to] = [n.left - 6, c.right + 5];
      if (from - to < 8) continue;
      this._canvas.append(svgNode("path", {
        class: "tangle-flow-note-arrow",
        d: `M ${from} ${y} L ${to} ${y} M ${to + 5} ${y - 3.5} L ${to} ${y} L ${to + 5} ${y + 3.5}`,
      }));
    }
  }
}
