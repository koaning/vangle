# McNugget numbers

Chicken McNuggets used to come in boxes of 6, 9 and 20. You can buy 15 nuggets (6 + 9) or
26 (6 + 20), but not 16, however you combine the boxes. Which totals can you buy, and is
there a largest one you can't?

<t-scope class="example nuggets" data-show-source>
  <p>With boxes of <t-num name="a" min="1" max="50" color="#246bce #75a7ff">6</t-num>,
    <t-num name="b" min="1" max="50" color="#246bce #75a7ff">9</t-num> and
    <t-num name="c" min="0" max="50" color="#246bce #75a7ff">20</t-num> nuggets,
    <t-out expr="info.gcd > 1
      ? `every box holds a multiple of ${info.gcd}, so you can only buy multiples of ${info.gcd}. There's no largest total you can't buy.`
      : info.largest === 0
        ? 'you can buy any number of nuggets.'
        : `you can buy any number above ${info.largest}. Only ${info.missing} totals are impossible, and ${info.largest} is the largest of them.`"></t-out></p>
  <t-let name="info" expr="nuggets([a, b, c])"></t-let>
  <div class="grid" aria-hidden="true"></div>
  <p>Point at a total in the grid, or drag this one:
    <t-num name="pick" min="1" max="100">44</t-num> nuggets is
    <t-out expr="info.fewest[pick] === Infinity
      ? 'impossible'
      : `${recipe(info, pick)}, ${info.fewest[pick] === 1 ? 'one box' : `${info.fewest[pick]} boxes`}`"></t-out>.</p>
</t-scope>

<script type="module" data-show-source>
  import { registerFunction, scopeOf } from "../tangle.js";

  const LIMIT = 2600; // beyond the largest impossible total, for any boxes of up to 50

  // For every total up to LIMIT: the fewest boxes that make it exactly (Infinity if no
  // combination does), and the box added last. Each total is a smaller one plus one box.
  function nuggets(boxes) {
    boxes = [...new Set(boxes.filter((size) => size > 0))];
    const fewest = new Array(LIMIT + 1).fill(Infinity);
    const last = new Array(LIMIT + 1).fill(0);
    fewest[0] = 0;
    for (let total = 1; total <= LIMIT; total++) {
      for (const size of boxes) {
        if (size <= total && fewest[total - size] + 1 < fewest[total]) {
          fewest[total] = fewest[total - size] + 1;
          last[total] = size;
        }
      }
    }
    const gcd = boxes.reduce((g, size) => { while (size) [g, size] = [size, g % size]; return g; }, 0);
    let largest = 0, missing = 0;
    for (let total = 1; total <= LIMIT; total++) {
      if (fewest[total] === Infinity) [largest, missing] = [total, missing + 1];
    }
    return { fewest, last, gcd, largest, missing };
  }

  // Follows the boxes back from `total` to 0: "1 × 20 + 2 × 9 + 1 × 6".
  function recipe({ last }, total) {
    const counts = new Map();
    for (let t = total; t > 0; t -= last[t]) counts.set(last[t], (counts.get(last[t]) ?? 0) + 1);
    return [...counts].sort(([x], [y]) => y - x).map(([size, k]) => `${k} × ${size}`).join(" + ");
  }

  registerFunction("nuggets", nuggets);
  registerFunction("recipe", recipe);

  // Each example on the page gets a grid of the totals 1 to 100.
  for (const root of document.querySelectorAll(".nuggets")) {
    const scope = scopeOf(root);
    const cells = Array.from({ length: 100 }, (_, i) => {
      const cell = document.createElement("span");
      cell.textContent = i + 1;
      cell.addEventListener("pointerenter", () => scope.set("pick", i + 1));
      return cell;
    });
    root.querySelector(".grid").replaceChildren(...cells);

    // Recolors the grid whenever the boxes (and so info) or the picked total change.
    scope.effect((s) => {
      const info = s.get("info"), pick = s.get("pick");
      if (!info) return;
      cells.forEach((cell, i) => {
        const total = i + 1;
        cell.classList.toggle("can", info.fewest[total] < Infinity);
        cell.classList.toggle("largest", info.gcd === 1 && total === info.largest);
        cell.classList.toggle("picked", total === pick);
      });
    });
  }
</script>

<style data-show-source>
  .nuggets { --largest: light-dark(#b45b1b, #ffad66); }
  .nuggets .grid {
    display: grid; grid-template-columns: repeat(10, 1fr); gap: 3px; margin: 0.5rem 0 1rem;
    font: 0.8rem system-ui, sans-serif; font-variant-numeric: tabular-nums;
  }
  .nuggets .grid span {
    display: grid; place-items: center; aspect-ratio: 1.6; border-radius: 4px; cursor: default;
    background: color-mix(in srgb, currentColor 5%, transparent); color: color-mix(in srgb, currentColor 45%, transparent);
  }
  .nuggets .grid .can { background: color-mix(in srgb, var(--tangle-accent) 22%, transparent); color: inherit; }
  .nuggets .grid .largest { background: var(--largest); color: var(--tangle-surface); font-weight: 600; }
  .nuggets .grid .picked { outline: 2px solid currentColor; outline-offset: -1px; }
</style>

The blue totals can be bought, and the orange one is the largest that can't. Past it, every
total can be bought: once you can make six totals in a row, adding a box of 6 to each makes the
next six, and so on.

## Two boxes have a formula

With only two box sizes *p* and *q* that share no factor, the largest total you can't buy is
*pq* − *p* − *q*, and (*p* − 1)(*q* − 1)/2 totals can't be bought in all: half of the totals up
to the largest. For three or more box sizes there's no formula like it. You have to search, as the script above does.

<t-scope class="example nuggets" data-show-source>
  <t-var name="p" value="5" min="2" max="30" color="#246bce #75a7ff"></t-var>
  <t-var name="q" value="7" min="2" max="30" color="#b45b1b #ffad66"></t-var>
  <t-var name="pick" value="23" min="1" max="100"></t-var>
  <t-let name="info" expr="nuggets([p, q])"></t-let>
  <t-math display>
    \underbrace{\tangle{p}\cdot\tangle{q} - \tangle{p} - \tangle{q}}_{\text{largest impossible}} = \val{p * q - p - q}
    \qquad
    \underbrace{\frac{(\tangle{p} - 1)(\tangle{q} - 1)}{2}}_{\text{impossible totals}} = \val{(p - 1) * (q - 1) / 2}
  </t-math>
  <p><t-out expr="info.gcd > 1
    ? `But ${p} and ${q} share the factor ${info.gcd}, so the formula doesn't apply: only multiples of ${info.gcd} can be bought.`
    : info.largest > 100
      ? `The search agrees: ${info.largest} is the largest, past the end of this grid, and ${info.missing} totals are impossible.`
      : `The search agrees: ${info.largest} is the largest, and ${info.missing} totals are impossible.`"></t-out></p>
  <div class="grid" aria-hidden="true"></div>
</t-scope>

## Things to try

- **Order a Happy Meal.** Kids' meals came with 4 nuggets. Change the box of 20 to 4, and the
  largest total you can't buy drops from 43 to 11. (The 20 doesn't matter then: it's five 4s.)
- **Share a factor.** Make the boxes 6, 9 and 21. They're all multiples of 3, so the grid
  shows stripes, and every total that isn't a multiple of 3 is out.
- **Drop a box.** Set the third box to 0, so only 6 and 9 are left. They share the factor 3,
  so there's no largest. Then change 9 to 7.
- **Go big.** Make the two boxes in the formula 29 and 30. The largest impossible total is 811,
  far beyond the grid.

## How it's built

- **The search is a function.** The script [registers](expressions.md#functions) `nuggets`,
  which works out, for every total up to 2,600, the fewest boxes that make it. A
  [`<t-let>`](t-let.md) calls it with the box sizes, so `info` is recomputed whenever one
  changes. The prose reads `info.largest`, `info.missing` and `info.gcd` from it.
- **The grid is drawn by an effect.** The script makes the 100 cells once, then a
  `scope.effect` reads `info` and `pick` and toggles a class on each cell. Pointing at a cell
  calls `scope.set("pick", …)`, which updates the recipe in the text.
- **Two scopes, one script.** Each example is a [`<t-scope>`](t-scope.md) with its own `info`
  and `pick`, and the script sets up a grid in each. The second one names its boxes `p` and `q`
  and passes `[p, q]` to the same function.

Inspired by the McNugget graph demo in [wigglystuff](https://github.com/koaning/wigglystuff),
which steps through the same search as a graph.
