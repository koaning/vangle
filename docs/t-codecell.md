# `<t-codecell>`

Code the reader edits. It runs in a sandbox, again whenever the code or a page variable it
mentions changes, and its result goes into a variable.

<t-scope class="example" data-show-source>
  <p>A stone dropped from <t-num name="height" min="1" max="100">20</t-num> m falls for
    <t-out expr="fall" format="%.2f s"></t-out>.</p>
  <t-tag tag='t-codecell name="fall"'>
    <t-choice name="output" options="true, false">true</t-choice>
    <t-choice name="copy" options="true, false">true</t-choice>
    <t-num name="timeout" min="100" max="5000" step="100">2000</t-num>
    <t-num name="debounce" min="0" max="2000" step="100">400</t-num>
    Math.sqrt(2 * height / 9.81)
  </t-tag>
</t-scope>

## Attributes

| Attribute | Default | Description |
|---|---|---|
| `name` | | The variable that holds the result. |
| `output` | off | Shows the result under the editor. Without a `name` it always shows, since it has nowhere else to go. Logged lines and errors show either way. |
| `copy` | off | Adds a **Copy** button that puts the code, as edited, on the clipboard. |
| `lang` | `js` | The language. JavaScript is built in; [`registerEngine`](#engines) adds others. |
| `timeout` | `2000` | Milliseconds a run may take before it's stopped. |
| `debounce` | `400` | Milliseconds to wait after the last keystroke before running. |
| `error` | | A variable that gets the error message, or `null` when a run succeeds. |
| `label` | the name | The editor's accessible name. |

## A simulation {#simulation}

The result can be anything that fits in a variable, such as a whole trajectory to plot.

<t-scope class="example" data-show-source>
  <p>A baseball leaves the bat at <t-num name="angle" min="5" max="85">35</t-num>° and
    <t-num name="speed" min="10" max="60">45</t-num> m/s. With air drag it lands
    <t-out expr="path?.at(-1).x" format="%d"></t-out> m away; in a vacuum it would go
    <t-out expr="speed ** 2 * Math.sin(2 * angle * Math.PI / 180) / 9.81" format="%d"></t-out> m.</p>
  <t-codecell name="path">
    <script type="text/plain">
    // Drag force: ½ ρ C_d A v², for a 145 g ball 7.3 cm across.
    const rho = 1.2, cd = 0.3, area = Math.PI * 0.0365 ** 2, mass = 0.145;
    const k = (0.5 * rho * cd * area) / mass;
    const g = 9.81, dt = 0.005;
    const a = (angle * Math.PI) / 180;
    let x = 0, y = 0, vx = speed * Math.cos(a), vy = speed * Math.sin(a);
    const points = [{ x, y }];
    while (y >= 0) {
      const v = Math.hypot(vx, vy);
      vx -= k * v * vx * dt;
      vy -= (g + k * v * vy) * dt;
      x += vx * dt;
      y += vy * dt;
      points.push({ x, y: Math.max(y, 0) });
    }
    return points;
    </script>
  </t-codecell>
  <t-obsplot>
    <script type="text/plain">
    {
      height: 220,
      x: { label: "Distance (m)", domain: [0, 370] },
      y: { label: "Height (m)", domain: [0, 185] },
      marks: [
        Plot.ruleY([0]),
        Plot.line(d3.range(0, 1.001, 0.01), {
          x: (t) => t * speed ** 2 * Math.sin(2 * angle * Math.PI / 180) / 9.81,
          y: (t) => t * (1 - t) * (speed * Math.sin(angle * Math.PI / 180)) ** 2 * 2 / 9.81,
          strokeDasharray: "4 3", strokeOpacity: 0.5
        }),
        Plot.line(path ?? [], { x: "x", y: "y", stroke: "var(--tangle-accent)", strokeWidth: 2 })
      ]
    }
    </script>
  </t-obsplot>
</t-scope>

The cell mentions `angle` and `speed`, so dragging either one runs it again. Change the drag
coefficient `cd` to `0` and the solid line lands on the dashed one, the path in a vacuum.

## Writing the code

Short code can go straight inside the element, as in the first example. Longer code is
better in a `<script type="text/plain">`, as in the second: the browser doesn't run it, and
Markdown and HTML leave its `<` and `&` alone. Either way, its indentation is removed.

The code is either:

- **One expression**, like the `expr` of a [`<t-let>`](t-let.md): `speed * 3.6`.
- **Statements with a `return`**, as in the example. Without a `return`, the result is
  `undefined`.

It runs as an `async` function, so `await` works at the top level.

In the editor, the names that come from the page are tinted, like the values the reader
changes in the prose. A name the code declares itself isn't tinted.

Page variables the code mentions are passed in as copies, so assigning to one doesn't change the
page. The code can declare its own variable with the same name. The result goes back out the
same way. Numbers, strings, arrays, plain objects, `Map`, `Set`, `Date` and typed arrays can
cross; functions and DOM elements can't.

## Output

Under the editor are what the code logged with `console.log`, and the error and the line it
happened on, if there is one. The result shows there too with `output`, or when the cell has no
`name`; usually other elements on the page show it instead. While a run is in progress the
old output stays, dimmed, and so does every element that shows the cell's variable. A failed
run keeps the last good value.

| Input | Effect |
|---|---|
| Typing | Runs the code after a pause. |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> | Runs now, even if nothing changed. |
| Reset | Puts the starting code back. It only shows up after an edit. |
| Copy | Puts the code on the clipboard. Only with `copy`. |

## The sandbox {#sandbox}

JavaScript cells run in a [Web Worker](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API),
one per cell:

- The code can't reach the page: no `document`, no `window`, no other cells and no page
  variables except the copies it was given.
- A run that takes longer than `timeout`, like an endless `while (true) {}`, is stopped and
  reported. The page keeps responding. A new edit also stops a run that's still going.
- A worker can still use `fetch` with the page's address. That's fine for a reader editing
  code on their own screen, but it doesn't make code from strangers safe to run.

## The editor

The editor is [CodeMirror](https://codemirror.net/), and it loads only on pages that have a
`<t-codecell>`. Until it loads, the code shows as plain text. If it can't load, for example
offline, a plain text area takes its place. Highlighting uses the same colors as
[`<t-call>`](t-call.md), so it follows the [theme](styling.md). To load CodeMirror from
somewhere else, see [`configure`](javascript.md#configuration).

## Other languages {#engines}

An engine runs a language's code. `registerEngine(lang, factory)` adds one: `factory()` is
called once per cell and returns `{ run(code, inputs, { timeout }), dispose() }`. `run`
returns a promise of `{ value, logs }`, where `logs` is a list of `{ level, text }`. To report
a failure, it rejects with an `Error`, which can carry a `line`.

<div class="example" data-show-source="open">
  <t-codecell name="shout" lang="shout">
    <script type="text/plain">
    the quick brown fox
    </script>
  </t-codecell>
</div>

<script type="module" data-show-source="open">
  import { registerEngine } from "../tangle.js";

  registerEngine("shout", () => ({
    async run(code) {
      return { value: code.toUpperCase(), logs: [{ level: "log", text: `${code.length} characters` }] };
    },
  }));
</script>

An engine for Python (with Pyodide) or SQL (with DuckDB) would start its runtime in a worker in
the same way.
