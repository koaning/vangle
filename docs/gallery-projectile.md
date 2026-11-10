# Projectile motion with wind

A ball is thrown across flat ground, and a steady wind pushes it sideways while it flies. Nine
formulas say where it lands, in the order the physics works it out. At the top is the up-and-down
motion, which alone decides how long the ball stays up. Below it is the motion along the ground:
the forward speed and the wind, which only need to know that time. Where the two meet, the ball
lands. Drag a number, in the text or in a formula, and every formula it feeds shows its value
instead of its symbol.

<t-scope id="throw" class="example" data-show-source>
  <p>Thrown at <t-num name="v" min="1" max="50" label="launch speed (m/s)">20</t-num> m/s, at
    <t-num name="theta" min="1" max="89" label="launch angle (°)">45</t-num>° above the ground.</p>
  <t-formula-dag>
    <script type="text/plain">
    {
      formulas: {
        vx: { tex: String.raw`v_x = \tangle[v]{v}\cos\tangle[\theta]{theta}`, value: "v * Math.cos(theta * Math.PI / 180)", label: "forward speed", format: "%.2f", row: 2 },
        vy: { tex: String.raw`v_y = \tangle[v]{v}\sin\tangle[\theta]{theta}`, value: "v * Math.sin(theta * Math.PI / 180)", label: "upward speed", format: "%.2f" },
        ax: { tex: String.raw`a_x = \tangle[a_w]{wind}\cos\tangle[\varphi]{phi}`, value: "wind * Math.cos(phi * Math.PI / 180)", label: "wind, forward", format: "%.2f", row: 2 },
        az: { tex: String.raw`a_z = \tangle[a_w]{wind}\sin\tangle[\varphi]{phi}`, value: "wind * Math.sin(phi * Math.PI / 180)", label: "wind, sideways", format: "%.2f", row: 2 },
        t: { tex: String.raw`t = \note{updown}{\frac{2\,\use{vy}}{\tangle[g]{g}}}`, value: () => 2 * vy / g, label: "time in the air", format: "%.2f" },
        H: { tex: String.raw`H = \frac{\use{vy}^2}{2\tangle[g]{g}}`, value: "vy ** 2 / (2 * g)", label: "peak height", format: "%.1f" },
        X: { tex: String.raw`X = \use{vx}\,\use{t} + \tfrac{1}{2}\,\use{ax}\,\use{t}^2`, value: "vx * t + ax * t ** 2 / 2", label: "downrange", format: "%.1f" },
        Z: { tex: String.raw`Z = \note{drift}{\tfrac{1}{2}\,\use{az}\,\use{t}^2}`, value: "az * t ** 2 / 2", label: "sideways drift", format: "%.1f" },
        D: { tex: String.raw`D = \sqrt{\use{X}^2 + \use{Z}^2}`, value: "Math.hypot(X, Z)", label: "landing distance", format: "%.1f" },
      },
      params: {
        g: { value: 9.8, min: 1, max: 25, step: 0.1, label: "gravity (m/s²)" },
        wind: { value: 1.5, min: 0, max: 6, step: 0.1, label: "wind push (m/s²)" },
        phi: { value: 60, min: 0, max: 355, step: 5, label: "wind direction (°)" },
      },
      notes: {
        updown: { text: "up to the peak and back down: twice the rise time", side: "bottom" },
        drift: "only the wind pushes sideways",
      },
    }
    </script>
  </t-formula-dag>
  <p>It lands <t-out expr="D" format="%.1f m"></t-out> away: <t-out expr="X" format="%.1f m"></t-out> downrange
    and <t-out expr="Z" format="%.1f m"></t-out> to the side, after <t-out expr="t" format="%.2f s"></t-out> in the air.</p>
  <t-obsplot>
    <script type="text/plain">
    {
      height: 190,
      marginLeft: 44,
      x: { domain: view.x, label: "downrange (m)" },
      y: { domain: [0, view.up], label: "height (m)", grid: true },
      marks: [
        Plot.ruleY([0]),
        Plot.line(d3.range(0, 1.001, 0.01), { x: (u) => vx * u * t + ax * (u * t) ** 2 / 2, y: (u) => vy * u * t - g * (u * t) ** 2 / 2, stroke: "currentColor", clip: true }),
        Plot.ruleY([H], { stroke: "currentColor", strokeOpacity: 0.5, strokeDasharray: "4 3", clip: true }),
        Plot.dot([X], { x: (d) => d, y: 0, fill: "currentColor", r: 4, clip: true }),
      ],
    }
    </script>
  </t-obsplot>
  <t-obsplot>
    <script type="text/plain">
    {
      // Seen from above: downrange to the right, left of the thrower up. Equal
      // scales on both axes, so the drift looks as big as it is.
      aspectRatio: 1,
      marginLeft: 44,
      x: { domain: view.x, label: "downrange (m)", grid: true },
      y: { domain: [-view.side, view.side], label: "to the left (m)", grid: true },
      marks: [
        Plot.ruleY([0], { strokeOpacity: 0.25 }),
        // Without wind, it would come down straight ahead, after the same time in the air.
        Plot.dot([[vx * t, 0]], { stroke: "currentColor", strokeOpacity: 0.5, r: 4, clip: true }),
        Plot.text([[vx * t, 0]], { text: ["no wind"], dy: 12, fillOpacity: 0.6, clip: true }),
        // X downrange, then Z to the side, in the diagram's colors; D straight across.
        Plot.line([[0, 0], [X, 0]], { stroke: "var(--tangle-dag-6)", strokeWidth: 2.5, clip: true }),
        Plot.line([[X, 0], [X, Z]], { stroke: "var(--tangle-dag-7)", strokeWidth: 2.5, clip: true }),
        Plot.line([[0, 0], [X, Z]], { stroke: "currentColor", strokeOpacity: 0.4, strokeDasharray: "4 3", clip: true }),
        Plot.text([[X / 2, 0]], { text: ["X"], dy: 11, fill: "var(--tangle-dag-6)", fontWeight: 700, clip: true }),
        Plot.text([[X, Z / 2]], { text: ["Z"], dx: 9, fill: "var(--tangle-dag-7)", fontWeight: 700, clip: true }),
        // The path itself.
        Plot.line(d3.range(0, 1.001, 0.01), { x: (u) => vx * u * t + ax * (u * t) ** 2 / 2, y: (u) => az * (u * t) ** 2 / 2, stroke: "currentColor", strokeWidth: 2, clip: true }),
        Plot.dot([[0, 0]], { fill: "currentColor", r: 3 }),
        Plot.dot([[X, Z]], { fill: "currentColor", r: 5, clip: true }),
        // The wind, as an arrow in the bottom corner: longer when it pushes harder.
        Plot.arrow([view.wind], { x1: "x1", y1: "y1", x2: "x2", y2: "y2", stroke: "currentColor", strokeOpacity: 0.6, strokeWidth: 2, headLength: 8 }),
        Plot.text([[view.wind.x1, view.wind.y1]], { text: ["wind"], dy: 12, fillOpacity: 0.6 }),
      ],
    }
    </script>
  </t-obsplot>
</t-scope>

<script type="module" data-show-source>
  import { scopeOf } from "../tangle.js";

  // Both charts read `view`: the limits that fit the whole throw. This script
  // sets it, and glides it to new limits instead of jumping.
  const scope = scopeOf(document.getElementById("throw"));

  // A round number at least x: 1, 2 or 5 times a power of ten.
  const niceCeil = (x) => {
    const p = 10 ** Math.floor(Math.log10(x));
    return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= x * (1 - 1e-9));
  };

  // Limits that fit a throw, rounded so that small drags don't move them.
  function fit({ vx, ax, t, X, Z, H }) {
    // The farthest the ball gets downrange: where it lands, or where a
    // headwind strong enough to blow it back turns it around.
    const turn = ax < 0 && -vx / ax < t ? -(vx * vx) / (2 * ax) : 0;
    let hi = niceCeil(Math.max(1, X, vx * t, turn) * 1.05);
    const lo = X < 0 ? -niceCeil(-X * 1.1) : -hi / 20;
    const up = niceCeil(Math.max(1, H * 1.15));
    const side = niceCeil(Math.max(Math.abs(Z) * 1.15, (hi - lo) / 10));
    // From above, both axes share a scale. Keep the map at least 1.6 times as
    // wide as it is tall, by widening the downrange axis when the drift is big.
    if (2 * side * 1.6 > hi - lo) hi = lo + 2 * side * 1.6;
    return { lo, hi, up, side };
  }

  const still = matchMedia("(prefers-reduced-motion: reduce)");
  let shown = null; // the limits on screen
  let goal = null; // the limits they glide toward
  let wind = { ax: 0, az: 0 };
  let frame = 0;

  function publish() {
    const { lo, hi, up, side } = shown;
    // The wind arrow starts near the bottom-left corner. At the strongest
    // push, 6 m/s², it's a little under half as long as the map is high.
    const x1 = lo + (hi - lo) * 0.06;
    const y1 = -side * 0.45;
    const k = side / 14;
    scope.set("view", { x: [lo, hi], up, side, wind: { x1, y1, x2: x1 + k * wind.ax, y2: y1 + k * wind.az } });
  }

  // One frame of the glide: a quarter of the way there, until it's there.
  function step() {
    frame = 0;
    let moving = false;
    for (const key of Object.keys(goal)) {
      const gap = goal[key] - shown[key];
      if (Math.abs(gap) > Math.abs(goal[key]) * 1e-3) {
        shown[key] += gap / 4;
        moving = true;
      } else {
        shown[key] = goal[key];
      }
    }
    publish();
    if (moving) frame = requestAnimationFrame(step);
  }

  scope.effect((s) => {
    const now = Object.fromEntries(["vx", "ax", "az", "t", "X", "Z", "H"].map((n) => [n, s.get(n)]));
    if (!Object.values(now).every(Number.isFinite)) return; // not until every value is a number
    wind = { ax: now.ax, az: now.az };
    goal = fit(now);
    if (!shown || still.matches) {
      shown = { ...goal };
      publish();
    } else if (!frame) {
      frame = requestAnimationFrame(step);
    }
  });
</script>

The two charts show the same throw from the side and from above. From the side, the dashed line
is the peak height `H`. From above, the ball goes `X` downrange and `Z` to the side, and the open
circle is where it would land without wind, after the same time in the air.

## Up and down, then along the ground

Gravity pulls straight down and the wind pushes straight sideways, so the two motions don't mix.
The vertical one is a throw at `v_y` against `g`: up, and back down after `t`, peaking at `H`.
Nothing horizontal feeds into it. In the diagram, no arrow comes up from the row of `v_x`, `a_x`
and `a_z`.

The horizontal motion only borrows `t`. Along the ground, the ball keeps its forward speed `v_x`,
and the wind adds `½ a_x t²` downrange and `½ a_z t²` to the side. The wind is an acceleration
`a_w` toward the direction `φ`: 0° is a tailwind, 180° a headwind and 90° a push to the left.

Without wind, the throw that goes farthest downrange is at 45°. With wind, it isn't. A higher
throw stays up longer, which gives a tailwind more time to push. Right now the farthest throw
downrange is at <t-out expr="Math.atan2(g, -ax) * 90 / Math.PI" format="%.1f°"></t-out>, from
setting the slope of `X` against `θ` to zero.

This is a simplification. Real wind acts through drag, on the ball's speed relative to the air,
and that has no closed form for the time of flight. Drag also slows the ball in still air, so a
real throw falls short of all of these numbers.

## How it's built

One [`<t-formula-dag>`](t-formula-dag.md) holds the nine formulas. Each formula has a `value`,
which makes it a variable, so the `<t-out>`s and both [`<t-obsplot>`](t-obsplot.md) charts read
`t`, `X`, `Z` and `H` straight from the diagram. `v` and `theta` are `<t-num>`s in the first
sentence, and the diagram's `params` declare the other three numbers. A short script works out
the charts' limits from the throw and glides them to new ones, so the whole throw stays in view.

The rows come from `row`. On its own, a formula that uses nothing sits in the top row, so `v_x`,
`a_x` and `a_z` would sit beside `v_y`. `row: 2` on all three moves the horizontal motion below
the vertical one, and `X`, `Z` and `D` follow, because they use them. See
[Rows](t-formula-dag.md#rows).
