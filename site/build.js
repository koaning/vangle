// Builds docs/*.html from docs/*.md. Run it with `make docs`.
//
// The Markdown is the source of truth: it's what LLMs read (see llms.txt). The
// generated HTML is gitignored; the Pages workflow builds and publishes it.
//
// The converter covers the subset the docs use, with CommonMark's rules for
// raw HTML so live examples pass through untouched:
// - ATX headings, with an optional {#id} suffix
// - paragraphs, `-` and `1.` lists (items may hold code blocks), pipe tables
// - fenced code blocks, which site.js highlights by their language-* class
// - raw HTML blocks: <script>, <style> and <pre> run to their closing tag,
//   other blocks to the next blank line
// - inline `code`, **strong**, *em*, [links](x.md) and raw inline HTML
// Links to x.md become x.html, so the Markdown pages link to each other.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const NAV = [
  ["Guide", [
    ["index", "Getting started"],
    ["expressions", "Expressions &amp; formats"],
    ["charts", "Updating a chart"],
    ["custom-elements", "Your own elements"],
    ["blogging", "Using it on a blog"],
  ]],
  ["Elements", [
    ["t-num", "<code>&lt;t-num&gt;</code>"],
    ["t-var", "<code>&lt;t-var&gt;</code>"],
    ["t-let", "<code>&lt;t-let&gt;</code>"],
    ["t-out", "<code>&lt;t-out&gt;</code>"],
    ["t-choice", "<code>&lt;t-choice&gt;</code>"],
    ["t-math", "<code>&lt;t-math&gt;</code>"],
    ["t-vega", "<code>&lt;t-vega&gt;</code>"],
    ["t-scope", "<code>&lt;t-scope&gt;</code>"],
    ["t-panel", "<code>&lt;t-panel&gt;</code>"],
  ]],
  ["Gallery", [
    ["gallery-matrix", "Matrix transformations"],
  ]],
  ["Reference", [
    ["javascript", "JavaScript API"],
    ["styling", "Styling"],
  ]],
];

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

const ATTR = String.raw`\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>\x60]+))?`;
const OPEN_TAG = String.raw`<[A-Za-z][\w-]*(?:${ATTR})*\s*\/?>`;
const CLOSE_TAG = String.raw`<\/[A-Za-z][\w-]*\s*>`;
const INLINE_HTML = new RegExp(String.raw`<!--[\s\S]*?-->|${OPEN_TAG}|${CLOSE_TAG}`, "g");

// CommonMark HTML blocks: type 1 ends at its closing tag, type 6 (block-level
// tag names) at a blank line and may interrupt a paragraph, and type 7 (a line
// that is a single tag, such as <t-scope>) at a blank line but may not.
const RAW_UNTIL_CLOSE = /^ {0,3}<(script|pre|style|textarea)(?=[\s>]|$)/i;
const RAW_BLOCK_TAG = /^ {0,3}<\/?(?:address|article|aside|blockquote|details|dialog|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)(?=[\s/>]|$)/i;
const RAW_LONE_TAG = new RegExp(String.raw`^ {0,3}(?:${OPEN_TAG}|${CLOSE_TAG})\s*$`);

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+\{#([\w-]+)\})?\s*$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([\w-]*)\s*$/;
const ITEM = /^( {0,3})([-*]|\d+\.)( +|$)/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function href(url) {
  return /^[a-z][\w+.-]*:|^\//i.test(url) ? url : url.replace(/\.md(?=$|[#?])/, ".html");
}

export function inline(src) {
  const stash = [];
  const keep = (html) => `\0${stash.push(html) - 1}\0`;
  let s = src
    .replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, ticks, code) => keep(`<code>${esc(code.replace(/^ (.*) $/s, "$1"))}</code>`))
    .replace(INLINE_HTML, keep)
    .replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, keep)
    .replace(/\\([!-/:-@[-`{-~])/g, (_, c) => keep(esc(c)));
  s = esc(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => `<a href="${href(url)}">${text}</a>`)
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(?=[^\s*])([\s\S]*?[^\s*])\*/g, "<em>$1</em>");
  return s.replace(/\0(\d+)\0/g, (_, i) => stash[i]);
}

function cells(row) {
  return row.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => inline(c.trim()));
}

function table(lines) {
  const [head, , ...rows] = lines;
  const tr = (row, tag) => `<tr>${cells(row).map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;
  return [
    "<table>",
    `<thead>${tr(head, "th")}</thead>`,
    "<tbody>",
    ...rows.map((row) => tr(row, "td")),
    "</tbody>",
    "</table>",
  ].join("\n");
}

function list(lines, i) {
  const ordered = /\d/.test(lines[i].match(ITEM)[2]);
  const items = [];
  let tight = true;
  let blank = false;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(ITEM);
    if (m && (!items.length || m[1].length < items.at(-1).indent)) {
      if (blank && items.length) tight = false;
      items.push({ indent: m[0].length, lines: [line.slice(m[0].length)] });
    } else if (!line.trim()) {
      items.at(-1).lines.push("");
    } else if (line.match(/^ */)[0].length >= items.at(-1).indent) {
      if (blank) tight = false;
      items.at(-1).lines.push(line.slice(items.at(-1).indent));
    } else if (!blank && !blockStart(line)) {
      items.at(-1).lines.push(line.trim()); // lazy continuation of a paragraph
    } else break;
    blank = !line.trim();
  }
  const tag = ordered ? "ol" : "ul";
  const html = items.map((item) => `<li>${blocks(item.lines.join("\n").trimEnd(), tight)}</li>`);
  return [`<${tag}>\n${html.join("\n")}\n</${tag}>`, i];
}

function blockStart(line) {
  return HEADING.test(line) || FENCE.test(line) || ITEM.test(line) || RAW_UNTIL_CLOSE.test(line) || RAW_BLOCK_TAG.test(line);
}

// Converts Markdown to HTML. In a tight list item, paragraphs aren't wrapped.
export function blocks(src, tight = false) {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) {
      i++;
    } else if ((m = line.match(FENCE))) {
      const end = new RegExp(String.raw`^ {0,3}${m[2][0]}{${m[2].length},}\s*$`);
      const code = [];
      for (i++; i < lines.length && !end.test(lines[i]); i++) {
        code.push(lines[i].replace(new RegExp(`^ {0,${m[1].length}}`), ""));
      }
      i++;
      const lang = m[3] ? ` class="language-${m[3]}"` : "";
      out.push(`<pre><code${lang}>${esc(code.join("\n"))}</code></pre>`);
    } else if ((m = line.match(HEADING))) {
      const n = m[1].length;
      out.push(`<h${n}${m[3] ? ` id="${m[3]}"` : ""}>${inline(m[2])}</h${n}>`);
      i++;
    } else if ((m = line.match(RAW_UNTIL_CLOSE))) {
      const close = new RegExp(`</${m[1]}>`, "i");
      const start = i;
      while (i < lines.length && !close.test(lines[i])) i++;
      out.push(lines.slice(start, ++i).join("\n"));
    } else if (RAW_BLOCK_TAG.test(line) || RAW_LONE_TAG.test(line) || line.startsWith("<!--")) {
      const start = i;
      while (i < lines.length && lines[i].trim()) i++;
      out.push(lines.slice(start, i).join("\n"));
    } else if (line.includes("|") && TABLE_RULE.test(lines[i + 1] ?? "")) {
      const start = i;
      while (i < lines.length && lines[i].includes("|")) i++;
      out.push(table(lines.slice(start, i)));
    } else if (ITEM.test(line)) {
      let html;
      [html, i] = list(lines, i);
      out.push(html);
    } else {
      const text = [];
      while (i < lines.length && lines[i].trim() && (!text.length || !blockStart(lines[i]))) text.push(lines[i++].trim());
      const html = inline(text.join("\n"));
      out.push(tight ? html : `<p>${html}</p>`);
    }
  }
  return out.join("\n");
}

export function page(name, md) {
  const body = blocks(md).replace(/(<\/h1>\n)<p>/, '$1<p class="lede">');
  const title = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)[1].replace(/<[^>]+>/g, "");
  const flat = NAV.flatMap(([, links]) => links);
  const at = flat.findIndex(([slug]) => slug === name);
  const link = ([slug, label], cls, hint) => `<a class="${cls}" href="${slug}.html"><small>${hint}</small>${label}</a>`;
  const nav = NAV.map(
    ([heading, links]) =>
      `<h4>${heading}</h4>\n<ul>\n${links
        .map(([slug, label]) => `<li><a href="${slug}.html"${slug === name ? ' aria-current="page"' : ""}>${label}</a></li>`)
        .join("\n")}\n</ul>`,
  ).join("\n");
  const pager = [
    at > 0 ? link(flat[at - 1], "prev", "Previous") : "",
    at >= 0 && at < flat.length - 1 ? link(flat[at + 1], "next", "Next") : "",
  ].join("");

  return `<!doctype html>
<!-- Generated from ${name}.md by site/build.js. Edit the Markdown, then run \`make docs\`. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · vangle docs</title>
<script>try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch {}</script>
<link rel="alternate" type="text/markdown" href="${name}.md">
<link rel="stylesheet" href="../tangle.css">
<link rel="stylesheet" href="../site/site.css">
<script type="module" src="../tangle.js"></script>
</head>
<body class="docs">
<nav class="docs-nav">
<div class="docs-nav-top">
<a class="brand" href="../index.html">vangle</a>
<button class="theme-toggle" type="button" data-theme-toggle aria-label="Dark mode"></button>
</div>
${nav}
</nav>
<main>
${body}
<div class="pager">${pager}</div>
</main>
<script src="../site/site.js"></script>
</body>
</html>
`;
}

export const DOCS = join(dirname(fileURLToPath(import.meta.url)), "../docs");

// Returns { "name.html": html } for every Markdown page in dir.
export function build(dir = DOCS) {
  const pages = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const name = basename(file, ".md");
    pages[`${name}.html`] = page(name, readFileSync(join(dir, file), "utf8"));
  }
  return pages;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [file, html] of Object.entries(build())) {
    writeFileSync(join(DOCS, file), html);
    console.log(`docs/${file}`);
  }
}
