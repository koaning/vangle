import { Effect, watchers, bumpGraph, untracked } from "./signals.js";
import { NAME_RE, scopeOf } from "./scope.js";
import { decorate, hover, active, syncClasses } from "./interaction.js";

// ---------------------------------------------------------------------------
// Custom elements
// ---------------------------------------------------------------------------

// Lets the non-DOM parts of this module load in Node (for tests).
export const Base = typeof HTMLElement === "undefined" ? class {} : HTMLElement;

const NUMERIC_META = { min: "min", max: "max", step: "step", "pixels-per-step": "pixelsPerStep" };

/** Read declaration attributes into the variable's metadata and set its initial value. */
export function declare(el, scope, name, initial) {
  const patch = {};
  for (const [attr, key] of Object.entries(NUMERIC_META)) {
    if (el.hasAttribute(attr)) patch[key] = Number(el.getAttribute(attr));
  }
  for (const attr of ["color", "label", "format"]) {
    if (el.hasAttribute(attr)) patch[attr] = el.getAttribute(attr);
  }
  const color = patch.color?.trim().split(/\s+/);
  if (color?.length === 2) patch.color = `light-dark(${color[0]}, ${color[1]})`;
  // A <t-num>'s format only becomes the variable's default if none is set yet.
  if (el.localName === "t-num" && scope.slot(name).meta.peek().format) delete patch.format;
  if (Object.keys(patch).length) scope.setMeta(name, patch);
  const slot = scope.slot(name);
  if (initial !== undefined && !slot.initialized) {
    slot.initialized = true;
    scope.set(name, initial);
  }
}

export function validName(el) {
  const name = el.getAttribute("name");
  if (name && NAME_RE.test(name)) return name;
  console.error(`tangle: <${el.localName}> needs a valid name="…"`, el);
  return null;
}

/**
 * The base class of the built-in elements, and of your own. Effects started
 * with `watch` stop when the element leaves the page; if you override
 * `disconnectedCallback`, call `super.disconnectedCallback()`.
 */
export class TangleElement extends Base {
  /** The variables this element belongs to: its nearest <t-scope>, else the page's. */
  get scope() {
    return scopeOf(this);
  }
  disconnectedCallback() {
    for (const dispose of this._disposers ?? []) dispose();
    this._disposers = [];
    this._effects?.clear();
    watchers.delete(this);
    bumpGraph();
    this.classList?.remove("is-stale");
  }
  /**
   * Run `fn(scope)` now and whenever a variable it read changes, until disconnected.
   * While a variable it read is pending, the element has the class is-stale.
   */
  watch(fn) {
    const e = new Effect(() => fn(this.scope));
    (this._effects ??= new Set()).add(e);
    (this._disposers ??= []).push(() => e.dispose());
    watchers.add(this);
    bumpGraph();
  }
  /** Declare `name` from this element's min, max, step, color, label and format attributes. */
  declare(name, initial) {
    declare(this, this.scope, name, initial);
  }
  /** Let the reader drag, type or arrow-key `name` on `target`, like a <t-num>. */
  makeDraggable(name, target = this) {
    const scope = this.scope;
    target.dataset.tangleParam = name;
    this.watch(() => {
      scope.meta(name), scope.get(name);
      untracked(() => decorate(target, scope, name));
    });
    this.watch(() => {
      hover.value, active.value;
      syncClasses(target, scope, name);
    });
  }
}
