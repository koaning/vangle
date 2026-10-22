import { decimals } from "./core/format.js";
import { parseParams } from "./core/params.js";

// ---------------------------------------------------------------------------
// tangleCall: a <t-call> built from a JavaScript function's parameters.
// ---------------------------------------------------------------------------

const CALL_ATTRS = {
  min: "min", max: "max", format: "format", color: "color", label: "label", pixelsPerStep: "pixels-per-step",
};

/**
 * Build a <t-call> with one argument per parameter of `fn`. Each default sets
 * the starting value and the kind of argument: numbers drag, booleans toggle,
 * strings are editable text. `params` adds settings per parameter:
 * `{ min, max, step, format, color, label, pixelsPerStep, options, select, value }`,
 * where `options` (values, or `{ label, value }` objects) makes it a choice, and
 * `select: true` makes that choice a searchable menu, a <t-select>.
 * Add the result to the page; it joins the scope it lands in.
 */
export function tangleCall(fn, { name, params = {} } = {}) {
  const call = document.createElement("t-call");
  call.fn = fn;
  call.setAttribute("fn", fn.name || "f");
  if (name) call.setAttribute("name", name);
  for (const param of parseParams(fn)) {
    const opts = params[param.name] ?? {};
    const value = opts.value ?? param.value;
    if (value === undefined) {
      throw new Error(`tangleCall: "${param.name}" needs a default, or params.${param.name}.value`);
    }
    let el;
    if (opts.options || typeof value === "boolean") {
      el = document.createElement(opts.select ? "t-select" : "t-choice");
      el.options = (opts.options ?? [true, false]).map((o) =>
        o !== null && typeof o === "object" ? o : { label: String(o), value: o },
      );
    } else if (typeof value === "number") {
      el = document.createElement("t-num");
      const step = Number.isInteger(value) ? 1 : 10 ** -Math.min(10, decimals(value));
      el.setAttribute("step", opts.step ?? step);
    } else {
      el = document.createElement("t-text");
    }
    el.setAttribute("name", param.name);
    el.setAttribute("value", String(value));
    for (const [key, attr] of Object.entries(CALL_ATTRS)) {
      if (opts[key] != null) el.setAttribute(attr, opts[key]);
    }
    call.append(el);
  }
  return call;
}
