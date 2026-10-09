# Throwing darts at a drawing

How big is a blob? For a circle there's a formula, but for a doodle there isn't. You can still
measure it by throwing darts. Throw them at random over the canvas and count how many land on
ink. The share that hits is roughly the share of the canvas the blob covers. This is a Monte
Carlo estimate: it works for any shape, and the more darts you throw, the closer it gets.

## Throw some darts

The canvas starts with a disc. Paint over it, erase bits of it, or clear it and draw your own
shape. Every stroke rethrows the same darts at the new drawing.

<div class="example darts" data-show-source>
  <t-var name="seed" value="1"></t-var>
  <div class="board">
    <t-paint name="shape" width="300" height="300" color="#246bce" label="Shape"
      src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><circle cx='150' cy='150' r='150' fill='%23246bce'/></svg>"></t-paint>
    <t-obsplot>
      <script type="text/plain">
      {
        width: 300,
        height: 300,
        margin: 0,
        x: { domain: [0, 300], axis: null },
        y: { domain: [0, 300], reverse: true, axis: null },
        marks: [
          Plot.image([shape], { frameAnchor: "middle", src: (d) => d, width: 300, height: 300 }),
          Plot.dot(darts, { x: "x", y: "y", r: n > 1000 ? 1.5 : 2.5, fill: (d) => (d.hit ? "var(--hit)" : "var(--miss)") }),
          Plot.frame({ strokeOpacity: 0.2 })
        ]
      }
      </script>
    </t-obsplot>
  </div>
  <p>Of <t-num name="n" min="10" max="5000" step="10" format="%,d">500</t-num> darts,
    <t-out expr="hits" format="%,d"></t-out> <span class="hit">hit</span> the ink. So the shape
    covers about <t-out expr="estimate" format="%.1f%%"></t-out> of the canvas, give or take
    <t-out expr="margin" format="%.1f"></t-out> points. Counting every one of its 90,000 pixels,
    it covers <t-out expr="truth" format="%.1f%%"></t-out>.</p>
  <t-let name="darts" expr="throwDarts(shape, n, seed)"></t-let>
  <t-let name="hits" expr="darts.filter((d) => d.hit).length"></t-let>
  <t-let name="estimate" expr="100 * hits / n"></t-let>
  <t-let name="margin" expr="2 * Math.sqrt(estimate * (100 - estimate) / n)"></t-let>
  <t-let name="truth" expr="100 * inked(shape)"></t-let>
  <button type="button" id="rethrow">Throw again</button>
  <button type="button" id="blank">Blank canvas</button>
</div>

<script type="module" data-show-source>
  import { registerFunction, scopeOf } from "../tangle.js";

  const paint = document.querySelector(".darts t-paint");

  // mulberry32, a small seeded random number generator: the same seed throws the same darts.
  function random(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // The canvas's ink, one alpha value per pixel. The canvas only changes with `shape`, so the
  // pixels are read once per drawing, however many expressions ask for them.
  let cache = { shape: null };
  function ink(shape) {
    if (cache.shape !== shape) {
      const { width, height } = paint.canvas;
      const { data } = paint.canvas.getContext("2d").getImageData(0, 0, width, height);
      cache = { shape, width, height, alpha: data.filter((_, i) => i % 4 === 3) };
    }
    return cache;
  }

  // n darts, each a random point on the canvas, and whether it landed on ink (more than half
  // opaque). `share` is the share of hits so far, for the chart below.
  function throwDarts(shape, n, seed) {
    const { width, height, alpha } = ink(shape);
    const rand = random(seed);
    let hits = 0;
    return Array.from({ length: n }, (_, i) => {
      const x = rand() * width;
      const y = rand() * height;
      const hit = alpha[Math.floor(y) * width + Math.floor(x)] > 127;
      if (hit) hits++;
      return { x, y, hit, share: hits / (i + 1) };
    });
  }

  // The exact answer: the share of all pixels with ink on them.
  function inked(shape) {
    const { alpha } = ink(shape);
    return alpha.reduce((count, a) => count + (a > 127), 0) / alpha.length;
  }

  registerFunction("throwDarts", throwDarts);
  registerFunction("inked", inked);

  const scope = scopeOf(paint);
  document.querySelector("#rethrow").addEventListener("click", () => scope.set("seed", scope.peek("seed") + 1));
  // Setting the variable loads a picture into the canvas; an empty one clears it.
  document.querySelector("#blank").addEventListener("click", () => scope.set("shape", ""));
</script>

<style data-show-source>
  .darts { --hit: #e8590c; --miss: #8a8a8a; }
  .darts .hit { color: var(--hit); font-weight: 600; }
  .darts .board { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 16px; margin: 1rem 0; }
  .darts .board t-obsplot { flex: 0 0 300px; margin: 0; }
</style>

The darts on the right land in the same places as long as the seed stays the same, so you can
watch single darts turn orange as you paint over them.

## How fast it settles

A few darts give a rough answer, and every extra dart refines it. This chart follows the
estimate as the darts come in, one at a time, against the exact share (the dashed line).

<div class="example darts" data-show-source>
  <t-obsplot>
    <script type="text/plain">
    {
      height: 220,
      marginBottom: 40,
      x: { type: "log", domain: [1, n], label: "Darts thrown (log scale)", labelAnchor: "center", labelArrow: "none" },
      y: { domain: [0, 100], grid: true, label: "Estimated area (%)" },
      marks: [
        Plot.ruleY([truth], { strokeDasharray: "4 3", strokeOpacity: 0.6 }),
        Plot.line(darts, { x: (d, i) => i + 1, y: (d) => 100 * d.share, stroke: "var(--tangle-accent)", strokeWidth: 2 })
      ]
    }
    </script>
  </t-obsplot>
  <p>Throwing four times as many darts only halves the error. The "give or take" above is two
    standard errors, 2√(<i>p</i>(1 − <i>p</i>)/<i>n</i>), so about 19 times out of 20 the
    estimate lands that close to the truth. With <t-num name="n"></t-num> darts, that's
    <t-out expr="margin" format="%.1f"></t-out> points.</p>
</div>

## A dart's estimate of π

The starting disc touches all four sides of its square canvas, so it covers π/4 of it. That makes
four times the hit rate an estimate of π: right now <t-out expr="4 * hits / n" format="%.3f"></t-out>,
if the disc is still there. Click **Clear** in the toolbar to bring it back, since it's the
`src` image.

## Things to try

- **Halve the disc.** Erase half of it with a big eraser. The estimate drops to around 39%.
- **Draw a thin line.** Thin shapes are hard to hit: with a few hundred darts, a line can get
  no hits at all, even though it has ink. Drag the darts up and the estimate finds it.
- **Rethrow.** Click **Throw again** a few times with 50 darts, then with 5,000. The estimate
  jumps around a lot less with more darts.
- **Start from nothing.** Click **Blank canvas**, which sets `shape` to `""`. The canvas is
  cleared, and every dart misses.

## How it's built

- **The drawing is a variable.** [`<t-paint name="shape">`](t-paint.md) puts the picture in
  `shape` as a PNG data URL whenever a stroke ends. The board on the right shows that same
  image, as a `Plot.image` under the darts in a [`<t-obsplot>`](t-obsplot.md).
- **The pixels come from the canvas.** The script registers `throwDarts` and `inked`, which read
  the canvas's alpha channel through the element's `canvas` property. They take `shape` as an
  argument even though they don't decode it: that's what makes the expressions that call them
  run again after each stroke. The pixels are read once per drawing and shared.
- **The starting disc is an SVG** in the `src` attribute, as a data URL. Clear goes back to it.
- **Seeded randomness.** The darts come from `seed`, so painting moves the ink, not the darts.
  **Throw again** adds one to `seed`, and **Blank canvas** sets `shape` to an empty string,
  which clears the canvas.
