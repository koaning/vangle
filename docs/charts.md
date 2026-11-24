# Updating a chart

For most charts, use [`<t-vega>`](t-vega.md), which draws a Vega-Lite spec, or
[`<t-obsplot>`](t-obsplot.md), which draws an Observable Plot chart. Neither needs a script.
For any other chart, a few lines of JavaScript do it: the variables stay in the HTML, and a script
reads them and draws.

## A live chart

<div class="example" data-show-source="open">
  <t-scope id="throw">
    <p>Throw a ball at <t-num name="speed" min="5" max="30" format="%d m/s">22</t-num>,
      <t-num name="angle" min="5" max="85" format="%d°">30</t-num> above the ground.
      It reaches <t-out expr="peak" format="%.1f m"></t-out> high and lands
      <t-out expr="range" format="%.1f m"></t-out> away.
      <t-out expr="angle === 45 ? 'No angle throws further.' : ''"></t-out></p>
    <t-let name="rad" expr="angle * Math.PI / 180"></t-let>
    <t-let name="range" expr="speed ** 2 * Math.sin(2 * rad) / 9.81"></t-let>
    <t-let name="peak" expr="(speed * Math.sin(rad)) ** 2 / (2 * 9.81)"></t-let>
    <svg class="chart" viewBox="0 0 600 290" role="img" aria-label="The ball's flight path">
      <g class="axes"></g>
      <polyline class="flight"></polyline>
      <circle class="peak" r="6"></circle>
      <circle class="landing" r="6"></circle>
    </svg>
  </t-scope>
</div>

<script type="module" data-show-source="open">
  import { scopeOf } from "../tangle.js";

  const root = document.querySelector("#throw");
  const scope = scopeOf(root);
  const svg = root.querySelector("svg");
  const [flight, peak, landing] = svg.querySelectorAll(".flight, .peak, .landing");

  // Fixed scales: 0–100 m across, 0–45 m up, 5.4 pixels per metre.
  const x = (m) => 40 + m * 5.4;
  const y = (m) => 258 - m * 5.4;

  // The axes don't depend on any variable, so draw them once, outside the effect.
  const axes = [];
  for (let m = 0; m <= 100; m += 20) {
    axes.push(`<line x1="${x(m)}" x2="${x(m)}" y1="${y(0)}" y2="${y(45)}"/>`);
    axes.push(`<text x="${x(m)}" y="${y(0) + 22}">${m} m</text>`);
  }
  for (let m = 0; m <= 40; m += 10) {
    axes.push(`<line x1="${x(0)}" x2="${x(100)}" y1="${y(m)}" y2="${y(m)}"/>`);
    if (m) axes.push(`<text class="y" x="${x(0) - 8}" y="${y(m) + 4}">${m} m</text>`);
  }
  svg.querySelector(".axes").innerHTML = axes.join("");

  // Redraws the flight whenever speed, angle, range or peak changes.
  scope.effect((s) => {
    const v = s.get("speed"), rad = s.get("rad"), range = s.get("range");
    const points = [];
    for (let i = 0; i <= 60; i++) {
      const d = (range * i) / 60; // distance travelled
      const h = d * Math.tan(rad) - (9.81 * d * d) / (2 * (v * Math.cos(rad)) ** 2);
      points.push(`${x(d)},${y(h)}`);
    }
    flight.setAttribute("points", points.join(" "));
    peak.setAttribute("cx", x(range / 2));
    peak.setAttribute("cy", y(s.get("peak")));
    landing.setAttribute("cx", x(range));
    landing.setAttribute("cy", y(0));
  });

  // Dragging the chart's handles changes speed and angle. Drag the top of the arc anywhere,
  // or the landing point along the ground. Pressing anywhere else moves the top there.
  const g = 9.81, rad = (deg) => (deg * Math.PI) / 180;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)));
  const toMetres = (event) => {
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return { d: (p.x - x(0)) / 5.4, h: (y(0) - p.y) / 5.4 };
  };
  const aim = {
    // The top of the arc is at (d, h) when tan(angle) = 2h / d and speed² = 2gh / sin²(angle).
    peak({ d, h }) {
      const a = Math.atan2(2 * Math.max(h, 0.5), Math.max(d, 0.5));
      scope.set("angle", clamp((a * 180) / Math.PI, 5, 85));
      scope.set("speed", clamp(Math.sqrt((2 * g * Math.max(h, 0.5)) / Math.sin(a) ** 2), 5, 30));
    },
    // Keep the angle and find the speed that lands at d: range = speed² · sin(2 · angle) / g.
    landing({ d }) {
      const s2 = (Math.max(d, 0) * g) / Math.sin(2 * rad(scope.peek("angle")));
      scope.set("speed", clamp(Math.sqrt(s2), 5, 30));
    },
  };
  let dragging = null;
  svg.addEventListener("pointerdown", (event) => {
    dragging = event.target === landing ? "landing" : "peak";
    svg.setPointerCapture(event.pointerId);
    aim[dragging](toMetres(event));
  });
  svg.addEventListener("pointermove", (event) => dragging && aim[dragging](toMetres(event)));
  svg.addEventListener("pointerup", () => (dragging = null));
  svg.addEventListener("pointercancel", () => (dragging = null));
</script>

<style data-show-source>
  .chart { display: block; width: 100%; height: auto; margin: 1rem 0; overflow: visible; cursor: crosshair; touch-action: none; user-select: none; }
  .chart .axes line { stroke: currentColor; stroke-opacity: 0.12; }
  .chart .axes text { fill: currentColor; fill-opacity: 0.55; font: 12px system-ui, sans-serif; text-anchor: middle; }
  .chart .axes text.y { text-anchor: end; }
  .chart .flight { fill: none; stroke: var(--tangle-accent); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
  .chart .peak, .chart .landing { fill: var(--tangle-accent); stroke: var(--tangle-accent); stroke-opacity: 0.25; stroke-width: 12; cursor: grab; }
  .chart .peak { fill-opacity: 0.5; }
  .chart .landing { cursor: ew-resize; }
</style>

Drag the speed or the angle in the text, or drag the chart: pull the top of the arc anywhere to set
both, or slide the landing point along the ground to throw further at the same angle.

## How it works

1. **The HTML declares the variables.** The two `<t-num>` elements and three
   [`<t-let>`](t-let.md) values live in `<t-scope id="throw">`, which keeps them apart from
   the other examples on the page. The
   `<svg>` holds empty shapes for the script to position. The script declares no variables
   of its own.
2. **`scopeOf(root)` gets the scope** that holds those variables. `root` is the
   `<t-scope>`, found by its id, but any element inside it works. On a page without a
   `<t-scope>`, use `scopeOf(document)`. See [A first script](javascript.md#first-script).
3. **The scales are fixed.** `x` and `y` turn metres into pixels, and they never change. If the
   chart rescaled to fit each throw, a 20 m throw would look the same as an 80 m one, and
   dragging would only change the numbers.
4. **Parts that never change are drawn once.** The gridlines and labels are built before the
   effect, so they're not rebuilt on every change.
5. **`effect(fn)` draws the parts that change.** It runs `fn` once straight away, and
   remembers each variable that `s.get` read: `speed`, `rad`, `range` and `peak`. When any of
   those changes, it runs again and moves the existing shapes.
6. **Changes are batched.** Dragging the angle changes `rad`, `range` and `peak` too, but the
   effect runs once per change.

The effect reads computed variables too. `range` and `peak` come from the `<t-let>` elements,
so the text and the chart can't disagree.

The colors come from CSS, using `currentColor` and `var(--tangle-accent)`, so the chart
follows the theme (light or dark) with no extra code.

## Drawing on a canvas

A canvas needs explicit colors and pixel sizes. Read the colors from CSS when you draw, and
redraw when the canvas changes size. A redraw for some other reason, like a resize, should use
`peek`, so it doesn't subscribe to anything:

```js
import { scopeOf } from "/tangle.js";

const canvas = document.querySelector("#plot");
const scope = scopeOf(canvas);
const css = (name) => getComputedStyle(canvas).getPropertyValue(name).trim();

function draw(a, b) {
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;
  const g = canvas.getContext("2d");
  g.scale(devicePixelRatio, devicePixelRatio);
  g.strokeStyle = css("--tangle-accent");
  // ...
}

scope.effect((s) => draw(s.get("a"), s.get("b")));
new ResizeObserver(() => draw(scope.peek("a"), scope.peek("b"))).observe(canvas);
```

The parabola on the [home page](../index.html) is drawn this way.

## Using a chart library

With a library, create the chart once outside the effect. Then, in the effect, give it new
data and ask it to update. Turn animations off, so the chart follows a drag instead of lagging
behind it. With [Chart.js](https://www.chartjs.org):

```js
const chart = new Chart(canvas, { type: "line", data: { labels: [], datasets: [{ data: [] }] } });

scopeOf(canvas).effect((s) => {
  const years = Array.from({ length: s.get("years") + 1 }, (_, i) => i);
  chart.data.labels = years;
  chart.data.datasets[0].data = years.map((t) => s.get("start") * (1 + s.get("rate") / 100) ** t);
  chart.update("none"); // "none" skips the animation
});
```

Other libraries work the same way: with Plotly, call `Plotly.react(el, data, layout)` in the
effect. With D3, run the update part of your join.

## Letting the chart change variables

The data can flow the other way too. Dragging the chart calls `scope.set`, and every `<t-num>`,
output and formula that uses `speed` or `angle` updates, including the chart itself.

Work out which variables a gesture should change from what the reader is pointing at. A reader
who drags the top of the arc expects the arc's top to follow the pointer, so the handler solves
the physics backwards for the speed and angle that put it there:

```js
const toMetres = (event) => {
  // Convert the pointer from screen pixels to the SVG's own coordinates, then to metres.
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  return { d: (p.x - x(0)) / 5.4, h: (y(0) - p.y) / 5.4 };
};

// The top of the arc is at (d, h) when tan(angle) = 2h / d and speed² = 2gh / sin²(angle).
function aimPeak({ d, h }) {
  const a = Math.atan2(2 * h, d);
  scope.set("angle", clamp((a * 180) / Math.PI, 5, 85));
  scope.set("speed", clamp(Math.sqrt((2 * 9.81 * h) / Math.sin(a) ** 2), 5, 30));
}
```

`set` doesn't apply the variable's `min`, `max` or `step`, so `clamp` rounds and clamps the value
itself. Near the edges the arc's top then stops short of the pointer instead of jumping around.

Use pointer events with `setPointerCapture`, so the drag keeps going when the pointer leaves the
chart, and `touch-action: none` in the CSS, so a drag on a phone doesn't scroll the page.

`effect` returns a function that stops it. Call it if you remove the chart from the page.
