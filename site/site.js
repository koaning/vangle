// Helpers for the landing page and docs (not needed to use tangle.js).
//
// Load this as a classic <script> at the end of <body>. Classic scripts run
// before deferred module scripts, so this sees example markup before tangle.js
// upgrades it.
//
// - [data-show-source] on an element appends a panel with its highlighted
//   source (innerHTML for markup, textContent for a <script> or <style>).
//   Use data-show-source="open" to expand the panel.
// - <script type="text/plain" data-lang="html|js|css"> is replaced by a
//   highlighted code block. Write "</script>" inside it as "<\/script>".
// - <nav data-docs-nav> is filled with the docs navigation, and
//   <div data-docs-pager> with previous/next links.
(() => {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const span = (cls, html) => `<span class="hl-${cls}">${html}</span>`;

  function highlightTex(src) {
    return src
      .split(/(\\(?:tangle|val)(?![A-Za-z])|\\[A-Za-z]+|\\.)/)
      .map((part, i) => (i % 2 ? span(/^\\(tangle|val)$/.test(part) ? "marker" : "tex", esc(part)) : esc(part)))
      .join("");
  }

  function highlightAttrs(attrs, tag) {
    return attrs.replace(/(\s+)([\w-]+)(?:(=)"([^"]*)")?/g, (_, ws, name, eq, value) => {
      // The serializer writes boolean attributes as display=""; show them bare.
      if (!eq || value === "") return ws + span("attr", name);
      // Chrome serializes < and > inside attributes as entities; show the original.
      value = value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      const body = tag === "t-math" && name === "tex" ? highlightTex(value) : esc(value);
      return `${ws}${span("attr", name)}${span("punct", "=")}${span("string", `"${body}"`)}`;
    });
  }

  function highlightHtml(src) {
    let inMath = false;
    return src.replace(
      /(<!--[\s\S]*?-->)|(<\/?)([\w-]+)((?:\s+[\w-]+(?:="[^"]*")?)*)(\s*\/?>)|([^<]+)|([\s\S])/g,
      (match, comment, open, tag, attrs, close, text) => {
        if (comment) return span("comment", esc(comment));
        if (text) return inMath ? highlightTex(text) : esc(text);
        if (!tag) return esc(match);
        if (tag === "t-math") inMath = open === "<";
        const cls = tag.startsWith("t-") ? "tangle-tag" : "tag";
        return span("punct", esc(open)) + span(cls, tag) + highlightAttrs(attrs, tag) + span("punct", esc(close));
      },
    );
  }

  function highlightJs(src) {
    return src.replace(
      /(\/\/.*)|("[^"]*"|'[^']*'|`[^`]*`)|\b(import|from|export|const|let|var|function|return|if|else|new|for|of|await|async)\b|\b(\d+(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)(?=\()|([^"'`/\w]+|[\s\S])/g,
      (match, comment, string, keyword, number, call) => {
        if (comment) return span("comment", esc(comment));
        if (string) return span("string", esc(string));
        if (keyword) return span("keyword", keyword);
        if (number) return span("number", number);
        if (call) return span("call", call);
        return esc(match);
      },
    );
  }

  function highlightCss(src) {
    return src.replace(
      /(\/\*[\s\S]*?\*\/)|([^{}\s][^{};]*)(?=\{)|(--[\w-]+|[a-z-]+)(?=\s*:)|("[^"]*")|([\s\S])/g,
      (match, comment, selector, prop, string) => {
        if (comment) return span("comment", esc(comment));
        if (selector) return span("selector", esc(selector));
        if (prop) return span("prop", prop);
        if (string) return span("string", esc(string));
        return esc(match);
      },
    );
  }

  const highlighters = { html: highlightHtml, js: highlightJs, css: highlightCss };

  function dedent(src) {
    const lines = src.replace(/^\s*\n/, "").replace(/\s+$/, "").split("\n");
    const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
    return lines.map((l) => l.slice(indent)).join("\n");
  }

  function codeBlock(src, lang) {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.innerHTML = highlighters[lang](dedent(src));
    pre.append(code);
    return pre;
  }

  for (const el of document.querySelectorAll("[data-show-source]")) {
    const lang = { script: "js", style: "css" }[el.localName] ?? "html";
    const details = document.createElement("details");
    details.className = "source";
    details.open = el.dataset.showSource === "open";
    details.innerHTML = `<summary>${{ js: "script", css: "stylesheet", html: "source" }[lang]}</summary>`;
    details.append(codeBlock(lang === "html" ? el.innerHTML : el.textContent, lang));
    el.after(details);
  }

  for (const el of document.querySelectorAll('script[type="text/plain"][data-lang]')) {
    el.replaceWith(codeBlock(el.textContent.replace(/<\\\//g, "</"), el.dataset.lang));
  }

  // Docs navigation ---------------------------------------------------------

  const NAV = [
    ["Guide", [
      ["index.html", "Getting started"],
      ["expressions.html", "Expressions &amp; formats"],
      ["blogging.html", "Using it on a blog"],
    ]],
    ["Elements", [
      ["t-num.html", "<code>&lt;t-num&gt;</code>"],
      ["t-var.html", "<code>&lt;t-var&gt;</code>"],
      ["t-let.html", "<code>&lt;t-let&gt;</code>"],
      ["t-out.html", "<code>&lt;t-out&gt;</code>"],
      ["t-choice.html", "<code>&lt;t-choice&gt;</code>"],
      ["t-math.html", "<code>&lt;t-math&gt;</code>"],
      ["t-scope.html", "<code>&lt;t-scope&gt;</code>"],
    ]],
    ["Reference", [
      ["javascript.html", "JavaScript API"],
      ["styling.html", "Styling"],
    ]],
  ];

  const here = location.pathname.split("/").pop() || "index.html";
  const nav = document.querySelector("[data-docs-nav]");
  if (nav) {
    nav.innerHTML =
      '<a class="brand" href="../index.html">vangle</a>' +
      NAV.map(
        ([title, links]) =>
          `<h4>${title}</h4><ul>${links
            .map(([href, label]) => `<li><a href="${href}"${href === here ? ' aria-current="page"' : ""}>${label}</a></li>`)
            .join("")}</ul>`,
      ).join("");
  }

  const pager = document.querySelector("[data-docs-pager]");
  if (pager) {
    const flat = NAV.flatMap(([, links]) => links);
    const i = flat.findIndex(([href]) => href === here);
    const link = ([href, label], cls, hint) =>
      `<a class="${cls}" href="${href}"><small>${hint}</small>${label}</a>`;
    pager.className = "pager";
    pager.innerHTML =
      (i > 0 ? link(flat[i - 1], "prev", "Previous") : "") +
      (i >= 0 && i < flat.length - 1 ? link(flat[i + 1], "next", "Next") : "");
  }
})();
