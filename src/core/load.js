// ---------------------------------------------------------------------------
// Lazy loading: KaTeX for <t-math>, Vega for <t-vega>, Plot for <t-obsplot>,
// CodeMirror for <t-codecell>. Each
// loads only if the page has such an element, and a copy the page already loaded is reused.
// ---------------------------------------------------------------------------

const KATEX_VERSION = "0.19.0";
const CDN = "https://cdn.jsdelivr.net/npm/";
// CodeMirror's packages must share one copy of @codemirror/state and view, so
// they come from esm.sh with the shared ones pinned.
const CM_DEPS = "?deps=@codemirror/state@6.7.6,@codemirror/view@6.43.15,@codemirror/language@6.13.1,@lezer/highlight@1.2.5";
export const config = {
  katexUrl: `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.mjs`,
  katexCssUrl: `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`,
  vegaUrl: `${CDN}vega@6.4.0/build/vega.min.js`,
  vegaLiteUrl: `${CDN}vega-lite@6.4.3/build/vega-lite.min.js`,
  vegaEmbedUrl: `${CDN}vega-embed@7.3.0/build/vega-embed.min.js`,
  d3Url: `${CDN}d3@7.9.0/dist/d3.min.js`,
  plotUrl: `${CDN}@observablehq/plot@0.6.17/dist/plot.umd.min.js`,
  jsxgraphUrl: `${CDN}jsxgraph@1.14.0/distrib/jsxgraphcore.js`,
  codemirrorUrl: `https://esm.sh/codemirror@6.0.2${CM_DEPS}`,
  // With state as its only pinned dependency, esm.sh gives the copy of view the others use.
  codemirrorViewUrl: "https://esm.sh/@codemirror/view@6.43.15?deps=@codemirror/state@6.7.6",
  codemirrorJsUrl: `https://esm.sh/@codemirror/lang-javascript@6.2.5${CM_DEPS}`,
  codemirrorLanguageUrl: `https://esm.sh/@codemirror/language@6.13.1${CM_DEPS}`,
  lezerHighlightUrl: "https://esm.sh/@lezer/highlight@1.2.5",
  pixelsPerStep: 5,
};

/**
 * Override defaults: { katexUrl, katexCssUrl, vegaUrl, vegaLiteUrl, vegaEmbedUrl, d3Url,
 * plotUrl, jsxgraphUrl, codemirrorUrl, codemirrorViewUrl, codemirrorJsUrl, codemirrorLanguageUrl,
 * lezerHighlightUrl, pixelsPerStep }. Call before KaTeX, Vega, Plot, JSXGraph or CodeMirror loads.
 */
export function configure(options) {
  Object.assign(config, options);
}

let katexPromise = null;
export function loadKatex() {
  return (katexPromise ??= (async () => {
    await null; // let a same-module configure() call run first
    if (globalThis.TangleConfig) Object.assign(config, globalThis.TangleConfig);
    if (globalThis.katex) return globalThis.katex;
    if (!document.querySelector('link[href*="katex"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = config.katexCssUrl;
      document.head.append(link);
    }
    const mod = await import(config.katexUrl);
    return mod.default ?? mod;
  })());
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.append(script);
  });
}

// Vega's builds are classic scripts that set globals, and vega-embed needs the
// other two first, so they load in order. Returns vegaEmbed.
let vegaPromise = null;
export function loadVega() {
  return (vegaPromise ??= (async () => {
    await null; // let a same-module configure() call run first
    if (globalThis.TangleConfig) Object.assign(config, globalThis.TangleConfig);
    if (!globalThis.vega) await loadScript(config.vegaUrl);
    if (!globalThis.vegaLite) await loadScript(config.vegaLiteUrl);
    if (!globalThis.vegaEmbed) await loadScript(config.vegaEmbedUrl);
    return globalThis.vegaEmbed;
  })());
}

// Plot's UMD build needs d3 as a global, so d3 loads first. Returns { Plot, d3 }.
let plotPromise = null;
export function loadPlot() {
  return (plotPromise ??= (async () => {
    await null; // let a same-module configure() call run first
    if (globalThis.TangleConfig) Object.assign(config, globalThis.TangleConfig);
    if (!globalThis.d3) await loadScript(config.d3Url);
    if (!globalThis.Plot) await loadScript(config.plotUrl);
    return { Plot: globalThis.Plot, d3: globalThis.d3 };
  })());
}

// JSXGraph's build is a classic script that sets the JXG global. Returns JXG.
let jsxgraphPromise = null;
export function loadJsxgraph() {
  return (jsxgraphPromise ??= (async () => {
    await null; // let a same-module configure() call run first
    if (globalThis.TangleConfig) Object.assign(config, globalThis.TangleConfig);
    if (!globalThis.JXG) await loadScript(config.jsxgraphUrl);
    return globalThis.JXG;
  })());
}

// CodeMirror 6 is ES modules. Returns { EditorView, ViewPlugin, Decoration, basicSetup,
// javascript, syntaxHighlighting, syntaxTree, classHighlighter }.
let codemirrorPromise = null;
export function loadCodemirror() {
  return (codemirrorPromise ??= (async () => {
    await null; // let a same-module configure() call run first
    if (globalThis.TangleConfig) Object.assign(config, globalThis.TangleConfig);
    const [cm, view, js, language, highlight] = await Promise.all([
      import(config.codemirrorUrl),
      import(config.codemirrorViewUrl),
      import(config.codemirrorJsUrl),
      import(config.codemirrorLanguageUrl),
      import(config.lezerHighlightUrl),
    ]);
    return {
      EditorView: cm.EditorView,
      ViewPlugin: view.ViewPlugin,
      Decoration: view.Decoration,
      basicSetup: cm.basicSetup,
      javascript: js.javascript,
      syntaxHighlighting: language.syntaxHighlighting,
      syntaxTree: language.syntaxTree,
      classHighlighter: highlight.classHighlighter,
    };
  })());
}
