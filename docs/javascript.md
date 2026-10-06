# JavaScript API

The elements cover most documents. For charts, simulations and anything custom, the same
reactive variables are available from JavaScript.

<t-scope id="growth" class="example">
  <p>Growing by <t-num name="g" min="-20" max="50">10</t-num>% a year for
    <t-num name="years" min="1" max="20">8</t-num> years:</p>
  <div class="bars"></div>
</t-scope>

<script type="module" data-show-source="open">
  import { scopeOf } from "../tangle.js";

  const root = document.querySelector("#growth");
  const bars = root.querySelector(".bars");

  // Re-runs whenever a variable it reads (g or years) changes.
  scopeOf(root).effect((s) => {
    const values = Array.from({ length: s.get("years") }, (_, i) => (1 + s.get("g") / 100) ** i);
    const top = Math.max(...values);
    bars.replaceChildren(...values.map((v) => {
      const bar = document.createElement("div");
      bar.style.height = `${(v / top) * 100}%`;
      return bar;
    }));
  });
</script>

<style>
  .bars { display: flex; align-items: flex-end; gap: 6px; height: 120px; margin: 1rem 0; }
  .bars div { flex: 1; border-radius: 4px 4px 0 0; background: var(--tangle-accent); transition: height 80ms; }
</style>

## Importing

Import from the **same URL** as your `<script type="module">` tag. The
browser loads a module once per URL, so `/tangle.js` and `/tangle.js?v=2` would be
two separate copies with separate variables.

```js
import { scopeOf, registerFunction, registerFormat, configure } from "/tangle.js";
```

## Scopes

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
`tangle.js`, before the first formula loads KaTeX.

| Option | Default | Description |
|---|---|---|
| `katexUrl` | jsDelivr, KaTeX 0.19.0 | The KaTeX ES module to import. |
| `katexCssUrl` | jsDelivr, KaTeX 0.19.0 | The KaTeX stylesheet, added if the page has none. |
| `pixelsPerStep` | `5` | The default drag sensitivity. |
