# Title: the question, in a few words

One paragraph: what the data is, where it comes from (link it), and the question this notebook
answers.

## First section: the headline

<div class="example slug" data-show-source>
  <p>A sentence with live numbers: across <t-out expr="(rows ?? []).length"></t-out> rows, …
    <t-choice name="mode" options="first option:a, second option:b">first option</t-choice> …
    <t-out expr="summary.value" format="%.2f"></t-out>.</p>
  <t-fetch name="rows" url="https://datasette.exe.xyz/some_db/-/query.json"
    params="{ sql: 'select name, x, y from some_table', _shape: 'array' }"></t-fetch>
  <t-let name="summary" expr="summarize(rows ?? [], mode)"></t-let>
  <t-obsplot>
    <script type="text/plain">
    {
      height: 280,
      marginBottom: 40,
      x: { domain: [0, 10], label: "X", labelAnchor: "center", labelArrow: "none" },
      y: { domain: [0, 10], grid: true, label: "Y" },
      marks: [
        Plot.dot(rows ?? [], { x: "x", y: "y", r: 3.5, fill: "var(--tangle-accent)", fillOpacity: 0.75 }),
        Plot.tip(rows ?? [], Plot.pointer({ x: "x", y: "y", title: (d) => d.name }))
      ]
    }
    </script>
  </t-obsplot>
</div>

<style data-show-source>
  .slug { --pop: light-dark(#b45b1b, #ffad66); }
</style>

A plain paragraph about what the chart shows.

## Second section: the nuance

<div class="example slug" data-show-source>
  <p>A ride with <t-num name="level" min="0" max="10" step="0.1">5</t-num> … gives
    <t-out expr="level * 2" format="%.1f"></t-out>.</p>
</div>

What it means, in a sentence or two.

## How it's built

- **The data comes from a [`<t-fetch>`](t-fetch.md)** …
- **Registered functions:** what each one is for.

<script type="module" data-show-source>
  import { registerFunction } from "../tangle.js";

  // Why this function exists, not what it does line by line.
  registerFunction("summarize", (rows, mode) => ({ value: rows.length ? rows.reduce((sum, d) => sum + d.y, 0) / rows.length : NaN }));
</script>
