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

Open `index.html` through a local server (`python3 -m http.server`) to see the demos.

## Elements

| Element | What it does |
| --- | --- |
| `<t-num name="x" min max step format>3</t-num>` | A draggable number. Its text is the initial value, which is also what shows without JS. With no value, it's just another view of a variable declared elsewhere. |
| `<t-var name="x" value min max step color format>` | Declares a variable invisibly, for example one used only in formulas. |
| `<t-let name="y" expr="x * 2">` | A named computed value. Other expressions and formulas can use it. |
| `<t-out expr="x * 2" format="%.1f">` | Shows the result of an expression. |
| `<t-choice name="n" options="yearly:1, monthly:12">monthly</t-choice>` | Click to cycle through options. Each option is `label` or `label:value`, and numeric values become numbers. Two options make a toggle. |
| `<t-math display>…</t-math>` | A KaTeX formula with live markers (see below). Omit `display` for inline math. |
| `<t-scope>…</t-scope>` | Gives its contents their own variables. Without one, everything shares a page-wide scope. |

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
- **Click** without dragging, or press **Enter**, to type a value. The field also accepts an expression such as `2 * PI`.
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

## Expressions

Expressions (`expr`, `\val{…}`) are plain JavaScript evaluated against the scope:

- Variables are in scope by name.
- `Math` members are available directly: `sqrt(x)`, `PI`, `max(a, b)`.
- Dependencies are tracked automatically.
- For conditional text, use a ternary instead of a special element: `<t-out expr="x > 0 ? 'gain' : 'lose'">`.

> Expressions are compiled with `new Function`. If your site sends a Content-Security-Policy, it must allow `'unsafe-eval'`.

## Formats

- **printf-lite:** `%d`, `%.2f`, `%s`, and `%%`, with the flags `+` (always show the sign) and `,` (thousands separators). Text around the placeholder is kept: `"$%,.2f"`, `"%+.1f km"`.
- **Named formats:** `percent` (multiplies by 100), `dollars`, and `int`.
- **Your own formats:** `registerFormat("hz", v => v + " Hz")`.
- **No format:** numbers are rounded to the precision of `step`, or to 4 significant digits.

## JavaScript API

The declarative elements cover most posts. For charts and other custom logic, the same reactive scope is available from JS:

```js
import { scopeOf, registerFormat, configure } from "./tangle.js";

const scope = scopeOf(document);           // or scopeOf(someElementInsideATScope)
scope.effect((s) => draw(s.get("a")));      // re-runs whenever `a` changes
scope.set("a", 2);
scope.setValues({ a: 2, b: 3 });
scope.define("area", (s) => s.get("w") * s.get("h"));  // or scope.define("area", "w * h")
scope.peek("a");                            // read without subscribing
scope.eval("a * 2");
```

Lower-level primitives are exported too: `signal`, `computed`, `effect`, `untracked`.

### KaTeX source

By default KaTeX 0.19.0 comes from jsdelivr. To use a different copy:

- If `window.katex` exists (your blog loads KaTeX itself), it is used.
- Otherwise, call `configure({ katexUrl, katexCssUrl })` in the same module that imports `tangle.js`.
- Or set `window.TangleConfig = { katexUrl, katexCssUrl }` before the module loads.

## Development

```sh
npm test    # node --test: signals, formats, expressions, TeX parsing
```

## Credits

Based on [Tangle](https://worrydream.com/Tangle/) by Bret Victor (MIT). The formula interaction follows `TangleLatex` from [wigglystuff](https://github.com/koaning/wigglystuff).
