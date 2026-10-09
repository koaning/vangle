# `<t-paint>`

A canvas the reader draws on. With a `name`, the drawing is a variable: a PNG data URL, which
you can show in an image, send to a server or read pixels from.

<t-scope class="example" data-show-source>
  <t-tag tag="t-paint">
    <t-num name="width" min="120" max="640" step="20">480</t-num>
    <t-num name="height" min="80" max="400" step="20">200</t-num>
    <t-choice name="tools" options="brush marker eraser color, brush eraser, marker color, brush">brush eraser</t-choice>
    <t-choice name="color" options="rebeccapurple, #246bce, crimson, #000000">rebeccapurple</t-choice>
    <t-choice name="background" options="white, transparent, lightyellow">transparent</t-choice>
  </t-tag>
</t-scope>

## Attributes

| Attribute | Default | Description |
|---|---|---|
| `name` | | The variable that holds the drawing, as a PNG data URL. Without it, the canvas is just a sketchpad. |
| `width`, `height` | `480`, `320` | The canvas size in pixels, which is also the size of the PNG. On a narrow screen the canvas scales down to fit, and the drawing keeps its size. |
| `src` | | A starting image, drawn into the canvas. **Clear** goes back to it. Without `width` and `height`, the canvas takes the image's size; with one of them, the other follows the image's aspect ratio. An image from another site needs [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) headers. |
| `tools` | `brush marker eraser color` | What the toolbar offers: `brush` (a thin line), `marker` (a thick one), `eraser` and `color` (the color picker). Undo and clear are always there. |
| `color` | `#000000` | The starting ink color. Any CSS color. |
| `background` | `white` | The paper, which is part of the PNG. With `transparent`, the canvas shows a checkerboard and the PNG is transparent where nothing is drawn. |
| `label` | the name | The accessible name of the canvas. |

## Interaction

| Input | Effect |
|---|---|
| Drag on the canvas | Draws with the current tool. Mouse, pen and touch all work. |
| A tool button | Picks the tool. The marker and eraser get a thickness slider. |
| **Undo**, or <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd> | Takes back the last stroke, clear or loaded picture, up to 20 steps. |
| **Clear** | Empties the canvas, or goes back to the `src` image. Undo brings the drawing back. |

## The drawing as a variable {#variable}

Give the canvas a `name`, and the drawing is a variable that other elements can use.

<t-scope class="example" data-show-source="open">
  <t-paint name="art" width="480" height="240"></t-paint>
  <p>The drawing is a PNG of <t-out expr="(art.length - 22) * 3 / 4 / 1024" format="%.1f KB"></t-out>.
    Here it is again, as an image: <img id="paint-copy" alt="A copy of the drawing" width="120" height="60"></p>
</t-scope>

<script type="module" data-show-source>
  import { scopeOf } from "../tangle.js";

  const copy = document.querySelector("#paint-copy");
  scopeOf(copy).effect((s) => {
    if (s.get("art")) copy.src = s.get("art");
  });
</script>

<style>
  #paint-copy { vertical-align: middle; border: 1px solid var(--line); border-radius: 4px; }
</style>

The variable changes when a stroke ends, not while it's being drawn, so a drawing costs one PNG
encode per stroke. It's a plain string, so it's ready for `JSON.stringify` or an `<img src>`.

## Setting the drawing {#setting}

The variable works both ways. Set it to a data URL or an image URL, and the canvas shows that
picture. An empty value (`""` or `null`) clears it.

```js
import { scopeOf } from "./tangle.js";

const paint = document.querySelector("t-paint");
scopeOf(paint).set("art", "sketch.png");
```

Once the picture has loaded, the variable becomes the canvas's PNG, on its paper, just like
after a stroke. So whatever you set, the variable ends up holding a PNG, and code that reads the
pixels runs again when the canvas shows the new picture.

## Sending it to a server {#backend}

The data URL is a string, so it fits in JSON as is. Read it from the variable, or from the
element's `value`:

```js
const paint = document.querySelector("t-paint");
await fetch("/api/drawings", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ image: paint.value }),
});
```

On the server, strip the `data:image/png;base64,` prefix and decode the rest. To upload a file
instead, turn the data URL into a `Blob`:

```js
const form = new FormData();
form.append("image", await (await fetch(paint.value)).blob(), "drawing.png");
await fetch("/api/drawings", { method: "POST", body: form });
```

## Reading pixels {#pixels}

The element's `canvas` holds just the ink, without the paper, so it's transparent where nothing
is drawn. Read it in an expression that takes the variable as an argument, and it runs again after
every stroke:

```js
import { registerFunction } from "./tangle.js";

const paint = document.querySelector("t-paint");
// The share of the canvas with ink on it. `art` is only there so the expression re-runs.
registerFunction("inked", (art) => {
  const { width, height } = paint.canvas;
  const { data } = paint.canvas.getContext("2d").getImageData(0, 0, width, height);
  let count = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 127) count++;
  return count / (width * height);
});
```

```html
<p>You've covered <t-out expr="inked(art)" format="percent"></t-out> of the canvas.</p>
```

The [darts gallery page](gallery-darts.md) uses this to estimate the area of a drawing.

## Styling {#styling}

The toolbar and canvas are in a shadow root, so the page's styles for buttons and inputs don't
reach them. The toolbar uses `--tangle-surface` and `--tangle-accent`. Its pieces are
[shadow parts](https://developer.mozilla.org/en-US/docs/Web/CSS/::part):

| Selector | Matches |
|---|---|
| `t-paint` | The element. It's as wide as its canvas, and never wider than its container. |
| `t-paint::part(toolbar)` | The bar of tools above the canvas. |
| `t-paint::part(button)` | A tool, undo or clear button. The current tool has `aria-pressed="true"`. |
| `t-paint::part(color)`, `::part(size)` | The color picker and the thickness slider. |
| `t-paint::part(paper)` | The box around the canvas, which shows the paper. |
| `t-paint::part(canvas)` | The canvas. |

```css
t-paint::part(toolbar) { border-radius: 0; }
t-paint::part(paper) { border-radius: 0; box-shadow: 0 2px 8px rgb(0 0 0 / 0.1); }
```
