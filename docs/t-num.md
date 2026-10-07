# `<t-num>`

A number the reader can drag, type or step with the keyboard. This is the classic Tangle control.

<t-scope class="example" data-show-source="open">
  <p>A <t-num name="w" min="1" max="20">4</t-num> by <t-num name="h" min="1" max="20">3</t-num>
    metre room has <t-out expr="w * h"></t-out> m² of floor.</p>
</t-scope>

The element's text is the starting value, and also what readers see without JavaScript.
You can use the `value` attribute instead, which is handy when a format adds symbols,
as in `<t-num name="price" value="1000" format="$%,d"></t-num>`.

## Attributes

| Attribute | Default | Description |
|---|---|---|
| `name` | *required* | The variable this number shows and changes. |
| `value` | text content | The starting value. Without a value or text, the element is just another view of a variable declared elsewhere ([see below](#views)). |
| `min`, `max` | unbounded | The range the reader can drag or type within. |
| `step` | `1` | The increment for dragging and the arrow keys. It also sets the default number of decimals shown. |
| `format` | from `step` | How the number is displayed. See [formats](expressions.md#formats). |
| `color` | accent color | A CSS color, or two (`"#246bce #75a7ff"`) for light and dark mode. Every place the variable appears uses it, formulas included. |
| `label` | the name | The accessible name screen readers announce. |
| `pixels-per-step` | `5` | How far the pointer must travel to change the value by one step. Raise it for finer control. |

Try them out: change the attributes in the code, then drag the number below it. This uses
[`<t-tag>`](t-tag.md).

<t-scope class="example">
  <t-tag tag='t-num name="w"'>
    <t-num name="min" max="10">0</t-num>
    <t-num name="max" min="1" max="100">20</t-num>
    <t-choice name="step" options="1, 0.5, 0.1, 5">1</t-choice>
    <t-choice name="format" options="%s, %.1f m, $%d">%s</t-choice>
    <t-num name="pps" attr="pixels-per-step" min="1" max="30">5</t-num>
    4
  </t-tag>
</t-scope>

## Interaction

| Input | Effect |
|---|---|
| Drag left or right | Changes the value by one step every `pixels-per-step` pixels. Works with touch too. |
| Click without dragging | Opens a small field to type a value. The value is snapped to the step and clamped to the range. |
| <kbd>→</kbd> <kbd>↑</kbd> / <kbd>←</kbd> <kbd>↓</kbd> | One step up or down. Hold <kbd>Shift</kbd> for ten steps. |
| <kbd>Home</kbd> / <kbd>End</kbd> | Jumps to `min` or `max`, if set. |
| <kbd>Enter</kbd> or <kbd>Space</kbd> | Opens the field to type a value. |

In the typing field, <kbd>Enter</kbd> confirms and <kbd>Esc</kbd> cancels; clicking away also
confirms. The field accepts expressions, so readers can type `w + 1` or `2 * Math.PI`.

Hovering a number highlights every place its variable appears on the page, in text and in formulas.

## Several views of one variable {#views}

Only the first element that declares a variable sets its starting value. Any other `<t-num>`
with the same name, and with no value of its own, is another handle on the same variable:

<t-scope class="example" data-show-source="open">
  <p>Set the budget to <t-num name="budget" value="500" min="0" max="2000" step="10" format="$%,d"></t-num>.</p>
  <p>… three paragraphs later …</p>
  <p>With your <t-num name="budget"></t-num> budget, you can buy <t-out expr="Math.floor(budget / 35)"></t-out> books.</p>
</t-scope>

## Drag sensitivity

A drag changes the value by one `step` every `pixels-per-step` pixels. If a
range has many steps, lower `pixels-per-step` so a comfortable drag still covers it.
Raise it when you want precise, slow adjustments.

<t-scope class="example" data-show-source="open">
  <p>A learning rate of <t-num name="lr" min="0.001" max="1" step="0.001" pixels-per-step="2" format="%.3f">0.01</t-num>
    over <t-num name="steps" min="1" max="1000" step="10">100</t-num> steps moves the weights by
    <t-out expr="lr * steps" format="%.2f"></t-out>.</p>
</t-scope>

## Notes

- If several elements declare `min`, `max`, `step` or `color`
  for the same variable, the most recently connected one wins. Declare constraints once.
- A `<t-num>`'s `format` also becomes the variable's default format, for
  formulas and other views, unless the variable already has one.
- For assistive technology the element is a `slider`, with `aria-valuenow`,
  `aria-valuemin`, `aria-valuemax` and `aria-valuetext` kept up to date.
