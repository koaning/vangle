# Amdahl's law

Twice the cores rarely means twice the speed. Most programs have some work that can't be split:
steps that wait for each other, or a sync where every core has to agree. Extra cores only speed up
the rest. A program that spends a fraction *s* of its time on serial work runs
1 / (*s* + (1 − *s*) / *N*) times faster on *N* cores. Drag the numbers to see how much that
serial part costs.

<t-scope class="example amdahl" data-show-source>
  <p>On <t-num name="cores" min="1" max="1024" pixels-per-step="1" format="%,d">16</t-num> cores:</p>
  <ul>
    <li>Program <span class="a">A</span> spends
      <t-num name="sa" min="0" max="50" step="0.5" format="%.1f%%" color="#246bce #75a7ff">1</t-num>
      of its time syncing. It runs <t-out expr="speedA" format="%.1f×"></t-out> faster, and never
      more than <t-out expr="100 / sa" format="%.0f×"></t-out>.</li>
    <li>Program <span class="b">B</span> spends
      <t-num name="sb" min="0" max="50" step="0.5" format="%.1f%%" color="#b45b1b #ffad66">5</t-num>
      of its time syncing. It runs <t-out expr="speedB" format="%.1f×"></t-out> faster, and never
      more than <t-out expr="100 / sb" format="%.0f×"></t-out>.</li>
  </ul>
  <t-let name="speedA" expr="1 / (sa / 100 + (1 - sa / 100) / cores)"></t-let>
  <t-let name="speedB" expr="1 / (sb / 100 + (1 - sb / 100) / cores)"></t-let>
  <!-- Both charts draw the same rows: each program's speedup at 201 core counts from 1 to 1,024. -->
  <t-let name="curves" expr="Array.from({ length: 201 }, (_, i) => 2 ** (i / 20)).flatMap((n) => [
    { n, program: 'A', color: 'var(--a)', speedup: 1 / (sa / 100 + (1 - sa / 100) / n) },
    { n, program: 'B', color: 'var(--b)', speedup: 1 / (sb / 100 + (1 - sb / 100) / n) }
  ])"></t-let>
  <t-let name="now" expr="[{ n: cores, color: 'var(--a)', speedup: speedA }, { n: cores, color: 'var(--b)', speedup: speedB }]"></t-let>
  <t-let name="ceilings" expr="[{ color: 'var(--a)', speedup: 100 / sa }, { color: 'var(--b)', speedup: 100 / sb }]"></t-let>
  <t-let name="speedRange" expr="[0, Math.min(1024, 1.15 * Math.max(100 / sa, 100 / sb))]"></t-let>
  <p class="caption">With the cores on a linear scale, the ceilings take over: past a hundred cores
    or so, both lines are nearly flat.</p>
  <t-obsplot>
    <script type="text/plain">
    {
      height: 240,
      marginRight: 40,
      marginBottom: 40,
      x: { domain: [1, 1024], label: "Cores", labelAnchor: "center", labelArrow: "none", ticks: [1, 128, 256, 384, 512, 640, 768, 896, 1024], tickFormat: (n) => n.toLocaleString("en-US"), grid: true },
      y: { domain: speedRange, grid: true, label: "Speedup" },
      marks: [
        Plot.line(curves, { x: "n", y: "n", z: "program", stroke: "currentColor", strokeOpacity: 0.3, strokeDasharray: "4 4", clip: true }),
        Plot.ruleY(ceilings, { y: "speedup", stroke: (d) => d.color, strokeOpacity: 0.5, strokeDasharray: "2 3" }),
        Plot.ruleX([cores], { stroke: "currentColor", strokeOpacity: 0.2 }),
        Plot.line(curves, { x: "n", y: "speedup", z: "program", stroke: (d) => d.color, strokeWidth: 2.5 }),
        Plot.dot(now, { x: "n", y: "speedup", fill: (d) => d.color, r: 5 }),
        Plot.text(curves.filter((d) => d.n === 1024), { x: "n", y: "speedup", text: "program", fill: (d) => d.color, dx: 12, fontWeight: 600 })
      ]
    }
    </script>
  </t-obsplot>
  <p class="caption">With the cores on a log scale, every step to the right doubles them. That
    spreads out the first few dozen cores, where the two programs part ways.</p>
  <t-obsplot>
    <script type="text/plain">
    {
      height: 240,
      marginRight: 40,
      marginBottom: 40,
      x: { type: "log", base: 2, domain: [1, 1024], label: "Cores (log scale)", labelAnchor: "center", labelArrow: "none", ticks: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024], tickFormat: (n) => n.toLocaleString("en-US"), grid: true },
      y: { domain: speedRange, grid: true, label: "Speedup" },
      marks: [
        Plot.line(curves, { x: "n", y: "n", z: "program", stroke: "currentColor", strokeOpacity: 0.3, strokeDasharray: "4 4", clip: true }),
        Plot.ruleY(ceilings, { y: "speedup", stroke: (d) => d.color, strokeOpacity: 0.5, strokeDasharray: "2 3" }),
        Plot.ruleX([cores], { stroke: "currentColor", strokeOpacity: 0.2 }),
        Plot.line(curves, { x: "n", y: "speedup", z: "program", stroke: (d) => d.color, strokeWidth: 2.5 }),
        Plot.dot(now, { x: "n", y: "speedup", fill: (d) => d.color, r: 5 }),
        Plot.text(curves.filter((d) => d.n === 1024), { x: "n", y: "speedup", text: "program", fill: (d) => d.color, dx: 12, fontWeight: 600 })
      ]
    }
    </script>
  </t-obsplot>
</t-scope>

<style data-show-source>
  .amdahl { --a: light-dark(#246bce, #75a7ff); --b: light-dark(#b45b1b, #ffad66); }
  .amdahl .a { color: var(--a); font-weight: 600; }
  .amdahl .b { color: var(--b); font-weight: 600; }
  .amdahl .caption { margin-bottom: 0; font-size: 0.9em; opacity: 0.75; }
</style>

## Things to try

- **Take the serial part away.** Set A's syncing to 0%, and its line runs along the dashed
  one: N cores, N times faster. Now nudge it to 0.5%. Over the first few dozen cores almost
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
  The colors come from the `color` attribute of each `<t-num>`, and the chart uses the same two.
- **Two charts, one set of rows.** A `<t-let>` computes both programs' speedups at 201 core
  counts, spaced evenly on a log scale. Two [`<t-obsplot>`](t-obsplot.md)s draw those rows, and
  they differ only in their x-axis: linear, or log with a tick at every power of 2. Each chart
  redraws when `sa`, `sb` or `cores` changes. The y-axis fits the ceilings, not the cores, so
  dragging the cores only moves the dots.
- **Wide ranges.** `cores` goes from 1 to 1,024, so its `pixels-per-step` is 1. Hold
  **Shift** with the arrow keys to step by 10.

Ported from the `TangleSlider` demo in [wigglystuff](https://github.com/koaning/wigglystuff).
