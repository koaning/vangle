import { parseNumber, formatValue } from "../core/format.js";
import { TangleElement, validName } from "../core/element.js";

// <t-num name="cookies" min="0" max="20" step="1" format="%d">3</t-num>
// A draggable number. Its text is the initial value (and the no-JS fallback).
// Without a value it's just another view of a variable declared elsewhere.
export class TNum extends TangleElement {
  connectedCallback() {
    const name = validName(this);
    if (!name) return;
    this._initial ??= parseNumber(this.getAttribute("value") ?? this.textContent);
    this.declare(name, this._initial);
    this.watch((scope) => {
      const meta = scope.meta(name);
      this.textContent = formatValue(scope.get(name), this.getAttribute("format") ?? meta.format, meta.step);
      this.setAttribute("aria-valuetext", this.textContent);
    });
    this.makeDraggable(name);
  }
}
