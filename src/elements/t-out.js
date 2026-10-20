import { scopeOf } from "../core/scope.js";
import { formatValue } from "../core/format.js";
import { TangleElement } from "../core/element.js";

// <t-out expr="cookies * 50" format="%d"></t-out>
export class TOut extends TangleElement {
  connectedCallback() {
    const scope = scopeOf(this);
    const expr = this.getAttribute("expr") ?? this.getAttribute("name") ?? "undefined";
    this.watch(() => {
      try {
        const value = scope.eval(expr);
        this.textContent = formatValue(value, this.getAttribute("format"));
        this.classList.remove("is-error");
        this.removeAttribute("title");
      } catch (error) {
        this.textContent = "⚠";
        this.classList.add("is-error");
        this.title = `${expr}: ${error.message}`;
      }
    });
  }
}
