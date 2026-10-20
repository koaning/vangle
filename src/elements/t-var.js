import { parseNumber } from "../core/format.js";
import { TangleElement, validName } from "../core/element.js";

// <t-var name="a" value="2" min="-5" max="5" step="0.1" color="#246bce">
// Declares a variable without showing it (e.g. for formulas).
export class TVar extends TangleElement {
  connectedCallback() {
    const name = validName(this);
    if (!name) return;
    const raw = this.getAttribute("value");
    this.declare(name, raw == null ? undefined : parseNumber(raw));
  }
}
