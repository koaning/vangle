# `<t-call>`

A function call whose arguments the reader can change: `savings(deposit=200, rate=0.05, …)`.
The numbers drag, the choices cycle and the text is editable. Give it a `name`, and
the call's return value becomes a variable you can show anywhere.

<t-scope class="example" data-show-source="open">
  <t-call display fn="savings" name="total">
    <t-num name="deposit" min="0" max="2000" step="50">200</t-num>
    <t-num name="rate" min="0" max="0.15" step="0.005">0.05</t-num>
    <t-num name="years" min="1" max="40">10</t-num>
    <t-choice name="every" options="month, year">month</t-choice>
  </t-call>
  <p>Putting away <t-num name="deposit"></t-num> a month at
    <t-out expr="rate" format="percent"></t-out> for <t-out expr="years"></t-out> years
    returns <t-out expr="total" format="$%,d"></t-out>.</p>
</t-scope>

<script type="module" data-show-source="open">
  import { registerFunction } from "../tangle.js";

  registerFunction("savings", (deposit, rate, years, every) => {
    const n = every === "month" ? 12 : 1;
    const r = rate / n;
    const payment = (deposit * 12) / n;
    return r === 0 ? payment * years * n : payment * (((1 + r) ** (years * n) - 1) / r);
  });
</script>

The arguments are ordinary [`<t-num>`](t-num.md), [`<t-choice>`](t-choice.md) and
[`<t-text>`](t-text.md) elements, so they work exactly as they do in prose. They are also
ordinary variables: the `deposit` in the sentence is the same one as in the call, and hovering
either highlights both. `<t-call>` adds the function name, a `name=` before each argument and
the punctuation in between. String values get quotes. To show an HTML element instead
of a function call, use [`<t-tag>`](t-tag.md).

## Attributes

| Attribute | Default | Description |
|---|---|---|
| `fn` | | The function to call, by its [registered](expressions.md#functions) name. Any expression that gives a function works, such as `Math.hypot`. It's also the name shown before the parentheses. |
| `name` | | The variable that holds the call's return value, like [`<t-let>`](t-let.md). Without it, the call only displays its arguments. |
| `display` | | Shows the call as a block with a border, instead of inline code. |

The arguments are the children that have a `name`, in order. The function receives their
values positionally: `savings(deposit, rate, years, every)`.

## Inline

Without `display`, the call sits in the text like inline code:

<t-scope class="example" data-show-source="open">
  <p>The hypotenuse is
    <t-call fn="Math.hypot" name="c"><t-num name="a" min="0" max="20">3</t-num><t-num name="b" min="0" max="20">4</t-num></t-call>
    = <t-out expr="c" format="%.2f"></t-out>.</p>
</t-scope>

## From a JavaScript function {#tanglecall}

`tangleCall(fn, options)` builds a `<t-call>` from a function's parameters, the way a
signature reads. Each default sets the starting value and the kind of argument:

| Default | Argument |
|---|---|
| A number | A draggable [`<t-num>`](t-num.md). The step is `1` for whole numbers, and otherwise matches the default's decimals: `0.05` steps by `0.01`. |
| `true` or `false` | A [`<t-choice>`](t-choice.md) toggle between `true` and `false`. |
| A string | An editable [`<t-text>`](t-text.md), or a choice if you give `options`. |

Add the returned element to the page. It joins the scope it lands in:

<t-scope class="example" id="pizza" data-show-source="open">
  <p>Your order: <t-out expr="order"></t-out>.</p>
</t-scope>

<script type="module" data-show-source="open">
  import { tangleCall } from "../tangle.js";

  function pizza(title = "Margherita", diameter = 30, slices = 8, crust = "thin", cheese = false) {
    const area = (Math.PI * (diameter / 2) ** 2) / slices;
    const kcal = area * (crust === "thick" ? 2.9 : 2.2) * (cheese ? 1.3 : 1);
    return `${title}, ${slices} slices of ${Math.round(area)} cm² and ${Math.round(kcal)} kcal each`;
  }

  document.querySelector("#pizza").prepend(
    tangleCall(pizza, {
      name: "order",
      params: {
        diameter: { min: 20, max: 45 },
        slices: { min: 2, max: 16, step: 2 },
        crust: { options: ["thin", "thick"] },
      },
    }),
  );
</script>

The options are:

| Option | Description |
|---|---|
| `name` | The variable that holds the return value, like the `name` attribute. |
| `params` | Settings per parameter: `min`, `max`, `step`, `format`, `color`, `label` and `pixelsPerStep` work as the attributes of the same name. `options` (a list of values, or `{ label, value }` objects) turns the argument into a choice, and `value` replaces the default. |

The returned element has no `display` attribute. Set it before adding the element to get the block style:
`el.setAttribute("display", "")`.

`tangleCall` reads the parameters from the function's source, so a few things don't work:

- Every parameter needs a default, or a `value` in `params`.
- A default must give a number, string or boolean on its own. `Math.PI / 4` is fine;
  a default that uses an earlier parameter isn't.
- Rest parameters (`...args`) and destructuring (`{ a, b }`) aren't supported.
- A minifier that rewrites defaults changes what `tangleCall` sees. Write the function
  in the page, or keep it out of the minified bundle.

`parseParams(fn)` is the part that reads the source. It returns
`[{ name, value, hasDefault }]`, in case you want to build something else from a signature.

## Layout

The call stays on one line while it fits. When it's too wide for its container, it wraps the
way Python's Black formatter does, with one argument per line and a trailing comma:

```text
savings(
    deposit=200,
    rate=0.05,
    years=10,
    every='month',
)
```

It switches back as soon as it fits again.
