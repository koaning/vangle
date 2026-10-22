import { scopeOf } from "../core/scope.js";
import { TangleElement, validName } from "../core/element.js";

// <t-let name="calories" expr="cookies * 50"></t-let>
// A named computed value, usable by other expressions and formulas.
export class TLet extends TangleElement {
  connectedCallback() {
    const name = validName(this);
    if (!name) return;
    scopeOf(this).define(name, this.getAttribute("expr") ?? "undefined");
  }
}
