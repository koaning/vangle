# `<t-chart>`

A line, area or bar chart drawn from your variables, as SVG. You write the chart in HTML,
and when the reader drags a number, only the shapes that depend on it are redrawn.

<t-scope class="example" data-show-source="open">
  <p>Put away <t-num name="deposit" min="0" max="400" step="10" format="$%d">200</t-num> a month
    at <t-num name="rate" min="0" max="8" step="0.5" format="%.1f%%">6</t-num> a year.
    After 30 years you have <t-out expr="saved(30)" format="dollars"></t-out>, of which you paid in
    <t-out expr="yearly * 30" format="dollars"></t-out>.</p>
  <t-let name="yearly" expr="deposit * 12"></t-let>
  <!-- saved(year) is what you have after that many years. A t-let can hold a function. -->
  <t-let name="saved" expr="(year) => rate ? yearly * ((1 + rate / 100) ** year - 1) / (rate / 100) : yearly * year"></t-let>
  <!-- var="year" names the x axis variable: each mark is drawn for year = 0 … 30. -->
  <t-chart var="year" xmin="0" xmax="30" ymin="0" ymax="600000" x-label="years" y-format="$%,d" label="Savings over 30 years">
    <t-area y="saved(year)"></t-area>
    <t-line y="saved(year)" label="Your savings"></t-line>
    <t-line y="yearly * year" class="paid-in" label="What you paid in"></t-line>
  </t-chart>
</t-scope>

<style data-show-source>
  t-chart .paid-in {
    stroke: currentColor;
    stroke-opacity: 0.45;
    stroke-dasharray: 4 5;
  }
</style>

## How a line is drawn {#sampling}

A `y` expression describes the line one point at a time. The chart walks across the x axis, from
`xmin` to `xmax`, in small even steps (about 135 of them). At each step it sets the x variable to
that position, works out `y`, and puts a point there. Then it connects the points.

In this example the x variable is called `year`, and `xmin`/`xmax` are 0 and 30. So
`<t-line y="saved(year)">` works out `saved(0)`, `saved(0.22)`, `saved(0.44)`, and so on up to
`saved(30)`, and the line is drawn through those points. `y="yearly * year"` does the same for the
money you paid in.

- The x variable only exists inside `y` expressions. You don't declare it, and it doesn't change
  your other variables.
- It's called `x` unless you name it with `var`. The other examples on this page use `x`, as in
  `y="amp * Math.sin(freq * x)"`.
- `saved` is a `<t-let>` whose value is a function, so the chart (`saved(year)`) and the text
  (`saved(30)`) share one formula.

## Legends

Give a mark a `label` and the chart shows a legend, above the chart by default, or below it with
`legend="bottom"`. Each swatch takes the same classes and color as its mark, so the
`t-chart .paid-in` rule above dashes both the line and its swatch. The area has no `label`, so it
stays out of the legend.

## Bars

<t-scope class="example" data-show-source="open">
  <p>A café sells <t-num name="base" min="0" max="40">20</t-num> coffees on a weekday, and
    <t-num name="boost" min="0" max="100" step="5" format="%d%%">50</t-num> more on weekends.</p>
  <t-let name="week" expr="[0, 0, 0, 0, 0, 1, 1].map((weekend) => base * (1 + weekend * boost / 100))"></t-let>
  <t-chart ymax="80" labels="Mon, Tue, Wed, Thu, Fri, Sat, Sun" height="220" label="Coffees sold per day">
    <t-bars data="week"></t-bars>
  </t-chart>
</t-scope>

With `labels`, bar `i` gets the `i`-th label, and the x axis fits the bars without an `xmin` or `xmax`.

## Data from JavaScript

A chart can draw any variable that holds an array. To chart data your own script loads or
computes, put it in a variable with `scope.set`:

<t-scope class="example" id="weather" data-show-source="open">
  <p>Above <t-num name="limit" min="0" max="20" format="%d °C">12</t-num>, Amsterdam has
    <t-out expr="temps.filter((t) => t > limit).length"></t-out> warm months a year.</p>
  <t-chart ymin="0" ymax="20" labels="Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec"
           y-format="%d°" height="220" legend="bottom" label="Average temperature per month in Amsterdam">
    <t-line data="temps" label="Average temperature"></t-line>
    <t-line y="limit" class="paid-in" label="Warm enough"></t-line>
  </t-chart>
</t-scope>

<script type="module" data-show-source="open">
  import { scopeOf } from "../tangle.js";

  scopeOf(document.querySelector("#weather"))
    .set("temps", [3.4, 3.7, 6.4, 9.6, 13.3, 16, 18.1, 17.9, 15, 11.1, 7, 4.1]);
</script>

To update the chart, set a new array. Changing the old one in place (`temps.push(…)`) isn't
noticed, because the variable still holds the same array.

## Attributes

### `<t-chart>`

| Attribute | Default | Description |
|---|---|---|
| `xmin`, `xmax` | `0`, `1` | The x axis range. These are [expressions](expressions.md), so they can use variables. With bars or `labels`, the default fits the bars. |
| `ymin`, `ymax` | `0`, `1` | The y axis range, also expressions. |
| `labels` | | Comma-separated names for x = 0, 1, 2…, shown on the x axis. |
| `x-label`, `y-label` | | Axis titles. |
| `x-format`, `y-format` | | [Formats](expressions.md#formats) for the tick labels. |
| `x-ticks`, `y-ticks` | `5` | About how many ticks to show. They land on round numbers. |
| `width`, `height` | `600`, `300` | The size of the drawing in SVG units. The chart always fills the width of its container, so these set the aspect ratio. |
| `var` | `x` | The name of the x variable in `y` expressions. See [How a line is drawn](#sampling). |
| `label` | `Chart` | The accessible name of the chart. |
| `legend` | `top` | Where the legend goes: `top` or `bottom`. There's only a legend if a mark has a `label`. |

### Marks

| Element | Attributes |
|---|---|
| `<t-line>` | `y`: an expression of `x`, worked out at `samples` points across the x axis (default: one per 4 units of width; see [How a line is drawn](#sampling)). Or `data`: an expression that gives an array. |
| `<t-area>` | The same as `<t-line>`, plus `y0` (default `0`): the area is filled down to that value. |
| `<t-bars>` | `data`: an array expression. `width` (default `0.8`): bar width, in x units. `y0` (default `0`): where bars start, so negative values hang down. |

All three also take:

- `color`: one CSS color, or two for light and dark mode, as on [`<t-num>`](t-num.md). The
  default is `--tangle-accent`.
- `class`: copied onto the SVG shape and its legend swatch, so your CSS can style one series.
- `label`: the series name, shown in the [legend](#legends).

`data` can hold numbers, which are drawn at x = 0, 1, 2…, or `[x, y]` pairs, or `{ x, y }`
objects. A value that isn't a number (like `NaN`) leaves a gap in a line.

## What redraws when

The chart is built to stay cheap while the reader drags:

- The SVG, gridlines and tick labels are drawn once. They're only redrawn if `xmin`, `xmax`,
  `ymin` or `ymax` uses a variable that changes.
- Each mark redraws on its own, and only when something it reads changes. In the first example,
  dragging `rate` redraws the area and the curve, but not the paid-in line, which doesn't use it.
- A line or area rewrites one attribute (its path). Bars reuse their rectangles and only update
  the sizes that changed.
- Changes are batched. Dragging `deposit` also changes `yearly` and `saved`, but each mark
  redraws once per change.

For a chart this element can't draw, use [`<t-vega>`](t-vega.md), which loads Vega-Lite on
pages that need it, or see [Updating a chart](charts.md), which draws with your own script.

## Restyling

Charts use `currentColor` for the axes and `--tangle-accent` for the marks, so they follow your
text color and dark mode. Set these properties on `:root`, or on any container:

| Property | Default | Used for |
|---|---|---|
| `--tangle-chart-stroke` | `2.5px` | Line width. |
| `--tangle-chart-area` | `20%` | Strength of an area's fill, mixed from the mark color. |
| `--tangle-chart-grid` | `12%` | Strength of the gridlines, mixed from the text color. |
| `--tangle-chart-text` | `60%` | Strength of the tick and axis labels. |
| `--tangle-chart-font` | `12px system-ui` | Font of the tick and axis labels. |

<t-scope class="example bold-chart" data-show-source="open">
  <p>A wave with amplitude <t-num name="amp" min="0" max="2" step="0.1">1.2</t-num>
    and frequency <t-num name="freq" min="1" max="6">2</t-num>.</p>
  <t-chart xmin="0" xmax="2 * Math.PI" ymin="-2" ymax="2" height="200" x-format="%.1f" label="A sine wave">
    <t-area y="amp * Math.sin(freq * x)"></t-area>
    <t-line y="amp * Math.sin(freq * x)"></t-line>
  </t-chart>
</t-scope>

<style data-show-source="open">
  .bold-chart {
    --tangle-accent: #c2410c;
    --tangle-chart-stroke: 4px;
    --tangle-chart-area: 35%;
    --tangle-chart-grid: 0%;
  }
</style>

The SVG and its parts have classes, for anything the properties don't cover:

| Selector | Matches |
|---|---|
| `.tangle-chart` | The `<svg>`. |
| `.tangle-grid line` | Gridlines. |
| `.tangle-axis text` | Tick labels: `.x` and `.y`, and `.label` for the axis titles. |
| `.tangle-line`, `.tangle-area` | A line or area's `<path>`. |
| `.tangle-bars`, `.tangle-bar` | The group of bars, and each `<rect>`. |
| `.tangle-legend` | The legend, a flex row of `.tangle-legend-item`s. |
| `.tangle-swatch` | The small `<svg>` in each legend item. |
