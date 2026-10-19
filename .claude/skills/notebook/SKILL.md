---
name: notebook
description: Write an explorable vangle notebook, a docs gallery page that explains a question about a dataset (e.g. "how does X relate to Y"), with live numbers, choices and Observable Plot charts. Use when the user asks for a notebook, explainer or interactive page about some data, often from datasette.exe.xyz.
---

# Writing a vangle notebook

A notebook is a gallery page in the docs: one Markdown file, `docs/gallery-<slug>.md`, that
`make docs` turns into `docs/gallery-<slug>.html`. It explains one question with a few live
examples. Besides the page, add it in two places (`make test` checks both):

- the `Gallery` section of `NAV` in `site/build.js`: `["gallery-<slug>", "Title"]`;
- the `## Gallery` list in `llms.txt`: one line saying what the page shows and which elements
  it combines.

Start from [template.md](template.md). `docs/gallery-coaster-nausea.md` is a finished example.

## 1. Find the data

- For datasette.exe.xyz, read `https://datasette.exe.xyz/llms.txt`, then the table's
  `/<db>/<table>.md` for the schema and column notes.
- The page loads rows with a [`<t-fetch>`](../../../docs/t-fetch.md) against the SQL JSON API
  (CORS is open). Use `/<db>/-/query.json` directly, because `/<db>.json?sql=` redirects to it:
  `<t-fetch name="rows" url="https://datasette.exe.xyz/<db>/-/query.json" params="{ sql: 'select …', _shape: 'array' }">`.
  Select only the columns you use, and rename long ones (`rollercoaster_type as type`). SQL
  results are capped at 1,000 rows, so aggregate in SQL for anything bigger.
- Other sources work the same way, as long as they send CORS headers. Check with
  `curl -sI -H "Origin: https://example.com" <url> | grep -i access-control`.

## 2. Find the story before writing

Download the data (`/<db>/<table>.csv?_stream=on`) and explore it in Python first. Look for:

- Outliers and broken rows. One bad row can hide the whole relationship. Show it, and let the
  reader decide what to do with it, rather than silently filtering it.
- Sentinel values such as `-1` for "unknown", and impossible values.
- The headline number, the spread around it, and one confounder, if there is one.

Every number in the prose must come from the data. Compute it in Python, and compute it again
from the page's own functions (step 4). Keep notebooks short: two or three sections unless the user asks for more.

## 3. Write it

Structure: an `#` title, a one-paragraph question, then `##` sections, and a short
`## How it's built` list at the end, like the other gallery pages. Each section is one
`<div class="example <slug>" data-show-source>` with a sentence of live prose, its `<t-let>`s and
a chart, plus a paragraph of plain Markdown after it that says what it shows. Put
`data-show-source` on the `<style>` and `<script>` too, so readers can see the whole page.

Read `llms.txt` and the element pages in `docs/` for details. The parts a notebook uses most:

- `<t-num name min max step format>7</t-num>`: a draggable number in the prose.
- `<t-choice name options="label:value, …">label</t-choice>`: click to cycle. Labels can't
  contain commas or colons. Put the starting option first: the reader clicks forward from it.
- `<t-fetch name url params>`: a variable holding a server's answer. It's `undefined` until then.
- `<t-let name expr>`: derived values and arrays. `<t-out expr format>`: a live number in text.
- `<t-math display>` with `\tangle{x}` and `\val[%.2f]{expr}`: a formula with live values.
  Inside it, write `<` as `&lt;`.
- `<t-obsplot>` with a Plot options object in `<script type="text/plain">`. `name="v"` puts the
  datum under the pointer in `v`. A chart must not read its own `name` variable.

Conventions:

- **Page-wide variables, no `<t-scope>`**, so a choice in one section feeds the later ones.
- **One `<script type="module">` at the end**, importing `registerFunction` from `../tangle.js`,
  that registers small functions (fits, cleaning, grouping) for the expressions. Until the data
  arrives, write `rows ?? []` in expressions. Numbers show `…` or `–` until then, which is fine.
- **Colors:** `var(--tangle-accent)` for the data, plus one highlight color defined in a
  `<style>` block as `light-dark(#b45b1b, #ffad66)`. Text and axes use `currentColor`.
- **Charts:** fixed `domain`s so they don't jump while dragging, `height: 280`,
  `marginBottom: 40`, axis labels with `labelAnchor: "center", labelArrow: "none"`, and a
  `Plot.tip(…, Plot.pointer(…))` naming each point.
- **Show, don't tell.** No "try dragging" or "click the choice" prose: the dotted underline
  already says it's interactive. Describe what the reader sees, not what to do.
- **Prose style:** short sentences, plain words, numbers with a unit or a comparison. Comments in
  the script say why, not what.

## 4. Check it

1. `make docs && make test`.
2. Fetch the exact URL the `<t-fetch>` builds (`URLSearchParams` of the params, in `node -e`) with
   `curl`, and check the rows. Run the registered functions on them in `node` and compare the
   results with your Python numbers.
3. Serve the repo root with `make serve PORT=8080` (8000 is often taken by another workspace's
   server; pick a free port), and give the user `http://localhost:8080/docs/gallery-<slug>.html`.
4. Don't launch a browser (Playwright, Chromium) without asking: even headless, its window pops
   up while the user works. If a visual check is needed, ask first.
