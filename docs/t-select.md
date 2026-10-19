# `<t-select>`

A word the reader clicks to pick from a menu of options, and types to search it. For lists too long
to cycle through with a [`<t-choice>`](t-choice.md).

<t-scope class="example" data-show-source="open">
  <p>Without air, a ball dropped from <t-num name="h" min="1" max="1000">10</t-num> m on
    <t-select name="g" options="Mercury:3.70, Venus:8.87, Earth:9.81, the Moon:1.62, Mars:3.72,
      Ceres:0.28, Jupiter:24.79, Io:1.80, Europa:1.31, Ganymede:1.43, Callisto:1.24, Saturn:10.44,
      Enceladus:0.11, Titan:1.35, Uranus:8.69, Neptune:11.15, Triton:0.78, Pluto:0.62">Mars</t-select>
    falls for <t-out expr="Math.sqrt(2 * h / g)" format="%.1f"></t-out> s and lands at
    <t-out expr="Math.sqrt(2 * g * h)" format="%.1f"></t-out> m/s.</p>
</t-scope>

## Attributes

| Attribute | Default | Description |
|---|---|---|
| `name` | *required* | The variable that holds the selected option's value. |
| `options` | *required* | A comma-separated list. Each option is `label` or `label:value`. |
| `value` | text content | The starting option, matched against values first and then labels. Defaults to the first option. |
| `color` | accent color | One CSS color, or two for light and dark mode. |
| `label` | the name | The accessible name. |

The options work as in [`<t-choice>`](t-choice.md#labels-and-values): the reader sees the label,
expressions get the value, and values that look like numbers become numbers.

## Interaction

| Input | Effect |
|---|---|
| Click, <kbd>Enter</kbd>, <kbd>Space</kbd> or <kbd>↓</kbd> | Opens the menu. |
| Typing a letter | Opens the menu and starts a search with it. |
| <kbd>←</kbd> or <kbd>→</kbd> | The previous or next option, without opening the menu. |

In the menu, typing narrows the list: labels that start with what you typed come first, then labels
with a word that starts with it, then the rest that contain it. <kbd>↑</kbd> and <kbd>↓</kbd> move
through the list, <kbd>Enter</kbd> or a click picks, and <kbd>Esc</kbd> or clicking away closes the
menu without a change.

## Options from JavaScript

For a long or generated list, set the element's `options` property to `{ label, value }` objects
before adding it to the page. The values can be anything, not just numbers and text:

<t-scope class="example" data-show-source="open">
  <p>A cube of <span id="metal">iron</span> with sides of
    <t-num name="side" min="1" max="50">10</t-num> cm weighs
    <t-out expr="metal.density * side ** 3 / 1000" format="%,.2f"></t-out> kg, and
    <t-out expr="metal.density < 1 ? 'floats' : 'sinks'"></t-out> in water.</p>
</t-scope>

<script type="module" data-show-source="open">
  const densities = {
    lithium: 0.534, potassium: 0.862, sodium: 0.971, calcium: 1.55, magnesium: 1.74,
    silicon: 2.33, aluminium: 2.70, titanium: 4.51, zinc: 7.14, chromium: 7.19, tin: 7.29,
    iron: 7.87, cobalt: 8.90, nickel: 8.91, copper: 8.96, bismuth: 9.78, silver: 10.49,
    lead: 11.34, uranium: 19.1, tungsten: 19.25, gold: 19.30, platinum: 21.45,
    iridium: 22.56, osmium: 22.59,
  };
  const select = document.createElement("t-select");
  select.setAttribute("name", "metal");
  select.setAttribute("value", "iron");
  select.options = Object.entries(densities).map(([label, density]) => ({ label, value: { density } }));
  document.querySelector("#metal").replaceWith(select);
</script>

[`tangleCall`](t-call.md#tanglecall) makes a `<t-select>` for a parameter with `options` and
`select: true`.

Labels written in the `options` attribute can't contain commas or colons, since those separate the options.
