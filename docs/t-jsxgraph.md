# `<t-jsxgraph>`

A [JSXGraph](https://jsxgraph.org) board that shares variables with the page. Where
[`<t-vega>`](t-vega.md) and [`<t-obsplot>`](t-obsplot.md) draw charts of data, JSXGraph draws
points, lines and curves that the reader can drag. JSXGraph loads only on pages that have a
`<t-jsxgraph>`.

<t-scope class="example lifeguard" data-show-source>
  <p>A lifeguard runs at <t-num name="vr" min="1" max="10" step="0.5" format="%.1f m/s" color="#b45b1b #ffad66">5</t-num>
    on sand and swims at <t-num name="vs" min="0.5" max="3" step="0.1" format="%.1f m/s" color="#246bce #75a7ff">1.5</t-num>.
    Going in at the marked point takes <t-out expr="time" format="%.1f s"></t-out>,
    <t-out expr="time - fastest < 0.05 ? 'the fastest way there.' : `${(time - fastest).toFixed(1)} s more than the fastest route (dashed).`"></t-out>
    Heading straight for the swimmer takes <t-out expr="T(straight)" format="%.1f s"></t-out>.</p>
  <t-var name="ax" value="0" min="-5" max="85" step="0.5"></t-var>
  <t-var name="ay" value="30" min="2" max="38" step="0.5"></t-var>
  <t-var name="bx" value="60" min="-5" max="85" step="0.5"></t-var>
  <t-var name="by" value="-20" min="-34" max="-2" step="0.5"></t-var>
  <t-var name="ex" value="36" min="-8" max="88" step="0.1"></t-var>
  <!-- T(x): the time to run to x on the shoreline, then swim the rest. -->
  <t-let name="T" expr="(x) => Math.hypot(x - ax, ay) / vr + Math.hypot(bx - x, by) / vs"></t-let>
  <t-let name="time" expr="T(ex)"></t-let>
  <!-- The fastest entry point, by ternary search: T has one minimum, between the two people. -->
  <t-let name="best" expr="(() => {
    let lo = Math.min(ax, bx), hi = Math.max(ax, bx);
    for (let i = 0; i < 80; i++) {
      const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
      if (T(a) < T(b)) hi = b; else lo = a;
    }
    return (lo + hi) / 2;
  })()"></t-let>
  <t-let name="fastest" expr="T(best)"></t-let>
  <t-let name="straight" expr="ax + (bx - ax) * ay / (ay - by)"></t-let>
  <t-let name="sin1" expr="(ex - ax) / Math.hypot(ex - ax, ay)"></t-let>
  <t-let name="sin2" expr="(bx - ex) / Math.hypot(bx - ex, by)"></t-let>
  <t-math display>
    \frac{\sin\theta_1}{\sin\theta_2} = \val[%.2f]{sin1 / sin2}
    \qquad \frac{v_\text{run}}{v_\text{swim}} = \val[%.2f]{vr / vs}
  </t-math>
  <t-jsxgraph x="-10 90" y="-38 42">
    <script type="text/plain">
      // The beach above the shoreline, the sea below it.
      const area = { fixed: true, highlight: false, vertices: { visible: false }, borders: { visible: false } };
      board.create("polygon", [[-50, 0], [150, 0], [150, 100], [-50, 100]], { ...area, cssClass: "sand" });
      board.create("polygon", [[-50, 0], [150, 0], [150, -100], [-50, -100]], { ...area, cssClass: "sea" });
      // The fastest route, through best (a <t-let>), under everything else.
      const F = board.create("point", [() => best, 0], { visible: false });
      // The lifeguard and the swimmer go anywhere on their side. The entry point stays on the shoreline.
      const A = point("ax", "ay", { name: "Lifeguard", withLabel: true, size: 6, cssClass: "person" });
      const B = point("bx", "by", { name: "Swimmer", withLabel: true, size: 6, cssClass: "person" });
      const E = point("ex", 0, { size: 7, cssClass: "entry" });
      board.create("segment", [A, F], { fixed: true, cssClass: "fastest" });
      board.create("segment", [F, B], { fixed: true, cssClass: "fastest" });
      // The route through E: running, then swimming.
      board.create("segment", [A, E], { fixed: true, cssClass: "run" });
      board.create("segment", [E, B], { fixed: true, cssClass: "swim" });
      // The normal at E, and the two angles to it that Snell's law compares.
      const up = board.create("point", [() => E.X(), 10], { visible: false });
      const down = board.create("point", [() => E.X(), -10], { visible: false });
      board.create("segment", [up, down], { fixed: true, cssClass: "normal" });
      board.create("nonreflexangle", [up, E, A], { radius: 7, name: "θ<sub>1</sub>", withLabel: true, cssClass: "run-angle" });
      board.create("nonreflexangle", [down, E, B], { radius: 7, name: "θ<sub>2</sub>", withLabel: true, cssClass: "swim-angle" });
    </script>
  </t-jsxgraph>
</t-scope>

<style data-show-source>
  .lifeguard { --run: light-dark(#b45b1b, #ffad66); --swim: light-dark(#246bce, #75a7ff); }
  .lifeguard .tangle-jsxgraph { aspect-ratio: 100 / 80; }
  .lifeguard .sand { fill: light-dark(#f4e9cc, #3d3424); fill-opacity: 1; stroke: none; }
  .lifeguard .sea { fill: light-dark(#dbe9f6, #1d2f42); fill-opacity: 1; stroke: none; }
  .lifeguard .person { stroke: currentColor; fill: currentColor; }
  .lifeguard .entry { stroke: currentColor; fill: var(--tangle-surface, white); stroke-width: 2; }
  .lifeguard .run { stroke: var(--run); stroke-width: 3; }
  .lifeguard .swim { stroke: var(--swim); stroke-width: 3; }
  .lifeguard .fastest { stroke: currentColor; stroke-opacity: 0.45; stroke-width: 2; stroke-dasharray: 5 5; }
  .lifeguard .normal { stroke: currentColor; stroke-opacity: 0.35; stroke-width: 1; stroke-dasharray: 2 4; }
  .lifeguard .run-angle { fill: var(--run); fill-opacity: 0.25; stroke: none; }
  .lifeguard .swim-angle { fill: var(--swim); fill-opacity: 0.25; stroke: none; }
</style>

The straight line is the shortest way to the swimmer, but not the fastest. Sand is quicker than
water, so the fastest route runs further along the beach and swims less. It's the route where the
two ratios above are equal, which is Snell's law: light is slower in water than in air, and it bends
at the surface by the same rule, for the same reason.

The lifeguard, the swimmer and the entry point are each two variables, through `point()`. The entry
point's y is the number `0`, so it only slides along the shoreline. The times, the fastest route
and the angles are [`<t-let>`](t-let.md)s, and the dashed route reads `best` inside a function.

## Writing the board

Put a script in a `<script type="text/plain">` inside the element, or keep it in its own file and
point to it with `src`. Unlike [`<t-obsplot>`](t-obsplot.md), it's a script, not an expression,
and it runs once, when JSXGraph has loaded. It builds the board with JSXGraph's own API, and has
these names in reach:

- `board`, the [JSXGraph board](https://jsxgraph.org/docs/symbols/JXG.Board.html). Make
  elements with `board.create(type, parents, attributes)`.
- `point(x, y, attributes)`, a draggable point tied to variables. See [below](#point).
- `JXG`, the whole library.
- The page's variables, your [registered functions](expressions.md#functions) and the usual
  `Math`, `Array` and friends.

In Markdown, keep blank lines out of the script: a blank line ends the HTML block.

## Variables {#binding}

### From the page to the board

Where JSXGraph takes a function (a coordinate, a curve, an
attribute such as `visible`), the function can read variables:

```js
board.create("point", [() => q, () => p], { fixed: true });
board.create("functiongraph", [(x) => amp * Math.sin(freq * x)]);
```

JSXGraph calls these functions whenever the board updates, and the board updates when a variable
they read changes. A variable read outside a function is read once, when the script runs.

### From the board to the page {#point}

`point(x, y)` makes a point at the values of two
variables, given by name. Dragging it sets them, and changing them elsewhere moves it. A number
instead of a name keeps that coordinate fixed, as `point("ex", 0)` does above: the point only
slides along the shoreline.

- The values snap to the variables' `min`, `max` and `step`, from the [`<t-num>`](t-num.md) or
  [`<t-var>`](t-var.md) that declares them, and the point snaps with them.
- Lines and polygons made from such points can be dragged too. Dragging a segment between two
  of them moves both, and sets all four variables at once.
- The reader can also tab to a point and move it with the arrow keys.

## Theme {#theme}

The board draws in the page's colors, in light and dark mode:

- Axes, gridlines and labels are `currentColor`, with the strengths from `--tangle-chart-grid`
  and `--tangle-chart-text`, and the font from `--tangle-chart-font`.
- Points, lines, curves and polygons are `--tangle-accent`.
- For other colors, give an element a `cssClass` and color it from your CSS, as the example does
  with `.run` and `.swim`. CSS beats the colors JSXGraph sets, and the class stays on when
  the pointer is over the element.
- The board is 3:2. Set `aspect-ratio` or `height` on `.tangle-jsxgraph` to change that.

## Attributes

| Attribute | Default | Description |
|---|---|---|
| `x` | `-5 5` | The range of the x-axis: left, then right. |
| `y` | `-5 5` | The range of the y-axis: bottom, then top. |
| `axis` | | Draw axes, with a gridline at every tick. |
| `src` | | A URL to load the script from, instead of the `<script>` inside. |

## How JSXGraph loads

The first `<t-jsxgraph>` on a page loads JSXGraph 1.14.0 from jsDelivr: about 1 MB of minified
JavaScript, 260 KB over the network. Pages without a `<t-jsxgraph>` load none of it.

- If the page already loaded it (`window.JXG`), that copy is used.
- To load it from somewhere else, call `configure({ jsxgraphUrl })` in the module that imports
  `tangle.js`, or set `window.TangleConfig` before it loads. See
  [Configuration](javascript.md#configuration).
