import { scopeOf } from "../core/scope.js";
import { formatValue } from "../core/format.js";
import { openEditor } from "../core/interaction.js";
import { TangleElement, validName, declare } from "../core/element.js";

// <t-text name="title">Hello</t-text>
// An editable string. Click (or press Enter) to type a new one.
export class TText extends TangleElement {
  connectedCallback() {
    const name = validName(this);
    if (!name) return;
    const scope = scopeOf(this);
    this._initial ??= this.getAttribute("value") ?? this.textContent.trim();
    declare(this, scope, name, this._initial);
    this.tabIndex = 0;
    this.setAttribute("role", "button");
    this._onClick ??= () => openEditor(this, { text: true });
    this._onKey ??= (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openEditor(this, { text: true });
    };
    this.addEventListener("click", this._onClick);
    this.addEventListener("keydown", this._onKey);
    this.watch(() => {
      const meta = scope.meta(name);
      this.textContent = formatValue(scope.get(name), this.getAttribute("format") ?? meta.format);
      this.setAttribute("aria-label", `${meta.label ?? name}: ${this.textContent}. Click to edit.`);
      if (meta.color) this.style.setProperty("--tangle-color", meta.color);
    });
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("click", this._onClick);
    this.removeEventListener("keydown", this._onKey);
  }
}
