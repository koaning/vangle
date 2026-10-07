# Your own elements

When the built-in elements don't fit, write your own. Extend `TangleElement`, the class the
built-in elements extend, and register it with `customElements.define`. Your element then works
with the same variables, scopes and expressions as `<t-num>` and `<t-out>`.

## A bar that shows a value {#bar}

The smallest element reads variables and draws. Here, `<t-bar>` fills up to the value of its
`expr`, from 0 to 1:

<t-scope class="example" data-show-source="open">
  <p>Saving <t-num name="monthly" min="0" max="1000" step="10" format="$%d">250</t-num> a month
    towards <t-num name="goal" min="500" max="20000" step="100" format="$%,d">6000</t-num>, after a
    year you're <t-bar expr="12 * monthly / goal"></t-bar>
    <t-out expr="12 * monthly / goal" format="percent"></t-out> of the way there.</p>
</t-scope>

<script type="module" data-show-source="open">
  import { TangleElement } from "../tangle.js";

  // <t-bar expr="done / total"></t-bar>
  customElements.define("t-bar", class extends TangleElement {
    connectedCallback() {
      const fill = document.createElement("span");
      this.replaceChildren(fill);
      // Runs now, and again whenever a variable in the expression changes.
      this.watch((s) => {
        const value = s.eval(this.getAttribute("expr"));
        fill.style.width = `${Math.min(1, Math.max(0, value)) * 100}%`;
      });
    }
  });
</script>

<style data-show-source>
  t-bar {
    display: inline-block; width: 6em; height: 0.6em; vertical-align: middle;
    border-radius: 1em; overflow: hidden;
    background: color-mix(in srgb, currentColor 12%, transparent);
  }
  t-bar span { display: block; height: 100%; background: var(--tangle-accent); }
</style>

`this.watch(fn)` is the same as [`scope.effect(fn)`](javascript.md#scopes): `fn` gets the
element's scope, and `s.get` and `s.eval` subscribe to what they read. The difference is that
it stops when the element leaves the page.

## A slider that sets a variable {#slider}

An element can declare a variable and set it. `<t-slider>` wraps a range input. It's bound to the
same `speed` as the `<t-num>`, so moving either one moves the other:

<t-scope class="example" data-show-source="open">
  <p>Driving at <t-num name="speed" format="%d km/h"></t-num>
    <t-slider name="speed" value="90" min="30" max="130" step="5"></t-slider>
    you cover 100 km in <t-out expr="100 / speed * 60" format="%d minutes"></t-out>.</p>
</t-scope>

<script type="module" data-show-source="open">
  import { TangleElement } from "../tangle.js";

  // <t-slider name="speed" value="90" min="30" max="130" step="5"></t-slider>
  customElements.define("t-slider", class extends TangleElement {
    connectedCallback() {
      const name = this.getAttribute("name");
      // Reads min, max, step, color, label and format, like <t-var>.
      this.declare(name, Number(this.getAttribute("value")));
      const input = document.createElement("input");
      input.type = "range";
      input.addEventListener("input", () => this.scope.set(name, Number(input.value)));
      this.replaceChildren(input);
      this.watch((s) => {
        const { min = 0, max = 100, step = 1, label } = s.meta(name);
        Object.assign(input, { min, max, step, value: s.get(name) });
        input.setAttribute("aria-label", label ?? name);
      });
    }
  });
</script>

`this.declare(name, initial)` sets the variable's settings from the element's attributes, and
its value if nothing has set it yet. `s.meta(name)` reads those settings back, whichever element
declared them.

## A draggable of your own {#draggable}

`this.makeDraggable(name)` makes an element behave like a `<t-num>`: the reader can
[drag it, click to type, or use the arrow keys](t-num.md), hovering highlights every other
place the variable appears, and screen readers announce it as a slider. You only decide how it
looks:

<t-scope class="example" data-show-source="open">
  <p><t-dots name="cups" min="0" max="8">3</t-dots>
    <t-num name="cups"></t-num> cups of coffee a day is about
    <t-out expr="cups * 95" format="%d mg"></t-out> of caffeine.</p>
</t-scope>

<script type="module" data-show-source="open">
  import { TangleElement } from "../tangle.js";

  // <t-dots name="cups" min="0" max="8">3</t-dots>
  customElements.define("t-dots", class extends TangleElement {
    connectedCallback() {
      const name = this.getAttribute("name");
      // The text is replaced below, so keep the first one in case the element moves.
      this._initial ??= Number(this.textContent);
      this.declare(name, this._initial);
      this.makeDraggable(name);
      this.watch((s) => {
        const n = s.get(name), { max } = s.meta(name);
        this.textContent = "●".repeat(n) + "○".repeat(max - n);
        this.setAttribute("aria-valuetext", `${n} of ${max}`);
      });
    }
  });
</script>

<style data-show-source>
  t-dots { letter-spacing: 0.1em; white-space: nowrap; }
</style>

A draggable gets the same color, hover and focus styles as a `<t-num>`, from
`[data-tangle-param]` in `tangle.css`. Its `color` attribute works too. See
[Styling](styling.md).

## Reference {#reference}

| Member | Description |
|---|---|
| `this.scope` | The element's [scope](javascript.md#scopes): its nearest `<t-scope>`, or the page-wide one. |
| `this.watch(fn)` | Runs `fn(scope)` now, and again whenever a variable it read changes. Stops when the element is removed. |
| `this.declare(name, initial)` | Declares `name` from the `min`, `max`, `step`, `color`, `label` and `format` attributes, and sets it to `initial` unless something already did. |
| `this.makeDraggable(name, target)` | Lets the reader drag, type or arrow-key `name` on `target`, which defaults to the element itself. |

A few things to keep in mind:

- **Put setup in `connectedCallback`.** It runs when the element is added to the page, and again
  if it's moved. `watch` effects stop when it's removed. If you override `disconnectedCallback`,
  call `super.disconnectedCallback()`.
- **Pick a name that won't clash.** Any name with a hyphen works. A future version may add more
  `t-` elements, so a prefix of your own, like `my-bar`, is safest.
- **Import from the same URL** as the `<script>` tag that loads `tangle.js`, or your element gets
  a separate copy with separate variables. See [Importing](javascript.md#importing).
- **Define elements in one file.** On a blog, put them in a module such as `elements.js` and load
  it on every page, after `tangle.js`. Elements already in the page upgrade when they're defined,
  so it doesn't matter whether the script runs before or after the content.
