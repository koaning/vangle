import { pending, effect, untracked, watchers, graphVersion } from "../core/signals.js";
import { Formula, scopeOf } from "../core/scope.js";
import { hover, keyOf } from "../core/interaction.js";
import { Base } from "../core/element.js";

// ---------------------------------------------------------------------------
// Debugging: <t-debug> shows every variable, what it reads and what reads it.
// ---------------------------------------------------------------------------

/**
 * The variables of `scope` as data, which is what <t-debug> shows: one row per
 * variable with its `value` (or `error`), its `kind` ("value", "formula", "fetch",
 * or "unset" if something reads it but nothing sets it), whether it's `pending`,
 * how many times it has `runs`, the variables it `reads` and is `readBy`, and the
 * `elements` whose effects read it.
 */
export function inspectScope(scope) {
  return untracked(() => {
    const names = new Map(); // cell → variable name
    for (const [name, slot] of scope.slots) names.set(slot.cell, name);
    const rows = new Map();
    for (const [name, slot] of scope.slots) {
      const def = slot.def.peek();
      let value;
      let error = null;
      try {
        value = slot.cell.value;
      } catch (e) {
        error = e?.message ?? String(e);
      }
      const kind = def instanceof Formula ? "formula" : (slot.kind ?? (def === undefined ? "unset" : "value"));
      const reads = [...slot.cell.deps].filter((d) => d !== slot.cell && names.has(d)).map((d) => names.get(d));
      rows.set(name, {
        name, kind, value, error, reads,
        pending: pending.has(slot.def),
        runs: slot.cell.runs,
        readBy: [],
        elements: [],
      });
    }
    for (const row of rows.values()) for (const name of row.reads) rows.get(name).readBy.push(row.name);
    for (const el of watchers) {
      const read = new Set();
      for (const e of el._effects) for (const d of e.deps) if (names.has(d)) read.add(names.get(d));
      for (const name of read) rows.get(name).elements.push(el);
    }
    return [...rows.values()];
  });
}

const DEBUG_COLUMN_GAP = 48;
const DEBUG_ROW_GAP = 12;
const DEBUG_NODE_HEIGHT = 38;
const DEBUG_CHAR = 7.3; // the width of a character of the 12px monospace font, roughly

/**
 * Where <t-debug> draws each variable: left to right in columns, each formula
 * one column after the furthest variable it reads, ordered within a column to
 * keep edges short. Takes rows like inspectScope's, returns { nodes, edges,
 * width, height }, with nodes in column order.
 */
export function layoutGraph(rows) {
  const byName = new Map(rows.map((row) => [row.name, row]));
  const depth = new Map();
  const depthOf = (row, seen = new Set()) => {
    if (depth.has(row.name)) return depth.get(row.name);
    if (seen.has(row.name)) return 0; // a cycle
    seen.add(row.name);
    const d = Math.max(-1, ...row.reads.filter((n) => byName.has(n)).map((n) => depthOf(byName.get(n), seen))) + 1;
    depth.set(row.name, d);
    return d;
  };
  const columns = [];
  rows.forEach((row) => (columns[depthOf(row)] ??= []).push(row));
  for (let i = 0; i < columns.length; i++) columns[i] ??= [];

  // Order each column by the average position of the variables it reads, then
  // of the ones that read it, a few times over (the barycenter heuristic).
  const rank = new Map();
  // A box's position is where its center ends up, in boxes from the top: columns are centered.
  const tallest = Math.max(0, ...columns.map((col) => col.length));
  const index = () => columns.forEach((col) => col.forEach((row, i) => rank.set(row.name, (tallest - col.length) / 2 + i)));
  const mean = (names, fallback) => {
    const known = names.filter((n) => rank.has(n));
    return known.length ? known.reduce((sum, n) => sum + rank.get(n), 0) / known.length : fallback;
  };
  const order = (col, neighbours) => {
    const keyed = col.map((row) => [mean(neighbours(row), rank.get(row.name)), row]);
    keyed.sort((a, b) => a[0] - b[0]);
    col.splice(0, col.length, ...keyed.map(([, row]) => row));
  };
  index();
  for (let sweep = 0; sweep < 4; sweep++) {
    for (const col of columns.slice(1)) order(col, (row) => row.reads), index();
    for (const col of columns.slice(0, -1).reverse()) order(col, (row) => row.readBy), index();
  }

  const nodes = [];
  const at = new Map();
  const height = tallest * DEBUG_NODE_HEIGHT + Math.max(0, tallest - 1) * DEBUG_ROW_GAP;
  let x = 1; // room for the outline of the nodes on the edge
  for (const col of columns) {
    const labels = col.map((row) => (row.error ? `⚠ ${row.error}` : preview(row.value, 20)));
    const width = Math.max(64, ...col.map((row, i) => Math.max(row.name.length, labels[i].length) * DEBUG_CHAR + 20));
    const used = col.length * DEBUG_NODE_HEIGHT + Math.max(0, col.length - 1) * DEBUG_ROW_GAP;
    col.forEach((row, i) => {
      const node = { row, label: labels[i], x, y: 1 + (height - used) / 2 + i * (DEBUG_NODE_HEIGHT + DEBUG_ROW_GAP), width, height: DEBUG_NODE_HEIGHT };
      nodes.push(node);
      at.set(row.name, node);
    });
    x += width + DEBUG_COLUMN_GAP;
  }
  const edges = rows.flatMap((row) => row.reads.filter((n) => at.has(n)).map((n) => ({ from: at.get(n), to: at.get(row.name) })));
  return { nodes, edges, width: Math.max(0, x - DEBUG_COLUMN_GAP) + 2, height: height + 2 };
}

function htmlNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svgNode(tag, attrs, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text != null) node.textContent = text;
  return node;
}

/** A short, one-line version of any value, for <t-debug>. */
function preview(value, max = 48) {
  if (typeof value === "function") return `ƒ ${value.name || "anonymous"}`;
  if (typeof value === "number" || typeof value === "boolean" || value == null) return String(value);
  let s;
  try {
    s = JSON.stringify(value) ?? String(value);
  } catch {
    s = String(value);
  }
  if (s.length <= max) return s;
  return Array.isArray(value) ? `Array(${value.length}) ${s.slice(0, max - 12)}…` : `${s.slice(0, max - 1)}…`;
}

// <t-debug></t-debug>
// A live table of variables: their values, what each reads and what reads it, and
// which elements show it. Inside a <t-scope> it shows that scope, elsewhere every
// scope on the page. Hovering a row outlines the elements that show the variable.
// Add ?tangle-debug to any page's URL to float one over it.
export class TDebug extends Base {
  connectedCallback() {
    this._seen ??= new Map(); // the values shown last time, to flash the ones that change
    this._outlined = new Set();
    // A plain effect, not watch(): the table isn't a view of the variables, so it doesn't dim.
    this._dispose = effect(() => {
      graphVersion.value, hover.value;
      for (const [, scope] of this.scopes()) {
        for (const slot of scope.slots.values()) {
          slot.def.value;
          try {
            slot.cell.value;
          } catch {}
        }
      }
      this._frame ??= requestAnimationFrame(() => {
        this._frame = null;
        if (this.isConnected) this.render();
      });
    });
    this._onClick ??= (event) => {
      const target = event.target.closest?.(".t-debug-node, .t-debug-value");
      if (target) console.log(target.dataset.name, target._value); // the whole value, to explore
    };
    this.addEventListener("click", this._onClick);
  }

  disconnectedCallback() {
    this._dispose?.();
    cancelAnimationFrame(this._frame);
    this._frame = null;
    this.outline(new Set());
    this.removeEventListener("click", this._onClick);
  }

  /** [label, scope] for each scope shown. */
  scopes() {
    if (this.closest("t-scope")) return [["", scopeOf(this)]];
    const hosts = [...document.querySelectorAll("t-scope")];
    return [
      ["page", scopeOf(document)],
      ...hosts.map((host, i) => [host.id ? `#${host.id}` : `<t-scope> ${i + 1}`, scopeOf(host)]),
    ].filter(([, scope]) => scope.slots.size);
  }

  render() {
    const scopes = this.scopes();
    const outlined = new Set();
    const parts = [];
    const table = htmlNode("table", "t-debug-table");
    const head = table.createTHead().insertRow();
    for (const title of ["variable", "value", "reads", "read by"]) head.append(htmlNode("th", null, title));
    const body = table.createTBody();
    for (const [label, scope] of scopes) {
      const rows = inspectScope(scope).map((row) => {
        const key = keyOf(scope, row.name);
        const changed = this._seen.has(key) && !Object.is(this._seen.get(key), row.value);
        this._seen.set(key, row.value);
        const hot = hover.peek() === key;
        if (hot) for (const e of row.elements) outlined.add(e);
        return { ...row, key, changed, hot, color: scope.slot(row.name).meta.peek().color };
      });
      if (scopes.length > 1) {
        parts.push(htmlNode("div", "t-debug-scope", label));
        body.insertRow().append(Object.assign(htmlNode("th", "t-debug-scope", label), { colSpan: 4 }));
      }
      const layout = layoutGraph(rows);
      parts.push(this.graph(layout, rows.find((row) => row.hot)));
      for (const { row } of layout.nodes) body.append(this.tableRow(row));
    }
    if (!parts.length) parts.push(htmlNode("div", "t-debug-empty", "No variables yet."));
    const details = htmlNode("details", "t-debug-details");
    details.open = Boolean(this._tableOpen);
    details.addEventListener("toggle", () => (this._tableOpen = details.open));
    details.append(htmlNode("summary", null, "table"), table);
    this.replaceChildren(...parts, details);
    this.outline(outlined);
  }

  /** The variables as a graph: an edge from each variable to the formulas that read it. */
  graph({ nodes, edges, width, height }, hot) {
    const svg = svgNode("svg", { class: "t-debug-graph", width, height, viewBox: `0 0 ${width} ${height}` });
    for (const { from, to } of edges) {
      const x1 = from.x + from.width;
      const y1 = from.y + from.height / 2;
      const x2 = to.x;
      const y2 = to.y + to.height / 2;
      const mid = (x1 + x2) / 2;
      const lit = hot && (from.row === hot || to.row === hot);
      svg.append(svgNode("path", {
        class: lit ? "t-debug-edge is-hot" : hot ? "t-debug-edge is-faded" : "t-debug-edge",
        d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`,
      }));
    }
    for (const node of nodes) {
      const { row } = node;
      const kind = row.pending ? "loading" : row.kind;
      const g = svgNode("g", {
        class: `t-debug-node is-${kind}${row.hot ? " is-hot" : ""}${row.changed ? " is-changed" : ""}${row.error ? " is-error" : ""}`,
        transform: `translate(${node.x},${node.y})`,
        "data-tangle-hover": row.key,
      });
      if (row.color) g.style.setProperty("--tangle-color", row.color);
      g._value = row.error ?? row.value;
      g.dataset.name = row.name;
      g.append(
        svgNode("rect", { width: node.width, height: node.height, rx: 6 }),
        svgNode("text", { x: 10, y: 15, class: "t-debug-node-name" }, row.name),
        svgNode("text", { x: 10, y: 29, class: "t-debug-node-value" }, node.label),
        svgNode("title", {}, `${row.name} (${row.kind === "unset" ? "never set" : kind}${row.kind === "formula" ? `, ran ${row.runs}×` : ""})\n${row.error ?? preview(row.value, 2000)}`),
      );
      svg.append(g);
    }
    return svg;
  }

  tableRow(row) {
    const tr = htmlNode("tr");
    tr.dataset.tangleHover = row.key;
    tr.classList.toggle("is-changed", row.changed);
    tr.classList.toggle("is-hot", row.hot);
    const name = htmlNode("td", "t-debug-name", row.name);
    if (row.color) name.style.setProperty("--tangle-color", row.color);
    const kind = row.pending ? "loading" : row.kind === "unset" ? "never set" : row.kind;
    const runs = row.kind === "formula" ? ` ×${row.runs}` : "";
    name.append(htmlNode("span", `t-debug-kind is-${row.pending ? "loading" : row.kind}`, kind + runs));
    const value = htmlNode("td", "t-debug-value", row.error ? `⚠ ${row.error}` : preview(row.value));
    value.classList.toggle("is-error", Boolean(row.error) || row.kind === "unset");
    value.dataset.name = row.name;
    value._value = row.error ?? row.value;
    value.title = row.error ?? preview(row.value, 2000);
    const counts = new Map();
    for (const e of row.elements) counts.set(e.localName, (counts.get(e.localName) ?? 0) + 1);
    const shown = [...counts].map(([tag, n]) => (n > 1 ? `<${tag}> ×${n}` : `<${tag}>`));
    tr.append(name, value, htmlNode("td", null, row.reads.join(", ")), htmlNode("td", null, [...row.readBy, ...shown].join(", ")));
    return tr;
  }

  outline(elements) {
    for (const el of this._outlined) if (!elements.has(el)) el.classList.remove("t-debug-target");
    for (const el of elements) el.classList.add("t-debug-target");
    this._outlined = elements;
  }
}
