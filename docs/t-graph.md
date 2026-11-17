# `<t-graph>`

Nodes and edges, laid out by a force simulation. The graph is a JavaScript expression over the
page's variables, so it changes shape when they do, and the node the reader clicks or points at
goes back into variables. d3 loads only on pages that have a `<t-graph>`.

<t-scope class="example" data-show-source>
  <p>Each corner of a cube in <t-num name="n" min="1" max="6">4</t-num> dimensions is a string of
    bits, and an edge joins two corners that differ in one bit. Its color says which. That makes
    <t-out expr="2 ** n"></t-out> corners and <t-out expr="n * 2 ** (n - 1)"></t-out> edges.
    <t-out expr="readout"></t-out></p>
  <t-var name="picked" value="0"></t-var>
  <!-- How many bits two corners differ in, which is how many edges apart they are. -->
  <t-let name="apart" expr="(a, b) => (Number(a.id) ^ Number(b.id)).toString(2).replaceAll('0', '').length"></t-let>
  <t-let name="readout" expr="!picked?.name ? ''
    : hovered && hovered.id !== picked.id ? `${hovered.name} is ${apart(picked, hovered)} edges from ${picked.name}, one for each bit they differ in.`
    : `All ${n} neighbours of ${picked.name} differ from it in one bit.`"></t-let>
  <t-graph name="picked" hover="hovered" height="420" zoom>
    <script type="text/plain">
    {
      nodes: d3.range(2 ** n).map((i) => ({ id: i, name: i.toString(2).padStart(n, "0"), size: 6 })),
      edges: d3.range(2 ** n).flatMap((i) =>
        d3.range(n)
          .filter((bit) => i < (i ^ (1 << bit)))
          .map((bit) => ({ source: i, target: i ^ (1 << bit), color: bit + 1 }))
      )
    }
    </script>
  </t-graph>
</t-scope>

The corners' ids are numbers, so going from 3 to 4 dimensions keeps corners 0 to 7 where they
were, and the new ones grow out of them as a second cube.

## Writing the graph

The expression goes in a `<script type="text/plain">` inside the element, where the browser
doesn't run it and Markdown leaves it alone. Or keep it in a file and point to it with `src`.
It's an expression like the `expr` of a [`<t-let>`](t-let.md), with `d3` in reach, and it gives
back an object:

| Key | Default | Description |
|---|---|---|
| `nodes` | `[]` | The nodes. See below. |
| `edges` | `[]` | The edges. See below. |
| `directed` | `false` | Draw arrowheads at each edge's target. |

The expression says what the graph is. How it's drawn (its height and how the layout spreads
it out) is up to the [attributes](#attributes).

A node is a string or a number, which is both its id and its name, or an object:

| Key | Description |
|---|---|
| `id` | What edges and the variables use to find the node. Defaults to the name if no other node has it, else `node-` and its index. |
| `name` | The label under the node. |
| `size` | The radius in pixels. Defaults to 8. |
| `color` | See [Colors](#colors). Defaults to the accent color. |
| `data` | An object shown in a tooltip when the pointer is on the node. |
| `x`, `y` | Where a new node starts. The simulation moves it from there. |

An edge is a `[source, target]` pair, or an object:

| Key | Description |
|---|---|
| `source`, `target` | The nodes it joins. Each is an id, a name that only one node has, or an index into `nodes`. |
| `name` | A label at the middle of the edge. |
| `width` | The line width in pixels. Defaults to 1.5. |
| `color` | See [Colors](#colors). Defaults to a faint text color. |
| `data` | An object shown in a tooltip when the pointer is on the edge. |
| `id` | Defaults to `edge-` and its index. |

Nodes and edges can carry other keys too. They're kept, and they're there when a node is
[picked or hovered](#name). An edge to a node that doesn't exist, or a misspelled key in the
object, shows an error in place of the graph.

### Colors {#colors}

A color can be any CSS color, or two separated by a space for light and dark mode:
`"#b45b1b #ffad66"`. It can also be a number from 1 to 8, for that color of the theme's palette,
the same one [`<t-formula-dag>`](t-formula-dag.md) uses. The edges in the hypercube are
`color: bit + 1`, so they follow the theme into dark mode.

## Picking and hovering {#name}

Two attributes put what the reader does into variables:

- `name="picked"`: the node the reader clicked, or `null`. Clicking it again, or clicking the
  background, sets `null`. It works both ways. Setting the variable to a node's id, like
  `<t-var name="picked" value="0">` above, picks that node, and the graph replaces the id with
  the node. With `name`, nodes can be tabbed to and picked with <kbd>Enter</kbd> or
  <kbd>Space</kbd>.
- `hover="hovered"`: the node under the pointer (or with keyboard focus), or `null`.

Both hold the node object from your expression, with its id as a string: `{ id: "5", name:
"0101", size: 6 }`. When the expression runs again, they hold the node's new object, so
`picked.name` above changes from `101` to `0101` when you add a dimension. A node that's gone
sets them to `null`.

The expression can read these variables itself, for example to color the neighbours of the
picked node. Only the colors change then, and nothing moves.

## Zooming {#zoom}

With the `zoom` attribute, the reader can zoom in to read a crowded graph, as in the
hypercube above:

- <kbd>⌘</kbd> or <kbd>Ctrl</kbd> with the scroll wheel zooms, up to 8 times, and so does
  pinching on a trackpad or a touch screen.
- Dragging the background pans. Dragging a node still moves the node.
- A **Reset zoom** button appears in the corner once the view has moved.

The scroll wheel on its own still scrolls the page, so a graph never traps the reader halfway
down it. Scrolling over the graph shows a short hint about the key instead. Zooming only
changes the view: the layout stays inside the box, and you can't zoom out past it or pan away
from it. On a touch screen, a zoomable graph takes one-finger drags for panning, so the page
scrolls from outside the graph.

## When the graph changes {#updates}

The expression runs again whenever a variable it read changes, and the graph keeps what it can:

- **Nodes with the same id stay where they are.** A new node starts next to a neighbour that's
  already placed, and the simulation nudges the rest to make room. If most of the nodes are new,
  the graph is laid out from scratch.
- **Only new nodes or edges move things.** A change of color, size, name or data redraws in place.
- **Dragging a node** pulls the graph along with it. When you let go, the simulation settles again.
- **With reduced motion** turned on in the system settings, the graph settles before it's drawn,
  without animating.

Give nodes ids that mean something, like the numbers in the hypercube, so the same node keeps
the same id from one run to the next.

## Styling {#styling}

The graph is plain SVG, with these classes:

| Class | What it is |
|---|---|
| `.tangle-graph` | The box around the SVG. `.is-loading` until d3 has loaded. |
| `.tangle-graph-node` | A node: a `circle` and a `.tangle-graph-label`. `.is-picked` on the picked node. |
| `.tangle-graph-edge` | An edge: a `.tangle-graph-line` and a `.tangle-graph-head`. |
| `.tangle-graph-edge-label` | An edge's name. |
| `.tangle-graph-tooltip` | The tooltip with a node's or edge's `data`. |
| `.tangle-graph-reset`, `.tangle-graph-hint` | With `zoom`: the Reset zoom button, and the hint a plain scroll shows. |
| `.tangle-graph-error` | The message shown in place of the graph when the expression throws. |

Each node and edge sets `--node` or `--edge` to its color, and the stylesheet draws with it. To
draw every node hollow:

```css
t-graph .tangle-graph-node circle {
  fill: var(--tangle-surface);
  stroke: var(--node, var(--tangle-accent));
}
```

The labels use `--tangle-chart-font`, like the charts.

## Attributes {#attributes}

| Attribute | Default | Description |
|---|---|---|
| `height` | `400` | The height in pixels. The width is the element's, and follows it. |
| `distance` | `60` | How long the layout tries to make each edge, in pixels. |
| `charge` | `-160` | How hard nodes push each other apart. More negative spreads the graph out. |
| `zoom` | | Let the reader zoom and pan. See [Zooming](#zoom). |
| `src` | | A URL to load the expression from, instead of the `<script>` inside. |
| `name` | | A variable for the picked node. See [Picking and hovering](#name). |
| `hover` | | A variable for the node under the pointer. |
| `label` | `Graph` | The accessible name of the graph. |

## How d3 loads

The first `<t-graph>` on a page loads d3 7.9.0 from jsDelivr, about 280 KB of minified
JavaScript. A page with a [`<t-obsplot>`](t-obsplot.md) loads it anyway, and the two share
it. If the page already has `window.d3`, that copy is used. To load it from somewhere else, call
`configure({ d3Url })`. See [Configuration](javascript.md#configuration).

Ported from `GraphWidget` in [wigglystuff](https://github.com/koaning/wigglystuff).
