# `<t-flow>`

Live elements laid out as a graph of what feeds what. Each child is a node. An arrow runs from
one node to another when the second reads a variable the first defines, so the arrows come
from the page itself.

<t-scope class="example trilateration" data-show-source="open">
  <t-flow>
    <div id="map">
      <t-var name="x1" value="0" min="-90" max="90"></t-var>
      <t-var name="y1" value="70" min="-90" max="90"></t-var>
      <t-var name="x2" value="-65" min="-90" max="90"></t-var>
      <t-var name="y2" value="-45" min="-90" max="90"></t-var>
      <t-var name="x3" value="65" min="-90" max="90"></t-var>
      <t-var name="y3" value="-45" min="-90" max="90"></t-var>
      <t-var name="px" value="15" min="-90" max="90"></t-var>
      <t-var name="py" value="5" min="-90" max="90"></t-var>
      <t-jsxgraph x="-100 100" y="-100 100">
        <script type="text/plain">
          const you = point("px", "py", { name: "you", withLabel: true, size: 5, cssClass: "you" });
          for (const [x, y] of [["x1", "y1"], ["x2", "y2"], ["x3", "y3"]]) {
            const beacon = point(x, y, { size: 5, cssClass: "beacon" });
            board.create("circle", [beacon, you], { fixed: true, highlight: false, cssClass: "range" });
          }
        </script>
      </t-jsxgraph>
    </div>
    <p>Range noise ± <t-num name="noise" min="0" max="20">4</t-num> m</p>
    <t-codecell name="fixes">
      <script type="text/plain">
      const beacons = [[x1, y1], [x2, y2], [x3, y3]];
      // Seeded, so every run draws the same noise
      // and the cloud moves smoothly.
      let seed = 42;
      const random = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const gauss = () => Math.sqrt(-2 * Math.log(1 - random()))
        * Math.cos(2 * Math.PI * random());
      // Further beacons are less sure: their noise grows
      // by its own size again every 50 m.
      const dist = beacons.map(([bx, by]) =>
        Math.hypot(px - bx, py - by));
      const grow = dist.map((d) => 1 + d / 50);
      const fixes = [];
      for (let i = 0; i < 2000; i++) {
        const r = dist.map((d, j) =>
          d + noise * grow[j] * gauss());
        // A first guess: circle 1 minus circles 2 and 3
        // gives two lines that cross near the fix.
        const [[a, b, c], [d, e, f]] = [1, 2].map((k) => {
          const [[x0, y0], [xk, yk]] = [beacons[0], beacons[k]];
          return [2 * (xk - x0), 2 * (yk - y0),
            r[0] ** 2 - r[k] ** 2 + xk ** 2 - x0 ** 2
              + yk ** 2 - y0 ** 2];
        });
        const det = a * e - b * d;
        let x = (c * e - b * f) / det;
        let y = (a * f - c * d) / det;
        // Then Gauss-Newton steps toward the point that fits
        // all three ranges best, trusting each by its noise.
        for (let step = 0; step < 6; step++) {
          let [hxx, hxy, hyy, gx, gy] = [0, 0, 0, 0, 0];
          beacons.forEach(([bx, by], j) => {
            const len = Math.hypot(x - bx, y - by) || 1e-9;
            const ux = (x - bx) / len, uy = (y - by) / len;
            const w = 1 / grow[j] ** 2, miss = r[j] - len;
            hxx += w * ux * ux;
            hxy += w * ux * uy;
            hyy += w * uy * uy;
            gx += w * ux * miss;
            gy += w * uy * miss;
          });
          const D = hxx * hyy - hxy * hxy;
          x += (hyy * gx - hxy * gy) / D;
          y += (hxx * gy - hxy * gx) / D;
        }
        fixes.push({ x, y });
      }
      return fixes;
      </script>
    </t-codecell>
    <t-obsplot id="cloud">
      <script type="text/plain">
      {
        height: 360,
        x: { domain: [-100, 100], label: null },
        y: { domain: [-100, 100], label: null },
        marks: [
          Plot.dot([{ x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 }], { x: "x", y: "y", r: 3.5, fill: "currentColor" }),
          Plot.dot(fixes ?? [], { x: "x", y: "y", r: 1.2, fill: "var(--tangle-accent)", fillOpacity: 0.25, clip: true }),
          Plot.dot([{ x: px, y: py }], { x: "x", y: "y", r: 4, stroke: "currentColor", strokeWidth: 1.5 })
        ]
      }
      </script>
    </t-obsplot>
    <p><t-let name="r95" expr="fixes && fixes.map((p) => Math.hypot(p.x - px, p.y - py)).sort((a, b) => a - b)[Math.floor(fixes.length * 0.95)]"></t-let>95% within <t-out expr="r95" format="%.1f"></t-out> m</p>
    <script type="text/plain">
    {
      nodes: {
        map: { label: "three beacons, and you", width: 250 },
        fixes: { label: "2,000 noisy fixes", width: 520, fold: "closed" },
        cloud: { label: "where the fixes land", width: 360 },
      },
    }
    </script>
  </t-flow>
</t-scope>

<style data-show-source>
  .trilateration .tangle-jsxgraph { aspect-ratio: 1; }
  .trilateration t-codecell { font-size: 0.68em; }
  .trilateration .beacon { stroke: currentColor; fill: currentColor; }
  .trilateration .you { stroke: var(--tangle-accent); fill: var(--tangle-accent); }
  .trilateration .range { stroke: currentColor; stroke-opacity: 0.3; stroke-width: 1; fill: none; }
</style>

Nobody wrote down the arrows. The code cell (folded, open it with its arrow) reads the
beacons, your position and the noise, and the chart and the sentence read its `fixes`. The
spec only adds captions, widths and the fold.

## Nodes and ids

Every child element is a node, apart from `<script>`, `<style>` and the elements that show
nothing (`<t-var>`, `<t-let>`, `<t-fetch>`). A node can be anything: a paragraph, a chart, a
code cell, or a whole `<div>` of them. Even another `<t-flow>` works as a single node.

The spec names a node by its id. That's its `id` attribute if it has one. Otherwise it's the
one variable it defines, so above the paragraph with `<t-num name="noise">` is `noise`, and
the `<div>` with eight `<t-var>`s needs `id="map"`. Failing both, it's `n0`, `n1`, … by position.

## Arrows {#arrows}

An arrow runs from A to B when something in B reads a variable that something in A defines.
It also looks through formulas that no node defines, so a `<t-let>` between the two still
links them. When a longer path already connects two nodes, the direct arrow between them is
left out. `edgeLabels: true` writes the variables each arrow carries next to it:

<t-scope class="example" data-show-source="open">
  <t-flow>
    <p>Length <t-num name="L" min="0.1" max="5" step="0.1">1</t-num> m</p>
    <p>Gravity <t-num name="g" min="1" max="25" step="0.1">9.8</t-num> m/s²</p>
    <p><t-let name="T" expr="2 * Math.PI * Math.sqrt(L / g)"></t-let>Period <t-out expr="T" format="%.2f s"></t-out></p>
    <p><t-let name="f" expr="1 / T"></t-let>Frequency <t-out expr="f" format="%.2f Hz"></t-out></p>
    <script type="text/plain">
    {
      edgeLabels: true,
      edges: [["T", "f", { label: "1 / T", color: "#b45b1b", dashed: true }]],
    }
    </script>
  </t-flow>
</t-scope>

`edges` changes the arrows. An entry for an arrow that's already there restyles it, and any
other entry adds one:

| Entry | Does |
|---|---|
| `["a", "b"]` | Adds an arrow from `a` to `b`. |
| `["a", "b", "label"]` | Adds one with a label, or labels the one that's there. |
| `["a", "b", { … }]` | Adds or restyles one: `label`, `color`, `dashed`, `exit`, `enter`. |
| `["a", "b", false]` | Drops the inferred arrow. |

`infer: false` turns inference off, and then only the arrows in `edges` are drawn. If the
arrows go round in a circle, an error says which nodes are involved, and you can break the
circle with `false`.

### Ports {#ports}

An arrow leaves the far side of a node and lands on the near side of the next one, spread
out with the arrows that share that side. `exit` and `enter` pick the sides yourself:
`"top"`, `"bottom"`, `"left"` or `"right"`, or a side and a position along it from 0 to 1,
like `["right", 0.25]`. An arrow with ports is routed around the other nodes.

## Layout {#layout}

Nodes sit in rows, one below the deepest node that feeds them. `direction: "right"` lays the
rows out as columns, left to right. A few keys move nodes around:

- `row: n` on a node pushes it down to at least row `n` (counting from 0), and the nodes it
  feeds move down with it.
- `beside: "id"` puts a node in the same row as `id`, right after it. `beside: ["id", "before"]`
  puts it right before. An arrow between the two joins their facing sides.
- `align: "left"` (or `"right"`; `"top"` or `"bottom"` going right) puts every row on one
  grid, so the first node of each row shares a column and a chain down it gets straight
  arrows. The default, `"center"`, centers each row on its own.

<t-scope class="example" data-show-source="open">
  <t-flow>
    <p>Mass <t-num name="m" min="0.1" max="10" step="0.1">2</t-num> kg</p>
    <p>Spring <t-num name="k" min="1" max="200">50</t-num> N/m</p>
    <p><t-let name="omega" expr="Math.sqrt(k / m)"></t-let>ω = <t-out expr="omega" format="%.2f rad/s"></t-out></p>
    <p>Amplitude <t-num name="A" min="0.01" max="0.5" step="0.01">0.1</t-num> m</p>
    <p><t-let name="vmax" expr="A * omega"></t-let>top speed <t-out expr="vmax" format="%.2f m/s"></t-out></p>
    <script type="text/plain">
    {
      direction: "right",
      nodes: {
        A: { beside: ["omega", "after"], note: "how far it's pulled before it's let go" },
      },
    }
    </script>
  </t-flow>
</t-scope>

## Captions, notes and widths {#nodes}

`label` puts a caption under a node. `note` puts text beside it with a short arrow, and the
text can have **bold** and `$math$`. `width` sets how wide the node is, in pixels or any CSS
length. Charts and code cells take whatever width they get, so give them one.

## Folding {#folding}

`fold: true` gives a node a small button in its corner, which shows when you hover over it.
The button folds the node into a pill with just its caption, and the rest of the diagram
moves up to fill the gap. `fold: "closed"` starts it folded.

`groups` draws a dashed frame around several nodes, with a tab that folds them all into one
pill. Arrows in and out of the group land on the pill. A group has to include every node on a
path between two of its own nodes, since the pill replaces all of them.

<t-scope class="example" data-show-source="open">
  <t-flow>
    <p>Length <t-num name="len" min="0.1" max="5" step="0.1">1</t-num> m</p>
    <p>Gravity <t-num name="grav" min="1" max="25" step="0.1">9.8</t-num> m/s²</p>
    <p><t-let name="period" expr="2 * Math.PI * Math.sqrt(len / grav)"></t-let>Period <t-out expr="period" format="%.2f s"></t-out></p>
    <p><t-let name="freq" expr="1 / period"></t-let>Frequency <t-out expr="freq" format="%.2f Hz"></t-out></p>
    <t-obsplot id="swing">
      <script type="text/plain">
      {
        height: 130,
        marginBottom: 36,
        x: { label: "Time (s)" },
        y: { domain: [-1.1, 1.1], label: null, ticks: 0 },
        marks: [Plot.lineY(d3.range(0, 6.01, 0.02), { x: (t) => t, y: (t) => Math.cos(2 * Math.PI * freq * t), stroke: "var(--tangle-accent)" })]
      }
      </script>
    </t-obsplot>
    <script type="text/plain">
    {
      nodes: { swing: { label: "the swing", width: 260, fold: true } },
      groups: [{ label: "derived", nodes: ["period", "freq"] }],
    }
    </script>
  </t-flow>
</t-scope>

## From JavaScript {#javascript}

`el.edges` lists the arrows as `[from, to]` pairs of node ids. `el.upstream(id)` and
`el.downstream(id)` list the nodes that feed `id` and that `id` feeds, directly or not.

## Spec keys {#spec}

The spec goes in a `<script type="text/plain">` inside the element. It's one JavaScript
expression, written like JSON, and every key is optional.

| Key | Description |
|---|---|
| `direction` | `"down"` (the default) or `"right"`. |
| `align` | `"center"` (the default), `"left"` or `"right"`; going right, `"top"` or `"bottom"`. See [Layout](#layout). |
| `nodes` | Options per node, by id: `label`, `note`, `width`, `fold`, `row`, `beside`. A string is short for `{ label }`. |
| `edges` | Arrows to add, restyle or drop. See [Arrows](#arrows). |
| `groups` | A list of `{ label, nodes, collapsed }`. See [Folding](#folding). |
| `infer` | `false` draws only the arrows in `edges`. |
| `edgeLabels` | `true` labels the inferred arrows with the variables they carry. |

The look comes from custom properties on `.tangle-flow`: `--tangle-flow-edge` (the arrows),
`--tangle-flow-note`, `--tangle-flow-bg` (behind crossings and pills),
`--tangle-flow-layer-gap` and `--tangle-flow-node-gap`.
