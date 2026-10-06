# Getting started

vangle turns a static HTML page into a reactive document. Readers drag numbers
in the text or inside formulas, and everything that depends on them updates as they drag.

It's a modern take on Bret Victor's [Tangle](https://worrydream.com/Tangle/).
You describe the document with a handful of custom HTML elements. You don't write an
`update()` function, and there's no build step and no dependencies.

## Install

Copy `tangle.js` and `tangle.css` into your site, then add two lines to
the page's `<head>`, or to your blog's layout template:

```html
<link rel="stylesheet" href="/tangle.css">
<script type="module" src="/tangle.js"></script>
```

That's all. KaTeX is only downloaded on pages that contain a [`<t-math>`](t-math.md) formula.

## Your first reactive paragraph

<t-scope class="example" data-show-source="open">
  <p>When you eat <t-num name="cookies" min="0" max="30">3</t-num> cookies, you consume
    <t-out expr="calories">150</t-out> calories. That's
    <t-out expr="calories / 2000" format="percent">8%</t-out> of a recommended daily intake.</p>
  <t-let name="calories" expr="cookies * 50"></t-let>
</t-scope>

Here's what each element does:

- `<t-num name="cookies">` declares a variable called `cookies` and shows it as a
  draggable number. Its text, `3`, is the starting value.
- `<t-let name="calories" expr="cookies * 50">` defines a computed variable. It's invisible.
- `<t-out expr="…">` shows the result of an expression and keeps it up to date.

Try dragging the number. You can also click it to type a value, or focus it and press the arrow keys.

## How it works

### Variables

Every value in the document is a named *variable*. A variable is declared by
[`<t-num>`](t-num.md),
[`<t-var>`](t-var.md) or
[`<t-choice>`](t-choice.md) (values the reader can change), or by
[`<t-let>`](t-let.md) (values computed from other variables).
Names follow JavaScript identifier rules: `rate`, `x2`, `total_cost`.

### Reactivity

Expressions are plain JavaScript (see [Expressions & formats](expressions.md)).
While an expression runs, vangle records which variables it reads. When one of them changes,
only the outputs, computed values and formulas that depend on it update. Changes are batched,
so a drag that moves several values redraws each output once.

### Order doesn't matter

You can use a variable before the element that declares it: in the example above,
`calories` is used before the `<t-let>` that defines it. This lets you
put declarations wherever reads best, for example next to the formula that uses them.

### Scopes

By default, every element on the page shares one set of variables. Wrap part of the page in
[`<t-scope>`](t-scope.md) to give it its own. Each example in these docs
sits in its own scope, so they don't interfere with each other.

### Without JavaScript

The markup degrades gracefully. A `<t-num>` shows its starting value, and a
`<t-out>` shows whatever fallback text you put inside it (the `150` above).
RSS readers and no-JS browsers still get a readable sentence.

## The elements

| Element | Use it for |
|---|---|
| [`<t-num>`](t-num.md) | A number the reader can drag, type or step with the keyboard. |
| [`<t-var>`](t-var.md) | Declaring a variable without showing it, for example one used only in a formula. |
| [`<t-let>`](t-let.md) | A named value computed from other variables. |
| [`<t-out>`](t-out.md) | Showing the live result of an expression in the text. |
| [`<t-choice>`](t-choice.md) | A word the reader clicks to cycle through options, or a toggle. |
| [`<t-math>`](t-math.md) | A KaTeX formula with draggable parameters and live results. |
| [`<t-scope>`](t-scope.md) | Giving part of the page its own variables. |

For charts and other custom logic, the same variables are available from
[JavaScript](javascript.md). See [Updating a chart](charts.md) for a walkthrough.
