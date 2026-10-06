# `<t-scope>`

Gives part of the page its own set of variables.

Without any `<t-scope>`, all elements on a page share one page-wide set of variables.
Every element inside a `<t-scope>` uses that scope's variables instead, so the same
names can mean different things in different places:

<div class="example" data-show-source="open">
  <t-scope>
    <p>Alice runs <t-num name="km" min="0" max="42" step="0.5">5</t-num> km at
      <t-num name="pace" min="3" max="9" step="0.1">5.5</t-num> min/km:
      <t-out expr="km * pace" format="%d"></t-out> minutes.</p>
  </t-scope>
  <t-scope>
    <p>Bob runs <t-num name="km" min="0" max="42" step="0.5">10</t-num> km at
      <t-num name="pace" min="3" max="9" step="0.1">6</t-num> min/km:
      <t-out expr="km * pace" format="%d"></t-out> minutes.</p>
  </t-scope>
</div>

## When to use it

- **Blog index pages.** When a page shows several posts in full, wrap each post in a
  `<t-scope>` so their variables can't collide.
- **Side-by-side comparisons**, like the example above.
- **Reusable snippets**, such as an include or shortcode used more than once on a page.

## Behavior

- Scopes don't inherit. Inside a `<t-scope>`, variables from the page-wide scope or
  from an enclosing `<t-scope>` aren't visible. An element always uses its nearest scope.
- A `<t-scope>` doesn't affect layout. It has `display: contents`, so it
  can wrap blocks or a fragment of a sentence. Override that in CSS if you want to style it as a box.
- The element has no attributes.

## From JavaScript

Get a scope with `scopeOf(element)`, using any element inside it, or from the
`scope` property of the `<t-scope>` itself:

```js
import { scopeOf } from "/tangle.js";

const alice = scopeOf(document.querySelector("#alice"));
alice.set("km", 21.1);

const page = scopeOf(document); // the page-wide scope
```

See the [JavaScript API](javascript.md) for what a scope can do.
