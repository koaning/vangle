# `<t-out>`

Shows the live result of an expression in the text.

<t-scope class="example" data-show-source="open">
  <p>Splitting a <t-num name="bill" value="84" min="0" max="500" format="$%d"></t-num> bill
    <t-num name="people" min="1" max="12">3</t-num> ways with a
    <t-num name="tip" min="0" max="30">15</t-num>% tip comes to
    <t-out expr="bill * (1 + tip / 100) / people" format="$%.2f">$32.20</t-out> each.</p>
</t-scope>

## Attributes

| Attribute | Default | Description |
|---|---|---|
| `expr` | | The [expression](expressions.md) to show. |
| `name` | | Shorthand for showing a single variable: `<t-out name="total">` is `<t-out expr="total">`. |
| `format` | automatic | How to display the result. See [formats](expressions.md#formats). |

The element's text is replaced as soon as the script runs, so it makes a good fallback for readers
without JavaScript (the `$32.20` above).

## Text results

Expressions can return strings, which makes `<t-out>` the tool for words that change
with the numbers:

<t-scope class="example" data-show-source="open">
  <p>You have <t-num name="n" min="0" max="5">1</t-num>
    <t-out expr="n === 1 ? 'apple' : 'apples'"></t-out><t-out expr="n === 0 ? '. Time to go shopping.' : '.'"></t-out></p>
</t-scope>

## Errors

If the expression throws, the element shows `⚠` in the error color, and its tooltip holds the
message. Hover over this one:

<t-scope class="example" data-show-source="open">
  <p>This output is broken: <t-out expr="banana.length"></t-out></p>
</t-scope>
