# How it works inside

It's not too complex.

Suppose you write this HTML:

```html
<p>When you eat <t-num name="cookies" min="0" max="30">3</t-num> cookies,
  you consume <t-out expr="calories">150</t-out> calories.</p>
<t-let name="calories" expr="cookies * 50"></t-let>
<t-debug></t-debug>
```

And you get this. Drag the number:

<t-scope class="example">
  <p>When you eat <t-num name="cookies" min="0" max="30">3</t-num> cookies,
    you consume <t-out expr="calories">150</t-out> calories.</p>
  <t-let name="calories" expr="cookies * 50"></t-let>
  <t-debug></t-debug>
</t-scope>

`name="cookies"` puts the number in a page variable called `cookies`, which any expression can
read. The last line, [`<t-debug>`](t-debug.md), draws the graph vangle builds from the rest:
`cookies` feeds `calories`. When you drag, its boxes pulse as the change goes through.

## The overview

Your HTML talks to three layers of JavaScript in `tangle.js`:

<t-flow class="boxes">
  <div id="html"><strong>Your HTML</strong><br><code>&lt;t-num&gt;</code>, <code>&lt;t-let&gt;</code>, <code>&lt;t-out&gt;</code></div>
  <div id="elements"><strong>Elements</strong><br>a web component for each tag<small>each one reads its attributes when it's added to the page</small></div>
  <div id="scope"><strong>Scope</strong><br><code>cookies = 3</code><br><code>calories = cookies * 50</code><small>one for the page, or one per &lt;t-scope&gt;</small></div>
  <div id="signals"><strong>Signals</strong><br>who read what, and who to tell<small>a change re-runs whatever read the variable</small></div>
  <script type="text/plain">
  {
    infer: false,
    edges: [
      ["html", "elements", "tangle.js turns them into web components"],
      ["elements", "scope", "declare, define and read variables"],
      ["scope", "signals", "each variable is a signal"],
    ],
  }
  </script>
</t-flow>

<style>
  .boxes .tangle-flow-body > div {
    width: 21rem;
    padding: 0.6rem 1rem;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
    text-align: center;
    line-height: 1.5;
  }
  .boxes .tangle-flow-body code { font-size: 0.85em; }
  .boxes .tangle-flow-label {
    font-family: inherit;
    font-style: italic;
    font-size: 0.85rem;
    line-height: 1.3;
    color: var(--muted);
  }
  .boxes .tangle-flow-body small {
    display: block;
    margin-top: 0.3rem;
    color: var(--muted);
    font-size: 0.8em;
    line-height: 1.35;
  }
</style>

## Reading it from JavaScript

Every variable lives in its scope, so your own scripts can read it, set it and follow it. This
script shows the two values below the paragraph, and its button sets `cookies`:

```js
import { scopeOf } from "../tangle.js";

const root = document.querySelector("#from-js");
const scope = scopeOf(root); // the variables of the <t-scope id="from-js">
const log = root.querySelector(".js-log");

// Runs now, and again whenever cookies or calories changes.
scope.effect((s) => {
  log.textContent = `cookies = ${s.get("cookies")}, calories = ${s.get("calories")}`;
});

// Sets cookies exactly like a drag does: the paragraph and the log update.
root.querySelector("button").addEventListener("click", () => scope.set("cookies", 10));
```

Drag the number, or press the button:

<div class="example">
  <t-scope id="from-js">
    <p>When you eat <t-num name="cookies" min="0" max="30">3</t-num> cookies,
      you consume <t-out expr="calories">150</t-out> calories.</p>
    <t-let name="calories" expr="cookies * 50"></t-let>
    <p><code class="js-log"></code></p>
    <button type="button">scope.set("cookies", 10)</button>
  </t-scope>
</div>

<script type="module">
  import { scopeOf } from "../tangle.js";
  const root = document.querySelector("#from-js");
  const scope = scopeOf(root);
  const log = root.querySelector(".js-log");
  scope.effect((s) => {
    log.textContent = `cookies = ${s.get("cookies")}, calories = ${s.get("calories")}`;
  });
  root.querySelector("button").addEventListener("click", () => scope.set("cookies", 10));
</script>

`scope.effect` is the same machinery the elements use: it records what it read, and runs again
when any of it changes. See the [JavaScript API](javascript.md) for the rest.

## When you drag

Here are the steps, in order. The boxes have their own live `cookies` and `calories`: drag the
number in the first box and watch the last one follow.

<t-scope>
<t-flow class="boxes">
  <div id="drag"><strong>1. You drag</strong><br>cookies = <t-num name="cookies" min="0" max="30">3</t-num><small>the number sets one variable</small></div>
  <div id="mark"><strong>2. Marked out of date</strong><br><code>calories</code>, then the <code>&lt;t-out&gt;</code><small>nothing is recomputed yet</small></div>
  <div id="redraw"><strong>3. Redrawn, once</strong><br><t-out expr="calories">150</t-out> calories<small>the &lt;t-out&gt; reads calories, which recomputes</small></div>
  <t-let name="calories" expr="cookies * 50"></t-let>
  <script type="text/plain">
  {
    infer: false,
    edges: [
      ["drag", "mark", "everything that read cookies is told"],
      ["mark", "redraw", "in a microtask, before the next mouse move"],
    ],
  }
  </script>
</t-flow>
</t-scope>

There's no throttle. This happens for every mouse move that changes the value, while you're
still dragging: the redraws run in a microtask, as soon as the code handling that move is done.
Even if one move changes several variables, each element redraws only once, with the final values.

You never write an `update()` function. Reading a variable is enough to subscribe to it.

## A bigger example

The same few pieces scale up. Here, one sentence sets five variables, and eight formulas build on
them and on each other. The formula, the last sentence and the graph all read them:

```html
<p>Eat <t-num name="cookies" min="0" max="30">3</t-num>
  <t-choice name="perCookie"
    options="chocolate chip:50, oatmeal:65, double fudge:90">chocolate chip</t-choice>
  cookies with <t-num name="milk" min="0" max="4">2</t-num> glasses of milk,
  on a budget of <t-num name="budget" min="1200" max="3500" step="100">2000</t-num>
  calories a day.
  You weigh <t-num name="weight" min="40" max="150">70</t-num> kg.</p>
<t-let name="snack" expr="cookies * perCookie"></t-let>
<t-let name="drinks" expr="milk * 120"></t-let>
<t-let name="calories" expr="snack + drinks"></t-let>
<t-let name="share" expr="calories / budget"></t-let>
<t-let name="left" expr="budget - calories"></t-let>
<t-let name="burn" expr="weight * 0.06"></t-let>
<t-let name="walk" expr="Math.round(calories / burn)"></t-let>
<t-let name="km" expr="Math.round(walk / 60 * 5 * 10) / 10"></t-let>
<t-math display>
  \text{calories} = \tangle{cookies} \times \val{perCookie}
    + \tangle{milk} \times 120 = \val{calories}
</t-math>
<p>That's <t-out expr="share" format="percent">20%</t-out> of your budget, which leaves
  <t-out expr="left" format="%d">1610</t-out> calories. Walking it off takes
  <t-out expr="walk">93</t-out> minutes, about <t-out expr="km">7.8</t-out> km.</p>
<t-debug></t-debug>
```

<t-scope class="example">
  <p>Eat <t-num name="cookies" min="0" max="30">3</t-num>
    <t-choice name="perCookie"
      options="chocolate chip:50, oatmeal:65, double fudge:90">chocolate chip</t-choice>
    cookies with <t-num name="milk" min="0" max="4">2</t-num> glasses of milk,
      on a budget of <t-num name="budget" min="1200" max="3500" step="100">2000</t-num>
    calories a day.
      You weigh <t-num name="weight" min="40" max="150">70</t-num> kg.</p>
  <t-let name="snack" expr="cookies * perCookie"></t-let>
  <t-let name="drinks" expr="milk * 120"></t-let>
  <t-let name="calories" expr="snack + drinks"></t-let>
  <t-let name="share" expr="calories / budget"></t-let>
  <t-let name="left" expr="budget - calories"></t-let>
  <t-let name="burn" expr="weight * 0.06"></t-let>
  <t-let name="walk" expr="Math.round(calories / burn)"></t-let>
  <t-let name="km" expr="Math.round(walk / 60 * 5 * 10) / 10"></t-let>
  <t-math display>
    \text{calories} = \tangle{cookies} \times \val{perCookie}
      + \tangle{milk} \times 120 = \val{calories}
  </t-math>
  <p>That's <t-out expr="share" format="percent">20%</t-out> of your budget, which leaves
    <t-out expr="left" format="%d">1610</t-out> calories. Walking it off takes
    <t-out expr="walk">93</t-out> minutes, about <t-out expr="km">7.8</t-out> km.</p>
  <t-debug></t-debug>
</t-scope>

Things to watch in the graph:

- **Drag your weight.** Only `burn`, `walk` and `km` pulse. How many calories you ate doesn't
  depend on your weight, so `calories` isn't recomputed.
- **Drag the budget.** Only `share` and `left` pulse.
- **Drag the milk.** `drinks`, `calories` and everything after them pulse, but `snack` doesn't.
- **Drag the 3 in the formula.** It's the same `cookies` as in the sentence, so both move.

## Where each piece lives

| Piece | File | What it is |
| --- | --- | --- |
| Signals | `src/core/signals.js` | `Signal` (a value), `Computed` (a cached formula), `Effect` (redraws). They track reads. |
| Scopes | `src/core/scope.js` | A map from names to signals, and how expressions are compiled. |
| Elements | `src/core/element.js`, `src/elements/` | `TangleElement` and one file per `<t-…>`. Each one reads attributes, then redraws in `watch(…)`. |
| Dragging | `src/core/interaction.js` | One listener on the document for every draggable number, typing included. |
| Bundle | `site/bundle.js` | Concatenates `src/` into `tangle.js`. |

## Good to know

- **Order doesn't matter.** An expression can read a variable before the element that defines
  it. It gets an empty value, and runs again as soon as the variable is defined.
- **Every bare name in an expression is a variable.** Expressions run inside `with` and a
  `Proxy`, so `cookies` always means the variable. Only `Math`, `JSON` and a few other globals
  get through.
- **One scope per `<t-scope>`.** Elements use the variables of the nearest `<t-scope>` around
  them, or the page's if there's none.
- **Formulas drag too.** `<t-math>` turns `\tangle{a}` into KaTeX's `\htmlData{tangle-param=a}`,
  so a number inside a formula is marked just like a `<t-num>`.
- **Slow values dim.** While a [`<t-fetch>`](t-fetch.md) or [`<t-codecell>`](t-codecell.md)
  waits, the elements that depend on it get the class `is-stale`.
- **Big libraries load only when needed.** KaTeX, Vega, Plot and the others come from a CDN the
  first time an element needs them.

To build your own element on the same pieces, see [Your own elements](custom-elements.md). For
the graph of a bigger document, see [What recomputes](gallery-recompute.md).
