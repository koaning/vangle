# `<t-let>`

A named value computed from other variables. It isn't rendered, but expressions,
outputs and formulas can use it like any other variable.

<t-scope class="example" data-show-source="open">
  <p>At <t-num name="kmh" min="5" max="200" step="5">50</t-num> km/h, a reaction time of
    <t-num name="react" min="0.5" max="3" step="0.1">1.5</t-num> s means you travel
    <t-out expr="reaction" format="%.1f"></t-out> m before braking, then
    <t-out expr="braking" format="%.1f"></t-out> m while braking:
    <t-out expr="reaction + braking" format="%d"></t-out> m in total.</p>
  <t-let name="ms" expr="kmh / 3.6"></t-let>
  <t-let name="reaction" expr="ms * react"></t-let>
  <t-let name="braking" expr="ms ** 2 / (2 * 7)"></t-let>
</t-scope>

Computed values can build on each other: `reaction` and `braking` both use
`ms`. Each is recomputed only when something it reads changes, and at most once per update.

## Attributes

| Attribute | Default | Description |
|---|---|---|
| `name` | *required* | The name of the computed variable. |
| `expr` | *required* | A JavaScript [expression](expressions.md) over other variables. |

## Why name things?

- **Reuse.** Write a formula once and refer to it from several outputs, as with
  `reaction + braking` above.
- **Formulas.** `\val{total}` reads better than repeating a long expression
  inside TeX.
- **JavaScript.** A chart can read `scope.get("braking")` and stay in sync
  with the text.

## Notes

- A computed value can't be dragged. To show it in a formula, use `\val{name}`, not
  `\tangle{name}`.
- Calling `scope.set("name", value)` from JavaScript replaces the computed value with a plain one.
- A variable that (indirectly) depends on itself shows up as an error in the outputs that use it.
