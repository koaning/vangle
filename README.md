# vangle

Reactive documents for static HTML. This is a modern take on Bret Victor's [Tangle](https://worrydream.com/Tangle/), with KaTeX formulas you can drag.

- One ES module (`tangle.js`) and one stylesheet (`tangle.css`). No build step, no dependencies.
- Declarative: posts are plain HTML, and you don't write an `update()` function. Values recompute automatically through a small signals core.
- KaTeX is loaded only when a page contains `<t-math>`. If your blog already loads `katex`, that copy is used.

```html
<link rel="stylesheet" href="tangle.css">
<script type="module" src="tangle.js"></script>

<p>When you eat <t-num name="cookies" min="0" max="20">3</t-num> cookies,
   you consume <t-out expr="calories"></t-out> calories.</p>
<t-let name="calories" expr="cookies * 50"></t-let>
```

To skip copying the files, load them from [jsDelivr](https://www.jsdelivr.com/), which serves them straight from this repo. The `.min` versions are minified by jsDelivr:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/koaning/vangle@v0.1.0/tangle.min.css">
<script type="module" src="https://cdn.jsdelivr.net/gh/koaning/vangle@v0.1.0/tangle.min.js"></script>
```

If you import from `tangle.js` in your own module (to register functions, or for the JavaScript API), use the same URL as the `<script>` tag. A different URL loads a second copy with its own variables.

Run `make docs`, serve the repo locally (`make serve`) and open:

- `index.html` for the demos.
- `docs/index.html` for the documentation: a page per element with live examples, guides on expressions and formats, blogging (Markdown, KaTeX, CSP), the JavaScript API and styling, and a gallery of complete examples.
- `llms.txt` for LLMs. It links to the Markdown source of each docs page.

## Elements

| Element | What it does |
| --- | --- |
| `<t-num name="x" min max step format>3</t-num>` | A draggable number. Its text is the initial value, which is also what shows without JS. With no value, it's just another view of a variable declared elsewhere. |
| `<t-var name="x" value min max step color format>` | Declares a variable invisibly, for example one used only in formulas. |
| `<t-let name="y" expr="x * 2">` | A named computed value. Other expressions and formulas can use it. |
| `<t-out expr="x * 2" format="%.1f">` | Shows the result of an expression. |
| `<t-choice name="n" options="yearly:1, monthly:12">monthly</t-choice>` | Click to cycle through options. Each option is `label` or `label:value`, numeric values become numbers, and `true`/`false` become booleans. Two options make a toggle. |
| `<t-text name="who">reader</t-text>` | Click to rewrite a piece of text. The variable holds a string. |
| `<t-call fn="f" name="y">…</t-call>` | Shows its `<t-num>`, `<t-choice>` and `<t-text>` children as a call, `f(a=1, b='x')`. With `name`, the return value becomes a variable. `tangleCall(fn)` builds one from a JS function. |
| `<t-tag tag="progress">…</t-tag>` | Shows an HTML tag whose attributes are `<t-num>`, `<t-choice>` and `<t-text>` children, with the live element below it. Handy for documenting an element. |
| `<t-math display>…</t-math>` | A KaTeX formula with live markers (see below). Omit `display` for inline math. |
| `<t-vega>…</t-vega>` | A Vega-Lite chart, with its spec in a `<script type="application/json">` or `src`. Vega loads only if the page has one. See [Vega](#vega). |
| `<t-obsplot>…</t-obsplot>` | An Observable Plot chart, written as a JavaScript expression in a `<script type="text/plain">` or `src`. Plot loads only if the page has one. See [Observable Plot](#observable-plot). |
| `<t-paint name="art" width height tools>` | A canvas the reader draws on, with brush, marker, eraser, undo and clear. The variable holds the drawing as a PNG data URL, updated when a stroke ends, and setting it loads a picture. |
| `<t-scope>…</t-scope>` | Gives its contents their own variables. Without one, everything shares a page-wide scope. |
| `<t-panel corner label width collapsed>…</t-panel>` | Floats its contents in a draggable panel that stays in view while the page scrolls, so controls can follow the reader. |

To write your own, extend `TangleElement`. See `docs/custom-elements.md`.

Declaration order doesn't matter: you can use a variable before the element that declares it.

### Attributes for numbers (`t-num`, `t-var`)

- `min`, `max`: bounds. The default is unbounded.
- `step`: the drag and keyboard increment, and the default display precision. The default is `1`.
- `format`: see [Formats](#formats).
- `color`: one CSS color, or two (`"#246bce #75a7ff"`) for light and dark mode. The two-color form uses CSS `light-dark()`, so the page needs `color-scheme: light dark`.
- `label`: the accessible name. The default is the variable name.
- `pixels-per-step`: drag sensitivity. The default is `5`.

### Interaction

- **Drag** horizontally to change a value.
- **Click** without dragging, or press **Enter**, to type a value. The field also accepts an expression such as `w + 1`.
- **Arrow keys** step the value, **Shift** multiplies the step by 10, and **Home**/**End** jump to min and max.
- **Hover** over a variable to highlight every place it appears, in prose and in formulas.

## Formulas

`<t-math>` takes ordinary KaTeX source plus two markers:

- `\tangle{a}`: the value of `a`, which you can drag.
- `\tangle[\alpha]{a}`: shows the TeX `\alpha` until you drag or edit it.
- `\val{expr}` or `\val[fmt]{expr}`: the live result of an expression, optionally formatted.

```html
<t-var name="a" value="1" min="-3" max="3" step="0.1" color="#246bce"></t-var>
<t-var name="b" value="-1" min="-6" max="6" step="0.2"></t-var>
<t-math display>
  f(x) = \tangle[a]{a}\,x^2 + \tangle[b]{b}\,x
  \quad f(1) = \val[%.2f]{a + b}
</t-math>
```

Things to know when writing TeX inside HTML:

- Write `<` as `&lt;` and `&` as `&amp;` in the element text.
- Markdown processors may rewrite `_` and `*` inside a `<t-math>` that sits in a paragraph. In that case, use the attribute form, which Markdown leaves alone: `<t-math tex="E = \tangle{m} c^2"></t-math>`.
- A marker inserts just the number. So with negative values, write `-(\tangle{b})` rather than `-\tangle{b}`.
- Text values, such as the result of `\val{x > 0 ? 'yes' : 'no'}`, are rendered with `\text{…}`.

## Vega

For charts, `<t-vega>` renders a [Vega-Lite](https://vega.github.io/vega-lite/) spec:

```html
<p>Highlight cars over <t-num name="hp" min="50" max="230" step="10">150</t-num> horsepower.</p>
<t-vega>
  <script type="application/json">
  { "data": { "url": "cars.json" },
    "params": [{ "name": "hp", "value": 150 }],
    "mark": "point",
    "encoding": {
      "x": { "field": "Horsepower", "type": "quantitative" },
      "y": { "field": "Miles_per_Gallon", "type": "quantitative" },
      "opacity": { "condition": { "test": "datum.Horsepower > hp", "value": 1 }, "value": 0.2 } } }
  </script>
</t-vega>
```

- A top-level param with a variable's name is linked to it both ways; selections (`select`) only flow from the chart to the page. A named data source (`"data": { "name": "rows" }`) is fed from the variable `rows`.
- Colors and fonts come from the surrounding CSS (`currentColor`, `--tangle-accent`, `--tangle-chart-*`), and charts re-render when the theme changes.
- Vega 6.4.0, Vega-Lite 6.4.3 and vega-embed 7.3.0 (about 830 KB minified) load from jsDelivr only when the page has a `<t-vega>`. An existing `window.vega`/`vegaLite`/`vegaEmbed` is reused, or set other URLs with `configure({ vegaUrl, vegaLiteUrl, vegaEmbedUrl })`.

## Observable Plot

`<t-obsplot>` renders an [Observable Plot](https://observablehq.com/plot/) chart. Plot is a JavaScript API, so the chart is an expression over the variables, with `Plot` and `d3` in reach:

```html
<p>A wave of <t-num name="freq" min="0.5" max="4" step="0.5">2</t-num> Hz.</p>
<t-obsplot>
  <script type="text/plain">
  { height: 200,
    marks: [Plot.line(d3.range(0, 3, 0.01), { x: (t) => t, y: (t) => Math.sin(2 * Math.PI * freq * t) })] }
  </script>
</t-obsplot>
```

- The expression gives Plot options, an array of marks, or a chart made with `Plot.plot`. Every variable it reads (also inside channel functions) is tracked, and the chart redraws when one changes.
- `name="x"` sets the variable `x` to the datum under Plot's pointer (`tip`, `Plot.pointer`), or `null`.
- The width follows the element, the font comes from `--tangle-chart-font`, and Plot's `currentColor` follows the theme.
- d3 7.9.0 and Plot 0.6.17 (about 490 KB minified) load from jsDelivr only when the page has a `<t-obsplot>`. An existing `window.d3`/`Plot` is reused, or set other URLs with `configure({ d3Url, plotUrl })`.

## Expressions

Expressions (`expr`, `\val{…}`) are plain JavaScript evaluated against the scope. A name in an expression is one of:

- **A scope variable.** Any name that isn't one of the two kinds below, even before it's declared. Dependencies are tracked automatically.
- **A function you registered** with `registerFunction("bmi", (kg, m) => kg / m ** 2)`.
- **A standard JS global** from a short allowlist: `Math`, `Number`, `String`, `Boolean`, `Array`, `Object`, `JSON`, `Date`, `Intl`, `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `Infinity`, `NaN`, `undefined`. So write `Math.sqrt(x)`, not `sqrt(x)`.

Nothing else from `window` leaks in, so a variable called `top`, `name` or `length` is just a variable.
- For conditional text, use a ternary instead of a special element: `<t-out expr="x > 0 ? 'gain' : 'lose'">`.

> Expressions are compiled with `new Function`. If your site sends a Content-Security-Policy, it must allow `'unsafe-eval'`.

## Formats

- **printf-lite:** `%d`, `%.2f`, `%s`, and `%%`, with the flags `+` (always show the sign) and `,` (thousands separators). Text around the placeholder is kept: `"$%,.2f"`, `"%+.1f km"`.
- **Named formats:** `percent` (multiplies by 100), `dollars`, and `int`.
- **Your own formats:** `registerFormat("hz", v => v + " Hz")`.
- **No format:** numbers are rounded to the precision of `step`, or to 4 significant digits.

## JavaScript API

The declarative elements cover most posts. For custom charts and other logic, the same reactive scope is available from JS:

```js
import { scopeOf, registerFormat, registerFunction, configure } from "./tangle.js";

const scope = scopeOf(document);           // or scopeOf(someElementInsideATScope)
scope.effect((s) => draw(s.get("a")));      // re-runs whenever `a` changes
scope.set("a", 2);
scope.setValues({ a: 2, b: 3 });
scope.define("area", (s) => s.get("w") * s.get("h"));  // or scope.define("area", "w * h")
scope.peek("a");                            // read without subscribing
scope.eval("a * 2");
```

Lower-level primitives are exported too: `signal`, `computed`, `effect`, `untracked`.

### KaTeX, Vega and Plot sources

By default KaTeX 0.19.0 comes from jsdelivr. To use a different copy:

- If `window.katex` exists (your blog loads KaTeX itself), it is used.
- Otherwise, call `configure({ katexUrl, katexCssUrl })` in the same module that imports `tangle.js`.
- Or set `window.TangleConfig = { katexUrl, katexCssUrl }` before the module loads.
- Vega works the same way, with `window.vega`, `window.vegaLite` and `window.vegaEmbed`, and the options `vegaUrl`, `vegaLiteUrl` and `vegaEmbedUrl`. So does Plot, with `window.d3` and `window.Plot`, and the options `d3Url` and `plotUrl`.

## Development

```sh
make           # rebuild the docs, then run the tests
make test      # node --test: signals, formats, expressions, TeX parsing, docs build
make docs      # generate docs/*.html from docs/*.md
make site      # assemble the published site in _site/
make serve     # serve the repo at http://localhost:8000 (run make docs first)
make pr        # test, push the branch and open a pull request
```

CI runs `make test` on every push to main and on pull requests. On main, the Pages workflow also runs `make site` and publishes `_site/` to GitHub Pages.

The docs are written in Markdown (`docs/*.md`), and `site/build.js` turns them into the HTML pages. The HTML is generated, not committed (it's gitignored). Live examples are raw HTML blocks in the Markdown, so the HTML in the docs is the HTML a reader would copy. `llms.txt` is written by hand; update it when a page is added.

## Credits

Based on [Tangle](https://worrydream.com/Tangle/) by Bret Victor (MIT). The formula interaction follows `TangleLatex` from [wigglystuff](https://github.com/koaning/wigglystuff).
