# JavaScript API

The elements cover most documents. For charts, simulations and anything custom, the same
reactive variables are available from JavaScript.

## A first script {#first-script}

Here, the HTML declares two variables, `g` and `years`, and an empty `.bars` element. A
script draws one bar per year, and the button resets both numbers:

<div class="example" data-show-source="open">
  <t-scope id="growth">
    <p>Growing by <t-num name="g" min="-20" max="50">10</t-num>% a year for
      <t-num name="years" min="1" max="20">8</t-num> years:</p>
    <div class="bars"></div>
    <button type="button">Reset</button>
  </t-scope>
</div>

<script type="module" data-show-source="open">
  import { scopeOf } from "../tangle.js";

  const root = document.querySelector("#growth");
  const scope = scopeOf(root);
  const bars = root.querySelector(".bars");

  // Runs now, and again whenever g or years changes.
  scope.effect((s) => {
    const values = Array.from({ length: s.get("years") }, (_, i) => (1 + s.get("g") / 100) ** i);
    const top = Math.max(...values);
    bars.replaceChildren(...values.map((v) => {
      const bar = document.createElement("div");
      bar.style.height = `${(v / top) * 100}%`;
      return bar;
    }));
  });

  root.querySelector("button").addEventListener("click", () => {
    scope.setValues({ g: 10, years: 8 });
  });
</script>

<style data-show-source>
  .bars { display: flex; align-items: flex-end; gap: 6px; height: 120px; margin: 1rem 0; }
  .bars div { flex: 1; border-radius: 4px 4px 0 0; background: var(--tangle-accent); transition: height 80ms; }
</style>

Step by step:

1. **Find the variables.** A page can have more than one set of variables: one page-wide
   set, plus one for each [`<t-scope>`](t-scope.md). Every example in these docs sits in its
   own `<t-scope>`, so this `years` can't clash with a `years` elsewhere on the page.
   `scopeOf(element)` returns the set that `element` belongs to, which is why it needs an
   element. Here that's `root`, the `<t-scope id="growth">`, found by its id. Any element inside
   it works too: `scopeOf(bars)` returns the same scope.
2. **Read them in an effect.** `scope.effect(fn)` runs `fn` straight away. While it runs,
   each `s.get("…")` returns the current value and records that `fn` depends on it. Here that's
   `g` and `years`.
3. **Re-run when they change.** When the reader drags `g` or `years`, `fn` runs again and
   rebuilds the bars. Each bar's height is a percentage of the tallest one.
4. **Set them from anywhere.** The button calls `scope.setValues`. The numbers in the text
   update, and so do the bars, because the effect depends on both values.

On a page without any `<t-scope>`, everything is page-wide. There, use `scopeOf(document)`
and skip the id:

```js
const scope = scopeOf(document);
scope.effect((s) => console.log(s.get("years")));
```

An effect finds its dependencies by running, so you never list them. If an `if` skips a
`s.get`, that variable isn't watched until a later run reads it.
[Updating a chart](charts.md) builds a bigger example, and covers canvas and chart
libraries.

## Importing

Import from the **same URL** as your `<script type="module">` tag. The
browser loads a module once per URL, so `/tangle.js` and `/tangle.js?v=2` would be
two separate copies with separate variables.

```js
import { scopeOf, registerFunction, registerFormat, configure } from "/tangle.js";
```

## Scopes {#scopes}

`scopeOf(element)` returns the scope an element belongs to: its nearest
[`<t-scope>`](t-scope.md), or the page-wide scope. Call
`scopeOf(document)` for the page-wide scope directly.

| Method | Description |
|---|---|
| `get(name)` | The current value. Inside an `effect`, also subscribes to it. |
| `peek(name)` | The current value, without subscribing. |
| `set(name, value)` | Sets a value. Everything that depends on it updates. |
| `setValues({ a: 1, b: 2 })` | Sets several values in one go. |
| `define(name, fn)` | Defines a computed variable, like `<t-let>`. `fn` receives the scope: `(s) => s.get("w") * s.get("h")`. An expression string also works: `define("area", "w * h")`. |
| `eval(expr)` | Evaluates an [expression](expressions.md) against the scope. |
| `effect(fn)` | Runs `fn(scope)` now, and again whenever a variable it read changes. Returns a function that stops it. |
| `meta(name)` | The variable's settings: `{ min, max, step, format, color, label, pixelsPerStep }`. |
| `setMeta(name, patch)` | Changes some of those settings. |

### Timing

Effects don't run synchronously on `set`. They're batched and run in a microtask, so setting
ten variables in a row redraws once. If you need the updated DOM right after a `set`,
wait a microtask first:

```js
scope.set("years", 12);
await Promise.resolve();
// outputs, formulas and effects are now up to date
```

## Signals

The reactive core is exported too, for state that doesn't belong in a scope:

```js
import { signal, computed, effect, untracked } from "/tangle.js";

const count = signal(1);
const double = computed(() => count.value * 2);
const stop = effect(() => console.log(double.value)); // logs 2

count.value = 5;                     // logs 10, in a microtask
untracked(() => count.value);        // read without subscribing
stop();
```

## Functions and formats

| Export | Description |
|---|---|
| `registerFunction(name, fn)` | Makes `fn` callable by name from every expression. Expressions that already ran re-run. See [Your own functions](expressions.md#functions). |
| `registerFormat(name, fn)` | Adds a named format. `fn(value)` returns a string. |
| `formatValue(value, format, step)` | Formats a value the way the elements do. |
| `formats` | The registry of named formats, as a plain object. |

## Configuration {#configuration}

`configure(options)` changes global defaults. Call it in the same module that imports
`tangle.js`, before the first formula loads KaTeX, the first [`<t-vega>`](t-vega.md) loads Vega, or the first
[`<t-obsplot>`](t-obsplot.md) loads Plot.

| Option | Default | Description |
|---|---|---|
| `katexUrl` | jsDelivr, KaTeX 0.19.0 | The KaTeX ES module to import. |
| `katexCssUrl` | jsDelivr, KaTeX 0.19.0 | The KaTeX stylesheet, added if the page has none. |
| `vegaUrl`, `vegaLiteUrl`, `vegaEmbedUrl` | jsDelivr: Vega 6.4.0, Vega-Lite 6.4.3, vega-embed 7.3.0 | The three Vega scripts, loaded in order. Each is skipped if its global (`vega`, `vegaLite`, `vegaEmbed`) already exists. |
| `d3Url`, `plotUrl` | jsDelivr: d3 7.9.0, Observable Plot 0.6.17 | The two Plot scripts, loaded in order. Each is skipped if its global (`d3`, `Plot`) already exists. |
| `pixelsPerStep` | `5` | The default drag sensitivity. |
