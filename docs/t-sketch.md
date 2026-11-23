# `<t-sketch>`

A whiteboard with no edges: pen, highlighter, eraser and lasso on a canvas you pan and zoom.
The ink is vector strokes, not pixels, so it stays sharp at any zoom, and with a `name` the
drawing is a variable you can read, save and load. It's the board of
[Sketcher](https://github.com/koaning/sketcher), and it reads and writes Sketcher's `.sketcher`
files.

<t-scope class="example" data-show-source>
  <t-sketch name="pendulum" src="data/pendulum.sketcher" height="440" label="A pendulum"></t-sketch>
  <p>The board has <t-out expr="pendulum.strokes.length"></t-out> strokes, of which
    <t-out expr="pendulum.strokes.filter((s) => s.tool == 'marker').length"></t-out> are highlights.</p>
</t-scope>

For a fixed-size canvas whose drawing is a picture, see [`<t-paint>`](t-paint.md).

## Attributes

| Attribute | Default | Description |
|---|---|---|
| `name` | | The variable that holds the board, as `.sketcher` JSON. Without it, the board is just a whiteboard. |
| `height` | `400` | The board's height in pixels. It's as wide as its container. |
| `background` | `dots` | The paper of an empty board: `plain`, `dots` or `grid`. A loaded board brings its own, and the palette's background button cycles through them. |
| `src` | | A `.sketcher` file to start from. |
| `label` | the name | The accessible name of the board. |

## Interaction

The palette in the top-left corner has the tools, three line widths, six colors, the background,
undo and redo. Right-click the board for the rest.

| Input | Effect |
|---|---|
| Drag | Draws with the current tool. Mouse, pen and touch all work; a pen's eraser end erases. |
| <kbd>P</kbd>, <kbd>M</kbd>, <kbd>E</kbd>, <kbd>S</kbd> | Pen, marker (a highlighter), eraser, select. |
| <kbd>1</kbd>–<kbd>6</kbd>, <kbd>[</kbd> <kbd>]</kbd> | A color, a thinner or thicker line. |
| <kbd>Shift</kbd> while drawing | A straight line, at a multiple of 15°. |
| <kbd>Option</kbd>/<kbd>Alt</kbd> while drawing | A straight line from grid point to grid point. With <kbd>Shift</kbd> too, the end lands on the grid where that keeps the angle. |
| Select, then drag | Draw a lasso around strokes to select them. Drag the selection to move it, or its round handle to resize it. |
| <kbd>⌫</kbd> | Deletes the selection. |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>C</kbd>, <kbd>X</kbd>, <kbd>V</kbd> | Copy, cut and paste strokes, also between boards. A paste lands under the pointer. |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Z</kbd>, <kbd>Shift</kbd>+<kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Z</kbd> | Undo and redo. |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>A</kbd> | Selects everything. |
| Scroll, or two fingers on a trackpad | Pans, once you've clicked the board. Before that, the page scrolls. |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + scroll, or pinch | Zooms around the pointer, from 10% to 800%. |
| <kbd>Space</kbd> + drag, middle-drag, two fingers on a touch screen | Pans (and with two fingers, zooms). |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>0</kbd>, <kbd>Shift</kbd>+<kbd>0</kbd>, <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>=</kbd> <kbd>-</kbd> | Zoom to fit, to 100%, in and out. |
| <kbd>Shift</kbd>+<kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>E</kbd>, <kbd>Shift</kbd>+<kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>C</kbd> | Downloads a PNG of the board, copies one (of the selection, if any). |
| <kbd>Esc</kbd> | Cancels the current stroke, or clears the selection. |

Line widths are in screen pixels when you draw: zoom out to draw big, zoom in for detail.
Overlapping highlights of one color don't get darker. Strokes in the six palette colors follow the
page's light or dark theme, so black ink becomes white chalk in dark mode.

## The board as a variable {#variable}

Give the board a `name`, and the variable holds the board as `.sketcher` JSON. It changes when a
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
  <p>
    <button id="sketch-save">Download .sketcher</button>
    <label><input id="sketch-open" type="file" accept=".sketcher,application/json"> Open one</label>
  </p>
</t-scope>

<script type="module" data-show-source>
  import { scopeOf } from "../tangle.js";

  const save = document.querySelector("#sketch-save");
  const scope = scopeOf(save);
  save.addEventListener("click", () => {
    const file = new Blob([JSON.stringify(scope.get("notes"))], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: "notes.sketcher" });
    a.click();
  });
  document.querySelector("#sketch-open").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (file) scope.set("notes", await file.text());
  });
</script>

`JSON.stringify` of the variable is a `.sketcher` file, with its keys in the order the Mac app
writes them, so the app opens it.

## As a picture {#picture}

The element's `toPNG()` gives the board as a PNG data URL, cropped to the ink with a margin, on
the board's paper, at twice the size. It's `null` when the board is empty.

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
| `t-sketch::part(board)` | The box around the canvas. Without a `height` attribute, you can set its height here. |
| `t-sketch::part(canvas)` | The canvas. |
| `t-sketch::part(palette)` | The floating palette of tools. |
| `t-sketch::part(button)` | A button in the palette or the selection bar. The current tool has `aria-pressed="true"`. |
| `t-sketch::part(swatch)` | A color button. |
| `t-sketch::part(selection-bar)` | The bar with the delete button above a selection. |
| `t-sketch::part(menu)` | The right-click menu. |

```css
t-sketch::part(board) { height: 70vh; border-radius: 0; }
t-sketch::part(palette) { box-shadow: none; }
```
