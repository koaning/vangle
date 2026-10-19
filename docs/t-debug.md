# `<t-debug>`

The variables as a live graph: what each one holds, what it reads, and what reads it.
It's for writing a document, not for readers.

<t-scope class="example" data-show-source="open">
  <p>A <t-num name="w" min="1" max="20">4</t-num> by <t-num name="h" min="1" max="20">3</t-num> m
    floor has an area of <t-out expr="area"></t-out> m² and needs
    <t-out expr="tiles"></t-out> <t-choice name="tile" options="small:0.25, large:1">small</t-choice> tiles.</p>
  <t-let name="area" expr="w * h"></t-let>
  <t-let name="tiles" expr="Math.ceil(area / tile * (1 + wastage))"></t-let>
  <t-debug></t-debug>
</t-scope>

The number of tiles shows as `–`, not a number, and the graph shows why: `tiles` reads
`wastage`, which nothing sets, so its box is red. A typo in an expression shows up the same way.

## The graph

Each box is a variable, with its current value below the name. An edge goes from a variable
to every formula that read it, so values sit on the left and each formula is a column to the
right of the furthest variable it reads.

| Box | Kind |
|---|---|
| In the variable's color | A value, set by an element such as [`<t-num>`](t-num.md), or by JavaScript. |
| Plain | A formula: a [`<t-let>`](t-let.md), or a [`<t-call>`](t-call.md) with a `name`. |
| Dashed | A [`<t-fetch>`](t-fetch.md). It dims while a new answer loads. |
| Red | A variable that something reads but nothing sets, or a formula that throws. |

A box pulses when its value changes, so you see how far one change reaches. Hovering a box
lights up its edges and outlines the elements on the page that show the variable, and
hovering a draggable number on the page lights up its box. Click a box to log the whole value
to the console. The title of a box (hover and wait) has its kind, how many times a formula has
run, and the value in full.

## The table

Below the graph, a table lists the same variables with their connections spelled out.

| Column | Description |
|---|---|
| variable | The name, and its kind: `value` (set by an element or by JavaScript), `formula` (a [`<t-let>`](t-let.md) or a [`<t-call>`](t-call.md) with a `name`) with how many times it has run, `fetch` ([`<t-fetch>`](t-fetch.md)), or `never set`. While a fetch waits, the kind reads `loading`. |
| value | The current value on one line. A formula that throws shows its error. Click a value to log it to the console. |
| reads | The variables this one's formula read the last time it ran. |
| read by | The formulas that read it, and the elements that show it, such as `<t-out> ×2`. |

Rows come in the graph's order, and hovering one works like hovering its box.

The graph is what the page did, not what it could do. A formula that reads `a` only when
`x > 0` lists `a` only while that's true.

## Which variables

Inside a [`<t-scope>`](t-scope.md), `<t-debug>` shows that scope's variables. Anywhere else, it
shows every scope on the page, under a heading each: `page` for the page-wide one, and a
`<t-scope>`'s `id` if it has one.

## On any page

Add `?tangle-debug` to the address of a page that uses tangle.js, such as
[this page](t-fetch.html?tangle-debug), and a `<t-debug>` floats over it in a
[`<t-panel>`](t-panel.md). There's nothing to remove before you publish.

To keep one in a page while you write, put it in a panel yourself:

```html
<t-panel label="Debug" corner="bottom-left"><t-debug></t-debug></t-panel>
```

## From JavaScript {#from-javascript}

`inspectScope(scope)` returns the same information as data, one object per variable:

```js
import { inspectScope, scopeOf } from "../tangle.js";

inspectScope(scopeOf(document));
// [{ name: "area", kind: "formula", value: 12, error: null, pending: false, runs: 1,
//    reads: ["w", "h"], readBy: ["tiles"], elements: [<t-out>] }, …]
```

`elements` holds the elements themselves. That's handy in the console, and for an agent that
helps write the document: it can check what depends on what without reading the page.
`layoutGraph(rows)` gives the positions `<t-debug>` draws those rows at, to draw the graph your own way.
