import { untracked } from "../core/signals.js";
import { scopeOf } from "../core/scope.js";
import { parseTex, toTex } from "../core/tex.js";
import { loadKatex } from "../core/load.js";
import {
  hover,
  active,
  PARAM,
  syncClasses,
  keyOf,
  occurrence,
  decorate,
  relocate,
} from "../core/interaction.js";
import { TangleElement } from "../core/element.js";

// <t-math display>f(x) = \tangle{a} x^2 + \tangle[b]{b} x = \val[%.2f]{a + b}</t-math>
// or <t-math tex="…"> (handy inside Markdown, which leaves attributes alone).
//   \tangle{a}       draggable number bound to variable a
//   \tangle[sym]{a}  shows the TeX `sym` until dragged or edited
//   \val[fmt]{expr}  live result of a JS expression, optionally formatted
export class TMath extends TangleElement {
  connectedCallback() {
    if (this._parts === undefined) {
      const source = this.getAttribute("tex") ?? this.textContent;
      try {
        this._parts = parseTex(source);
      } catch (error) {
        this._parts = null;
        this.showError(error, source);
      }
    }
    if (!this._parts) return;
    const scope = scopeOf(this);
    const token = (this._token = {});
    loadKatex().then(
      (katex) => {
        if (this._token !== token || !this.isConnected) return;
        this.watch(() => this.render(katex, scope));
        this.watch(() => {
          hover.value, active.value;
          this.syncAll(scope);
        });
      },
      (error) => this.showError(new Error(`Could not load KaTeX: ${error.message}`)),
    );
  }

  disconnectedCallback() {
    this._token = null;
    super.disconnectedCallback();
  }

  showError(error, source) {
    const box = document.createElement("span");
    box.className = "tangle-math-error";
    box.textContent = error.message;
    if (source) box.title = source;
    this.replaceChildren(box);
  }

  params() {
    return this.querySelectorAll(`.katex-html ${PARAM}`);
  }

  syncAll(scope) {
    for (const el of this.params()) syncClasses(el, scope, el.dataset.tangleParam);
  }

  render(katex, scope) {
    let tex = "";
    for (const part of this._parts) {
      if (typeof part === "string") {
        tex += part;
      } else if (part.type === "param") {
        const meta = scope.meta(part.name);
        const value = scope.get(part.name);
        const shown =
          !part.symbol || active.value === keyOf(scope, part.name)
            ? toTex(value, meta.format, meta.step)
            : part.symbol;
        tex += `\\htmlData{tangle-param=${part.name}}{${shown}}`;
      } else {
        let shown;
        try {
          shown = toTex(scope.eval(part.expr), part.format);
        } catch {
          shown = "\\text{?}";
        }
        tex += `\\htmlClass{tangle-val}{${shown}}`;
      }
    }

    untracked(() => {
      // Remember which marker had keyboard focus; rendering replaces it.
      const focused = document.activeElement;
      const refocus = this.contains(focused) && focused.matches(PARAM) ? occurrence(focused) : null;
      try {
        katex.render(tex, this, {
          displayMode: this.hasAttribute("display"),
          throwOnError: true,
          trust: (ctx) => ctx.command === "\\htmlData" || ctx.command === "\\htmlClass",
          strict: (code) => (code === "htmlExtension" ? "ignore" : "warn"),
        });
      } catch (error) {
        this.showError(error, tex);
        return;
      }
      for (const el of this.params()) {
        decorate(el, scope, el.dataset.tangleParam);
        syncClasses(el, scope, el.dataset.tangleParam);
      }
      if (refocus) relocate(refocus, focused.dataset.tangleParam)?.focus({ preventScroll: true });
    });
  }
}
