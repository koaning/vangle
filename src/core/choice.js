import { scopeOf } from "./scope.js";
import { formatValue } from "./format.js";
import { parseOptions } from "./options.js";
import { TangleElement, validName } from "./element.js";

// Shared by <t-choice> and <t-select>: a variable that holds one of a list of options.
// Options are "label" or "label:value"; numeric values become numbers, and true and
// false become booleans. From JavaScript, set `el.options = [{ label, value }, …]`
// before adding the element to the page. Subclasses say how the reader picks, in
// handlers(), an object of event listeners.
export class ChoiceElement extends TangleElement {
  connectedCallback() {
    const name = validName(this);
    if (!name) return;
    const scope = scopeOf(this);
    const options = this.options ?? parseOptions(this.getAttribute("options") ?? "");
    if (!options.length || !options[0].label) {
      console.error(`tangle: <${this.localName}> needs options="a, b, c"`, this);
      return;
    }
    this._options = options;
    this._initial ??= this.getAttribute("value") ?? this.textContent.trim();
    const start =
      options.find((o) => String(o.value) === this._initial) ??
      options.find((o) => o.label === this._initial) ??
      options[0];
    this.declare(name, start.value);
    this.tabIndex = 0;
    this.setAttribute("role", "button");
    this._handlers ??= this.handlers();
    for (const [type, fn] of Object.entries(this._handlers)) this.addEventListener(type, fn);
    this.watch(() => {
      const meta = scope.meta(name);
      const value = scope.get(name);
      const option = options.find((o) => Object.is(o.value, value));
      this.textContent = option ? option.label : formatValue(value);
      this.dataset.type = typeof value;
      this.setAttribute("aria-label", `${meta.label ?? name}: ${this.textContent}. Click to change.`);
      if (meta.color) this.style.setProperty("--tangle-color", meta.color);
    });
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    for (const [type, fn] of Object.entries(this._handlers ?? {})) this.removeEventListener(type, fn);
  }
  /** Moves `by` options from the current one, wrapping around. */
  step(by) {
    const options = this._options;
    const name = this.getAttribute("name");
    const i = options.findIndex((o) => Object.is(o.value, this.scope.peek(name)));
    this.scope.set(name, options[(i + by + options.length) % options.length].value);
  }
}
