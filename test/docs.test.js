import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DOCS, NAV, blocks, build, inline } from "../site/build.js";

test("committed docs HTML matches the Markdown", () => {
  for (const [file, html] of Object.entries(build())) {
    const committed = readFileSync(join(DOCS, file), "utf8");
    assert.ok(committed === html, `docs/${file} is out of date. Run \`make docs\`.`);
  }
});

test("every page in the nav has Markdown", () => {
  for (const [, links] of NAV) {
    for (const [slug] of links) assert.ok(existsSync(join(DOCS, `${slug}.md`)), `docs/${slug}.md`);
  }
});

test("llms.txt links to every docs page, and only to pages that exist", () => {
  const llms = readFileSync(join(DOCS, "../llms.txt"), "utf8");
  const linked = [...llms.matchAll(/\]\((docs\/[\w-]+\.md)\)/g)].map((m) => m[1]);
  for (const path of linked) assert.ok(existsSync(join(DOCS, "..", path)), path);
  for (const [, links] of NAV) {
    for (const [slug] of links) assert.ok(linked.includes(`docs/${slug}.md`), `llms.txt is missing docs/${slug}.md`);
  }
});

test("inline code is escaped and inline HTML passes through", () => {
  assert.equal(inline("Use `<t-num>` & <kbd>Enter</kbd>"), "Use <code>&lt;t-num&gt;</code> &amp; <kbd>Enter</kbd>");
  assert.equal(inline('<t-out expr="a * b > c">x</t-out>'), '<t-out expr="a * b > c">x</t-out>');
  assert.equal(inline("**bold**, *em* and `**code**`"), "<strong>bold</strong>, <em>em</em> and <code>**code**</code>");
  assert.equal(inline("a \\*literal\\* star &amp; entity"), "a *literal* star &amp; entity");
});

test("links to Markdown pages point at the HTML", () => {
  assert.equal(inline("[a](t-num.md)"), '<a href="t-num.html">a</a>');
  assert.equal(inline("[a](expressions.md#formats)"), '<a href="expressions.html#formats">a</a>');
  assert.equal(inline("[a](#views)"), '<a href="#views">a</a>');
  assert.equal(inline("[a](https://example.com/x.md)"), '<a href="https://example.com/x.md">a</a>');
});

test("headings take an optional id", () => {
  assert.equal(blocks("## Formats {#formats}"), '<h2 id="formats">Formats</h2>');
  assert.equal(blocks("# `<t-num>`"), "<h1><code>&lt;t-num&gt;</code></h1>");
});

test("tables", () => {
  assert.equal(
    blocks("| A | B |\n|---|---|\n| `x` | |"),
    "<table>\n<thead><tr><th>A</th><th>B</th></tr></thead>\n<tbody>\n<tr><td><code>x</code></td><td></td></tr>\n</tbody>\n</table>",
  );
});

test("raw HTML blocks pass through untouched", () => {
  const example = '<t-scope class="example">\n  <p>A *b* <t-num name="x">1</t-num></p>\n</t-scope>';
  assert.equal(blocks(`Text\n\n${example}\n\nMore`), `<p>Text</p>\n${example}\n<p>More</p>`);
  const script = '<script type="module">\n  const a = 1;\n\n  const b = 2;\n</script>';
  assert.equal(blocks(script), script);
});

test("a lone inline tag doesn't interrupt a paragraph, a block tag does", () => {
  assert.equal(blocks("one\n<t-out expr=\"x\"></t-out> two"), '<p>one\n<t-out expr="x"></t-out> two</p>');
  assert.equal(blocks("one\n<div>two</div>"), "<p>one</p>\n<div>two</div>");
});

test("fenced code, also inside a list item", () => {
  assert.equal(blocks("```js\nif (a < b) {}\n```"), '<pre><code class="language-js">if (a &lt; b) {}</code></pre>');
  assert.equal(
    blocks("- one\n- two:\n  ```html\n  <b>x</b>\n  ```\n- three"),
    '<ul>\n<li>one</li>\n<li>two:\n<pre><code class="language-html">&lt;b&gt;x&lt;/b&gt;</code></pre></li>\n<li>three</li>\n</ul>',
  );
});

test("loose lists wrap items in paragraphs", () => {
  assert.equal(blocks("1. one\n\n2. two"), "<ol>\n<li><p>one</p></li>\n<li><p>two</p></li>\n</ol>");
});
