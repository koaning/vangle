# The winner's curse

There's a bucket of coins on the table, and it's up for auction. Nobody knows exactly what it's
worth. Everyone squints, makes a guess, and bids what they guessed. On average the guesses are
right. The trouble is who wins: whoever guessed highest, and the highest guess is usually too
high. So the winner tends to overpay. That's the winner's curse.

## One auction

<div class="example curse" data-show-source>
  <t-var name="seed" value="1"></t-var>
  <p>The bucket is worth <t-num name="V" min="50" max="500" step="10" format="$%d">100</t-num>.
    Each of <t-num name="n" min="2" max="100">8</t-num> bidders guesses it with an error of about
    <t-num name="sigma" min="0" max="60" format="$%d">20</t-num>, either way. The
    <span class="winner">winner</span> bid <t-out expr="top" format="$%d"></t-out>, so they
    <t-out expr="top >= V ? `overpaid by $${Math.round(top - V)}` : `got it $${Math.round(V - top)} below its value`"></t-out>.</p>
  <t-let name="bids" expr="guesses(V, sigma, n, seed)"></t-let>
  <t-let name="top" expr="Math.max(...bids)"></t-let>
  <!-- The charts span 3 noise-widths below the true value to 4 above, so they zoom with sigma. -->
  <t-let name="range" expr="[V - 3 * Math.max(sigma, 5), V + 4 * Math.max(sigma, 5)]"></t-let>
  <t-obsplot>
    <script type="text/plain">
    {
      height: 160,
      marginTop: 24,
      marginBottom: 40,
      x: { domain: range, label: "Bid ($)", labelAnchor: "center", labelArrow: "none" },
      y: { axis: null, domain: [0, 1] },
      marks: [
        Plot.ruleX([V], { strokeWidth: 2 }),
        Plot.text([V], { x: (v) => v, text: () => "true value", frameAnchor: "top", dy: -14 }),
        // Each bid gets a fixed height of its own (golden-ratio steps), and the winner is drawn last.
        Plot.dot(bids.map((bid, i) => ({ bid, y: 0.05 + 0.9 * ((i * 0.618034) % 1), winner: i === bids.indexOf(top) }))
          .sort((p, q) => p.winner - q.winner), {
          x: "bid",
          y: "y",
          r: n > 40 ? 4 : 6,
          fill: (d) => (d.winner ? "var(--winner)" : "var(--tangle-accent)"),
          fillOpacity: 0.8
        })
      ]
    }
    </script>
  </t-obsplot>
  <button type="button" id="reroll">Another auction</button>
</div>

<script type="module" data-show-source>
  import { registerFunction, scopeOf } from "../tangle.js";

  // mulberry32, a small seeded random number generator: the same seed gives the same auctions.
  function random(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A standard normal number, by the Box–Muller transform.
  const normal = (rand) => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

  // The n guesses in auction number `run`: the true value plus noise. Each auction has its own
  // stream of random numbers, so one more bidder keeps the other guesses.
  function guesses(V, sigma, n, seed, run = 0) {
    const rand = random(seed * 100003 + run);
    return Array.from({ length: n }, () => V + sigma * normal(rand));
  }

  // The winning bid of each of `runs` auctions: the same guesses, without building the arrays.
  function auctions(V, sigma, n, runs, seed) {
    const wins = new Array(runs);
    for (let run = 0; run < runs; run++) {
      const rand = random(seed * 100003 + run);
      let top = -Infinity;
      for (let i = 0; i < n; i++) top = Math.max(top, normal(rand));
      wins[run] = V + sigma * top;
    }
    return wins;
  }

  // The average overpayment for every crowd size from 2 to `most` bidders, in one pass. Auction
  // `run` starts with the same guesses for any n, so its winner with one more bidder is the
  // larger of its winner so far and one more guess. The true value cancels out.
  function overpayments(sigma, most, runs, seed) {
    const totals = new Array(most + 1).fill(0);
    for (let run = 0; run < runs; run++) {
      const rand = random(seed * 100003 + run);
      let top = -Infinity;
      for (let n = 1; n <= most; n++) {
        top = Math.max(top, normal(rand));
        totals[n] += top;
      }
    }
    return totals.slice(2).map((total, i) => ({ n: i + 2, overpay: sigma * total / runs }));
  }

  // How many σ the largest of n standard normal guesses lands above the mean, by Blom's
  // approximation a_n ≈ Φ⁻¹((n − 0.375) / (n + 0.25)). Φ⁻¹ uses Winitzki's formula for erf⁻¹.
  function topGap(n) {
    const x = 2 * (n - 0.375) / (n + 0.25) - 1;
    const a = 0.147, l = Math.log(1 - x * x), k = 2 / (Math.PI * a) + l / 2;
    return Math.SQRT2 * Math.sqrt(Math.sqrt(k * k - l / a) - k);
  }

  registerFunction("guesses", guesses);
  registerFunction("auctions", auctions);
  registerFunction("overpayments", overpayments);
  registerFunction("topGap", topGap);
  registerFunction("mean", (xs) => xs.reduce((sum, x) => sum + x, 0) / xs.length);

  // Every auction on the page draws from `seed`, so a new seed reruns them all.
  const scope = scopeOf(document.body);
  document.querySelector("#reroll").addEventListener("click", () => scope.set("seed", scope.peek("seed") + 1));
</script>

<style data-show-source>
  .curse { --winner: light-dark(#b45b1b, #ffad66); }
  .curse .winner { color: var(--winner); font-weight: 600; }
</style>

Almost every time, the winner sits to the right of the true value. Click **Another auction** a
few times. Now and then the winner gets a bargain, but not often.

## Repeat it

One auction is an anecdote. Here are a few thousand of them, with the same bucket, the same
bidders and the same amount of noise.

<div class="example curse" data-show-source>
  <p>Across <t-num name="runs" min="100" max="10000" step="100" format="%,d">2000</t-num>
    auctions, each with <t-num name="n"></t-num> bidders and an error of
    <t-num name="sigma"></t-num>, the winner paid <t-out expr="mean(wins)" format="$%d"></t-out> on
    average, <t-out expr="mean(wins) - V" format="$%d"></t-out> more than the bucket is worth.
    Only <t-out expr="wins.filter((w) => w < V).length / wins.length" format="percent"></t-out>
    of the winners paid less than it's worth.</p>
  <t-let name="wins" expr="auctions(V, sigma, n, runs, seed)"></t-let>
  <t-obsplot>
    <script type="text/plain">
    {
      height: 240,
      marginBottom: 40,
      x: { domain: range, label: "Winning bid ($)", labelAnchor: "center", labelArrow: "none" },
      y: { grid: true, label: "Auctions" },
      marks: [
        Plot.rectY(wins, Plot.binX({ y: "count" }, {
          x: (w) => w,
          thresholds: d3.range(range[0], range[1], (range[1] - range[0]) / 70),
          fill: "var(--tangle-accent)",
          fillOpacity: 0.7
        })),
        Plot.ruleY([0]),
        Plot.ruleX([V], { strokeWidth: 2 }),
        Plot.ruleX([mean(wins)], { stroke: "var(--winner)", strokeWidth: 2, strokeDasharray: "4 3" })
      ]
    }
    </script>
  </t-obsplot>
</div>

The solid line is the true value, and the dashed one the average winning bid. Drag the bidders and
the noise, and watch the gap between them.

## More bidders, worse curse

With more bidders, the highest guess comes from further out in the tail. So the curse grows with
the crowd.

<div class="example curse" data-show-source>
  <p>With <t-num name="n"></t-num> bidders and an error of <t-num name="sigma"></t-num>, the
    winner overpays by <t-out expr="naive[n - 2].overpay" format="$%.1f"></t-out> on average.
    With 2 bidders it's <t-out expr="naive[0].overpay" format="$%.1f"></t-out>, and with 100
    it's <t-out expr="naive.at(-1).overpay" format="$%.1f"></t-out>.</p>
  <t-let name="naive" expr="overpayments(sigma, 100, runs, seed)"></t-let>
  <t-obsplot>
    <script type="text/plain">
    {
      height: 240,
      marginBottom: 40,
      x: { domain: [2, 100], label: "Bidders", labelAnchor: "center", labelArrow: "none" },
      y: { grid: true, label: "Average overpayment ($)" },
      marks: [
        Plot.ruleY([0]),
        Plot.line(naive, { x: "n", y: "overpay", stroke: "var(--winner)", strokeWidth: 2.5 }),
        Plot.dot([naive[n - 2]], { x: "n", y: "overpay", fill: "var(--winner)", r: 5 })
      ]
    }
    </script>
  </t-obsplot>
</div>

The true value doesn't matter: drag it, and this chart stays put. The overpayment is the noise
times a number that depends only on how many people bid.

## The cure: shave your bid

If you win, you probably held the highest of the guesses. For *n* guesses with noise *σ*
around the true value *V*, the highest one is on average

<div class="example curse" data-show-source>
  <t-math display>
    \mathbb{E}\Big[\max_i x_i\Big] = \tangle[V]{V} + \tangle[\sigma]{sigma}\, a_{\tangle[n]{n}}
    = \val[$%d]{V + sigma * topGap(n)},
    \qquad a_n \approx \Phi^{-1}\!\left(\frac{n - 0.375}{n + 0.25}\right) = \val[%.2f]{topGap(n)}
  </t-math>
  <p>So bid your guess minus your noise times <i>a<sub>n</sub></i>. If you think the noise is
    <t-num name="sighat" min="0" max="60" format="$%d">20</t-num> (it's really
    <t-num name="sigma"></t-num>), shave
    <t-out expr="sighat * topGap(n)" format="$%d"></t-out> off your guess. Then the winner of an
    auction with <t-num name="n"></t-num> bidders
    <t-out expr="cured[n - 2].overpay >= 0 ? `still overpays by $${cured[n - 2].overpay.toFixed(1)}` : `comes out $${(-cured[n - 2].overpay).toFixed(1)} ahead`"></t-out>
    on average.</p>
  <t-let name="cured" expr="naive.map(({ n, overpay }) => ({ n, overpay: overpay - sighat * topGap(n) }))"></t-let>
  <t-obsplot>
    <script type="text/plain">
    {
      height: 240,
      marginRight: 80,
      marginBottom: 40,
      x: { domain: [2, 100], label: "Bidders", labelAnchor: "center", labelArrow: "none" },
      y: { grid: true, label: "Average overpayment ($)" },
      marks: [
        Plot.ruleY([0]),
        ...[[naive, "var(--winner)", "full guess"], [cured, "var(--tangle-accent)", "shaved"]].flatMap(([rows, color, label]) => [
          Plot.line(rows, { x: "n", y: "overpay", stroke: color, strokeWidth: 2.5 }),
          Plot.dot([rows[n - 2]], { x: "n", y: "overpay", fill: color, r: 5 }),
          Plot.text([rows.at(-1)], { x: "n", y: "overpay", text: () => label, fill: color, dx: 8, textAnchor: "start" })
        ])
      ]
    }
    </script>
  </t-obsplot>
</div>

The approximation for *a<sub>n</sub>* is
[Blom's formula](https://en.wikipedia.org/wiki/Order_statistic) for normal order statistics.

## Things to try

- **Get the noise right.** Set your guess of the noise to the real one. The shaved line lies
  flat on zero for every crowd size: the curse is gone.
- **Underestimate it.** Halve your guess of the noise. The curse comes back, smaller, and it
  still grows with the crowd.
- **Take the noise away.** With an error of $0, everyone bids the true value, and nobody
  overpays.
- **Rerun.** Click **Another auction** in the first section. All four sections draw from the
  same seed, so they all change. The single auction jumps around, while the thousands barely
  move. With only 100 auctions, the histogram and the curves get noisy.
- **Pack the room.** Drag the bidders up to 100. The winner's guess comes from far out in the
  tail, and the dots crowd against the right of the chart.

## How it's built

- **No scope, one set of variables.** The sections are separate examples with prose in between,
  so the variables live in the page-wide scope instead of a [`<t-scope>`](t-scope.md). `n`,
  `sigma` and `V` are declared once, by the [`<t-num>`](t-num.md)s in the first section. Later
  sections show them again with an empty `<t-num name="n">`, which is a second view of the same
  variable.
- **The script registers five functions.** `guesses`, `auctions`, `overpayments`, `topGap` and
  `mean` are
  [registered](expressions.md#functions) so the expressions can call them. The
  [`<t-let>`](t-let.md)s and charts don't need to wait: an expression that ran before
  registration runs again once the function exists.
- **Seeded randomness.** Every auction draws from `seed`, so dragging a number reruns the same
  auctions with new settings instead of new random ones. That's why the curves are smooth.
  The button just adds one to `seed`.
- **One pass for every crowd size.** Auction number `run` always starts with the same guesses,
  so `overpayments` deals out 100 guesses per auction and keeps a running maximum. That's the
  winner for 2 bidders, then 3, and so on up to 100, without rerunning anything.
- **The cure costs nothing to compute.** Shaving every bid by the same amount lowers the
  winning bid by that amount, so `cured` is `naive` minus the discount. Dragging `sighat`
  doesn't rerun a single auction.

Ported from the winner's curse demo in [wigglystuff](https://github.com/koaning/wigglystuff).
