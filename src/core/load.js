// ---------------------------------------------------------------------------
// Lazy loading: KaTeX for <t-math>, Vega for <t-vega>, Plot for <t-obsplot>. Each
// loads only if the page has such an element, and a copy the page already loaded is reused.
// ---------------------------------------------------------------------------

const KATEX_VERSION = "0.19.0";
const CDN = "https://cdn.jsdelivr.net/npm/";
export const config = {
  katexUrl: `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.mjs`,
  katexCssUrl: `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`,
  vegaUrl: `${CDN}vega@6.4.0/build/vega.min.js`,
  vegaLiteUrl: `${CDN}vega-lite@6.4.3/build/vega-lite.min.js`,
  vegaEmbedUrl: `${CDN}vega-embed@7.3.0/build/vega-embed.min.js`,
  d3Url: `${CDN}d3@7.9.0/dist/d3.min.js`,
  plotUrl: `${CDN}@observablehq/plot@0.6.17/dist/plot.umd.min.js`,
  jsxgraphUrl: `${CDN}jsxgraph@1.14.0/distrib/jsxgraphcore.js`,
  pixelsPerStep: 5,
};

/**
 * Override defaults: { katexUrl, katexCssUrl, vegaUrl, vegaLiteUrl, vegaEmbedUrl, d3Url,
 * plotUrl, jsxgraphUrl, pixelsPerStep }. Call before KaTeX, Vega, Plot or JSXGraph loads.
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
