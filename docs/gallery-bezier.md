# Bézier curves

A cubic Bézier curve is the curve in every drawing program: four control points, of which it
passes through only the first and the last. De Casteljau's construction draws it with nothing but
mixing. Mix each pair of neighboring control points <span class="level1">*t* of the way</span>
along, then mix the three points that gives, then the <span class="level2">two</span> after that.
The last point lands on the curve, and as *t* runs from 0 to 1, it traces all of it.

<div class="example bezier-demo" data-show-source>
  <t-scope id="bezier">
    <t-var name="t" value="0.4" min="0" max="1" step="0.01" format="%.2f"></t-var>
    <t-math display>
      B(\tangle{t}) = \val[%.3f]{(1 - t) ** 3}\,P_0 + \val[%.3f]{3 * (1 - t) ** 2 * t}\,P_1
      + \val[%.3f]{3 * (1 - t) * t ** 2}\,P_2 + \val[%.3f]{t ** 3}\,P_3
    </t-math>
    <div class="controls"><button type="button" class="play">Play</button></div>
    <t-jsxgraph x="0 10" y="0.3 6.5">
      <script type="text/plain">
        // The control points are plain JSXGraph points: the board keeps them, not the page.
        const P = [[1, 1], [2.2, 5.6], [7.4, 5.8], [9, 1.2]].map(([x, y], i) =>
          board.create("point", [x, y], { name: `P<sub>${i}</sub>`, withLabel: true, size: 6, cssClass: "control", label: { offset: [10, 12], fontSize: 15 } }));
        // A point t of the way from a to b. It reads t, so it moves when t changes.
        const mix = (a, b, attributes) => board.create("point",
          [() => a.X() + t * (b.X() - a.X()), () => a.Y() + t * (b.Y() - a.Y())], { fixed: true, size: 3, ...attributes });
        const chain = (points, attributes) => points.slice(1).map((p, i) => board.create("segment", [points[i], p], attributes));
        // The curve itself, from the Bernstein form in the formula above.
        const B = (s, xy) => (1 - s) ** 3 * P[0][xy]() + 3 * (1 - s) ** 2 * s * P[1][xy]() + 3 * (1 - s) * s ** 2 * P[2][xy]() + s ** 3 * P[3][xy]();
        board.create("curve", [(s) => B(s, "X"), (s) => B(s, "Y"), 0, 1], { fixed: true, cssClass: "ghost" });
        board.create("curve", [(s) => B(s, "X"), (s) => B(s, "Y"), 0, () => t], { fixed: true, cssClass: "drawn" });
        // De Casteljau: three mixes, then two, then one.
        chain(P, { cssClass: "hull" });
        const Q = [0, 1, 2].map((i) => mix(P[i], P[i + 1], { cssClass: "level1" }));
        chain(Q, { fixed: true, cssClass: "level1" });
        const R = [0, 1].map((i) => mix(Q[i], Q[i + 1], { cssClass: "level2" }));
        chain(R, { fixed: true, cssClass: "level2" });
        mix(R[0], R[1], { size: 6, cssClass: "tip" });
      </script>
    </t-jsxgraph>
  </t-scope>
</div>

<script type="module" data-show-source>
  import { scopeOf } from "../tangle.js";

  const root = document.querySelector("#bezier");
  const scope = scopeOf(root);

  // Play sweeps t from 0 to 1 in two and a half seconds: every frame sets it a little further.
  let frame = null;
  root.querySelector(".play").addEventListener("click", () => {
    cancelAnimationFrame(frame);
    const start = performance.now();
    const step = (now) => {
      const s = Math.min(1, (now - start) / 2500);
      scope.set("t", s);
      if (s < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  });
  // Dragging t takes over from a running sweep.
  root.querySelector("t-math").addEventListener("pointerdown", () => cancelAnimationFrame(frame));
</script>

<style data-show-source>
  .bezier-demo { --level1: light-dark(#246bce, #75a7ff); --level2: light-dark(#b45b1b, #ffad66); --tip: light-dark(#c2185b, #f06292); }
  .level1 { color: light-dark(#246bce, #75a7ff); }
  .level2 { color: light-dark(#b45b1b, #ffad66); }
  .bezier-demo .controls { display: flex; justify-content: center; margin: 0.25rem 0 0.5rem; }
  .bezier-demo .controls button { margin: 0; }
  .bezier-demo .tangle-jsxgraph { aspect-ratio: 10 / 6.5; }
  .bezier-demo .control { stroke: currentColor; fill: var(--tangle-surface, white); stroke-width: 2; }
  .bezier-demo .hull { stroke: currentColor; stroke-opacity: 0.35; stroke-width: 1.5; stroke-dasharray: 4 5; }
  .bezier-demo .level1 { stroke: var(--level1); fill: var(--level1); stroke-width: 2; }
  .bezier-demo .level2 { stroke: var(--level2); fill: var(--level2); stroke-width: 2; }
  .bezier-demo .ghost { stroke: currentColor; stroke-opacity: 0.18; stroke-width: 2; fill: none; }
  .bezier-demo .drawn { stroke: var(--tip); stroke-width: 4; fill: none; }
  .bezier-demo .tip { stroke: var(--tip); fill: var(--tip); }
</style>

## Things to notice

- **The weights always add up to 1.** Each number in the formula is how much of one control point
  is in the mix. At *t* = 0 it's all *P*₀, and at *t* = 1 all *P*₃.
- **The curve never leaves the dashed outline.** Every mix lands between the points it mixes, so
  the curve stays inside the shape the control points span.
- **The ends point at the middle control points.** The curve leaves *P*₀ heading for *P*₁, and
  arrives at *P*₃ coming from *P*₂. Drawing programs show these as the handles.
- **Crossed handles bend the curve back.** With *P*₁ past *P*₂, the curve turns sharply, and
  with the two far enough past each other it loops over itself.

## How it's built

- **The board holds the geometry.** The four control points are ordinary JSXGraph points, so the
  board keeps track of them and the page doesn't. Dragging the dashed outline moves two at once.
- **One variable drives the construction.** `t` is a [`<t-var>`](t-var.md), shown by the
  `\tangle{t}` in the [`<t-math>`](t-math.md). Every mixed point and the drawn part of the curve
  read `t` inside a function, so [`<t-jsxgraph>`](t-jsxgraph.md) updates them when it changes.
- **The formula and the board agree.** The weights in the formula are `\val{}`s of the same
  expressions the curve uses.
- **Play is an animation.** The button sets `t` on every animation frame. The board doesn't know
  it's an animation: it's just a variable changing.

Open the source panels above for the full markup, script and styles.
