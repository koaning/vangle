# `<t-choice>`

A word the reader clicks to cycle through a list of options. With two options, it's a toggle.

<t-scope class="example" data-show-source="open">
  <p>Saving <t-num name="amount" value="200" min="0" max="2000" step="10" format="$%d"></t-num>
    <t-choice name="per" options="per week:52, per month:12, per year:1">per month</t-choice>
    adds up to <t-out expr="amount * per" format="$%,d"></t-out> a year.</p>
</t-scope>

## Attributes

| Attribute | Default | Description |
|---|---|---|
| `name` | *required* | The variable that holds the selected option's value. |
| `options` | *required* | A comma-separated list. Each option is `label` or `label:value`. |
| `value` | text content | The starting option, matched against values first and then labels. Defaults to the first option. |
| `color` | accent color | One CSS color, or two for light and dark mode. |
| `label` | the name | The accessible name. |

## Labels and values

The label is what the reader sees. The value is what expressions get. Values that look like numbers
become numbers, so `per week:52` gives the variable the number `52`, and `true` and `false` become
booleans. Without a
`:value`, the label is the value, and expressions compare against the text:

<t-scope class="example" data-show-source="open">
  <p>The trail is <t-num name="dist" min="1" max="50">10</t-num>
    <t-choice name="unit" options="km, miles">km</t-choice> long, which is
    <t-out expr="unit === 'km' ? dist * 0.621 : dist * 1.609" format="%.1f"></t-out>
    <t-out expr="unit === 'km' ? 'miles' : 'km'"></t-out>.</p>
</t-scope>

## Toggles

A two-option choice with `0` and `1` as values works as a switch. Options named `true` and `false`
become real booleans, so `options="true, false"` works too:

<t-scope class="example" data-show-source="open">
  <p>Shipping is <t-out expr="express ? 25 : 5" format="$%d"></t-out> with
    <t-choice name="express" options="standard:0, express:1">standard</t-choice> delivery,
    arriving in <t-out expr="express ? '1 day' : '5 days'"></t-out>.</p>
</t-scope>

## Interaction

| Input | Effect |
|---|---|
| Click | The next option, wrapping around at the end. |
| <kbd>Shift</kbd> + click | The previous option. |
| <kbd>Enter</kbd>, <kbd>Space</kbd> or <kbd>→</kbd> | The next option. |
| <kbd>←</kbd> | The previous option. |

Labels can't contain commas or colons, since those separate the options.
