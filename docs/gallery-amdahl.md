# Amdahl's law

Twice the cores rarely means twice the speed. Most programs have some work that can't be split:
steps that wait for each other, or a sync where every core has to agree. Extra cores only speed up
the rest. Drag the numbers to see how much that serial part costs.

<t-scope class="example amdahl" data-show-source>
  <p>Program <span class="a">A</span> spends
    <t-num name="sa" min="0" max="50" step="0.5" format="%.1f%%" color="#246bce #75a7ff">1</t-num>
    of its time syncing, and program <span class="b">B</span> spends
    <t-num name="sb" min="0" max="50" step="0.5" format="%.1f%%" color="#b45b1b #ffad66">5</t-num>.
    On <t-num name="cores" min="1" max="1024" pixels-per-step="1" format="%,d">16</t-num> cores,
    A runs <t-out expr="speedA" format="%.1f×"></t-out> faster and B
    <t-out expr="speedB" format="%.1f×"></t-out>. However many cores you add, A never gets past
    <t-out expr="100 / sa" format="%.0f×"></t-out> and B never past
    <t-out expr="100 / sb" format="%.0f×"></t-out>.</p>
  <t-let name="speedA" expr="1 / (sa / 100 + (1 - sa / 100) / cores)"></t-let>
  <t-let name="speedB" expr="1 / (sb / 100 + (1 - sb / 100) / cores)"></t-let>
  <t-math display>
    S_A = \frac{1}{\tangle{sa} + \dfrac{1 - \tangle{sa}}{\tangle{cores}}} = \val[%.1f]{speedA}\mathord{\times}
  </t-math>
  <t-math display>
    S_B = \frac{1}{\tangle{sb} + \dfrac{1 - \tangle{sb}}{\tangle{cores}}} = \val[%.1f]{speedB}\mathord{\times}
  </t-math>
  <t-obsplot>
    <script type="text/plain">
    {
      height: 300,
      marginRight: 40,
      x: { type: "log", domain: [1, 1024], label: "Cores", ticks: [1, 4, 16, 64, 256, 1024], tickFormat: "," },
      y: { domain: [0, Math.min(1024, 1.15 * Math.max(100 / sa, 100 / sb, cores))], grid: true, label: "Speedup", clamp: true },
      marks: [
        // Perfect scaling, for reference: N cores, N times faster.
        Plot.line([1, 1024], { x: (n) => n, y: (n) => n, stroke: "currentColor", strokeOpacity: 0.3, strokeDasharray: "4 4", clip: true }),
        Plot.ruleY([100 / sa], { stroke: "var(--a)", strokeOpacity: 0.5, strokeDasharray: "2 3" }),
        Plot.ruleY([100 / sb], { stroke: "var(--b)", strokeOpacity: 0.5, strokeDasharray: "2 3" }),
        Plot.ruleX([cores], { stroke: "currentColor", strokeOpacity: 0.2 }),
        ...[["a", sa], ["b", sb]].flatMap(([key, s]) => {
          const speedup = (n) => 1 / (s / 100 + (1 - s / 100) / n);
          return [
            Plot.line(d3.range(0, 10.001, 0.05).map((k) => 2 ** k), { x: (n) => n, y: speedup, stroke: `var(--${key})`, strokeWidth: 2.5 }),
            Plot.dot([cores], { x: (n) => n, y: speedup, fill: `var(--${key})`, r: 5 }),
            Plot.text([1024], { x: (n) => n, y: speedup, text: () => key.toUpperCase(), dx: 12, fill: `var(--${key})`, fontWeight: 600 }),
          ];
        }),
      ]
    }
    </script>
  </t-obsplot>
</t-scope>

<style data-show-source>
  .amdahl { --a: light-dark(#246bce, #75a7ff); --b: light-dark(#b45b1b, #ffad66); }
  .amdahl .a { color: var(--a); font-weight: 600; }
  .amdahl .b { color: var(--b); font-weight: 600; }
</style>

## Things to try

- **Take the serial part away.** Set A's syncing to 0%, and its line runs along the dashed
  diagonal: N cores, N times faster. Now nudge it to 0.5%. Over the first few dozen cores almost
  nothing changes, and then the line bends over.
- **Find the ceiling.** With a fraction *s* of serial work, the speedup can never pass 1/*s*,
  the dotted line. At 5% that's 20×, whether you have 64 cores or a million.
- **Count what the cores buy.** Put B at 10% and drag the cores from 16 to 1,024. That's 64
  times the hardware for about 1.5 times the speed.
- **Compare small differences.** 1% and 2% sound alike. Drag the cores past 100 and look how
  far apart they end up.

## How it's built

- **No script.** Everything on this page is markup: two [`<t-num>`](t-num.md)s for the serial
  fractions, one for the cores, and a [`<t-let>`](t-let.md) per program for its speedup.
- **The formula is a view.** The [`<t-math>`](t-math.md) formulas use the same variables with
  `\tangle{}`, so dragging inside the formula moves the numbers in the text and the chart.
  The colors come from the `color` attribute of each `<t-num>`.
- **The chart is an expression.** The [`<t-obsplot>`](t-obsplot.md) reads `sa`, `sb` and
  `cores`, so it redraws when any of them changes. The y-axis grows to fit the ceilings, and
  the curves, ceilings and dots for A and B are made by one `flatMap`.
- **Wide ranges.** `cores` goes from 1 to 1,024, so its `pixels-per-step` is 1. Hold
  **Shift** with the arrow keys to step by 10.

Ported from the `TangleSlider` demo in [wigglystuff](https://github.com/koaning/wigglystuff).
