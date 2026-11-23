# A Gaussian mixture, drawn as a DAG

Measure the heights of everyone in a room full of children and their parents, and the histogram
has two bumps. No single bell curve fits that. A *mixture* does: it says each point comes from
one of two groups, each group is a bell curve of its own, and a weight says how many points
each group contributes. Five numbers describe the whole thing: a centre μ and a spread σ for
each group, and the weight w of the first.

Below, those numbers and the three densities they make sit on a [`<t-sketch>`](t-sketch.md)
board, with the arrows of how they depend on each other drawn in by hand. Drag the numbers;
pan and zoom the board.

<t-scope class="example mixture">
  <t-let name="normal" expr="(x, mu, sigma) => Math.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI))"></t-let>
  <t-let name="xs" expr="Array.from({ length: 281 }, (_, i) => -6 + i * 0.05)"></t-let>
  <t-let name="rows" expr="xs.map((x) => {
    const a = (w / 100) * normal(x, mu1, s1);
    const b = (1 - w / 100) * normal(x, mu2, s2);
    return { x, n1: normal(x, mu1, s1), n2: normal(x, mu2, s2), a, b, mix: a + b };
  })"></t-let>
  <p class="caption">The workbench: the same board in edit mode. Move the cards, draw, then press
    <strong>Export</strong> in the palette and paste the result over the board below.</p>
  <t-sketch height="520" label="A Gaussian mixture, drawn as a DAG">
    <p data-x="0" data-y="40" data-width="230"><strong class="g1">Group 1</strong> is centred at μ₁ = <t-num name="mu1" min="-4" max="6" step="0.1" format="%.1f" color="#246bce #75a7ff">0</t-num>, with a spread of σ₁ = <t-num name="s1" min="0.2" max="3" step="0.1" format="%.1f" color="#246bce #75a7ff">1</t-num>.</p>
    <p data-x="0" data-y="340" data-width="230"><strong class="g2">Group 2</strong> is centred at μ₂ = <t-num name="mu2" min="-4" max="6" step="0.1" format="%.1f" color="#b45b1b #ffad66">3</t-num>, with a spread of σ₂ = <t-num name="s2" min="0.2" max="3" step="0.1" format="%.1f" color="#b45b1b #ffad66">0.7</t-num>.</p>
    <figure data-x="320" data-y="0" data-width="330">
      <figcaption>Group 1 alone: N(μ₁, σ₁)</figcaption>
      <t-obsplot>
        <script type="text/plain">
        {
          height: 140, marginLeft: 36, marginBottom: 24,
          x: { domain: [-6, 8], label: null }, y: { label: null, ticks: 3 },
          marks: [
            Plot.areaY(rows, { x: "x", y: "n1", fill: "var(--g1)", fillOpacity: 0.15 }),
            Plot.line(rows, { x: "x", y: "n1", stroke: "var(--g1)", strokeWidth: 2 }),
            Plot.ruleY([0], { stroke: "currentColor", strokeOpacity: 0.3 })
          ]
        }
        </script>
      </t-obsplot>
    </figure>
    <figure data-x="320" data-y="300" data-width="330">
      <figcaption>Group 2 alone: N(μ₂, σ₂)</figcaption>
      <t-obsplot>
        <script type="text/plain">
        {
          height: 140, marginLeft: 36, marginBottom: 24,
          x: { domain: [-6, 8], label: null }, y: { label: null, ticks: 3 },
          marks: [
            Plot.areaY(rows, { x: "x", y: "n2", fill: "var(--g2)", fillOpacity: 0.15 }),
            Plot.line(rows, { x: "x", y: "n2", stroke: "var(--g2)", strokeWidth: 2 }),
            Plot.ruleY([0], { stroke: "currentColor", strokeOpacity: 0.3 })
          ]
        }
        </script>
      </t-obsplot>
    </figure>
    <p data-x="760" data-y="10" data-width="300">A share w = <t-num name="w" min="0" max="100" format="%d%%" color="#147a68 #5ed5bd">40</t-num> of the points comes from group 1, and the rest from group 2.</p>
    <figure data-x="740" data-y="150" data-width="380">
      <figcaption><strong>The mixture</strong>: w · N₁ + (1 − w) · N₂</figcaption>
      <t-obsplot>
        <script type="text/plain">
        {
          height: 220, marginLeft: 36, marginBottom: 24,
          x: { domain: [-6, 8], label: null }, y: { label: null, ticks: 4 },
          marks: [
            Plot.areaY(rows, { x: "x", y: "a", fill: "var(--g1)", fillOpacity: 0.15 }),
            Plot.areaY(rows, { x: "x", y: "b", fill: "var(--g2)", fillOpacity: 0.15 }),
            Plot.line(rows, { x: "x", y: "mix", stroke: "currentColor", strokeWidth: 2.5 }),
            Plot.ruleY([0], { stroke: "currentColor", strokeOpacity: 0.3 })
          ]
        }
        </script>
      </t-obsplot>
    </figure>
    <script type="application/json">{"background":"dots","math":[],"strokes":[{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"B2DF687A-1DB2-449E-B298-D877A1F59374","points":[[240.0,74.0],[245.5,75.8],[251.5,77.6],[257.1,79.5],[262.4,81.1],[268.1,82.2],[274.0,82.8],[280.2,84.2],[285.8,84.1],[292.2,85.1],[298.1,84.6],[304.5,84.0],[310.0,84.0]],"swatch":0,"tool":"pen","width":2.5},{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"4CED60F2-F1AA-45AA-864A-355F11EC2F44","points":[[298.9,90.7],[310,84],[297.8,79.5]],"swatch":0,"tool":"pen","width":2.5},{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"90D54E5D-183D-446C-BAAD-11E4A2BA5DC9","points":[[240.0,374.0],[246.4,373.3],[251.6,373.0],[257.8,373.7],[263.5,373.7],[269.9,374.0],[275.6,374.4],[281.0,375.5],[287.4,376.9],[292.8,378.4],[298.6,379.8],[304.6,382.1],[310.0,384.0]],"swatch":0,"tool":"pen","width":2.5},{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"6CF6E5B1-FE12-4C2F-AE7D-A8B7889E9647","points":[[297.0,384.9],[310,384],[301.2,374.4]],"swatch":0,"tool":"pen","width":2.5},{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"681F79EE-FD09-451B-BB00-7CBEC90FDA3F","points":[[655.0,90.0],[656.4,96.2],[658.4,102.6],[660.4,108.0],[662.6,113.8],[664.0,120.4],[665.9,126.0],[668.0,131.9],[671.1,137.6],[673.6,143.0],[676.0,149.0],[678.5,154.4],[681.5,160.5],[684.0,165.7],[686.5,171.1],[690.1,176.8],[693.4,181.4],[696.2,187.1],[699.2,192.1],[702.8,196.9],[706.2,202.7],[709.9,207.2],[713.9,212.9],[717.4,217.4],[721.9,222.7],[726.2,227.6],[730.0,232.0]],"swatch":0,"tool":"pen","width":2.5},{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"EEAB8642-4A2B-4893-B43B-EB95DC6D8572","points":[[718.0,226.9],[730,232],[726.5,219.5]],"swatch":0,"tool":"pen","width":2.5},{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"A064F2EE-88C4-4403-8ABC-E628B1C353C0","points":[[655.0,385.0],[658.5,379.7],[662.5,375.0],[667.1,369.3],[670.4,364.6],[674.7,360.2],[679.4,355.4],[683.4,351.2],[688.3,347.1],[693.7,343.1],[698.1,339.0],[703.3,334.6],[708.6,331.7],[713.9,328.1],[718.8,324.3],[724.0,321.3],[730.0,318.0]],"swatch":0,"tool":"pen","width":2.5},{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"E2C4B505-C3C9-4803-94F9-101547FF9095","points":[[722.4,328.5],[730,318],[717.0,318.6]],"swatch":0,"tool":"pen","width":2.5},{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"E7AD40BE-4B74-4E45-828D-6191958B8A7B","points":[[905.0,92.0],[904.2,95.7],[904.0,100.0],[903.9,104.1],[903.4,108.3],[903.4,112.7],[903.3,117.4],[903.9,120.8],[903.6,125.2],[903.9,129.1],[904.7,134.2],[904.6,137.8],[905.0,142.0]],"swatch":0,"tool":"pen","width":2.5},{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"E8234DBD-9C33-43CC-B51B-881DC2C0D133","points":[[898.2,130.9],[905,142],[909.5,129.8]],"swatch":0,"tool":"pen","width":2.5}],"version":2}</script>
  </t-sketch>
  <p class="caption">As published: view mode. The numbers and charts work, the ink stays put.</p>
  <t-sketch mode="view" height="520" label="A Gaussian mixture, drawn as a DAG">
    <p data-x="0" data-y="40" data-width="230"><strong class="g1">Group 1</strong> is centred at μ₁ = <t-num name="mu1" min="-4" max="6" step="0.1" format="%.1f" color="#246bce #75a7ff">0</t-num>, with a spread of σ₁ = <t-num name="s1" min="0.2" max="3" step="0.1" format="%.1f" color="#246bce #75a7ff">1</t-num>.</p>
    <p data-x="0" data-y="340" data-width="230"><strong class="g2">Group 2</strong> is centred at μ₂ = <t-num name="mu2" min="-4" max="6" step="0.1" format="%.1f" color="#b45b1b #ffad66">3</t-num>, with a spread of σ₂ = <t-num name="s2" min="0.2" max="3" step="0.1" format="%.1f" color="#b45b1b #ffad66">0.7</t-num>.</p>
    <figure data-x="320" data-y="0" data-width="330">
      <figcaption>Group 1 alone: N(μ₁, σ₁)</figcaption>
      <t-obsplot>
        <script type="text/plain">
        {
          height: 140, marginLeft: 36, marginBottom: 24,
          x: { domain: [-6, 8], label: null }, y: { label: null, ticks: 3 },
          marks: [
            Plot.areaY(rows, { x: "x", y: "n1", fill: "var(--g1)", fillOpacity: 0.15 }),
            Plot.line(rows, { x: "x", y: "n1", stroke: "var(--g1)", strokeWidth: 2 }),
            Plot.ruleY([0], { stroke: "currentColor", strokeOpacity: 0.3 })
          ]
        }
        </script>
      </t-obsplot>
    </figure>
    <figure data-x="320" data-y="300" data-width="330">
      <figcaption>Group 2 alone: N(μ₂, σ₂)</figcaption>
      <t-obsplot>
        <script type="text/plain">
        {
          height: 140, marginLeft: 36, marginBottom: 24,
          x: { domain: [-6, 8], label: null }, y: { label: null, ticks: 3 },
          marks: [
            Plot.areaY(rows, { x: "x", y: "n2", fill: "var(--g2)", fillOpacity: 0.15 }),
            Plot.line(rows, { x: "x", y: "n2", stroke: "var(--g2)", strokeWidth: 2 }),
            Plot.ruleY([0], { stroke: "currentColor", strokeOpacity: 0.3 })
          ]
        }
        </script>
      </t-obsplot>
    </figure>
    <p data-x="760" data-y="10" data-width="300">A share w = <t-num name="w" min="0" max="100" format="%d%%" color="#147a68 #5ed5bd">40</t-num> of the points comes from group 1, and the rest from group 2.</p>
    <figure data-x="740" data-y="150" data-width="380">
      <figcaption><strong>The mixture</strong>: w · N₁ + (1 − w) · N₂</figcaption>
      <t-obsplot>
        <script type="text/plain">
        {
          height: 220, marginLeft: 36, marginBottom: 24,
          x: { domain: [-6, 8], label: null }, y: { label: null, ticks: 4 },
          marks: [
            Plot.areaY(rows, { x: "x", y: "a", fill: "var(--g1)", fillOpacity: 0.15 }),
            Plot.areaY(rows, { x: "x", y: "b", fill: "var(--g2)", fillOpacity: 0.15 }),
            Plot.line(rows, { x: "x", y: "mix", stroke: "currentColor", strokeWidth: 2.5 }),
            Plot.ruleY([0], { stroke: "currentColor", strokeOpacity: 0.3 })
          ]
        }
        </script>
      </t-obsplot>
    </figure>
    <script type="application/json">{"background":"dots","math":[],"strokes":[{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"B2DF687A-1DB2-449E-B298-D877A1F59374","points":[[240.0,74.0],[245.5,75.8],[251.5,77.6],[257.1,79.5],[262.4,81.1],[268.1,82.2],[274.0,82.8],[280.2,84.2],[285.8,84.1],[292.2,85.1],[298.1,84.6],[304.5,84.0],[310.0,84.0]],"swatch":0,"tool":"pen","width":2.5},{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"4CED60F2-F1AA-45AA-864A-355F11EC2F44","points":[[298.9,90.7],[310,84],[297.8,79.5]],"swatch":0,"tool":"pen","width":2.5},{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"90D54E5D-183D-446C-BAAD-11E4A2BA5DC9","points":[[240.0,374.0],[246.4,373.3],[251.6,373.0],[257.8,373.7],[263.5,373.7],[269.9,374.0],[275.6,374.4],[281.0,375.5],[287.4,376.9],[292.8,378.4],[298.6,379.8],[304.6,382.1],[310.0,384.0]],"swatch":0,"tool":"pen","width":2.5},{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"6CF6E5B1-FE12-4C2F-AE7D-A8B7889E9647","points":[[297.0,384.9],[310,384],[301.2,374.4]],"swatch":0,"tool":"pen","width":2.5},{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"681F79EE-FD09-451B-BB00-7CBEC90FDA3F","points":[[655.0,90.0],[656.4,96.2],[658.4,102.6],[660.4,108.0],[662.6,113.8],[664.0,120.4],[665.9,126.0],[668.0,131.9],[671.1,137.6],[673.6,143.0],[676.0,149.0],[678.5,154.4],[681.5,160.5],[684.0,165.7],[686.5,171.1],[690.1,176.8],[693.4,181.4],[696.2,187.1],[699.2,192.1],[702.8,196.9],[706.2,202.7],[709.9,207.2],[713.9,212.9],[717.4,217.4],[721.9,222.7],[726.2,227.6],[730.0,232.0]],"swatch":0,"tool":"pen","width":2.5},{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"EEAB8642-4A2B-4893-B43B-EB95DC6D8572","points":[[718.0,226.9],[730,232],[726.5,219.5]],"swatch":0,"tool":"pen","width":2.5},{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"A064F2EE-88C4-4403-8ABC-E628B1C353C0","points":[[655.0,385.0],[658.5,379.7],[662.5,375.0],[667.1,369.3],[670.4,364.6],[674.7,360.2],[679.4,355.4],[683.4,351.2],[688.3,347.1],[693.7,343.1],[698.1,339.0],[703.3,334.6],[708.6,331.7],[713.9,328.1],[718.8,324.3],[724.0,321.3],[730.0,318.0]],"swatch":0,"tool":"pen","width":2.5},{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"E2C4B505-C3C9-4803-94F9-101547FF9095","points":[[722.4,328.5],[730,318],[717.0,318.6]],"swatch":0,"tool":"pen","width":2.5},{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"E7AD40BE-4B74-4E45-828D-6191958B8A7B","points":[[905.0,92.0],[904.2,95.7],[904.0,100.0],[903.9,104.1],[903.4,108.3],[903.4,112.7],[903.3,117.4],[903.9,120.8],[903.6,125.2],[903.9,129.1],[904.7,134.2],[904.6,137.8],[905.0,142.0]],"swatch":0,"tool":"pen","width":2.5},{"color":{"a":1,"b":0.12,"g":0.11,"r":0.11},"id":"E8234DBD-9C33-43CC-B51B-881DC2C0D133","points":[[898.2,130.9],[905,142],[909.5,129.8]],"swatch":0,"tool":"pen","width":2.5}],"version":2}</script>
  </t-sketch>
</t-scope>

<style>
  .mixture { --g1: light-dark(#246bce, #75a7ff); --g2: light-dark(#b45b1b, #ffad66); }
  .mixture .g1 { color: var(--g1); }
  .mixture .g2 { color: var(--g2); }
  .mixture figcaption { font-size: 0.9em; }
  .mixture .caption { margin: 1.5em 0 0.5em; font-size: 0.9em; opacity: 0.75; }
</style>

## Things to try

- **Read the arrows backwards.** The mixture has two arrows from the groups and one from the
  weight, and nothing else. Every change you make reaches it along one of those three.
- **Merge the bumps.** Drag μ₂ towards μ₁. Somewhere around two spreads apart the dip between
  the bumps disappears, and the mixture looks like one wide bell curve even though it isn't.
- **Starve a group.** Put w at 95%. Group 2 is still there in its own chart, but in the
  mixture it's a ripple on the shoulder of group 1.
- **Make one group narrow.** With σ₂ at 0.2, group 2 is a spike. A narrow group with a small
  weight can still be the tallest thing in the mixture.

## How it's built

- **The cards are children of the board.** Each `<p>` and `<figure>` inside the
  [`<t-sketch>`](t-sketch.md) is a card, placed with `data-x`, `data-y` and `data-width` in board
  coordinates. They're ordinary vangle elements: [`<t-num>`](t-num.md)s for the five numbers
  and [`<t-obsplot>`](t-obsplot.md)s for the densities, reading three
  [`<t-let>`](t-let.md)s outside the board.
- **The DAG is ink.** The arrows were drawn on the board in edit mode,
  with the cards moved into place. **Export** in the palette copied the HTML of a view-only
  board: the cards where they ended up, and the strokes as JSON in a
  `<script type="application/json">`. That's what this page pastes in.
- **View mode** (`mode="view"`) leaves the cards live and the ink still: dragging a number
  drags the number, and dragging the paper pans.
