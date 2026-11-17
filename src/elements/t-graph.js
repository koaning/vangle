import { untracked } from "../core/signals.js";
import { evalWith } from "../core/scope.js";
import { loadD3 } from "../core/load.js";
import { TangleElement } from "../core/element.js";

// ---------------------------------------------------------------------------
// <t-graph>: nodes and edges from an expression, laid out by d3-force. The
// expression reruns when a variable it read changes, and nodes that stay keep
// their place. The picked node (name) and the hovered one (hover) are variables.
// ---------------------------------------------------------------------------

const GRAPH_KEYS = ["nodes", "edges", "directed"];
const GRAPH_RADIUS = 8; // a node's radius without a size
const GRAPH_PAD = 4; // between the box's edge and a node
const GRAPH_HEAD = 7; // arrowhead length
const GRAPH_HEAD_HALF = 3.5;

const graphKey = String;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Ids made unique the way GraphWidget does: a second "a" becomes "a-1". */
function uniqueId(id, used) {
  let out = id;
  for (let k = 1; used.has(out); k++) out = `${id}-${k}`;
  used.add(out);
  return out;
}

/**
 * A graph spec, normalized. A node is a string or number (its id and its name), or an
 * object with any of id, name, size, color, data. An edge is a [source, target] pair, or
 * an object with source, target and any of id, name, width, color, data. Endpoints are
 * ids, unique names, or indexes into the nodes. Every node and edge gets a string id.
 */
export function graphData(spec) {
  if (!isObject(spec)) throw new Error("the expression should give { nodes, edges }");
  const unknown = Object.keys(spec).filter((k) => !GRAPH_KEYS.includes(k));
  if (unknown.length) throw new Error(`unknown key ${unknown.join(", ")} (the keys are ${GRAPH_KEYS.join(", ")})`);
  const rawNodes = spec.nodes ?? [];
  const rawEdges = spec.edges ?? [];
  if (!Array.isArray(rawNodes)) throw new Error("nodes should be an array");
  if (!Array.isArray(rawEdges)) throw new Error("edges should be an array");

  // A name that appears once can be a node's id.
  const nameCount = new Map();
  const count = (name) => nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
  for (const n of rawNodes) {
    if (!isObject(n)) count(graphKey(n));
    else if (n.id == null && n.name != null) count(graphKey(n.name));
  }
  const usedNodes = new Set();
  const nodes = rawNodes.map((n, i) => {
    let node, id;
    if (isObject(n)) {
      node = { ...n };
      if (node.name != null) node.name = graphKey(node.name);
      if (node.id != null) id = graphKey(node.id);
      else if (node.name != null && nameCount.get(node.name) === 1) id = node.name;
      else id = `node-${i}`;
    } else {
      node = { name: graphKey(n) };
      id = nameCount.get(node.name) === 1 ? node.name : `node-${i}`;
    }
    node.id = uniqueId(id, usedNodes);
    return node;
  });

  // Endpoints: an id, then a name only one node has, then an index.
  const lookup = new Map(nodes.map((n) => [n.id, n.id]));
  const names = new Map();
  for (const n of nodes) if (n.name != null) names.set(n.name, names.has(n.name) ? null : n.id);
  for (const [name, id] of names) if (id !== null && !lookup.has(name)) lookup.set(name, id);
  const resolve = (end) => {
    const id = lookup.get(graphKey(end));
    if (id !== undefined) return id;
    if (Number.isInteger(end) && end >= 0 && end < nodes.length) return nodes[end].id;
    throw new Error(`an edge goes to ${JSON.stringify(end)}, which isn't a node`);
  };
  const usedEdges = new Set();
  const edges = rawEdges.map((e, i) => {
    let edge;
    if (Array.isArray(e) && e.length >= 2) edge = { source: e[0], target: e[1] };
    else if (isObject(e) && "source" in e && "target" in e) edge = { ...e };
    else throw new Error("an edge should be a [source, target] pair or { source, target }");
    edge.source = resolve(edge.source);
    edge.target = resolve(edge.target);
    if (edge.name != null) edge.name = graphKey(edge.name);
    edge.id = uniqueId(graphKey(edge.id ?? `edge-${i}`), usedEdges);
    return edge;
  });

  return {
    nodes,
    edges,
    directed: Boolean(spec.directed),
  };
}

/** A color: a number n is the theme's --tangle-dag-n, and "a b" is a in light mode, b in dark. */
function graphColor(color, fallback) {
  if (typeof color === "number") return `var(--tangle-dag-${(((Math.round(color) - 1) % 8) + 8) % 8 + 1})`;
  if (typeof color !== "string" || !color.trim()) return fallback;
  const parts = color.trim().split(/\s+/);
  return parts.length === 2 ? `light-dark(${parts[0]}, ${parts[1]})` : color;
}

const radiusOf = (n) => Math.max(2, Number(n.size) || GRAPH_RADIUS);

/** Whether two values hold the same node data, to stop a graph that reads its own pick from looping. */
function sameNode(a, b) {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** The id a variable's value names: a node object's id, or an id itself. */
function idOf(value) {
  if (value == null) return null;
  return isObject(value) ? (value.id == null ? null : graphKey(value.id)) : graphKey(value);
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// <t-graph name="picked" hover="h"><script type="text/plain">{ nodes, edges }</script></t-graph>
// or <t-graph src="graph.js">.
export class TGraph extends TangleElement {
  connectedCallback() {
    this._source ??= this.hasAttribute("src")
      ? fetch(this.getAttribute("src")).then((r) => {
          if (!r.ok) throw new Error(`${this.getAttribute("src")}: ${r.status}`);
          return r.text();
        })
      : Promise.resolve(this.querySelector("script")?.textContent ?? this.textContent);
    if (!this._box) {
      this._box = document.createElement("div");
      this._box.className = "tangle-graph is-loading";
      this._box.textContent = "Loading graph…";
      this.append(this._box);
    }
    const token = (this._token = {});
    Promise.all([loadD3(), this._source]).then(
      ([d3, expr]) => {
        if (this._token === token && this.isConnected) this.start(d3, expr);
      },
      (error) => {
        if (this._token === token) this.showError(error);
      },
    );
  }

  disconnectedCallback() {
    this._token = null;
    this._resize?.disconnect();
    this._sim?.stop();
    super.disconnectedCallback();
  }

  start(d3, expr) {
    const scope = this.scope;
    if (!this._svg) this.build(d3);
    this._resize = new ResizeObserver(() => {
      if (this.clientWidth && this.clientWidth !== this._width) this.resize();
    });
    this._resize.observe(this);
    this.watch(() => {
      let data;
      try {
        // Inside the effect, so every variable the expression reads is tracked.
        data = graphData(evalWith(scope, expr, { d3 }));
      } catch (error) {
        this.showError(error);
        return;
      }
      untracked(() => this.draw(data));
    });
    const name = this.getAttribute("name");
    if (name) {
      this.watch(() => {
        const id = idOf(scope.get(name));
        untracked(() => {
          this._picked = id;
          this.paintPicked();
        });
      });
    }
  }

  build(d3) {
    this._d3 = d3;
    this._box.className = "tangle-graph";
    this._box.textContent = "";
    this._svg = svgEl("svg", { class: "tangle-graph-svg" });
    this._svg.setAttribute("aria-label", this.getAttribute("label") ?? "Graph");
    this._edgeLayer = svgEl("g", { class: "tangle-graph-edges" });
    this._labelLayer = svgEl("g", { class: "tangle-graph-edge-labels" });
    this._nodeLayer = svgEl("g", { class: "tangle-graph-nodes" });
    this._svg.append(this._edgeLayer, this._labelLayer, this._nodeLayer);
    this._tip = Object.assign(document.createElement("div"), { className: "tangle-graph-tooltip", hidden: true });
    this._box.append(this._svg, this._tip);

    // How it's shown is up to the attributes; the expression only says what the graph is.
    const attr = (name, fallback) => Number(this.getAttribute(name)) || fallback;
    this._height = attr("height", 400);
    this._nodes = []; // the layout's nodes, each { id, spec, x, y, ... }
    this._edges = [];
    this._sim = d3
      .forceSimulation()
      .force("link", d3.forceLink().id((d) => d.id).distance(attr("distance", 60)))
      .force("charge", d3.forceManyBody().strength(attr("charge", -160)))
      .force("x", d3.forceX().strength(0.06))
      .force("y", d3.forceY().strength(0.06))
      .force("collide", d3.forceCollide().radius((d) => radiusOf(d.spec) + 4))
      .on("tick", () => this.tick())
      .stop();

    this._svg.addEventListener("click", (event) => {
      if (event.target === this._svg) this.pick(null);
    });
  }

  /** Puts a node, or null, in the name variable. */
  pick(node) {
    const name = this.getAttribute("name");
    if (!name) return;
    const scope = this.scope;
    const now = idOf(scope.peek(name));
    scope.set(name, node && now !== node.id ? node.spec : null);
  }

  setHover(node) {
    const name = this.getAttribute("hover");
    if (name) this.scope.set(name, node ? node.spec : null);
  }

  /** Shows a new spec. Nodes that keep their id keep their place; new ones start next to a neighbour. */
  draw(data) {
    this._error?.remove();
    if (!this._box.isConnected) this.append(this._box);
    this._data = data;
    const old = new Map(this._nodes.map((n) => [n.id, n]));
    const width = this.clientWidth || this._width || 640;
    const placed = new Map();
    let kept = 0;
    this._nodes = data.nodes.map((spec, i) => {
      const prev = old.get(spec.id);
      if (prev) {
        kept++;
        prev.spec = spec;
        placed.set(spec.id, prev);
        return prev;
      }
      const node = { id: spec.id, spec };
      if (Number.isFinite(spec.x) && Number.isFinite(spec.y)) Object.assign(node, { x: spec.x, y: spec.y });
      else {
        // Next to a neighbour that's already placed, else on a sunflower spiral round the middle.
        const edge = data.edges.find((e) => (e.source === spec.id && placed.has(e.target)) || (e.target === spec.id && placed.has(e.source)));
        if (edge) {
          const anchor = placed.get(edge.source === spec.id ? edge.target : edge.source);
          const angle = i * 2.399963229728653;
          Object.assign(node, { x: anchor.x + Math.cos(angle) * 30, y: anchor.y + Math.sin(angle) * 30 });
        } else {
          const angle = i * 2.399963229728653;
          const r = 10 * Math.sqrt(i + 1);
          Object.assign(node, { x: width / 2 + Math.cos(angle) * r, y: this._height / 2 + Math.sin(angle) * r });
        }
      }
      placed.set(spec.id, node);
      return node;
    });
    this._edges = data.edges.map((spec) => ({ id: spec.id, spec, source: spec.source, target: spec.target }));

    const sim = this._sim;
    const topology = `${data.nodes.map((n) => n.id).join("\n")}\n\n${data.edges.map((e) => `${e.source}\n${e.target}`).join("\n")}`;
    const moved = topology !== this._topology;
    this._topology = topology;
    sim.nodes(this._nodes);
    sim.force("link").links(this._edges);
    sim.force("collide").radius((d) => radiusOf(d.spec) + 4);
    this.render();
    this.size(width);
    if (moved) {
      // A mostly new graph gets a full layout; a few new nodes or edges only nudge the rest.
      const fresh = 1 - kept / Math.max(1, this._nodes.length);
      const alpha = fresh > 0.5 ? 1 : Math.max(0.3, fresh);
      if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        sim.alpha(alpha);
        for (let i = 0; i < 300 && sim.alpha() > sim.alphaMin(); i++) sim.tick();
        this.tick();
      } else sim.alpha(alpha).restart();
    } else this.tick();

    // The variables follow the new spec: a node that's gone is null, one that changed is its
    // new object, and an id set from elsewhere becomes its node. An id with no node yet stays.
    for (const attr of ["name", "hover"]) {
      const name = this.getAttribute(attr);
      const value = name ? this.scope.peek(name) : null;
      if (value == null) continue;
      const node = placed.get(idOf(value));
      if (!node) {
        if (isObject(value)) this.scope.set(name, null);
      } else if (!sameNode(value, node.spec)) this.scope.set(name, node.spec);
    }
  }

  /** Makes the elements for the current nodes and edges, keyed by id. */
  render() {
    const d3 = this._d3;
    const data = this._data;
    const pickable = this.hasAttribute("name");
    // Nodes the reader can pick are buttons, which an img would hide from screen readers.
    this._svg.setAttribute("role", pickable ? "group" : "img");

    d3.select(this._edgeLayer)
      .selectAll("g.tangle-graph-edge")
      .data(this._edges, (d) => d.id)
      .join((enter) => {
        const g = enter.append("g").attr("class", "tangle-graph-edge");
        g.append("path").attr("class", "tangle-graph-line");
        g.append("path").attr("class", "tangle-graph-head");
        return g;
      })
      .style("--edge", (d) => graphColor(d.spec.color, null))
      .each(function (d) {
        this.firstChild.setAttribute("stroke-width", Math.max(0.5, Number(d.spec.width) || 1.5));
        this.lastChild.setAttribute("display", data.directed ? "inline" : "none");
      })
      .on("pointerenter", (event, d) => this.showTip(event, d.spec))
      .on("pointerleave", () => this.hideTip());

    d3.select(this._labelLayer)
      .selectAll("text")
      .data(this._edges.filter((e) => e.spec.name), (d) => d.id)
      .join("text")
      .attr("class", "tangle-graph-edge-label")
      .text((d) => d.spec.name);

    const drag = d3
      .drag()
      .clickDistance(4)
      .on("start", (event, d) => {
        if (!event.active) this._sim.alphaTarget(0.2).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) this._sim.alphaTarget(0);
        d.fx = d.fy = null;
      });
    d3.select(this._nodeLayer)
      .selectAll("g.tangle-graph-node")
      .data(this._nodes, (d) => d.id)
      .join((enter) => {
        const g = enter.append("g").attr("class", "tangle-graph-node");
        g.append("circle");
        g.append("text").attr("class", "tangle-graph-label");
        g.call(drag)
          .on("pointerenter", (event, d) => {
            this.showTip(event, d.spec);
            this.setHover(d);
          })
          .on("pointerleave", () => {
            this.hideTip();
            this.setHover(null);
          })
          .on("click", (event, d) => this.pick(d))
          .on("keydown", (event, d) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            this.pick(d);
          })
          .on("focus", (event, d) => this.setHover(d))
          .on("blur", () => this.setHover(null));
        return g;
      })
      .attr("tabindex", pickable ? 0 : null)
      .attr("role", pickable ? "button" : null)
      .attr("aria-label", (d) => d.spec.name ?? d.id)
      .classed("is-pickable", pickable)
      .style("--node", (d) => graphColor(d.spec.color, null))
      .each(function (d) {
        const r = radiusOf(d.spec);
        this.firstChild.setAttribute("r", r);
        const label = this.lastChild;
        label.setAttribute("y", r + 12);
        label.textContent = d.spec.name ?? "";
      });
    this.paintPicked();
  }

  paintPicked() {
    if (!this._nodeLayer) return;
    for (const g of this._nodeLayer.children) {
      const on = g.__data__?.id === this._picked;
      g.classList.toggle("is-picked", on);
      if (g.hasAttribute("role")) g.setAttribute("aria-pressed", String(on));
    }
  }

  size(width) {
    this._width = width;
    const h = this._height;
    this._svg.setAttribute("width", width);
    this._svg.setAttribute("height", h);
    this._svg.setAttribute("viewBox", `0 0 ${width} ${h}`);
    this._sim.force("x").x(width / 2);
    this._sim.force("y").y(h / 2);
  }

  resize() {
    if (!this._data) return;
    this.size(this.clientWidth);
    this._sim.alpha(0.3).restart();
  }

  tick() {
    const w = this._width;
    const h = this._height;
    for (const n of this._nodes) {
      const r = radiusOf(n.spec) + GRAPH_PAD;
      n.x = Math.max(r, Math.min(w - r, n.x));
      n.y = Math.max(r, Math.min(h - r - 14, n.y)); // room for the label under the node
    }
    const directed = this._data.directed;
    for (const g of this._edgeLayer.children) {
      const { source: s, target: t } = g.__data__;
      if (s === t) {
        g.firstChild.setAttribute("d", "");
        g.lastChild.setAttribute("d", "");
        continue;
      }
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const rs = radiusOf(s.spec) + 2;
      const rt = radiusOf(t.spec) + 2;
      const x0 = s.x + ux * rs;
      const y0 = s.y + uy * rs;
      const tipX = t.x - ux * rt;
      const tipY = t.y - uy * rt;
      const back = directed ? GRAPH_HEAD : 0;
      g.firstChild.setAttribute("d", `M${x0},${y0}L${tipX - ux * back},${tipY - uy * back}`);
      if (directed) {
        const bx = tipX - ux * GRAPH_HEAD;
        const by = tipY - uy * GRAPH_HEAD;
        const px = -uy * GRAPH_HEAD_HALF;
        const py = ux * GRAPH_HEAD_HALF;
        g.lastChild.setAttribute("d", `M${tipX},${tipY}L${bx + px},${by + py}L${bx - px},${by - py}Z`);
      }
    }
    for (const text of this._labelLayer.children) {
      const { source: s, target: t } = text.__data__;
      text.setAttribute("x", (s.x + t.x) / 2);
      text.setAttribute("y", (s.y + t.y) / 2 - 4);
    }
    for (const g of this._nodeLayer.children) {
      const d = g.__data__;
      g.setAttribute("transform", `translate(${d.x},${d.y})`);
    }
  }

  /** A tooltip with the node's or edge's data, if it has any. */
  showTip(event, spec) {
    if (!isObject(spec.data)) return;
    const title = document.createElement("strong");
    title.textContent = spec.name ?? spec.id;
    const rows = Object.entries(spec.data).map(([key, value]) => {
      const row = document.createElement("div");
      const k = Object.assign(document.createElement("span"), { className: "key", textContent: `${key} ` });
      row.append(k, typeof value === "object" ? JSON.stringify(value) : String(value));
      return row;
    });
    this._tip.replaceChildren(title, ...rows);
    const box = this._box.getBoundingClientRect();
    this._tip.style.left = `${event.clientX - box.left + 12}px`;
    this._tip.style.top = `${event.clientY - box.top + 12}px`;
    this._tip.hidden = false;
  }

  hideTip() {
    this._tip.hidden = true;
  }

  showError(error) {
    this._box.remove();
    this._error ??= Object.assign(document.createElement("div"), { className: "tangle-graph-error" });
    this._error.textContent = `t-graph: ${error.message}`;
    this.append(this._error);
  }
}
