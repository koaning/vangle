# `<t-vega>`

A [Vega-Lite](https://vega.github.io/vega-lite/) chart that shares variables with the page.
Use it for what [`<t-chart>`](t-chart.md) doesn't do: scatter plots, tooltips, stacking,
legends from data, selections. Vega loads only on pages that have a `<t-vega>`.

<t-scope class="example" data-show-source>
  <p>Cars with more than <t-num name="hp" min="50" max="230" step="10">150</t-num> horsepower
    are highlighted. Hover over a point to see the car.</p>
  <t-vega>
    <script type="application/json">
    {
      "data": { "url": "https://cdn.jsdelivr.net/npm/vega-datasets@2/data/cars.json" },
      "params": [{ "name": "hp", "value": 150 }],
      "mark": { "type": "point", "filled": true },
      "height": 260,
      "encoding": {
        "x": { "field": "Horsepower", "type": "quantitative" },
        "y": { "field": "Miles_per_Gallon", "type": "quantitative", "title": "Miles per gallon" },
        "opacity": { "condition": { "test": "datum.Horsepower > hp", "value": 0.9 }, "value": 0.15 },
        "tooltip": [
          { "field": "Name", "title": "Car" },
          { "field": "Horsepower" },
          { "field": "Miles_per_Gallon", "title": "Miles per gallon" }
        ]
      }
    }
    </script>
  </t-vega>
</t-scope>

The spec declares a parameter named `hp`, and the page has a variable named `hp`, so they're
linked: dragging the number sets the parameter, and Vega redraws.

## Writing the spec

Put the spec, as JSON, in a `<script type="application/json">` inside the element. The browser
doesn't run or show it, and Markdown leaves it alone. Or keep the spec in its own file and point
to it with `src`:

```html
<t-vega src="charts/cars.vl.json"></t-vega>
```

Anything Vega-Lite can draw works. A few defaults are filled in for you:

- If the spec has no `width`, the chart fills the width of the page (`"width": "container"`).
- The colors and fonts come from your CSS. See [Theme](#theme).
- Vega's action menu (export, view source) is off.

## Variables and parameters {#binding}

A spec and the page share a name in two ways.

**Parameters.** A top-level entry in `params` with the name of a variable is linked to that
variable, in both directions:

- When the variable changes (the reader drags it, or an expression it depends on changes), the
  parameter gets the new value and Vega redraws. Vega's dataflow only recomputes what uses it.
- When the parameter changes inside Vega, for example through a slider made with `bind`, the
  variable gets the new value, and every output and formula that uses it updates.
- A parameter with `select` (a selection) only goes from Vega to the page. Read it in
  expressions to show what the reader selected:

<t-scope class="example" data-show-source>
  <p>Drag across the chart to select a range of horsepower. Selected:
    <t-out expr="brush.Horsepower ? Math.round(brush.Horsepower[0]) + '–' + Math.round(brush.Horsepower[1]) + ' hp' : 'nothing yet'"></t-out>.</p>
  <t-vega>
    <script type="application/json">
    {
      "data": { "url": "https://cdn.jsdelivr.net/npm/vega-datasets@2/data/cars.json" },
      "params": [{ "name": "brush", "select": { "type": "interval", "encodings": ["x"] } }],
      "mark": "bar",
      "height": 180,
      "encoding": {
        "x": { "field": "Horsepower", "bin": { "maxbins": 30 } },
        "y": { "aggregate": "count", "title": "Cars" }
      }
    }
    </script>
  </t-vega>
</t-scope>

**Data.** A named data source, `"data": { "name": "rows" }`, is linked to the variable `rows`.
The variable should hold an array of objects. Whenever it changes, Vega gets the new rows:

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
  <t-vega>
    <script type="application/json">
    {
      "data": { "name": "rows" },
      "mark": "bar",
      "height": 240,
      "encoding": {
        "x": { "field": "year", "type": "ordinal", "title": "Years", "axis": { "labelAngle": 0 } },
        "y": { "field": "amount", "type": "quantitative", "title": null, "axis": { "format": "$,.0f" } },
        "color": { "field": "part", "title": null, "sort": ["Paid in", "Interest"] },
        "order": { "field": "part", "sort": "descending" },
        "tooltip": [
          { "field": "part", "title": "Part" },
          { "field": "year", "title": "Year" },
          { "field": "amount", "title": "Amount", "format": "$,.0f" }
        ]
      }
    }
    </script>
  </t-vega>
</t-scope>

Set a new array to update the chart. A `<t-let>` does this for you, because it computes a new
array each time. From JavaScript, call `scope.set("rows", [...])`: changing the old array in place
isn't noticed.

## What redraws when

Vega only recomputes the parts of a chart that depend on what changed, and `<t-vega>` hands it
changes in the smallest form it can:

- **A parameter** is set on its own. Dragging `hp` in the first example re-evaluates only the
  opacity of each point; the data isn't fetched or parsed again, and only the points that cross the
  threshold change on screen.
- **A data change is diffed.** The new array is compared with the old one row by row. Rows at the
  same position are updated field by field, and only extra rows are added or missing ones removed.
  In the savings example, dragging the rate updates the "Interest" bars in place; the "Paid in"
  bars and the rest of the chart aren't rebuilt.
- **Changes are batched.** Dragging one number may change several variables. They're applied
  together, and the chart redraws once.
- **A theme change** re-renders the whole chart, since every color changes.

## Theme

Unless the spec says otherwise, the chart takes its look from the CSS around it:

- text, axes and gridlines from the text color (`currentColor`),
- the color of single-color marks from `--tangle-accent`,
- label size and font from `--tangle-chart-font`, and strengths from `--tangle-chart-text` and
  `--tangle-chart-grid`, the same properties [`<t-chart>`](t-chart.md#restyling) uses.

When the theme changes (a dark mode toggle, or the system setting), the charts re-render with the
new colors. A `config` in the spec wins over all of this, so you can still set a color scheme
for data colors, as in `"config": { "range": { "category": { "scheme": "tableau10" } } }`.

## Attributes

| Attribute | Default | Description |
|---|---|---|
| `src` | | A URL to load the spec from, instead of the `<script>` inside. |
| `renderer` | `svg` | `svg`, or `canvas`, which is faster for many thousands of points. |

## How Vega loads

The first `<t-vega>` on a page loads three scripts from jsDelivr, in order: Vega 6.4.0,
Vega-Lite 6.4.3 and vega-embed 7.3.0. That's about 830 KB of minified JavaScript (less over the
network, because it's compressed), which is why it isn't part of `tangle.js`. Pages without a
`<t-vega>` load none of it.

- If the page already loaded Vega (`window.vega`, `window.vegaLite`, `window.vegaEmbed`), that
  copy is used.
- To load it from somewhere else, for example your own server, call
  `configure({ vegaUrl, vegaLiteUrl, vegaEmbedUrl })` in the module that imports `tangle.js`, or
  set `window.TangleConfig` before it loads. See [Configuration](javascript.md#configuration).
- Vega compiles its expressions with `new Function`, just like tangle.js, so a
  Content-Security-Policy needs `'unsafe-eval'` for both.

Until Vega has loaded, the element shows "Loading chart…" (`.tangle-vega.is-loading`). A failure
to load Vega or to parse the spec shows a message in its place (`.tangle-vega-error`).

## `<t-chart>` or `<t-vega>`?

- [`<t-chart>`](t-chart.md) is built in: no download, plain HTML, styled with CSS, and it redraws
  only the shapes whose inputs changed. Use it for a few lines, areas or bars that follow the
  numbers in your text.
- `<t-vega>` costs a download, but can draw almost anything: scatter plots, tooltips, legends from
  data, stacked and faceted charts, and selections the reader makes in the chart.
