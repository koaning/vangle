# Coaster nausea

RollerCoaster Tycoon 2 rates every ride on intensity and nausea. Do intense rides make guests
sick? Here are 142 coasters from 31 parks, loaded live from
[datasette.exe.xyz](https://datasette.exe.xyz/rtc_rides/rides).

## One bad row

<div class="example coasters" data-show-source>
  <p>With all 142 rides as they come, intensity and nausea have a correlation of only
    <t-out expr="raw.r" format="%.2f"></t-out>. One ride is to blame: a
    <span class="odd">Hypercoaster</span> with an intensity of 44.94, while every other ride stays
    under 10. With that ride
    <t-choice name="outlier" options="kept:keep, read as 4.49:fix, dropped:drop">kept</t-choice>,
    the correlation is <t-out expr="line.r" format="%.2f"></t-out>, and each point of intensity adds
    <t-out expr="line.slope" format="%.2f"></t-out> points of nausea.</p>
  <t-fetch name="rides" url="https://datasette.exe.xyz/rtc_rides/-/query.json"
    params="{ sql: 'select id, theme, rollercoaster_type as type, intensity, nausea from rides', _shape: 'array' }"></t-fetch>
  <t-let name="rows" expr="clean(rides ?? [], outlier)"></t-let>
  <t-let name="raw" expr="fit(clean(rides ?? [], 'keep'))"></t-let>
  <t-let name="line" expr="fit(rows)"></t-let>
  <t-let name="xMax" expr="outlier === 'keep' ? 46 : 10"></t-let>
  <t-obsplot>
    <script type="text/plain">
    {
      height: 280,
      marginBottom: 40,
      x: { domain: [0, xMax], label: "Intensity", labelAnchor: "center", labelArrow: "none" },
      y: { domain: [0, 10], grid: true, label: "Nausea" },
      marks: [
        Plot.line([0, xMax], { x: (x) => x, y: (x) => line.intercept + line.slope * x, stroke: "currentColor", strokeOpacity: 0.5, strokeDasharray: "4 3" }),
        Plot.dot(rows, {
          x: "intensity",
          y: "nausea",
          r: (d) => (d.odd ? 6 : 3.5),
          fill: (d) => (d.odd ? "var(--pop)" : "var(--tangle-accent)"),
          fillOpacity: 0.75
        }),
        Plot.tip(rows, Plot.pointer({ x: "intensity", y: "nausea", title: (d) => `${d.type} at ${d.theme}\nintensity ${d.intensity}, nausea ${d.nausea}` }))
      ]
    }
    </script>
  </t-obsplot>
</div>

<style data-show-source>
  .coasters { --pop: light-dark(#b45b1b, #ffad66); }
  .coasters .odd { color: var(--pop); font-weight: 600; }
</style>

A least-squares line can't ignore a point that far out, so it flattens to reach it, and the other
141 rides barely count. The value is almost certainly a slipped decimal point. The game files the
ride under "Medium" intensity, and the other Medium rides run from 2.56 to 5.05, so 4.494 fits
right in.

## The trend, and how loose it is

<div class="example coasters" data-show-source>
  <t-math display>
    \text{nausea} \approx \val[%.2f]{line.slope} \times \tangle{level} \val[%+.2f]{line.intercept}
    = \val[%.2f]{line.slope * level + line.intercept}
  </t-math>
  <p>A ride with an intensity of
    <t-num name="level" min="1.5" max="9.5" step="0.1">7</t-num> should come out at a nausea of about
    <t-out expr="line.slope * level + line.intercept" format="%.1f"></t-out>. The
    <t-out expr="near.length"></t-out> real rides within half a point of that intensity range from
    <t-out expr="Math.min(...near.map((d) => d.nausea))" format="%.1f"></t-out> to
    <t-out expr="Math.max(...near.map((d) => d.nausea))" format="%.1f"></t-out>.</p>
  <t-let name="near" expr="rows.filter((d) => Math.abs(d.intensity - level) <= 0.5)"></t-let>
  <t-obsplot>
    <script type="text/plain">
    {
      height: 280,
      marginBottom: 40,
      x: { domain: [1, 10], label: "Intensity", labelAnchor: "center", labelArrow: "none" },
      y: { domain: [0, 10], grid: true, label: "Nausea" },
      marks: [
        Plot.rect([level], { x1: (x) => x - 0.5, x2: (x) => x + 0.5, y1: 0, y2: 10, fill: "currentColor", fillOpacity: 0.07 }),
        Plot.line([1, 10], { x: (x) => x, y: (x) => line.intercept + line.slope * x, stroke: "currentColor", strokeOpacity: 0.5, strokeDasharray: "4 3" }),
        Plot.dot(rows, {
          x: "intensity",
          y: "nausea",
          r: 3.5,
          fill: "var(--tangle-accent)",
          fillOpacity: (d) => (Math.abs(d.intensity - level) <= 0.5 ? 0.9 : 0.2)
        }),
        Plot.dot([level], { x: (x) => x, y: (x) => line.intercept + line.slope * x, r: 6, stroke: "var(--pop)", strokeWidth: 2.5 }),
        Plot.tip(rows, Plot.pointer({ x: "intensity", y: "nausea", title: (d) => `${d.type} at ${d.theme}\nintensity ${d.intensity}, nausea ${d.nausea}` }))
      ]
    }
    </script>
  </t-obsplot>
</div>

The ring is the line's guess, and the shaded strip holds the rides near that intensity. Intensity
explains <t-out expr="line.r ** 2" format="percent"></t-out> of the variation in nausea, and the
strip shows the rest: at an intensity of 7, two rides can be four points of nausea apart. So
intense rides do tend to be nauseating, but intensity alone won't tell you how sick a ride makes
its guests.

## How it's built

- **The data comes from a [`<t-fetch>`](t-fetch.md).** It sends one SQL query to
  [datasette](https://datasette.exe.xyz/rtc_rides/rides)'s JSON API, where `_shape: 'array'` asks for
  a plain array of rows, and puts the answer in `rides`. Until it arrives, `rides ?? []` gives the
  expressions an empty array, and the numbers show `–`.
- **No scope, one set of variables.** Both sections use the page-wide variables, so the choice in
  the first one feeds `rows` and `line` in the second.
- **Two registered functions.** `clean` applies the choice to the broken row, and `fit` is a
  least-squares line with its correlation. Everything else is a [`<t-let>`](t-let.md) or a
  chart expression.

<script type="module" data-show-source>
  import { registerFunction } from "../tangle.js";

  // Ride 142, a Hypercoaster, has an intensity of 44.94: kept as it is, read as 4.494, or left out.
  registerFunction("clean", (rides, outlier) => rides.flatMap((d) => {
    if (d.id !== 142) return [d];
    if (outlier === "drop") return [];
    return [{ ...d, odd: true, intensity: outlier === "fix" ? d.intensity / 10 : d.intensity }];
  }));

  // The least-squares line of nausea on intensity, and their correlation. NaN for no rows.
  registerFunction("fit", (rows) => {
    const n = rows.length;
    const mx = rows.reduce((sum, d) => sum + d.intensity, 0) / n;
    const my = rows.reduce((sum, d) => sum + d.nausea, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (const d of rows) {
      sxy += (d.intensity - mx) * (d.nausea - my);
      sxx += (d.intensity - mx) ** 2;
      syy += (d.nausea - my) ** 2;
    }
    const slope = sxy / sxx;
    return { slope, intercept: my - slope * mx, r: sxy / Math.sqrt(sxx * syy) };
  });
</script>
