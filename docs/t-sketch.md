# `<t-sketch>`

A whiteboard with no edges: pen, highlighter, eraser and lasso on a canvas you pan and zoom.
The ink is vector strokes, not pixels, so it stays sharp at any zoom. Anything you put inside
the board, vangle elements included, becomes a card on it that you can move around and draw
arrows between. When the board is done, **Export** gives you the HTML of a view-only copy to
paste into a page. It's the board of
[Sketcher](https://github.com/koaning/sketcher), and its JSON is the format Sketcher saves.

<t-scope class="example" data-show-source>
  <t-sketch name="pendulum" src="data/pendulum.json" height="440" label="A pendulum"></t-sketch>
  <p>The board has <t-out expr="pendulum.strokes.length"></t-out> strokes, of which
    <t-out expr="pendulum.strokes.filter((s) => s.tool == 'marker').length"></t-out> are highlights.</p>
</t-scope>

For a fixed-size canvas whose drawing is a picture, see [`<t-paint>`](t-paint.md).

## Attributes

| Attribute | Default | Description |
|---|---|---|
| `mode` | `edit` | `edit` draws and moves things, and has **Preview** and **Export**. `view` only pans and zooms: the ink stays put and the cards are live. |
| `name` | | Puts the board in a page variable of that name, as JSON, so other elements and your code can read it, save it or set it. See [the board as a variable](#variable). Without it, nothing else on the page sees the board. |
| `height` | `400` | The board's height in pixels. It's as wide as its container. |
| `background` | `dots` | The paper of an empty board: `plain`, `dots` or `grid`. A loaded board brings its own, and the palette's background button cycles through them. |
| `src` | | A JSON file of a board to start from. A `<script type="application/json">` inside the board does the same, inline. |
| `label` | the name | The accessible name of the board. |

## Interaction

The palette in the top-left corner has the tools, three line widths, six colors, the background,
undo and redo. Right-click the board for the rest.

| Input | Effect |
|---|---|
| Drag | Draws with the current tool. Mouse, pen and touch all work; a pen's eraser end erases. In view mode, or a preview, it pans. |
| <kbd>P</kbd>, <kbd>M</kbd>, <kbd>E</kbd>, <kbd>S</kbd> | Pen, marker (a highlighter), eraser, select. |
| <kbd>1</kbd>–<kbd>6</kbd>, <kbd>[</kbd> <kbd>]</kbd> | A color, a thinner or thicker line. |
| <kbd>Shift</kbd> while drawing | A straight line, at a multiple of 15°. |
| <kbd>Option</kbd>/<kbd>Alt</kbd> while drawing | A straight line from grid point to grid point. With <kbd>Shift</kbd> too, the end lands on the grid where that keeps the angle. |
| Select, then drag | Draw a lasso around strokes to select them. Drag the selection to move it, or its round handle to resize it. |
| <kbd>⌫</kbd> | Deletes the selection. |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>C</kbd>, <kbd>X</kbd>, <kbd>V</kbd> | Copy, cut and paste strokes, also between boards. A paste lands under the pointer. |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Z</kbd>, <kbd>Shift</kbd>+<kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Z</kbd> | Undo and redo. |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>A</kbd> | Selects everything. |
| Scroll, or two fingers on a trackpad | Pans, once you've clicked the board: its border turns the accent color. Before that, the page scrolls, and the board says how to scroll it instead. |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + scroll, or pinch | Zooms around the pointer, from 10% to 800%. |
| <kbd>Space</kbd> + drag, middle-drag, two fingers on a touch screen | Pans (and with two fingers, zooms). |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>0</kbd>, <kbd>Shift</kbd>+<kbd>0</kbd>, <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>=</kbd> <kbd>-</kbd> | Zoom to fit, to 100%, in and out. |
| <kbd>Shift</kbd>+<kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>E</kbd>, <kbd>Shift</kbd>+<kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>C</kbd> | Downloads a PNG of the board, copies one (of the selection, if any). |
| <kbd>Esc</kbd> | Cancels the current stroke, or clears the selection. In preview, goes back to editing. |
| The eye, the `</>` button | Preview the board as readers will see it; [Export](#export) it. |
| The arrows in the corner | Full screen, in edit and view mode. <kbd>Esc</kbd> or the button again goes back. |

Line widths are in screen pixels when you draw: zoom out to draw big, zoom in for detail.
Overlapping highlights of one color don't get darker. Strokes in the six palette colors follow the
page's light or dark theme, so black ink becomes white chalk in dark mode.

## Cards {#cards}

The board's children are cards: a paragraph, a figure, a chart, anything. Each one sits at
`data-x`, `data-y` in board coordinates and is `data-width` wide (280 without one). A card without
a place goes to the right of the others. Cards pan and zoom with the board, and the ink is
on top of them, so you can circle a number or draw an arrow from one chart to another.

<t-scope class="example" data-show-source>
  <t-sketch height="300" label="Cards to draw between">
    <p data-x="0" data-y="0" data-width="200">A circle with radius
      <t-num name="r" min="1" max="20">5</t-num> cm</p>
    <p data-x="320" data-y="60" data-width="220">has an area of
      <t-out expr="Math.PI * r ** 2" format="%.1f"></t-out> cm²
      and a circumference of <t-out expr="2 * Math.PI * r" format="%.1f"></t-out> cm.</p>
  </t-sketch>
</t-scope>

While editing, a card is a thing on the board: the select tool picks it up (click it, or lasso
its middle) and drags it, and its outline is dashed. Only ink resizes, and deleting removes only
ink, since the cards are the page's HTML. **Preview** shows the board as a reader will see it.
There the cards are live, so dragging a number drags the number, and dragging the paper pans.
<kbd>Esc</kbd> goes back to editing.

Children that don't show, like a `<t-let>`, aren't cards. Put the `<t-let>`s a board needs
outside it, next to it, as the [mixture gallery page](gallery-mixture.md) does.

## Export {#export}

**Export**, the last button in the palette (or **Copy HTML for a Page** in the right-click menu),
copies the HTML of a view-only copy of the board:

```html
<t-sketch mode="view" height="300">
  <p data-x="0" data-y="0" data-width="200">A circle with radius …</p>
  <p data-x="340" data-y="120" data-width="220">has an area of …</p>
  <script type="application/json">{"background":"dots","math":[],"strokes":[…],"version":2}</script>
</t-sketch>
```

The cards are the HTML they were written as, at the places you moved them to, and the ink is
JSON with the points rounded to a tenth. Paste it over the board you edited to publish the
result. `exportHTML()` on the element gives the same text.

## The board as a variable {#variable}

`name="notes"` puts the board in a page variable called `notes`, the way a `<t-num name="r">` puts
its number in `r`. Other elements can use it in their expressions (`notes.strokes.length`), and
code can read it or set it with `scopeOf(el).get("notes")` and `.set("notes", …)`. The variable
holds the board's ink as JSON; the cards aren't in it. It changes when a
stroke or an edit is done, not while you draw.

```json
{
  "background": "dots",
  "math": [],
  "strokes": [
    {
      "color": { "a": 1, "b": 0.12, "g": 0.11, "r": 0.11 },
      "id": "5C4F3B9E-…",
      "points": [[0, 0], [12.5, 3], [30, 4]],
      "swatch": 0,
      "tool": "pen",
      "width": 2.5
    }
  ],
  "version": 2
}
```

A stroke's `points` are in board coordinates, with y pointing down, and its `width` is in the same
units. `tool` is `pen` or `marker`. `swatch` is the palette color (0 to 5), and `color` is what
it was when drawn, for a stroke without one. `math` is Sketcher's layer of typeset LaTeX: a
`<t-sketch>` keeps it, but doesn't show it.

The variable works both ways. Set it to a board, as an object or as JSON text, and the board shows
it, zoomed to fit, and undo starts over. An empty value (`""` or `null`) leaves the board as it is,
and the variable goes back to holding it. A board with a `src` holds an empty board until the file
has loaded.

<t-scope class="example" data-show-source="open">
  <t-sketch name="notes" height="240"></t-sketch>
  <button type="button" id="sketch-save">Download .json</button>
  <button type="button" id="sketch-open">Open a .json</button>
  <input id="sketch-file" type="file" accept=".json,.sketcher,application/json" hidden>
</t-scope>

<script type="module" data-show-source>
  import { scopeOf } from "../tangle.js";

  const save = document.querySelector("#sketch-save");
  const scope = scopeOf(save);
  save.addEventListener("click", () => {
    const file = new Blob([JSON.stringify(scope.get("notes"))], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: "notes.json" });
    a.click();
  });
  // The file picker is hidden; the Open button opens it.
  const picker = document.querySelector("#sketch-file");
  document.querySelector("#sketch-open").addEventListener("click", () => picker.click());
  picker.addEventListener("change", async () => {
    const file = picker.files[0];
    if (file) scope.set("notes", await file.text());
    picker.value = ""; // so opening the same file again still loads it
  });
</script>

`JSON.stringify` of the variable is a `.json` file of the board. Its keys are in the order the
Sketcher Mac app writes them, so the app opens it too (it calls its files `.sketcher`).

## As a picture {#picture}

The element's `toPNG()` gives the ink as a PNG data URL, cropped to it with a margin, on the
board's paper, at twice the size. Cards aren't in the picture. It's `null` when there's no ink.

```js
const sketch = document.querySelector("t-sketch");
image.src = sketch.toPNG(); // or toPNG({ scale: 1, padding: 16 })
```

The element fires a `change` event whenever the board changes, with or without a `name`.

## Styling {#styling}

The board is in a shadow root, so the page's styles for buttons don't reach it. It uses
`--tangle-surface` for the paper and the palette, and `--tangle-accent` for the selection and the
current tool. Its pieces are [shadow parts](https://developer.mozilla.org/en-US/docs/Web/CSS/::part):

| Selector | Matches |
|---|---|
| `t-sketch::part(board)` | The box around the canvas. Its border is the accent color while the board has focus. Without a `height` attribute, you can set its height here. |
| `t-sketch::part(canvas)` | The canvas. |
| `t-sketch::part(palette)` | The floating palette of tools. |
| `t-sketch::part(viewbar)` | The zoom-to-fit and full-screen buttons (and in a preview, the way back to editing). |
| `t-sketch::part(button)` | A button in the palette or the selection bar. The current tool has `aria-pressed="true"`. |
| `t-sketch::part(swatch)` | A color button. |
| `t-sketch::part(selection-bar)` | The bar with the delete button above a selection. |
| `t-sketch::part(menu)` | The right-click menu. |

```css
t-sketch::part(board) { height: 70vh; border-radius: 0; }
t-sketch::part(palette) { box-shadow: none; }
```
