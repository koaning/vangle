# McNugget numbers

Chicken McNuggets used to come in boxes of 6, 9 and 20. You can buy 15 nuggets (6 + 9) or
26 (6 + 20), but not 16, however you combine the boxes. Which totals can you buy, and is
there a largest one you can't?

<div class="example nuggets" data-show-source>
  <p>With boxes of <t-num name="a" min="1" max="50" color="#246bce #75a7ff">6</t-num>,
    <t-num name="b" min="1" max="50" color="#147a68 #5ed5bd">9</t-num> and
    <t-num name="c" min="0" max="50" color="#8a4fd1 #c4a3ff">20</t-num> nuggets,
    <t-out expr="info.gcd > 1
      ? `every box holds a multiple of ${info.gcd}, so you can only buy multiples of ${info.gcd}. There's no largest total you can't buy.`
      : info.largest === 0
        ? 'you can buy any number of nuggets.'
        : `you can buy any number above ${info.largest}. Only ${info.missing} totals are impossible, and ${info.largest} is the largest of them.`"></t-out></p>
  <t-let name="info" expr="nuggets([a, b, c])"></t-let>
  <div class="grid" aria-hidden="true"></div>
  <p>Point at a total in the grid, or drag this one:
    <t-num name="pick" min="1" max="100">44</t-num> nuggets is
    <t-out expr="info.fewest[pick] === Infinity
      ? 'impossible'
      : `${recipe(info, pick)}, ${info.fewest[pick] === 1 ? 'one box' : `${info.fewest[pick]} boxes`}`"></t-out>.</p>
</div>

<script type="module" data-show-source>
  import { registerFunction, scopeOf } from "../tangle.js";

  const LIMIT = 2600; // beyond the largest impossible total, for any boxes of up to 50

  // For every total up to LIMIT: the fewest boxes that make it exactly (Infinity if no
  // combination does), and the box added last. Each total is a smaller one plus one box.
  function nuggets(boxes) {
    boxes = [...new Set(boxes.filter((size) => size > 0))];
    const fewest = new Array(LIMIT + 1).fill(Infinity);
    const last = new Array(LIMIT + 1).fill(0);
    fewest[0] = 0;
    for (let total = 1; total <= LIMIT; total++) {
      for (const size of boxes) {
        if (size <= total && fewest[total - size] + 1 < fewest[total]) {
          fewest[total] = fewest[total - size] + 1;
          last[total] = size;
        }
      }
    }
    const gcd = boxes.reduce((g, size) => { while (size) [g, size] = [size, g % size]; return g; }, 0);
    let largest = 0, missing = 0;
    for (let total = 1; total <= LIMIT; total++) {
      if (fewest[total] === Infinity) [largest, missing] = [total, missing + 1];
    }
    return { fewest, last, gcd, largest, missing };
  }

  // Follows the boxes back from `total` to 0: "1 × 20 + 2 × 9 + 1 × 6".
  function recipe({ last }, total) {
    const counts = new Map();
    for (let t = total; t > 0; t -= last[t]) counts.set(last[t], (counts.get(last[t]) ?? 0) + 1);
    return [...counts].sort(([x], [y]) => y - x).map(([size, k]) => `${k} × ${size}`).join(" + ");
  }

  registerFunction("nuggets", nuggets);
  registerFunction("recipe", recipe);

  // Every grid on the page shows the totals 1 to 100, for the boxes of its scope.
  for (const grid of document.querySelectorAll(".nuggets .grid")) {
    const scope = scopeOf(grid);
    const cells = Array.from({ length: 100 }, (_, i) => {
      const cell = document.createElement("span");
      cell.textContent = i + 1;
      cell.addEventListener("pointerenter", () => scope.set("pick", i + 1));
      return cell;
    });
    grid.replaceChildren(...cells);

    // Recolors the grid whenever the boxes (and so info) or the picked total change.
    scope.effect((s) => {
      const info = s.get("info"), pick = s.get("pick");
      if (!info) return;
      cells.forEach((cell, i) => {
        const total = i + 1;
        cell.classList.toggle("can", info.fewest[total] < Infinity);
        cell.classList.toggle("largest", info.gcd === 1 && total === info.largest);
        cell.classList.toggle("picked", total === pick);
      });
    });
  }
</script>

<style data-show-source>
  .nuggets { --largest: light-dark(#b45b1b, #ffad66); }
  .nuggets .grid {
    display: grid; grid-template-columns: repeat(10, 1fr); gap: 3px; margin: 0.5rem 0 1rem;
    font: 0.8rem system-ui, sans-serif; font-variant-numeric: tabular-nums;
  }
  .nuggets .grid span {
    display: grid; place-items: center; aspect-ratio: 1.6; border-radius: 4px; cursor: default;
    background: color-mix(in srgb, currentColor 5%, transparent); color: color-mix(in srgb, currentColor 45%, transparent);
  }
  .nuggets .grid .can { background: color-mix(in srgb, var(--tangle-accent) 22%, transparent); color: inherit; }
  .nuggets .grid .largest { background: var(--largest); color: var(--tangle-surface); font-weight: 600; }
  .nuggets .grid .picked { outline: 2px solid currentColor; outline-offset: -1px; }
</style>

The blue totals can be bought, and the orange one is the largest that can't. Past it, every
total can be bought: once you can make six totals in a row, adding a box of 6 to each makes the
next six, and so on.

## The search, as a graph

The search above runs through the totals in order. Draw it instead: every total is a dot, and every
box is a line from one total to a bigger one. Starting from 0, follow the lines.

<div class="example nuggets" data-show-source>
  <p>Each total up to <t-num name="limit" min="20" max="100" step="5">80</t-num> is a dot. A line
    adds a box of <t-num name="a"></t-num>, <t-num name="b"></t-num> or
    <t-num name="c"></t-num>, in the box's color. A total you can't buy has no line into it, so it
    drifts off on its own. Drag a dot to pull the shape around, or point at one to light up the
    fewest boxes that reach it.</p>
  <t-let name="edges" expr="search([a, b, c], limit)"></t-let>
  <t-let name="shown" expr="Math.round(progress / 100 * edges.length)"></t-let>
  <svg class="graph" viewBox="-360 -250 720 500" role="img" aria-label="The totals as a graph, joined by boxes">
    <g class="links"></g>
    <g class="nodes"></g>
  </svg>
  <p><button type="button" id="play">Play the search</button>
    <t-num name="progress" min="0" max="100" format="%d%%">100</t-num> done.
    <t-out expr="shown === 0 ? 'Start at 0.' : `From ${edges[shown - 1].from}, a box of ${edges[shown - 1].size} reaches ${edges[shown - 1].to}.`"></t-out></p>
  <p><t-num name="pick"></t-num> nuggets is
    <t-out expr="info.fewest[pick] === Infinity ? 'impossible' : recipe(info, pick)"></t-out>.</p>
</div>

<script type="module" data-show-source>
  import { registerFunction, scopeOf } from "../tangle.js";
  import { forceSimulation, forceLink, forceManyBody, forceX, forceY, forceCollide } from "https://cdn.jsdelivr.net/npm/d3-force@3/+esm";

  // A breadth-first search from 0: take the next total off the queue, and add each box to it.
  // Every line it draws is one step, so `shown` replays the search up to that step.
  function search(boxes, limit) {
    const sizes = [...new Set(boxes.filter((size) => size > 0))].sort((x, y) => x - y);
    const edges = [], seen = new Set([0]), queue = [0];
    while (queue.length) {
      const from = queue.shift();
      for (const size of sizes) {
        const to = from + size;
        if (to > limit) continue;
        edges.push({ from, to, size });
        if (!seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    return edges;
  }
  registerFunction("search", search);

  const root = document.querySelector("#play").closest(".example");
  const scope = scopeOf(root);
  const svg = root.querySelector("svg");
  const [linkLayer, nodeLayer] = svg.querySelectorAll(".links, .nodes");
  const toSvg = (event) => new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());

  // The layout is a physics simulation: lines pull their dots together, dots push each other
  // apart, and a weak pull to the middle keeps the loose ones on screen.
  let nodes = [], links = [], lines = [], dots = [];
  const simulation = forceSimulation()
    .force("charge", forceManyBody().strength(-90))
    .force("collide", forceCollide(11))
    .force("x", forceX().strength(0.06))
    .force("y", forceY().strength(0.09))
    .on("tick", () => {
      for (const d of nodes) {
        d.x = Math.max(-350, Math.min(350, d.x));
        d.y = Math.max(-240, Math.min(240, d.y));
      }
      links.forEach((l, i) => {
        lines[i].setAttribute("x1", l.source.x); lines[i].setAttribute("y1", l.source.y);
        lines[i].setAttribute("x2", l.target.x); lines[i].setAttribute("y2", l.target.y);
      });
      nodes.forEach((d, i) => dots[i].setAttribute("transform", `translate(${d.x},${d.y})`));
    });

  // Rebuilds the dots and lines for new boxes or a new limit. Dots that were there keep their place.
  function build(edges, limit, boxes) {
    const old = new Map(nodes.map((d) => [d.id, d]));
    nodes = Array.from({ length: limit + 1 }, (_, id) => old.get(id) ?? { id });
    links = edges.map((e) => ({ source: e.from, target: e.to, color: boxes.indexOf(e.size) }));
    linkLayer.innerHTML = links.map((l) => `<line class="box-${l.color}"/>`).join("");
    nodeLayer.innerHTML = nodes.map((d) => `<g><circle r="${d.id ? 9 : 12}"/><text>${d.id}</text></g>`).join("");
    lines = [...linkLayer.children];
    dots = [...nodeLayer.children];
    dots.forEach((dot, id) => {
      dot.addEventListener("pointerenter", () => id && scope.set("pick", id));
      dot.addEventListener("pointerdown", (event) => drag(event, nodes[id]));
    });
    simulation.nodes(nodes).force("link", forceLink(links).id((d) => d.id).distance(34).strength(0.6));
    simulation.alpha(0.8).restart();
  }

  // Dragging pins a dot to the pointer, and lets go of it on release.
  function drag(event, d) {
    const dot = event.currentTarget;
    dot.setPointerCapture(event.pointerId);
    const move = (event) => {
      const p = toSvg(event);
      [d.fx, d.fy] = [p.x, p.y];
      simulation.alphaTarget(0.3).restart();
    };
    move(event);
    dot.addEventListener("pointermove", move);
    dot.addEventListener("lostpointercapture", () => {
      dot.removeEventListener("pointermove", move);
      d.fx = d.fy = null;
      simulation.alphaTarget(0);
    }, { once: true });
  }

  // Rebuilds when the boxes or the limit change, and repaints for the step and the picked total.
  let built = null;
  scope.effect((s) => {
    const edges = s.get("edges"), info = s.get("info"), shown = s.get("shown"), pick = s.get("pick");
    if (!edges || !info) return;
    if (edges !== built) {
      build(edges, s.get("limit"), [s.get("a"), s.get("b"), s.get("c")]);
      built = edges;
    }

    // The fewest boxes to `pick`, as the set of totals on the way and the lines between them.
    const path = new Set();
    for (let t = info.fewest[pick] < Infinity ? pick : 0; t > 0; t -= info.last[t]) path.add(t);
    if (path.size) path.add(0);
    const reached = new Set([0, ...edges.slice(0, shown).map((e) => e.to)]);
    lines.forEach((line, i) => {
      const { from, to } = edges[i];
      line.classList.toggle("hidden", i >= shown);
      line.classList.toggle("on-path", path.has(from) && path.has(to) && info.last[to] === to - from);
    });
    dots.forEach((dot, id) => {
      dot.classList.toggle("reached", reached.has(id));
      dot.classList.toggle("impossible", info.fewest[id] === Infinity);
      dot.classList.toggle("largest", info.gcd === 1 && id === info.largest);
      dot.classList.toggle("on-path", path.has(id));
    });
  });

  // Playing replays the search from the start, one line at a time.
  let frame = null;
  document.querySelector("#play").addEventListener("click", () => {
    cancelAnimationFrame(frame);
    const start = performance.now(), duration = 40 * scope.peek("edges").length;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      scope.set("progress", Math.round(t * 100));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  });
</script>

<style data-show-source>
  .nuggets { --box-0: light-dark(#246bce, #75a7ff); --box-1: light-dark(#147a68, #5ed5bd); --box-2: light-dark(#8a4fd1, #c4a3ff); }
  .nuggets .graph { display: block; width: 100%; height: auto; margin: 0.5rem 0; touch-action: none; }
  .nuggets .graph line { stroke-width: 1.5; stroke-opacity: 0.55; transition: stroke-opacity 150ms; }
  .nuggets .graph line.hidden { stroke-opacity: 0; }
  .nuggets .graph line.on-path { stroke-width: 4; stroke-opacity: 1; }
  .nuggets .graph .box-0 { stroke: var(--box-0); }
  .nuggets .graph .box-1 { stroke: var(--box-1); }
  .nuggets .graph .box-2 { stroke: var(--box-2); }
  .nuggets .graph g g { cursor: grab; }
  .nuggets .graph circle { fill: var(--tangle-surface); stroke: currentColor; stroke-opacity: 0.25; transition: fill 150ms; }
  .nuggets .graph text { font: 600 8px system-ui, sans-serif; text-anchor: middle; dominant-baseline: central; fill: currentColor; fill-opacity: 0.4; pointer-events: none; }
  .nuggets .graph .reached circle { fill: color-mix(in srgb, currentColor 75%, transparent); stroke: none; }
  .nuggets .graph .reached text { fill: var(--tangle-surface); fill-opacity: 1; }
  .nuggets .graph .impossible circle { stroke-dasharray: 2 2; stroke-opacity: 0.5; }
  .nuggets .graph .largest circle { fill: var(--largest); stroke: none; }
  .nuggets .graph .largest text { fill: var(--tangle-surface); fill-opacity: 1; }
  .nuggets .graph .on-path circle { fill: var(--tangle-accent); }
  .nuggets .graph .on-path text { fill: var(--tangle-surface); fill-opacity: 1; }
</style>

Each dot is linked to the dots one box above and below it, so for 6, 9 and 20 the totals settle
into a ring, held together by lines of all three colors. The impossible totals are all small, and they
float around the start. Press **Play the search** to watch it spread from 0: a breadth-first
search, which reaches every total by the fewest boxes.

## Two boxes have a formula

With only two box sizes *p* and *q* that share no factor, the largest total you can't buy is
*pq* − *p* − *q*, and (*p* − 1)(*q* − 1)/2 totals can't be bought in all: half of the totals up
to the largest. For three or more box sizes there's no formula like it. You have to search, as the scripts above do.

<t-scope class="example nuggets" data-show-source>
  <t-var name="p" value="5" min="2" max="30" color="#246bce #75a7ff"></t-var>
  <t-var name="q" value="7" min="2" max="30" color="#b45b1b #ffad66"></t-var>
  <t-var name="pick" value="23" min="1" max="100"></t-var>
  <t-let name="info" expr="nuggets([p, q])"></t-let>
  <t-math display>
    \underbrace{\tangle{p}\cdot\tangle{q} - \tangle{p} - \tangle{q}}_{\text{largest impossible}} = \val{p * q - p - q}
    \qquad
    \underbrace{\frac{(\tangle{p} - 1)(\tangle{q} - 1)}{2}}_{\text{impossible totals}} = \val{(p - 1) * (q - 1) / 2}
  </t-math>
  <p><t-out expr="info.gcd > 1
    ? `But ${p} and ${q} share the factor ${info.gcd}, so the formula doesn't apply: only multiples of ${info.gcd} can be bought.`
    : info.largest > 100
      ? `The search agrees: ${info.largest} is the largest, past the end of this grid, and ${info.missing} totals are impossible.`
      : `The search agrees: ${info.largest} is the largest, and ${info.missing} totals are impossible.`"></t-out></p>
  <div class="grid" aria-hidden="true"></div>
</t-scope>

## Things to try

- **Order a Happy Meal.** Kids' meals came with 4 nuggets. Change the box of 20 to 4, and the
  largest total you can't buy drops from 43 to 11. (The 20 doesn't matter then: it's five 4s.)
- **Share a factor.** Make the boxes 6, 9 and 21. They're all multiples of 3, so the grid
  shows stripes, and in the graph two of every three totals come loose.
- **Make a chain.** Set the boxes to 1, 1 and 0. The graph is one long line from 0 to the
  limit. Change the second box to 2, and the line folds into a ladder.
- **Drop a box.** Set the third box to 0, so only 6 and 9 are left. They share the factor 3,
  so there's no largest. Then change 9 to 7.
- **Go big.** Make the two boxes in the formula 29 and 30. The largest impossible total is 811,
  far beyond the grid.

## How it's built

- **The search is a function.** The script [registers](expressions.md#functions) `nuggets`,
  which works out, for every total up to 2,600, the fewest boxes that make it. A
  [`<t-let>`](t-let.md) calls it with the box sizes, so `info` is recomputed whenever one
  changes. The prose reads `info.largest`, `info.missing` and `info.gcd` from it.
- **The grid is drawn by an effect.** The script makes the 100 cells once, then a
  `scope.effect` reads `info` and `pick` and toggles a class on each cell. Pointing at a cell
  calls `scope.set("pick", …)`, which updates the recipe in the text.
- **The graph is a d3-force simulation.** The second script imports
  [d3-force](https://d3js.org/d3-force) from jsDelivr and registers `search`, a breadth-first
  search that lists the lines in the order it finds them. One effect rebuilds the dots and lines
  when `edges` changes, keeping the dots that are still there in place, and repaints them for
  `shown` and `pick`. The tick handler only moves them.
- **Playing is a variable.** `progress` is an ordinary `<t-num>`, so you can scrub the search
  by dragging it. The play button sets it on every animation frame, from 0 to 100.
- **Shared variables, and a scope of its own.** The first two examples use the page-wide scope,
  so the graph and the grid show the same boxes and the same picked total. The formula example is
  a [`<t-scope>`](t-scope.md) with its own `info` and `pick`. It names its boxes `p` and `q`
  and passes `[p, q]` to the same function, and the grid script draws a grid in each scope.

Ported from the McNugget graph demo in [wigglystuff](https://github.com/koaning/wigglystuff).
