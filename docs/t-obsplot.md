# `<t-obsplot>`

An [Observable Plot](https://observablehq.com/plot/) chart that shares variables with the page.
Where [`<t-vega>`](t-vega.md) takes a JSON spec, `<t-obsplot>` takes a JavaScript expression, so
the chart can compute with the variables directly. Plot loads only on pages that have a
`<t-obsplot>`.

<t-scope class="example" data-show-source>
  <p>A wave of <t-num name="freq" min="0.5" max="4" step="0.5" format="%.1f Hz">2</t-num>, with an
    amplitude of <t-num name="amp" min="0.5" max="3" step="0.1">1.5</t-num>, damped by
    <t-num name="damp" min="0" max="2" step="0.1" format="%.1f">0.8</t-num> per second.</p>
  <t-obsplot>
    <script type="text/plain">
    {
      height: 240,
      x: { label: "Seconds" },
      y: { domain: [-3, 3], grid: true, label: null },
      marks: [
        Plot.ruleY([0]),
        Plot.line(d3.range(0, 3.001, 0.005), {
          x: (t) => t,
          y: (t) => amp * Math.exp(-damp * t) * Math.sin(2 * Math.PI * freq * t),
          stroke: "var(--tangle-accent)",
          strokeWidth: 2
        })
      ]
    }
    </script>
  </t-obsplot>
</t-scope>

The expression reads `amp`, `damp` and `freq`, so dragging any of them redraws the chart.

## Writing the chart

Put the expression in a `<script type="text/plain">` inside the element. The browser doesn't run
or show it, and Markdown leaves it alone. Or keep it in its own file and point to it with `src`:

```html
<t-obsplot src="charts/wave.js"></t-obsplot>
```

It's an expression, like the `expr` of a [`<t-let>`](t-let.md), not a script: no `return`, no
statements. It can give back one of three things:

- **Plot options**, as in the example: `{ marks: [...], height: 240, ... }`. They go to
  `Plot.plot` with a few defaults filled in.
- **An array of marks**, short for `{ marks: [...] }`.
- **A chart you made yourself** with `Plot.plot(...)`, which is shown as it is, without the
  defaults.

Inside the expression, `Plot` and `d3` are available, along with the page's variables, your
[registered functions](expressions.md#functions) and the usual `Math`, `Array` and friends.

The defaults, each of which the options can override:

- `width` is the width of the element, and the chart redraws when that changes.
- The font comes from `--tangle-chart-font`. See [Theme](#theme).

Plot leaves 40 pixels on the left for the y-axis labels. For longer labels, such as the dollar
amounts below, set `marginLeft`.

## Variables

Every variable the expression reads is tracked, including reads inside a channel function such
as `y: (t) => amp * …`. When one of them changes, the expression runs again and the chart is
redrawn.

Data works the same way: a variable holding an array of objects can go straight into a mark.
Here a [`<t-let>`](t-let.md) computes the rows:

<t-scope class="example" data-show-source>
  <p>Save <t-num name="monthly" min="0" max="500" step="10" format="$%d">200</t-num> a month at
    <t-num name="rate" min="0" max="10" step="0.5" format="%.1f%%">6</t-num> a year. After 30 years,
    <t-out expr="rows.at(-1).amount / (rows.at(-1).amount + rows.at(-2).amount)" format="percent"></t-out>
    of your money is interest.</p>
  <!-- Two rows per five years: what you paid in, and the interest it earned on top. -->
  <t-let name="rows" expr="[0, 5, 10, 15, 20, 25, 30].flatMap((year) => {
    const paid = monthly * 12 * year;
    const r = rate / 100;
    const total = r ? monthly * 12 * ((1 + r) ** year - 1) / r : paid;
    return [{ year, part: 'Paid in', amount: paid }, { year, part: 'Interest', amount: total - paid }];
  })"></t-let>
  <t-obsplot>
    <script type="text/plain">
    {
      height: 240,
      marginLeft: 70,
      x: { label: "Years" },
      y: { label: null, grid: true, tickFormat: "$,.0f" },
      color: { domain: ["Paid in", "Interest"], legend: true },
      marks: [
        Plot.barY(rows, {
          x: "year",
          y: "amount",
          fill: "part",
          tip: { format: { y: "$,.0f" } }
        }),
        Plot.ruleY([0])
      ]
    }
    </script>
  </t-obsplot>
</t-scope>

Set a new array to update the chart. A `<t-let>` does this for you, because it computes a new
array each time. From JavaScript, call `scope.set("rows", [...])`. Changing the old array in place
isn't noticed.

## Loading data and reading the pointer {#name}

Plot draws arrays and doesn't fetch, so load a file with a short script and put the rows in a
variable. Until they arrive, `cars ?? []` gives the chart an empty array to draw.

With `name="car"`, the variable `car` holds whatever Plot's pointer is on (the datum under a
`tip`, `Plot.pointer` or crosshair), or `null`. That's how the chart sets variables on the page:

<t-scope id="cars" class="example" data-show-source>
  <p>Cars with more than <t-num name="hp" min="50" max="230" step="10">150</t-num> horsepower
    are highlighted. You're pointing at <t-out expr="car ? car.Name : 'no car'"></t-out>.</p>
  <t-obsplot name="car">
    <script type="text/plain">
    {
      height: 260,
      x: { label: "Horsepower" },
      y: { label: "Miles per gallon", grid: true },
      marks: [
        Plot.dot(cars ?? [], {
          x: "Horsepower",
          y: "Miles_per_Gallon",
          fill: "var(--tangle-accent)",
          fillOpacity: (d) => (d.Horsepower > hp ? 0.9 : 0.15),
          r: 3
        }),
        Plot.tip(cars ?? [], Plot.pointer({ x: "Horsepower", y: "Miles_per_Gallon", title: "Name" }))
      ]
    }
    </script>
  </t-obsplot>
</t-scope>

<script type="module" data-show-source>
  import { scopeOf } from "../tangle.js";

  const url = "https://cdn.jsdelivr.net/npm/vega-datasets@2/data/cars.json";
  const cars = await fetch(url).then((response) => response.json());
  scopeOf(document.querySelector("#cars")).set("cars", cars);
</script>

A chart shouldn't read the variable it sets with `name`. Each pointer move would redraw the
chart, and the redraw would lose the pointer.

## What redraws when

Plot draws a chart in one go and can't update part of one, so `<t-obsplot>` redraws the whole
chart whenever a variable it read changes:

- **Changes are batched.** Dragging one number may change several variables. The chart redraws
  once.
- **The new chart replaces the old one in place**, in the same frame, so nothing flickers.
- **A redraw resets the pointer.** An open tip closes, and the `name` variable goes back to
  `null` until the pointer moves again.
- **A width change** redraws the chart at the new width.
- **A theme change** needs no redraw. See below.

For charts with tens of thousands of marks, redrawing on every step of a drag can feel slow.
There, [`<t-vega>`](t-vega.md) updates only what changed.

## Theme {#theme}

Plot draws text, axes and gridlines in `currentColor`, so the chart follows the text color, light
or dark, without redrawing. On top of that:

- The font size and family come from `--tangle-chart-font`, and the strength of the axis labels
  from `--tangle-chart-text` (`60%`).
- Tips and the halos around text are drawn on `--tangle-surface`, instead of Plot's white.
- Single-color marks are `currentColor` by default. For the accent color, write
  `fill: "var(--tangle-accent)"` or `stroke: "var(--tangle-accent)"`. Plot accepts any CSS
  color, so a `var()` works.

Set `style` in the options to change any of this.

## Attributes

| Attribute | Default | Description |
|---|---|---|
| `src` | | A URL to load the expression from, instead of the `<script>` inside. |
| `name` | | A variable to set to the datum under Plot's pointer, or `null`. See [Loading data and reading the pointer](#name). |

## How Plot loads

The first `<t-obsplot>` on a page loads two scripts from jsDelivr, in order: d3 7.9.0 and
Observable Plot 0.6.17. That's about 490 KB of minified JavaScript (less over the network,
because it's compressed). Pages without a `<t-obsplot>` load none of it.

- If the page already loaded them (`window.d3`, `window.Plot`), that copy is used.
- To load them from somewhere else, for example your own server, call
  `configure({ d3Url, plotUrl })` in the module that imports `tangle.js`, or set
  `window.TangleConfig` before it loads. See [Configuration](javascript.md#configuration).
- The expression is compiled with `new Function`, like every tangle.js expression, so a
  Content-Security-Policy needs `'unsafe-eval'`.

Until Plot has loaded, the element shows "Loading chart…" (`.tangle-obsplot.is-loading`). A
failure to load Plot, or an error in the expression, shows a message in its place
(`.tangle-obsplot-error`). The chart comes back on the next change that doesn't fail.
