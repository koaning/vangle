// Helpers for the landing page and docs (not needed to use tangle.js).
//
// Load this as a classic <script> at the end of <body>. Classic scripts run
// before deferred module scripts, so this sees example markup before tangle.js
// upgrades it.
//
// - [data-show-source] on an element appends a panel with its highlighted
//   source (innerHTML for markup, textContent for a <script> or <style>).
//   Use data-show-source="open" to expand the panel.
// - <pre><code class="language-html|js|css"> is highlighted. The docs are
//   generated from Markdown (site/build.js), whose code fences produce these.
// - <script type="text/plain" data-lang="html|js|css"> is replaced by a
//   highlighted code block. Write "</script>" inside it as "<\/script>".
// - [data-theme-toggle] buttons switch between light and dark by setting
//   data-theme on <html>, remembered in localStorage. Until one is clicked, the
//   page follows prefers-color-scheme. A script in <head> restores the choice
//   before the page renders.
(() => {
  const root = document.documentElement;
  const prefersDark = matchMedia("(prefers-color-scheme: dark)");
  const toggles = document.querySelectorAll("[data-theme-toggle]");
  const isDark = () => (root.dataset.theme ?? (prefersDark.matches ? "dark" : "light")) === "dark";

  function showTheme() {
    for (const button of toggles) {
      button.textContent = isDark() ? "\u2600\ufe0e" : "\u263e";
      button.setAttribute("aria-pressed", isDark());
      button.title = isDark() ? "Switch to light mode" : "Switch to dark mode";
    }
  }

  for (const button of toggles) {
    button.addEventListener("click", () => {
      root.dataset.theme = isDark() ? "light" : "dark";
      try {
        localStorage.setItem("theme", root.dataset.theme);
      } catch {}
      showTheme();
    });
  }
  prefersDark.addEventListener("change", showTheme);
  showTheme();
})();

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

  for (const code of document.querySelectorAll('pre > code[class^="language-"]')) {
    const lang = code.className.slice("language-".length);
    if (highlighters[lang]) code.innerHTML = highlighters[lang](code.textContent);
  }

  for (const el of document.querySelectorAll('script[type="text/plain"][data-lang]')) {
    el.replaceWith(codeBlock(el.textContent.replace(/<\\\//g, "</"), el.dataset.lang));
  }
})();
