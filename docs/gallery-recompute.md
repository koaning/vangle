# What recomputes

A change doesn't redraw the whole page. Each variable remembers which variables it read, and
only the ones that read a changed variable run again. Here, `count` adds one to a counter every
time a variable runs.

<t-scope id="recompute" class="example" data-show-source="open">
  <t-let name="sum" expr="count('sum', a + b)"></t-let>
  <t-let name="product" expr="count('product', sum * c)"></t-let>
  <p><t-num name="a" min="0" max="10">1</t-num> + <t-num name="b" min="0" max="10">2</t-num>
    = <t-out expr="sum"></t-out>, ran <t-out expr="sumRuns" format="%d×"></t-out>.</p>
  <p><t-out expr="sum"></t-out> × <t-num name="c" min="0" max="10">3</t-num>
    = <t-out expr="product"></t-out>, ran <t-out expr="productRuns" format="%d×"></t-out>.</p>
</t-scope>

<script type="module" data-show-source="open">
  import { registerFunction, scopeOf } from "../tangle.js";

  // count("sum", value) returns value, and adds one to the variable sumRuns.
  const scope = scopeOf(document.querySelector("#recompute"));
  registerFunction("count", (name, value) => {
    scope.set(`${name}Runs`, (scope.peek(`${name}Runs`) ?? 0) + 1);
    return value;
  });
</script>

## Things to try

- **Change `c`.** Only `product` runs. `sum` doesn't read `c`, so its count stays put.
- **Change `a` or `b`.** Both run: `sum` reads them, and `product` reads `sum`.
- **Count the reads.** `sum` is shown twice and read by `product`, yet it runs once per change.
  The first read computes it, and the others get the cached value.

## How it's built

- **Two [`<t-let>`](t-let.md)s** wrap their expressions in `count`. Without it, they'd be
  `a + b` and `sum * c`.
- **`count` is a [registered function](expressions.md#functions)** that sets a variable as a
  side effect, so the counters are ordinary variables that `<t-out>` can show.
