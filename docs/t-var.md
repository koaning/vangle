# `<t-var>`

Declares a variable without showing anything. Use it for values that only appear
in formulas, or to keep a variable's settings out of the prose.

<t-scope class="example" data-show-source="open">
  <t-var name="m" value="2" min="0.1" max="10" step="0.1" color="#246bce #75a7ff"></t-var>
  <t-var name="v" value="3" min="0" max="20" step="0.5" color="#b45b1b #ffad66"></t-var>
  <t-math display>E_k = \tfrac{1}{2}\,\tangle[m]{m}\,\tangle[v]{v}^2 = \val[%.1f]{0.5 * m * v ** 2}\ \text{J}</t-math>
  <p>A <t-num name="m"></t-num> kg ball at <t-num name="v"></t-num> m/s carries
    <t-out expr="0.5 * m * v ** 2" format="%.1f"></t-out> joules.</p>
</t-scope>

The formula's `m` and `v` are draggable. They show their symbols until you
drag them. The sentence holds two plain `<t-num>` views of the same variables, and
hovering one highlights its twin in the formula.

## Attributes

| Attribute | Default | Description |
|---|---|---|
| `name` | *required* | The variable to declare. |
| `value` | `undefined` | The starting value. Ignored if the variable was already given a value. |
| `min`, `max` | unbounded | The range for every control bound to this variable. |
| `step` | `1` | The drag and keyboard increment, and the default display precision. |
| `format` | from `step` | The default [format](expressions.md#formats) wherever the variable is shown, including `\tangle{}` in formulas. |
| `color` | accent color | One CSS color, or two separated by a space for light and dark mode. |
| `label` | the name | The accessible name. |
| `pixels-per-step` | `5` | Drag sensitivity. |

These are the same settings as [`<t-num>`](t-num.md); a `<t-var>`
simply doesn't render.

## When to use it

- **Formula parameters.** A `\tangle{a}` in a formula needs its range and step
  from somewhere. Declare them with a `<t-var>` next to the formula.
- **Constants.** A value the reader shouldn't change, but that you want to name, such as
  `<t-var name="g" value="9.81">`. Expressions can then use `g`.
- **Cleaner prose.** Put all of a post's declarations in one place, and use bare
  `<t-num name="…">` views in the text.
