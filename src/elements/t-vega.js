import { scopeOf } from "../core/scope.js";
import { loadVega } from "../core/load.js";
import { TangleElement } from "../core/element.js";

// ---------------------------------------------------------------------------
// Vega: <t-vega> renders a Vega-Lite (or Vega) spec, loading Vega on first use.
// Spec params and named data sources with the name of a variable are bound to it.
// ---------------------------------------------------------------------------

/** What a spec can share with the scope: top-level params, and named data sources anywhere. */
export function vegaBindings(spec) {
  const params = (spec.params ?? spec.signals ?? [])
    .filter((p) => typeof p?.name === "string")
    .map((p) => ({ name: p.name, selection: Boolean(p.select) }));
  const data = new Set();
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (typeof node.data?.name === "string") data.add(node.data.name);
    for (const value of Object.values(node)) walk(value);
  })(spec);
  // Vega specs list their data at the top level: [{ name, values? }, …].
  if (Array.isArray(spec.data)) for (const d of spec.data) if (d?.name && !d.url && !d.source) data.add(d.name);
  return { params, data: [...data] };
}

const MULTI_VIEW = ["concat", "hconcat", "vconcat", "facet", "repeat"];
const isRow = (d) => d !== null && typeof d === "object" && !Array.isArray(d);

/**
 * A Vega changeset that turns `rows` (the tuples Vega holds, or null) into `next`.
 * Rows at the same index are modified field by field, so Vega updates those
 * marks in place instead of removing and re-adding them. Vega's tuples are
 * copies, because modify() writes to them. Returns [changeset, new tuples].
 */
export function diffRows(vega, rows, next) {
  const changes = vega.changeset();
  if (!rows || !next.every(isRow)) {
    const fresh = next.map((d) => (isRow(d) ? { ...d } : d));
    return [changes.remove(() => true).insert(fresh), next.every(isRow) ? fresh : null];
  }
  const n = Math.min(rows.length, next.length);
  for (let i = 0; i < n; i++) {
    for (const [key, value] of Object.entries(next[i])) {
      if (!Object.is(rows[i][key], value)) changes.modify(rows[i], key, value);
    }
  }
  const added = next.slice(n).map((d) => ({ ...d }));
  return [changes.insert(added).remove(rows.slice(n)), rows.slice(0, n).concat(added)];
}

/** A Vega config from the CSS around `el`: text color, --tangle-accent and --tangle-chart-*. */
function vegaTheme(el) {
  const css = getComputedStyle(el);
  const pct = (name, fallback) => {
    const n = parseFloat(css.getPropertyValue(name));
    return (Number.isFinite(n) ? n : fallback) / 100;
  };
  const text = css.color;
  const font = css.getPropertyValue("--tangle-chart-font").match(/([\d.]+)px\s+(.+)$/);
  const size = font ? Number(font[1]) : 12;
  const textOpacity = pct("--tangle-chart-text", 60);
  const gridOpacity = pct("--tangle-chart-grid", 12);
  const labels = { labelColor: text, titleColor: text, labelOpacity: textOpacity, titleOpacity: textOpacity, labelFontSize: size, titleFontSize: size };
  return {
    background: "transparent",
    ...(font && { font: font[2] }),
    mark: { color: css.getPropertyValue("--tangle-accent").trim() || "#246bce" },
    view: { stroke: null },
    axis: {
      ...labels,
      gridColor: text, gridOpacity,
      domainColor: text, domainOpacity: Math.min(1, gridOpacity * 3),
      tickColor: text, tickOpacity: Math.min(1, gridOpacity * 3),
    },
    legend: labels,
    title: { color: text, fontSize: size + 2 },
  };
}

const vegaCharts = new Set();
let themeWatched = false;

// Theme toggles change classes or attributes on <html>, or the OS setting.
// Re-render only the charts whose colors actually changed (a drag also sets a class).
function watchTheme() {
  if (themeWatched) return;
  themeWatched = true;
  const check = () => {
    for (const chart of vegaCharts) {
      if (JSON.stringify(vegaTheme(chart)) !== chart._theme) chart.render();
    }
  };
  new MutationObserver(check).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", check);
}

// <t-vega><script type="application/json">{ …Vega-Lite spec… }</script></t-vega>
// or <t-vega src="chart.vl.json">. renderer="canvas" for many points.
export class TVega extends TangleElement {
  connectedCallback() {
    vegaCharts.add(this);
    watchTheme();
    this._spec ??= this.hasAttribute("src")
      ? fetch(this.getAttribute("src")).then((r) => {
          if (!r.ok) throw new Error(`${this.getAttribute("src")}: ${r.status}`);
          return r.json();
        })
      : Promise.resolve().then(() => JSON.parse(this.querySelector("script")?.textContent ?? this.textContent));
    this.render();
  }

  disconnectedCallback() {
    vegaCharts.delete(this);
    this._token = null;
    this.teardown();
  }

  teardown() {
    super.disconnectedCallback(); // stop the binding effects
    this._result?.finalize();
    this._result = null;
  }

  async render() {
    const token = (this._token = {});
    if (!this._target) {
      this._target = document.createElement("div");
      this._target.className = "tangle-vega is-loading";
      this._target.textContent = "Loading chart…"; // Vega is a large download on first use
      this.append(this._target);
    }
    let embed, source;
    try {
      [embed, source] = await Promise.all([loadVega(), this._spec]);
    } catch (error) {
      if (this._token === token) this.showError(error);
      return;
    }
    if (this._token !== token || !this.isConnected) return;
    this.teardown();

    const scope = scopeOf(this);
    const spec = structuredClone(source);
    const { params, data } = vegaBindings(spec);
    // Start from the variables' current values, so the first render is already right.
    for (const p of spec.params ?? spec.signals ?? []) {
      const value = p.select ? undefined : scope.peek(p.name);
      if (value !== undefined) p.value = value;
    }
    if (spec.width === undefined && !MULTI_VIEW.some((k) => k in spec)) spec.width = "container";
    // Fit axes and legend inside the page width, and lay out again when data
    // arrives: a named data source is still empty on the first render.
    spec.autosize ??= { type: spec.width === "container" ? "fit-x" : "pad", contains: "padding", resize: true };

    this._target.classList.remove("is-loading");
    this._target.textContent = "";
    const theme = vegaTheme(this);
    this._theme = JSON.stringify(theme);
    let result;
    try {
      result = await embed(this._target, spec, {
        actions: false,
        defaultStyle: false,
        renderer: this.getAttribute("renderer") ?? "svg",
        config: theme,
        tooltip: { theme: "tangle" }, // styled by tangle.css instead of vega-tooltip's light/dark
      });
    } catch (error) {
      if (this._token === token) this.showError(error);
      return;
    }
    if (this._token !== token || !this.isConnected) return result.finalize();
    this._result = result;
    this._error?.remove();
    const { view } = result;

    // The bindings queue their changes here, and one loop applies them and runs
    // the view, again if more arrived meanwhile. Vega applies a data change
    // against the last finished run, so changes must not overlap runs.
    const signals = new Map();
    const datasets = new Map();
    const tuples = new Map(); // per dataset: Vega's rows, which are our copies
    let syncing = null;
    const sync = () =>
      (syncing ??= (async () => {
        await null; // let the rest of this batch of effects queue their changes
        try {
          while ((signals.size || datasets.size) && this._result === result) {
            for (const [name, value] of signals) view.signal(name, value);
            for (const [name, next] of datasets) {
              const [changes, rows] = diffRows(globalThis.vega, tuples.get(name), next);
              tuples.set(name, rows);
              view.change(name, changes);
            }
            signals.clear();
            datasets.clear();
            await view.runAsync();
          }
        } catch (error) {
          console.error("tangle: <t-vega>", error);
        } finally {
          syncing = null;
        }
      })());

    for (const { name, selection } of params) {
      let signal;
      try {
        signal = view.signal(name);
      } catch {
        continue; // not a top-level signal in the compiled spec
      }
      // Variable → chart. Selections are driven by the reader, so they only go the other way.
      if (!selection) {
        this.watch(() => {
          const value = scope.get(name);
          if (value !== undefined && !Object.is(view.signal(name), value)) {
            signals.set(name, value);
            sync();
          }
        });
      }
      // Chart → variable: Vega's own inputs (bind) and selections set the variable.
      if (scope.peek(name) === undefined) scope.set(name, signal);
      view.addSignalListener(name, (_, value) => {
        if (!Object.is(scope.peek(name), value)) scope.set(name, value);
      });
    }

    for (const name of data) {
      this.watch(() => {
        const value = scope.get(name);
        if (Array.isArray(value)) {
          datasets.set(name, value);
          sync();
        }
      });
    }
    // The data arrives after the first render, so hide the empty chart until it has.
    if (data.length) {
      this._target.style.visibility = "hidden";
      await sync();
      this._target.style.visibility = "";
    }
  }

  showError(error) {
    this._target?.remove();
    this._target = null;
    this._error ??= Object.assign(document.createElement("div"), { className: "tangle-vega-error" });
    this._error.textContent = `t-vega: ${error.message}`;
    this.append(this._error);
  }
}
