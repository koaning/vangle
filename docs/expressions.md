# Expressions & formats

Expressions compute values; formats decide how those values look.

## Expressions

Expressions appear in `<t-out expr="…">`, `<t-let expr="…">` and
`\val{…}` inside formulas. They're ordinary JavaScript expressions. A name in an expression
is one of three things:

1. **A function you registered** with [`registerFunction`](#functions).
2. **A standard JavaScript global** from a short list: `Math`, `Number`,
  `String`, `Boolean`, `Array`, `Object`, `JSON`,
  `Date`, `Intl`, `parseInt`, `parseFloat`, `isNaN`,
  `isFinite`, `Infinity`, `NaN` and `undefined`.
3. **A variable**: every other name, whether or not it has been declared yet.

There are no other names, so `Math` is spelled out (`Math.sqrt(x)`, `Math.PI`),
and nothing else from `window` leaks in: a variable called `top`, `name` or
`length` is simply a variable. If a variable and a registered function share a name, the variable
wins once it has a value.

<t-scope class="example" data-show-source="open">
  <p>A circle with radius <t-num name="r" min="0" max="10" step="0.1">1.5</t-num> has an area of
    <t-out expr="Math.PI * r ** 2" format="%.2f"></t-out> and a circumference of
    <t-out expr="2 * Math.PI * r" format="%.2f"></t-out>. Rounded up, that's a
    <t-out expr="Math.ceil(2 * r)"></t-out>-unit-wide box.</p>
</t-scope>

### Your own functions {#functions}

For anything longer than a one-liner, write a JavaScript function and register it. Every expression
on the page can then call it by name:

<t-scope class="example" data-show-source="open">
  <p>At <t-num name="kg" min="40" max="150">70</t-num> kg and
    <t-num name="cm" min="140" max="210">175</t-num> cm, your BMI is
    <t-out expr="bmi(kg, cm / 100)" format="%.1f"></t-out>, which counts as
    <t-out expr="bmiClass(bmi(kg, cm / 100))"></t-out>.</p>
</t-scope>

<script type="module" data-show-source="open">
  import { registerFunction } from "../tangle.js";

  registerFunction("bmi", (kg, m) => kg / m ** 2);
  registerFunction("bmiClass", (bmi) =>
    bmi < 18.5 ? "underweight" : bmi < 25 ? "a healthy weight" : bmi < 30 ? "overweight" : "obese",
  );
</script>

Registration can happen at any time, even after the page has rendered: outputs that call a function
re-run as soon as it's registered. For short names, register what you need:
`registerFunction("sqrt", Math.sqrt)`.

To give a single [scope](t-scope.md) its own function, store it as a variable instead:
`scopeOf(el).set("f", (x) => x * 2)`.

### Conditional text

There's no special element for conditions. Use a ternary, which can return text:

<t-scope class="example" data-show-source="open">
  <p>The thermostat is set to <t-num name="temp" min="10" max="30" step="0.5" format="%.1f °C">21</t-num>,
    so the heating is <t-out expr="temp > 19 ? 'on' : 'off'"></t-out>
    <t-out expr="temp > 26 ? '(and your energy bill is not amused)' : ''"></t-out>.</p>
</t-scope>

### Writing expressions inside HTML

- Use single quotes for strings inside a double-quoted attribute: `expr="x > 0 ? 'yes' : 'no'"`.
- `<`, `>` and `&&` work as-is inside attribute values.
- Inside element *text* (such as a `\val{}` in a `<t-math>`), write
  `<` as `&lt;` and `&` as `&amp;`.

### Errors and missing values

- A variable that is never declared is `undefined`. Arithmetic on it gives
  `NaN`, which is shown as `–`.
- An expression that throws shows `⚠`. Hover over it to see the error message.

<div class="callout">

Expressions are compiled with `new Function`. If your site sends a
Content-Security-Policy header, it needs to allow `'unsafe-eval'`.

</div>

## Formats {#formats}

The `format` attribute (on `<t-num>`, `<t-var>` and
`<t-out>`) and the optional argument of `\val[…]{…}` control how a
value is displayed. A format is either printf-style or the name of a registered format.

### printf-style

| Format | Value | Shows |
|---|---|---|
| `%d` | 4.6 | 5 (rounded to an integer) |
| `%.2f` | 3.14159 | 3.14 |
| `%f` | 2 | 2.000000 (six decimals, as in C) |
| `%,d` | 1234567 | 1,234,567 |
| `%+.1f` | 2 | +2.0 (always show the sign) |
| `$%,.2f` | 1647.009 | $1,647.01 |
| `%d km` | 42 | 42 km |
| `%s` | "monthly" | monthly |
| `%%` | | a literal % |

Text around the placeholder is kept, so prefixes and suffixes need no extra attributes.

### Named formats

| Name | Value | Shows |
|---|---|---|
| `percent` | 0.256 | 26% (multiplies by 100) |
| `dollars` | 1499.5 | $1,500 |
| `int` | 2.5 | 3 |

Register your own from JavaScript. The function receives the value and returns a string:

```js
import { registerFormat } from "/tangle.js";

registerFormat("hz", (v) => (v < 1000 ? `${v.toFixed(0)} Hz` : `${(v / 1000).toFixed(2)} kHz`));
```

### Without a format

- A variable with a `step` is shown with as many decimals as the step: `step="0.1"` gives
  `2.0`, `2.1`, ….
- Other numbers are shown as integers when they are integers, rounded when they are 1000 or more, and
  with four significant digits otherwise.
- Text values are shown as-is.

<t-scope class="example" data-show-source="open">
  <p><t-num name="v" min="0" max="5" step="0.001">0.25</t-num> is
    <t-out expr="v" format="percent"></t-out>, or <t-out expr="v * 1000" format="%,d"></t-out> per mille, or
    <t-out expr="v" format="%+.3f"></t-out>, or <t-out expr="v * 9999" format="dollars"></t-out>
    out of $9,999.</p>
</t-scope>
