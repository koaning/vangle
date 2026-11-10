# `<t-formula-dag>`

Formulas that build on each other, laid out top to bottom by what uses what. One formula uses
another's result with `\use{name}`. An arrow runs from that formula's output to the exact spot
where it's used. Formulas can hold draggable numbers, and each one can compute a value that
the rest of the page reads.

<t-scope class="example" data-show-source="open">
  <p>A stone dropped from <t-num name="h" min="1" max="100" label="drop height (m)">20</t-num> m.</p>
  <t-formula-dag>
    <script type="text/plain">
    {
      formulas: {
        t: { tex: String.raw`t = \sqrt{\frac{2\tangle[h]{h}}{\tangle[g]{g}}}`, value: "Math.sqrt(2 * h / g)", label: "time to fall", format: "%.2f" },
        v: { tex: String.raw`v = \tangle[g]{g}\,\use{t}`, value: "g * t", label: "speed at impact", format: "%.1f" },
      },
      params: {
        g: { value: 9.8, min: 1, max: 25, step: 0.1, label: "gravity (m/s²)" },
      },
    }
    </script>
  </t-formula-dag>
  <p>It hits the ground after <t-out expr="t" format="%.2f s"></t-out>, at <t-out expr="v" format="%.1f m/s"></t-out>.</p>
</t-scope>

For a bigger diagram, with nine formulas, notes, and arrows that skip rows, see
[projectile motion with wind](gallery-projectile.md) in the gallery.

## Writing the spec

The spec goes in a `<script type="text/plain">` inside the element, where the browser
neither runs nor shows it, and Markdown leaves it alone. It's one JavaScript expression,
written like JSON, with an object of `formulas` keyed by name. Write the TeX in
`String.raw` template strings, so backslashes stay as they are: `` String.raw`\frac{a}{b}` ``.

A formula is a TeX string, or an object when it needs more:

| Key | Description |
|---|---|
| `tex` | The formula. Required. |
| `symbol` | What `\use{name}` shows in other formulas. Defaults to the left of the first `=`, or `\mathrm{name}` if there's none. |
| `label` | The caption under the formula. Defaults to the name. |
| `value` | An [expression](expressions.md) or a function. Defines a variable named after the formula. See [Values](#values). |
| `format` | The [format](expressions.md#formats) for that value. |
| `color` | Its color, one CSS color or two (light and dark): `"#b45b1b #ffad66"`. Defaults to the palette for formulas that others use. |
| `row` | The topmost row it may sit in, counting from 0 at the top. It sits lower when it uses a formula in that row or below. See [Rows](#rows). |

Next to `formulas`, the spec can have `params`, `notes`, `legend` and `reset`, described below.
A misspelled key, a `\use` of a formula that doesn't exist, or formulas that use each other
in a circle all show an error in place of the diagram.

## Wiring formulas with `\use` {#use}

`\use{name}` puts that formula's symbol into the TeX, and adds an arrow from it. Formulas sit
one row below the deepest formula they use. An arrow that skips rows threads through a gap
kept free for it. When something covers the spot, such as a fraction bar or a root, the arrow
comes in from the side:

<t-scope class="example" data-show-source="open">
  <t-formula-dag>
    <script type="text/plain">
    {
      formulas: {
        mu: String.raw`\mu = \frac{1}{n}\sum_{i=1}^{n} x_i`,
        var: String.raw`\sigma^2 = \frac{1}{n}\sum_{i=1}^{n} (x_i - \use{mu})^2`,
        sigma: String.raw`\sigma = \sqrt{\use{var}}`,
        z: { tex: String.raw`z_i = \frac{x_i - \use{mu}}{\use{sigma}}`, label: "z-score" },
      },
    }
    </script>
  </t-formula-dag>
</t-scope>

Each formula that others use gets a color. Its output, its arrows and every place it's used
share that color. Hover over a formula to keep only what it uses and what uses it.

### Rows {#rows}

Formulas that use nothing share the top row. That can put a formula far above the one that
uses it, with a long arrow down. `row` pushes a formula down to at least that row, and the
formulas that use it move down with it, so a formula never sits above one it uses. Use it to put the
diagram in the order a reader should follow. The [projectile](gallery-projectile.md) works out
the up-and-down motion first, and then the motion along the ground, which only needs the time
in the air. The forward speed and the wind use nothing, so they'd share the top row. `row: 2`
puts them below the time in the air:

```js
vx: { tex: String.raw`v_x = \tangle[v]{v}\cos\tangle[\theta]{theta}`, row: 2, … },
ax: { tex: String.raw`a_x = \tangle[a_w]{wind}\cos\tangle[\varphi]{phi}`, row: 2, … },
```

### Exponents

An exponent right after `\use{}` joins the symbol, so with `v_y` as the symbol,
`\use{vy}^2` stacks the 2 over the subscript, as `v_y^2` would, instead of raising it over
all of `v_y`.

## Numbers {#numbers}

`\tangle{name}` and `\tangle[symbol]{name}` work as they do in [`<t-math>`](t-math.md#markers):
a draggable number bound to a variable, shown as its symbol until it's dragged or edited.
`\val{expr}` shows a live result. A variable can be declared anywhere in the scope, by a
[`<t-num>`](t-num.md) in the text like `h` above, or a [`<t-var>`](t-var.md). It
can also be declared in the spec's `params`:

```js
params: {
  g: { value: 9.8, min: 1, max: 25, step: 0.1, label: "gravity (m/s²)" },
}
```

A param takes `value`, `min`, `max`, `step`, `pixelsPerStep`, `label`, `format` and `color`,
like the attributes of a `<t-var>`. Its `symbol` is what its chip shows, if there's no
`\tangle[symbol]{…}` to borrow one from.

Below the diagram, the **legend** has a chip for every number, which drags and edits just like
the number itself, and a chip with the current value of every formula that has one. **Reset**
puts the numbers back where they were when the page loaded. That includes a `<t-num>` in the
text that shares a variable with the diagram. `legend: false` and `reset: false` turn them off.

Numbers are ink in a diagram, unless their variable has a `color`: there, color means "comes
from that formula".

## Values {#values}

A formula with a `value` defines a variable of the same name, the way [`<t-let>`](t-let.md)
does. Every other formula's `value`, any element on the page, and any chart can read it. In
the first example, the `<t-out>`s below the diagram read `t` and `v`.

A value is an [expression](expressions.md), `"g * t"`, or a function, `() => g * t`. The function reads the variables by name, because the spec is evaluated
in the scope. Either way, it recomputes when a variable it read changes.

While the reader drags or edits a number, each formula that depends on it, directly or not,
shows its value in place of its symbol, and in every place it's used. Let go, and the symbols
come back.

## Notes {#notes}

`\note{name}{tex}` marks part of a formula. The note's text, from `notes`, sits next to it
with an arrow:

```js
notes: {
  drift: "only the wind pushes sideways",
  updown: { text: "up to the peak and back down", side: "bottom" },
}
```

The [projectile](gallery-projectile.md) in the gallery has both:

```js
t: String.raw`t = \note{updown}{\frac{2\,\use{vy}}{\tangle[g]{g}}}`,
Z: String.raw`Z = \note{drift}{\tfrac{1}{2}\,\use{az}\,\use{t}^2}`,
```

- Notes go above or below the part they mark, whichever has room and fewer arrows crossing.
  `side: "top"` or `"bottom"` decides it. A note on a formula's output goes to its left.
- The text can have `**bold**` and inline `$math$`. In a note with backslashes, write the text
  with `String.raw` too.
- A note that wraps a single number, `\note{why}{\tangle{k}}`, explains that number: it takes
  its color, and lights up while the number is dragged. Otherwise notes are gray, unless they
  have a `color`.
- Hovering over a note or its part fades the other notes.

## Picking a formula {#name}

With `name`, clicking a formula puts its name into that variable, and clicking it again sets
it to `null`. Setting the variable from elsewhere selects a formula too:

<t-scope class="example" data-show-source="open">
  <t-var name="L" value="1" min="0.1" max="10" step="0.1" label="length (m)"></t-var>
  <t-var name="g" value="9.8" min="1" max="25" step="0.1" label="gravity (m/s²)"></t-var>
  <t-formula-dag name="picked">
    <script type="text/plain">
    {
      formulas: {
        omega: { tex: String.raw`\omega = \sqrt{\tangle[g]{g} / \tangle[L]{L}}`, value: "Math.sqrt(g / L)", label: "angular frequency", format: "%.2f" },
        T: { tex: String.raw`T = \frac{2\pi}{\use{omega}}`, value: "2 * Math.PI / omega", label: "period", format: "%.2f" },
        f: { tex: String.raw`f = \frac{1}{\use{T}}`, value: "1 / T", label: "frequency", format: "%.3f" },
      },
    }
    </script>
  </t-formula-dag>
  <p>Picked: <t-out expr="picked ?? 'nothing yet'"></t-out>.</p>
</t-scope>

## From JavaScript {#javascript}

The element has the graph as data. `el.edges` lists `[producer, consumer]` pairs, and
`el.upstream(name)` and `el.downstream(name)` list the formulas a formula uses and is used by,
directly or not. `formulaDag(spec)`, exported by `tangle.js`, checks a spec and returns its
layout without drawing anything. See the [JavaScript API](javascript.md#formula-dag).

## Attributes and keys {#attributes}

| Attribute | Description |
|---|---|
| `name` | A variable for the formula the reader clicked: its name, or `null`. |

| Spec key | Description |
|---|---|
| `formulas` | The formulas, by name. Required. See [Writing the spec](#writing-the-spec). |
| `params` | Settings for the `\tangle{}` variables, by name. See [Numbers](#numbers). |
| `notes` | The text of each `\note{}`, as a string or `{ text, side, color }`. See [Notes](#notes). |
| `legend` | `false` hides the chips under the diagram. |
| `reset` | `false` hides the Reset button. |

## Writing TeX in a script

- The script ends at the first `</script>`, so don't write one inside it.
- Inside `` String.raw`…` ``, a backtick or `${` would end the string or start a
  placeholder. TeX rarely needs either.
- `&` and `<` can be written as they are, unlike in the text of a `<t-math>`.
- Only `value` is reactive. The spec itself is read once, when the element connects, so
  computing a formula's TeX from a variable won't update it.
- The colors come from the theme: see [Styling](styling.md#formula-dag).
