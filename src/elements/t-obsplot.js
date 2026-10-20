import { Signal, untracked } from "../core/signals.js";
import { scopeOf, evalWith } from "../core/scope.js";
import { loadPlot } from "../core/load.js";
import { TangleElement } from "../core/element.js";

// ---------------------------------------------------------------------------
// Observable Plot: <t-obsplot> evaluates a JavaScript expression against the
// scope, with Plot and d3 in reach, and redraws whenever a variable it read changes.
// ---------------------------------------------------------------------------

/**
 * Plot options from what a <t-obsplot> expression returned: an array of marks,
 * an options object, or an element it already made (returned as is). The
 * defaults (width, font) give way to the author's own options.
 */
export function plotOptions(result, { width, font } = {}) {
  if (typeof Node !== "undefined" && result instanceof Node) return result;
  const options = Array.isArray(result) ? { marks: result } : { ...result };
  options.width ??= width;
  options.style = typeof options.style === "string" ? options.style : { overflow: "visible", ...font, ...options.style };
  return options;
}

/** The font from --tangle-chart-font, as Plot style properties. */
function plotFont(el) {
  const font = getComputedStyle(el).getPropertyValue("--tangle-chart-font").match(/([\d.]+)px\s+(.+)$/);
  return font ? { fontSize: `${font[1]}px`, fontFamily: font[2] } : {};
}

// <t-obsplot><script type="text/plain">{ marks: [Plot.dot(rows, { x: "a", y: "b" })] }</script></t-obsplot>
// or <t-obsplot src="chart.js">. With name="x", the datum under the pointer goes into x.
export class TObsplot extends TangleElement {
  connectedCallback() {
    this._source ??= this.hasAttribute("src")
      ? fetch(this.getAttribute("src")).then((r) => {
          if (!r.ok) throw new Error(`${this.getAttribute("src")}: ${r.status}`);
          return r.text();
        })
      : Promise.resolve(this.querySelector("script")?.textContent ?? this.textContent);
    if (!this._target) {
      this._target = document.createElement("div");
      this._target.className = "tangle-obsplot is-loading";
      this._target.textContent = "Loading chart…";
      this.append(this._target);
    }
    const token = (this._token = {});
    Promise.all([loadPlot(), this._source]).then(
      ([libs, expr]) => {
        if (this._token === token && this.isConnected) this.start(libs, expr);
      },
      (error) => {
        if (this._token === token) this.showError(error);
      },
    );
  }

  disconnectedCallback() {
    this._token = null;
    this._resize?.disconnect();
    super.disconnectedCallback();
  }

  start(libs, expr) {
    const scope = scopeOf(this);
    const name = this.getAttribute("name");
    // Plot needs a width in pixels: follow the element's.
    const width = new Signal(this.clientWidth || 640);
    this._resize = new ResizeObserver(() => {
      if (this.clientWidth) width.value = this.clientWidth;
    });
    this._resize.observe(this);
    this.watch(() => {
      let figure;
      try {
        // Inside the effect, so every variable the expression (or a channel function) reads is tracked.
        const options = plotOptions(evalWith(scope, expr, libs), { width: width.value, font: plotFont(this) });
        figure = options instanceof Node ? options : libs.Plot.plot(options);
      } catch (error) {
        this.showError(error);
        return;
      }
      this._error?.remove();
      this._target.className = "tangle-obsplot";
      this._target.replaceChildren(figure);
      if (!this._target.isConnected) this.append(this._target);
      if (name) {
        // Chart → variable: the datum under Plot's pointer (tip, pointer, crosshair), or null.
        untracked(() => scope.set(name, figure.value ?? null));
        figure.addEventListener("input", () => scope.set(name, figure.value ?? null));
      }
    });
  }

  showError(error) {
    this._target.remove();
    this._error ??= Object.assign(document.createElement("div"), { className: "tangle-obsplot-error" });
    this._error.textContent = `t-obsplot: ${error.message}`;
    this.append(this._error);
  }
}
