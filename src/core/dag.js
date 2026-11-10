// ---------------------------------------------------------------------------
// DAG layout for <t-formula-dag>: layering, ordering within a layer, routes
// through the layers an edge skips, and the plain geometry the arrows use.
// No DOM here: boxes are { left, right, top, bottom } in px.
// ---------------------------------------------------------------------------

// Waypoint ids: an edge that skips a layer threads one per skipped layer.
// "!" can't start a formula name, so these never collide with one.
export const DAG_WAYPOINT = "!wp";
const DAG_NEAR_X = 6; // two vertical runs closer than this read as one line

/** One cycle among `edges` as a list of names (first equals last), or null. */
export function dagCycle(names, edges) {
  const children = new Map(names.map((n) => [n, []]));
  for (const [src, dst] of edges) children.get(src).push(dst);
  const state = new Map(); // name -> "visiting" | "done"
  const stack = [];
  const visit = (n) => {
    state.set(n, "visiting");
    stack.push(n);
    for (const c of children.get(n)) {
      if (state.get(c) === "visiting") return [...stack.slice(stack.indexOf(c)), c];
      if (!state.has(c)) {
        const found = visit(c);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(n, "done");
    return null;
  };
  for (const n of names) {
    if (state.has(n)) continue;
    const found = visit(n);
    if (found) return found;
  }
  return null;
}

/**
 * The layer of each node (0 = top), as a Map: one below the deepest node it
 * comes from, so nodes without parents share the top layer. `minRows` (a Map)
 * pushes a node down to at least that layer, and everything below it follows,
 * so a minimum never puts a node above one it comes from. `edges` must be acyclic.
 */
export function dagLayers(names, edges, minRows = new Map()) {
  const parents = new Map(names.map((n) => [n, []]));
  for (const [src, dst] of edges) parents.get(dst).push(src);
  const layer = new Map();
  const place = (n) => {
    if (!layer.has(n)) {
      const below = 1 + Math.max(-1, ...parents.get(n).map(place));
      layer.set(n, Math.max(minRows.get(n) ?? 0, below));
    }
    return layer.get(n);
  };
  names.forEach(place);
  return layer;
}

/** Every ordering of `items`, starting with `items` itself. */
export function* dagPermutations(items) {
  if (items.length <= 1) {
    yield items.slice();
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of dagPermutations(rest)) yield [items[i], ...p];
  }
}

/** The first of `candidates` with the lowest `score` (stops early at zero). */
function dagBest(candidates, score) {
  let best = null;
  let bestCost = Infinity;
  for (const c of candidates) {
    const cost = score(c);
    if (cost < bestCost) {
      best = c;
      bestCost = cost;
      if (cost === 0) break;
    }
  }
  return best;
}

/**
 * Order the nodes within each layer to reduce crossings, and split every edge
 * that skips layers with waypoints. `layerOf` maps a node to its layer (from
 * dagLayers); `names` seeds each layer's order. Returns { layers, routes }:
 * `layers` top to bottom, each a list of ids (names or waypoints), and one
 * route [src, ...waypoints, dst] per edge. Layers wider than `cap` keep their
 * seeded order instead of trying every permutation. Empty layers are dropped.
 */
export function dagOrder(names, layerOf, edges, { sweeps = 8, cap = 6 } = {}) {
  const deepest = Math.max(0, ...names.map((n) => layerOf.get(n)));
  const layers = Array.from({ length: deepest + 1 }, () => []);
  for (const n of names) layers[layerOf.get(n)].push(n);

  const below = new Map(); // id -> ids one layer down, after splitting
  const link = (a, b) => (below.has(a) ? below.get(a).push(b) : below.set(a, [b]));
  const routes = [];
  let waypoints = 0;
  for (const [src, dst] of edges) {
    let prev = src;
    const chain = [src];
    for (let l = layerOf.get(src) + 1; l < layerOf.get(dst); l++) {
      const wp = `${DAG_WAYPOINT}${waypoints++}`;
      layers[l].push(wp);
      link(prev, wp);
      chain.push(wp);
      prev = wp;
    }
    link(prev, dst);
    chain.push(dst);
    routes.push(chain);
  }

  const crossings = (upper, lower) => {
    const pos = new Map(lower.map((n, i) => [n, i]));
    const segs = [];
    upper.forEach((n, i) => {
      for (const c of below.get(n) ?? []) if (pos.has(c)) segs.push([i, pos.get(c)]);
    });
    let count = 0;
    for (let a = 0; a < segs.length; a++) {
      for (let b = a + 1; b < segs.length; b++) {
        if ((segs[a][0] - segs[b][0]) * (segs[a][1] - segs[b][1]) < 0) count++;
      }
    }
    return count;
  };
  const best = (layer, score) => dagBest(dagPermutations(layer), score);
  for (let s = 0; s < sweeps; s++) {
    for (let l = 1; l <= deepest; l++) {
      if (layers[l].length <= cap) layers[l] = best(layers[l], (p) => crossings(layers[l - 1], p));
    }
    for (let l = deepest - 1; l >= 0; l--) {
      if (layers[l].length <= cap) layers[l] = best(layers[l], (p) => crossings(p, layers[l + 1]));
    }
  }
  // A minimum row can leave layers that nothing (not even a waypoint) passes through.
  return { layers: layers.filter((l) => l.length), routes };
}

/** Everything reachable from `start` along `next` (a Map of id -> ids), not counting `start`. */
export function dagReach(start, next) {
  const seen = new Set();
  const todo = [start];
  while (todo.length) {
    for (const m of next.get(todo.pop()) ?? []) {
      if (!seen.has(m)) {
        seen.add(m);
        todo.push(m);
      }
    }
  }
  return seen;
}

/** The box around `boxes`, or null when there are none. */
export function rectUnion(boxes) {
  if (!boxes.length) return null;
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    right: Math.max(...boxes.map((b) => b.right)),
    top: Math.min(...boxes.map((b) => b.top)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

/**
 * Where an arrow lands on the symbol box `sym`: "top" when no glyph covers
 * it, otherwise "right" or "left" (whichever is clear, preferring the side
 * facing the arrow, which comes down at `fromX`). `pad` is how much vertical
 * clearance a side run keeps from the glyphs next to the symbol.
 */
export function landingSide(sym, glyphs, fromX, pad = 4) {
  // Anything starting higher up over the symbol's x-range covers it: a
  // fraction bar or numerator, a limit, or a radical (whose SVG also reaches
  // down past the symbol, so don't require it to end above).
  const above = glyphs.some((g) => g.right > sym.left + 1 && g.left < sym.right - 1 && g.top < sym.top - 2);
  if (!above) return "top";
  const rowMates = glyphs.filter((g) => g.bottom > sym.top - pad && g.top < sym.bottom + pad);
  const rightClear = !rowMates.some((g) => g.left >= sym.right - 1);
  const leftClear = !rowMates.some((g) => g.right <= sym.left + 1);
  const preferRight = fromX >= (sym.left + sym.right) / 2;
  if (rightClear && (preferRight || !leftClear)) return "right";
  if (leftClear) return "left";
  return "top";
}

/**
 * The cost of stacking producers' tracks top to bottom in `order` inside one
 * gap between rows. `bySrc` maps a producer to its segments { from, to }: a
 * segment drops at `from`, runs along the track, and drops again at `to`.
 * Track i above track j crosses when i's lower drop lands inside j's run, or
 * j's upper drop starts inside i's run. When i's lower drop and j's upper drop
 * share (almost) the same x, the two read as one line: worse than a crossing.
 */
export function trackCrossings(order, bySrc) {
  let count = 0;
  const inside = (x, s) => x > Math.min(s.from, s.to) + 1 && x < Math.max(s.from, s.to) - 1;
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      for (const s of bySrc.get(order[i])) {
        for (const u of bySrc.get(order[j])) {
          if (inside(s.to, u)) count++;
          if (inside(u.from, s)) count++;
          if (Math.abs(s.to - u.from) < DAG_NEAR_X) count += 2;
        }
      }
    }
  }
  return count;
}

/** The order of the tracks in a gap with the fewest crossings (`seed` when more than `cap`). */
export function trackOrder(seed, bySrc, cap = 6) {
  if (seed.length > cap) return seed;
  return dagBest(dagPermutations(seed), (order) => trackCrossings(order, bySrc));
}

/**
 * Spread labels along one row. Each item { cx, w } wants to sit centered on
 * cx, may not overlap the item before it (keeping `gap`), and must clear
 * `blocks` ({ left, right } spans the row can't use). Each gets the free x
 * nearest its wanted one: the wanted x itself, or flush against a block.
 * Sets item.x; items must be sorted by cx.
 */
export function packRow(items, blocks, gap = 12) {
  let floor = -Infinity;
  for (const item of items) {
    const want = Math.max(item.cx - item.w / 2, floor);
    const free = (x) => x >= floor && !blocks.some((b) => x < b.right && x + item.w > b.left);
    const candidates = [want, ...blocks.flatMap((b) => [b.left - item.w, b.right])].filter(free);
    item.x = candidates.length
      ? candidates.reduce((best, x) => (Math.abs(x - want) < Math.abs(best - want) ? x : best))
      : want;
    floor = item.x + item.w + gap;
  }
  return items;
}
