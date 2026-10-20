// vangle: reactive documents for static HTML, after Bret Victor's Tangle.
//
// Drop-in usage:
//   <link rel="stylesheet" href="tangle.css">
//   <script type="module" src="tangle.js"></script>
//
//   When you eat <t-num name="cookies" min="0" max="20">3</t-num> cookies,
//   you consume <t-out expr="cookies * 50"></t-out> calories.
//
// Zero dependencies. KaTeX is loaded lazily, and only if the page has a <t-math>;
// likewise Vega, only if it has a <t-vega>, Observable Plot for <t-obsplot>, and
// JSXGraph for <t-jsxgraph>.
// MIT license.

// The entry point of the source: `make build` bundles it, and every module it
// imports, into tangle.js. The exports below are the public API.

export { signal, computed, effect, untracked } from "./core/signals.js";
export { registerFunction, Scope, compile, scopeOf, evalWith } from "./core/scope.js";
export { formats, registerFormat, decimals, formatValue, snap } from "./core/format.js";
export { parseOptions, filterOptions } from "./core/options.js";
export { parseTex, toTex } from "./core/tex.js";
export { parseParams } from "./core/params.js";
export { configure } from "./core/load.js";
import { listen } from "./core/interaction.js";
export { TangleElement } from "./core/element.js";
import { TScope } from "./elements/t-scope.js";
import { TPanel } from "./elements/t-panel.js";
import { TPaint } from "./elements/t-paint.js";
import { TVar } from "./elements/t-var.js";
import { TNum } from "./elements/t-num.js";
import { TLet } from "./elements/t-let.js";
import { TOut } from "./elements/t-out.js";
import { TChoice } from "./elements/t-choice.js";
import { TSelect } from "./elements/t-select.js";
import { TText } from "./elements/t-text.js";
import { TCall } from "./elements/t-call.js";
import { TFetch, buildRequest } from "./elements/t-fetch.js";
import { TDebug, inspectScope, layoutGraph } from "./elements/t-debug.js";
import { TTag } from "./elements/t-tag.js";
import { TMath } from "./elements/t-math.js";
import { TVega, vegaBindings, diffRows } from "./elements/t-vega.js";
import { TObsplot, plotOptions } from "./elements/t-obsplot.js";
import { TJsxgraph } from "./elements/t-jsxgraph.js";
export { tangleCall } from "./call.js";

export { buildRequest, inspectScope, layoutGraph, vegaBindings, diffRows, plotOptions };

if (typeof window !== "undefined" && window.customElements) {
  listen();

  const elements = {
    "t-scope": TScope,
    "t-var": TVar,
    "t-num": TNum,
    "t-let": TLet,
    "t-out": TOut,
    "t-choice": TChoice,
    "t-select": TSelect,
    "t-text": TText,
    "t-call": TCall,
    "t-fetch": TFetch,
    "t-debug": TDebug,
    "t-tag": TTag,
    "t-math": TMath,
    "t-vega": TVega,
    "t-obsplot": TObsplot,
    "t-jsxgraph": TJsxgraph,
    "t-panel": TPanel,
    "t-paint": TPaint,
  };
  for (const [tag, cls] of Object.entries(elements)) {
    if (!customElements.get(tag)) customElements.define(tag, cls);
  }

  // ?tangle-debug in the URL floats a <t-debug> over any page.
  if (new URLSearchParams(location.search).has("tangle-debug")) {
    const addDebug = () => {
      const panel = document.createElement("t-panel");
      panel.setAttribute("label", "Debug");
      panel.setAttribute("corner", "bottom-left");
      panel.append(document.createElement("t-debug"));
      document.body.append(panel);
    };
    if (document.body) addDebug();
    else document.addEventListener("DOMContentLoaded", addDebug);
  }
}
