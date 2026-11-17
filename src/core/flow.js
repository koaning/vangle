import { dagCycle, dagLayers, dagOrder, dagReach, DAG_WAYPOINT, dagPermutations } from "./dag.js";

// ---------------------------------------------------------------------------
// <t-flow>, without the DOM: checking the spec, inferring the arrows from what
// each node reads and defines, layering, placing the nodes, and the geometry
// of the arrows. Boxes are { left, right, top, bottom } in px, in a "frame"
// where the layers stack top to bottom: for direction "right" the element
// swaps x and y on the way in and out, so one router serves both directions.
// ---------------------------------------------------------------------------

export const FLOW_SIDES = ["top", "bottom", "left", "right"];
const FLOW_KEYS = ["direction", "align", "nodes", "edges", "groups", "infer", "edgeLabels"];
const FLOW_NODE_KEYS = ["label", "note", "fold", "row", "beside", "width"];
const FLOW_EDGE_KEYS = ["label", "exit", "enter", "color", "dashed"];
const FLOW_GROUP_KEYS = ["label", "nodes", "collapsed"];
const FLOW_ALIGNS = { down: ["center", "left", "right"], right: ["center", "top", "bottom"] };
// Where an arrow leaves and lands when nothing says otherwise: out the far side, in at the near one.
export const FLOW_DEFAULT_SIDES = { down: ["bottom", "top"], right: ["right", "left"] };
// A widget placed beside its anchor: [the widget's side facing the anchor, the anchor's side facing it].
const FLOW_FACING = { down: ["left", "right"], right: ["top", "bottom"] };
// A side's name in the transposed frame (and back: the map is its own inverse).
export const FLOW_FLIP = { top: "left", left: "top", bottom: "right", right: "bottom" };

const flowFail = (message) => {
  throw new Error(`t-flow: ${message}`);
};
const flowPlain = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const flowList = (items) => items.map((s) => `"${s}"`).join(", ");

function flowKeys(obj, allowed, where) {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length) flowFail(`${where} has unknown ${extra.length > 1 ? "keys" : "key"} ${flowList(extra)}; use ${flowList(allowed)}`);
}

/** One end of an arrow, `"left"` or `["left", 0.3]`, as { side, at } (at is null for "spread out"). */
export function flowPort(value, where) {
  const [side, at = null] = Array.isArray(value) ? value : [value];
  if (!FLOW_SIDES.includes(side)) flowFail(`${where} must be one of ${flowList(FLOW_SIDES)}, got ${JSON.stringify(side)}`);
  if (at !== null && !(typeof at === "number" && at >= 0 && at <= 1)) {
    flowFail(`${where}: the position must be a number from 0 to 1, got ${JSON.stringify(at)}`);
  }
  return { side, at };
}

/**
 * Check a <t-flow> spec against the ids of its nodes, and fill in the
 * defaults. Throws an Error that says what's wrong. Returns { direction,
 * align, infer, edgeLabels, nodes: Map(id -> options), edges, groups }.
 */
export function flowSpec(spec, ids) {
  spec ??= {};
  if (!flowPlain(spec)) flowFail("the spec must be an object");
  flowKeys(spec, FLOW_KEYS, "the spec");
  const known = new Set(ids);
  const node = (id, where) => {
    if (!known.has(id)) {
      flowFail(`${where} names "${id}", which isn't a node. The nodes are ${ids.length ? flowList(ids) : "(none)"}`);
    }
    return id;
  };

  const direction = spec.direction ?? "down";
  if (!(direction in FLOW_ALIGNS)) flowFail(`direction must be "down" or "right", got ${JSON.stringify(direction)}`);
  const align = spec.align ?? "center";
  if (!FLOW_ALIGNS[direction].includes(align)) {
    flowFail(`with direction "${direction}", align must be one of ${flowList(FLOW_ALIGNS[direction])}, got ${JSON.stringify(align)}`);
  }
  for (const key of ["infer", "edgeLabels"]) {
    if (spec[key] !== undefined && typeof spec[key] !== "boolean") flowFail(`${key} must be true or false`);
  }

  const nodes = new Map(ids.map((id) => [id, { label: null, note: null, fold: null, row: null, beside: null, width: null }]));
  if (spec.nodes !== undefined && !flowPlain(spec.nodes)) flowFail("nodes must be an object, keyed by node id");
  for (const [id, raw] of Object.entries(spec.nodes ?? {})) {
    node(id, "nodes");
    const c = typeof raw === "string" ? { label: raw } : raw;
    if (!flowPlain(c)) flowFail(`nodes.${id} must be an object (or a string, its label)`);
    flowKeys(c, FLOW_NODE_KEYS, `nodes.${id}`);
    const n = nodes.get(id);
    if (c.label != null) n.label = String(c.label);
    if (c.note != null) n.note = String(c.note);
    if (c.fold != null && c.fold !== false) {
      if (![true, "open", "closed"].includes(c.fold)) flowFail(`nodes.${id}.fold must be true, "open" or "closed"`);
      n.fold = c.fold === "closed" ? "closed" : "open";
    }
    if (c.row != null) {
      if (!Number.isInteger(c.row) || c.row < 0) flowFail(`nodes.${id}.row must be a whole number from 0, got ${JSON.stringify(c.row)}`);
      n.row = c.row;
    }
    if (c.beside != null) {
      const [anchor, side = "after"] = Array.isArray(c.beside) ? c.beside : [c.beside];
      node(anchor, `nodes.${id}.beside`);
      if (side !== "before" && side !== "after") flowFail(`nodes.${id}.beside: the side must be "before" or "after"`);
      if (anchor === id) flowFail(`nodes.${id} can't sit beside itself`);
      n.beside = { anchor, before: side === "before" };
    }
    if (c.width != null) {
      if (typeof c.width === "number") n.width = `${c.width}px`;
      else if (typeof c.width === "string") n.width = c.width;
      else flowFail(`nodes.${id}.width must be a number of pixels or a CSS length`);
    }
  }
  for (const [id, n] of nodes) {
    if (!n.beside) continue;
    if (nodes.get(n.beside.anchor).beside) {
      flowFail(`nodes.${id} sits beside "${n.beside.anchor}", which itself sits beside another node; anchor it on one that doesn't`);
    }
    if (n.row != null) flowFail(`nodes.${id} sits beside "${n.beside.anchor}", so it takes that row; give the row to "${n.beside.anchor}" instead`);
  }

  if (spec.edges !== undefined && !Array.isArray(spec.edges)) flowFail("edges must be a list of [from, to] or [from, to, options]");
  const edges = [];
  const seen = new Set();
  for (const e of spec.edges ?? []) {
    if (!Array.isArray(e) || e.length < 2 || e.length > 3) flowFail(`each edge must be [from, to] or [from, to, options], got ${JSON.stringify(e)}`);
    const [src, dst, raw] = e;
    const name = `[${JSON.stringify(src)}, ${JSON.stringify(dst)}]`;
    node(src, `the edge ${name}`);
    node(dst, `the edge ${name}`);
    if (src === dst) flowFail(`the edge ${name} goes from a node to itself`);
    if (seen.has(`${src} ${dst}`)) flowFail(`the edge ${name} is given twice`);
    seen.add(`${src} ${dst}`);
    if (raw === false) {
      edges.push({ src, dst, drop: true, opts: {} });
      continue;
    }
    const c = raw == null ? {} : typeof raw === "string" ? { label: raw } : raw;
    if (!flowPlain(c)) flowFail(`the edge ${name}: options must be a label, an object, or false to drop it`);
    flowKeys(c, FLOW_EDGE_KEYS, `the edge ${name}`);
    const opts = {};
    if (c.label != null) opts.label = String(c.label);
    if (c.color != null) opts.color = String(c.color);
    if (c.dashed) opts.dashed = true;
    for (const k of ["exit", "enter"]) if (c[k] != null) opts[k] = flowPort(c[k], `the edge ${name}: ${k}`);
    edges.push({ src, dst, drop: false, opts });
  }

  if (spec.groups !== undefined && !Array.isArray(spec.groups)) flowFail("groups must be a list of { label, nodes }");
  const grouped = new Map();
  const groups = (spec.groups ?? []).map((g, i) => {
    if (!flowPlain(g)) flowFail(`groups[${i}] must be an object: { label, nodes, collapsed }`);
    flowKeys(g, FLOW_GROUP_KEYS, `groups[${i}]`);
    const label = String(g.label ?? `group ${i + 1}`);
    if (!Array.isArray(g.nodes) || !g.nodes.length) flowFail(`the group "${label}" needs a list of nodes`);
    const members = new Set(g.nodes.map((id) => node(id, `the group "${label}"`)));
    for (const id of members) {
      if (grouped.has(id)) flowFail(`"${id}" is in both the group "${grouped.get(id)}" and the group "${label}"`);
      grouped.set(id, label);
    }
    return { id: `!g${i}`, label, members: ids.filter((id) => members.has(id)), collapsed: Boolean(g.collapsed) };
  });

  return { direction, align, infer: spec.infer ?? true, edgeLabels: spec.edgeLabels ?? false, nodes, edges, groups };
}

/**
 * The arrows the data implies. `nodes` is [{ id, defines, reads }] (lists or
 * Sets of variable names); `formulaReads` maps each formula variable to the
 * variables it reads. A → B when B reads something A defines, also through
 * formulas no node defines, and through the formulas B defines itself.
 * Returns Map("src dst" -> Set of the variables of A it carries).
 */
export function flowInfer(nodes, formulaReads = new Map()) {
  const owner = new Map();
  for (const n of nodes) for (const name of n.defines) if (!owner.has(name)) owner.set(name, n.id);
  const edges = new Map();
  for (const n of nodes) {
    const seen = new Set();
    const visit = (name) => {
      if (seen.has(name)) return;
      seen.add(name);
      const o = owner.get(name);
      if (o !== undefined) {
        if (o !== n.id) {
          const key = `${o} ${n.id}`;
          if (!edges.has(key)) edges.set(key, new Set());
          edges.get(key).add(name);
        }
        return;
      }
      for (const m of formulaReads.get(name) ?? []) visit(m);
    };
    for (const name of n.reads) visit(name);
    for (const name of n.defines) {
      seen.add(name);
      for (const m of formulaReads.get(name) ?? []) visit(m);
    }
  }
  return edges;
}

/** `edges` (a Map keyed "src dst") without the ones a longer path already implies. */
export function flowReduce(edges) {
  const next = new Map();
  for (const key of edges.keys()) {
    const [s, d] = key.split(" ");
    if (!next.has(s)) next.set(s, []);
    next.get(s).push(d);
  }
  const out = new Map();
  for (const [key, value] of edges) {
    const [s, d] = key.split(" ");
    const others = (next.get(s) ?? []).filter((c) => c !== d);
    const implied = others.some((c) => c === d || dagReach(c, next).has(d));
    if (!implied) out.set(key, value);
  }
  return out;
}

/**
 * Every arrow to draw: the inferred ones (unless the spec says infer: false),
 * with the spec's edges laid over them, in node order. Each is { src, dst,
 * label, exit, enter, color, dashed, inferred }.
 */
export function flowEdges(inferred, model, ids) {
  const at = new Map(ids.map((id, i) => [id, i]));
  const out = new Map();
  if (model.infer) {
    for (const [key, names] of inferred) {
      const [src, dst] = key.split(" ");
      out.set(key, { src, dst, label: model.edgeLabels ? [...names].join(", ") : null, inferred: true });
    }
  }
  for (const e of model.edges) {
    const key = `${e.src} ${e.dst}`;
    if (e.drop) out.delete(key);
    else out.set(key, { src: e.src, dst: e.dst, label: null, inferred: false, ...out.get(key), ...e.opts });
  }
  return [...out.values()].sort((p, q) => at.get(p.src) - at.get(q.src) || at.get(p.dst) - at.get(q.dst));
}

const flowCycleText = (cycle) => cycle.map((id) => `"${id}"`).join(" → ");

/**
 * Lay the graph out in rows, with the groups in `folded` folded to one pill
 * each. Returns { rows, routes, rowOf, hidden }: `rows` top to bottom, each a
 * list of cells { id, before, after, lane } (lane for an arrow skipping the
 * row, before/after for nodes placed beside it); `routes` one per arrow,
 * { edge, src, dst, chain, ported, exit, enter } with sides in real (not frame) terms.
 * Throws when the arrows go round in a circle, or a group can't be folded.
 */
export function flowGraph(ids, edges, model, folded = new Set()) {
  const cycle = dagCycle(ids, edges.map((e) => [e.src, e.dst]));
  if (cycle) flowFail(`the arrows go round in a circle: ${flowCycleText(cycle)}. Drop one with [from, to, false]`);
  // A group folds into one pill, so nothing outside it may sit on a path between two of its nodes.
  const down = new Map();
  const up = new Map();
  for (const e of edges) {
    (down.get(e.src) ?? down.set(e.src, []).get(e.src)).push(e.dst);
    (up.get(e.dst) ?? up.set(e.dst, []).get(e.dst)).push(e.src);
  }
  for (const g of model.groups) {
    const reach = (next) => new Set(g.members.flatMap((m) => [...dagReach(m, next)]));
    const below = reach(down);
    const between = [...reach(up)].filter((id) => below.has(id) && !g.members.includes(id));
    if (between.length) {
      flowFail(`the group "${g.label}" must include "${between[0]}": it sits on a path between two of the group's nodes`);
    }
  }

  const pillOf = new Map();
  for (const g of model.groups) if (folded.has(g.id)) for (const m of g.members) pillOf.set(m, g.id);
  const shown = (id) => pillOf.get(id) ?? id;
  const visible = [];
  for (const id of ids) {
    const v = shown(id);
    if (!visible.includes(v)) visible.push(v);
  }
  const hidden = new Set(pillOf.keys());

  const beside = new Map();
  for (const [id, n] of model.nodes) {
    if (n.beside && !hidden.has(id) && !hidden.has(n.beside.anchor)) beside.set(id, n.beside);
  }
  const anchorOf = (id) => beside.get(id)?.anchor ?? id;
  const [defaultExit, defaultEnter] = FLOW_DEFAULT_SIDES[model.direction];
  const facing = FLOW_FACING[model.direction];

  // Arrows into or out of a folded group land on its pill; two that now join the same pair are drawn once.
  const routes = [];
  const joined = new Set();
  for (const e of edges) {
    const src = shown(e.src);
    const dst = shown(e.dst);
    if (src === dst || joined.has(`${src} ${dst}`)) continue;
    joined.add(`${src} ${dst}`);
    let exit = src === e.src ? e.exit : undefined;
    let enter = dst === e.dst ? e.enter : undefined;
    if (exit && exit.side === defaultExit && exit.at === null) exit = undefined;
    if (enter && enter.side === defaultEnter && enter.at === null) enter = undefined;
    // An arrow between a node and the one it sits beside joins their facing sides.
    let sides = null;
    if (beside.get(src)?.anchor === dst) sides = beside.get(src).before ? [...facing].reverse() : facing;
    else if (beside.get(dst)?.anchor === src) sides = beside.get(dst).before ? facing : [...facing].reverse();
    if (sides) {
      exit ??= { side: sides[0], at: null };
      enter ??= { side: sides[1], at: null };
    }
    routes.push({ edge: e, src, dst, chain: null, ported: Boolean(exit || enter), exit, enter });
  }

  const layered = visible.filter((id) => !beside.has(id));
  const layerEdges = [];
  for (const r of routes) {
    const s = anchorOf(r.src);
    const d = anchorOf(r.dst);
    if (s !== d) layerEdges.push({ r, pair: [s, d] });
  }
  const tied = dagCycle(layered, layerEdges.map((l) => l.pair));
  if (tied) {
    flowFail(`beside puts a node in its anchor's row, but the arrows then run in a circle (${flowCycleText(tied)}), so one would have to sit above the other`);
  }
  const minRows = new Map();
  for (const id of layered) if (model.nodes.get(id)?.row != null) minRows.set(id, model.nodes.get(id).row);
  const layerOf = dagLayers(layered, layerEdges.map((l) => l.pair), minRows);
  const direct = new Set();
  layerEdges.forEach((l, i) => l.r.ported && direct.add(i));
  const { layers, routes: chains } = dagOrder(layered, layerOf, layerEdges.map((l) => l.pair), { direct });
  layerEdges.forEach((l, i) => {
    l.r.chain = [l.r.src, ...chains[i].slice(1, -1), l.r.dst];
  });
  for (const r of routes) r.chain ??= [r.src, r.dst];

  const rowOf = new Map();
  const rows = layers.map((layer, i) =>
    layer.map((id) => {
      rowOf.set(id, i);
      return { id, lane: id.startsWith(DAG_WAYPOINT), before: [], after: [] };
    }),
  );
  for (const [id, b] of beside) {
    const row = rows[rowOf.get(b.anchor)];
    row.find((c) => c.id === b.anchor)[b.before ? "before" : "after"].push(id);
    rowOf.set(id, rowOf.get(b.anchor));
  }
  for (const row of rows) for (const c of row) c.before.reverse(); // nearest the anchor first, as given
  return { rows, routes, rowOf, hidden };
}

/**
 * Where each node goes, in frame coordinates. `size(id)` is { w, h }: w across
 * the flow, h along it. Rows stack with `layerGap` between them; within a
 * row, cells sit `nodeGap` apart. "center" centers each row on its own; any
 * other align puts the k-th cell of every row in one column (counted from
 * the far end for "right" and "bottom"), with the anchor on the column's
 * center line, so a chain down a column gets straight arrows. Returns
 * { pos: Map(id -> box), rowBoxes, width, height }.
 */
export function flowPlace(rows, size, { align = "center", nodeGap = 40, layerGap = 64, lane = 14 } = {}) {
  const sz = (cell, id) => (cell.lane ? { w: lane, h: 0 } : size(id));
  const span = (ids) => ids.reduce((sum, id) => sum + size(id).w + nodeGap, 0);
  const heights = rows.map((row) => Math.max(0, ...row.flatMap((c) => [c.id, ...c.before, ...c.after].map((id) => sz(c, id).h))));
  const rowBoxes = [];
  let y = 0;
  for (const h of heights) {
    rowBoxes.push({ top: y, bottom: y + h });
    y += h + layerGap;
  }
  const height = Math.max(0, y - layerGap);
  const pos = new Map();
  const put = (cell, id, left, r) => {
    const { w, h } = sz(cell, id);
    const box = rowBoxes[r];
    const top = cell.lane ? box.top : box.top + (box.bottom - box.top - h) / 2;
    pos.set(id, { left, right: left + w, top, bottom: cell.lane ? box.bottom : top + h });
  };
  // Lay out one cell with its anchor's left edge at x: the before nodes run leftwards from it.
  const putCell = (cell, x, r) => {
    let left = x;
    for (const id of cell.before) {
      left -= nodeGap + size(id).w;
      put(cell, id, left, r);
    }
    put(cell, cell.id, x, r);
    let right = x + sz(cell, cell.id).w;
    for (const id of cell.after) {
      put(cell, id, right + nodeGap, r);
      right += nodeGap + size(id).w;
    }
  };

  let width = 0;
  if (align === "center") {
    const widths = rows.map((row) => row.reduce((sum, c) => sum + span(c.before) + sz(c, c.id).w + span(c.after), 0) + nodeGap * (row.length - 1));
    width = Math.max(0, ...widths);
    rows.forEach((row, r) => {
      let x = (width - widths[r]) / 2;
      for (const c of row) {
        putCell(c, x + span(c.before), r);
        x += span(c.before) + sz(c, c.id).w + span(c.after) + nodeGap;
      }
    });
  } else {
    const cols = Math.max(0, ...rows.map((row) => row.length));
    const fromEnd = align === "right" || align === "bottom";
    const colOf = (row, k) => (fromEnd ? cols - row.length + k : k);
    const anchorW = Array(cols).fill(0);
    const sideW = Array(cols).fill(0);
    rows.forEach((row) =>
      row.forEach((c, k) => {
        const col = colOf(row, k);
        anchorW[col] = Math.max(anchorW[col], sz(c, c.id).w);
        sideW[col] = Math.max(sideW[col], span(c.before), span(c.after));
      }),
    );
    const colX = [];
    for (let k = 0; k < cols; k++) {
      colX.push(width);
      width += anchorW[k] + 2 * sideW[k] + (k < cols - 1 ? nodeGap : 0);
    }
    rows.forEach((row, r) =>
      row.forEach((c, k) => {
        const col = colOf(row, k);
        const center = colX[col] + sideW[col] + anchorW[col] / 2;
        putCell(c, center - sz(c, c.id).w / 2, r);
      }),
    );
  }
  return { pos, rowBoxes, width, height };
}

// ---- arrow geometry -----------------------------------------------------

export const FLOW_CORNER = 8;
export const FLOW_HEAD_LEN = 7;
const FLOW_HEAD_HALF = 3.6;
const FLOW_STUB = 16;
const FLOW_CLEAR = 10;
const FLOW_SLOT_GAP = 16; // closest an arrow tip may land to another arrow's straight drop
const FLOW_SLOT_INSET = 6; // closest an arrow tip may land to a node's corner
const FLOW_NORMAL = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

const flowDist = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);
const flowDir = (p, q) => [Math.sign(Math.round(q.x - p.x)), Math.sign(Math.round(q.y - p.y))];
const flowSame = (u, v) => u[0] === v[0] && u[1] === v[1];
const flowFlat = (p, q) => Math.abs(p.y - q.y) < 0.5;
const flowOverlap = (a0, a1, b0, b1) => Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1));
export const flowMid = (b) => (b.left + b.right) / 2;
export const flowPad = (b, pad) => ({ left: b.left - pad, right: b.right + pad, top: b.top - pad, bottom: b.bottom + pad });
export const flowOverlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** Does the axis-aligned segment p→q pass through box `o`? */
export function flowHits(p, q, o) {
  if (flowFlat(p, q)) return p.y > o.top && p.y < o.bottom && Math.max(p.x, q.x) > o.left && Math.min(p.x, q.x) < o.right;
  return p.x > o.left && p.x < o.right && Math.max(p.y, q.y) > o.top && Math.min(p.y, q.y) < o.bottom;
}

// How the leg p→q meets the polylines already drawn: legs it runs on top of, and legs it crosses.
function flowMeets(p, q, lines) {
  let along = 0;
  let cross = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [u, v] = [line[i - 1], line[i]];
      if (flowFlat(p, q) === flowFlat(u, v)) {
        const near = flowFlat(p, q)
          ? Math.abs(p.y - u.y) < 6 && flowOverlap(p.x, q.x, u.x, v.x) > 2
          : Math.abs(p.x - u.x) < 6 && flowOverlap(p.y, q.y, u.y, v.y) > 2;
        if (near) along++;
      } else {
        const [h0, h1, w] = flowFlat(p, q) ? [p, q, u] : [u, v, p];
        const [w0, w1] = flowFlat(p, q) ? [u, v] : [p, q];
        if (w.x > Math.min(h0.x, h1.x) && w.x < Math.max(h0.x, h1.x) && h0.y > Math.min(w0.y, w1.y) && h0.y < Math.max(w0.y, w1.y)) cross++;
      }
    }
  }
  return { along, cross };
}

function flowSimplify(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && flowDist(last, p) < 0.5) continue;
    if (last && Math.abs(last.x - p.x) > 0.5 && Math.abs(last.y - p.y) > 0.5) return null;
    if (out.length > 1 && flowSame(flowDir(out[out.length - 2], last), flowDir(last, p))) out.pop();
    out.push(p);
  }
  return out.length > 1 ? out : null;
}

/** Where an arrow end sits on a box: { x, y, nx, ny }, `out` px off the side, along its outward normal. */
export function flowPortPoint(box, side, at, out = 0) {
  const [nx, ny] = FLOW_NORMAL[side];
  const x = side === "left" ? box.left : side === "right" ? box.right : box.left + at * (box.right - box.left);
  const y = side === "top" ? box.top : side === "bottom" ? box.bottom : box.top + at * (box.bottom - box.top);
  return { x: x + nx * out, y: y + ny * out, nx, ny };
}

/**
 * An axis-aligned route from exit point `a` to arrow tip `b` (each with its
 * outward normal): the elbow shape with the fewest bends that leaves `a`
 * along its normal and enters `b` against its own, preferring shapes clear of
 * the `obstacles` and of the arrows already drawn (`lines`).
 */
export function flowOrthoRoute(a, b, obstacles = [], lines = []) {
  const d0 = [a.nx, a.ny];
  const d1 = [-b.nx, -b.ny];
  const p1 = { x: a.x + a.nx * FLOW_STUB, y: a.y + a.ny * FLOW_STUB };
  const p2 = { x: b.x + b.nx * FLOW_STUB, y: b.y + b.ny * FLOW_STUB };
  const legs = lines.flatMap((l) => l.slice(1).map((q, i) => [l[i], q]));
  const yms = [
    (p1.y + p2.y) / 2,
    ...obstacles.flatMap((o) => [o.top - FLOW_CLEAR, o.bottom + FLOW_CLEAR]),
    ...legs.filter(([u, v]) => flowFlat(u, v)).flatMap(([u]) => [u.y - FLOW_CLEAR, u.y + FLOW_CLEAR]),
  ];
  const xms = [
    (p1.x + p2.x) / 2,
    ...obstacles.flatMap((o) => [o.left - FLOW_CLEAR, o.right + FLOW_CLEAR]),
    ...legs.filter(([u, v]) => !flowFlat(u, v)).flatMap(([u]) => [u.x - FLOW_CLEAR, u.x + FLOW_CLEAR]),
  ];
  const shapes = [
    [],
    [{ x: a.x, y: b.y }],
    [{ x: b.x, y: a.y }],
    [p1, { x: p1.x, y: p2.y }, p2],
    [p1, { x: p2.x, y: p1.y }, p2],
    ...yms.map((ym) => [p1, { x: p1.x, y: ym }, { x: p2.x, y: ym }, p2]),
    ...xms.map((xm) => [p1, { x: xm, y: p1.y }, { x: xm, y: p2.y }, p2]),
  ];
  let best = null;
  for (const mid of shapes) {
    const pts = flowSimplify([a, ...mid, b]);
    if (!pts) continue;
    const dirs = pts.slice(1).map((q, i) => flowDir(pts[i], q));
    if (!flowSame(dirs[0], d0) || !flowSame(dirs[dirs.length - 1], d1)) continue;
    if (dirs.some((d, i) => i && d[0] === -dirs[i - 1][0] && d[1] === -dirs[i - 1][1])) continue;
    if (flowDist(pts[pts.length - 2], b) < FLOW_HEAD_LEN + 3) continue;
    let len = 0;
    let blocked = 0;
    let along = 0;
    let cross = 0;
    for (let i = 1; i < pts.length; i++) {
      len += flowDist(pts[i - 1], pts[i]);
      for (const o of obstacles) if (flowHits(pts[i - 1], pts[i], o)) blocked++;
      const m = flowMeets(pts[i - 1], pts[i], lines);
      along += m.along;
      cross += m.cross;
    }
    const score = blocked * 1e6 + along * 1e5 + (pts.length - 2) * 1000 + cross * 300 + len;
    if (!best || score < best.score) best = { pts, score };
  }
  return best ? best.pts : [a, p1, { x: p1.x, y: p2.y }, p2, b];
}

/** An SVG path through `pts` with rounded corners. */
export function flowRounded(pts) {
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [p, c, n] = [pts[i - 1], pts[i], pts[i + 1]];
    const r = Math.min(FLOW_CORNER, flowDist(p, c) / 2, flowDist(c, n) / 2);
    const u = flowDir(p, c);
    const v = flowDir(c, n);
    d += ` L ${c.x - u[0] * r} ${c.y - u[1] * r} Q ${c.x} ${c.y} ${c.x + v[0] * r} ${c.y + v[1] * r}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

/** A filled arrowhead with its tip at `b`, pointing along the unit vector `d`. */
export function flowHead(b, d) {
  const bx = b.x - d[0] * FLOW_HEAD_LEN;
  const by = b.y - d[1] * FLOW_HEAD_LEN;
  const [qx, qy] = [-d[1] * FLOW_HEAD_HALF, d[0] * FLOW_HEAD_HALF];
  return `M ${b.x} ${b.y} L ${bx + qx} ${by + qy} L ${bx - qx} ${by - qy} Z`;
}

/**
 * Label spots beside the long legs of a polyline, longest first: { x, y, h, v }
 * where h and v say which way the label extends ("after" = towards +x/+y).
 */
export function flowAlong(line) {
  const legs = line
    .slice(1)
    .map((q, i) => [line[i], q])
    .filter(([p, q]) => flowDist(p, q) > 28);
  legs.sort((u, v) => flowDist(v[0], v[1]) - flowDist(u[0], u[1]));
  return legs.flatMap(([p, q]) => {
    const [mx, my] = [(p.x + q.x) / 2, (p.y + q.y) / 2];
    return flowFlat(p, q)
      ? [{ x: mx, y: my - 4, h: "center", v: "before" }, { x: mx, y: my + 4, h: "center", v: "after" }]
      : [{ x: mx + 6, y: my, h: "after", v: "center" }, { x: mx - 6, y: my, h: "before", v: "center" }];
  });
}

/**
 * Where the arrows landing on one edge of a box (from `left` to `right`)
 * touch it, given where each comes from (`froms`, sorted): spread across the
 * middle, except that an arrow whose source is right above drops straight
 * down and the others make room for it.
 */
export function flowSlots(froms, left, right) {
  const n = froms.length;
  const center = (left + right) / 2;
  const span = Math.min((right - left) * 0.6, 40 * n);
  const xs = froms.map((_, k) => center - span / 2 + (span * (k + 0.5)) / n);
  const lo0 = left + FLOW_SLOT_INSET;
  const hi0 = right - FLOW_SLOT_INSET;
  const straight = [];
  froms.forEach((from, k) => {
    const ok = from - lo0 >= FLOW_SLOT_GAP * (k + 1) && hi0 - from >= FLOW_SLOT_GAP * (n - k);
    if (ok && straight.every((j) => from - froms[j] >= 2 * FLOW_SLOT_GAP)) straight.push(k);
  });
  for (const k of straight) xs[k] = froms[k];
  for (let k = 0; k < n; k++) {
    if (straight.includes(k)) continue;
    let e = k;
    while (e + 1 < n && !straight.includes(e + 1)) e++;
    const lo = k > 0 ? xs[k - 1] : lo0;
    const hi = e + 1 < n ? xs[e + 1] : hi0;
    const fits = xs.slice(k, e + 1).every((x) => x > lo + (k > 0 ? FLOW_SLOT_GAP : 0) && x < hi - (e + 1 < n ? FLOW_SLOT_GAP : 0));
    if (!fits) for (let j = k; j <= e; j++) xs[j] = lo + ((hi - lo) * (j - k + 1)) / (e - k + 2);
    k = e;
  }
  return xs;
}

/**
 * The order to stack the horizontal tracks in one gap between rows, fewest
 * crossings first. `bySrc` maps a source to its jogs [{ from, to }]; `seed`
 * is the order to start from (and keep, past `cap` sources).
 */
export function flowTracks(seed, bySrc, cap = 7) {
  const inside = (x, s) => x > Math.min(s.from, s.to) + 0.5 && x < Math.max(s.from, s.to) - 0.5;
  const above = (P, Q) => {
    let n = 0;
    for (const p of P) for (const q of Q) n += inside(q.from, p) + inside(p.to, q);
    return n;
  };
  const cost = (order) => {
    let n = 0;
    for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) n += above(bySrc.get(order[i]), bySrc.get(order[j]));
    return n;
  };
  if (seed.length > cap) return seed;
  let best = seed;
  let bestCost = cost(seed);
  for (const order of dagPermutations(seed)) {
    if (bestCost === 0) break;
    const c = cost(order);
    if (c < bestCost) [best, bestCost] = [order, c];
  }
  return best;
}
