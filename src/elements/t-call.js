import { scopeOf } from "../core/scope.js";
import { validName } from "../core/element.js";
import { CodeElement } from "../core/code.js";

// <t-call fn="train" name="loss"><t-num name="lr" step="0.01">0.1</t-num>…</t-call>
// Shows its children as the arguments of a call: train(lr=0.1, …). With a name,
// the call's result becomes a variable. `fn` names a registered function (or is
// any expression that gives one); tangleCall() builds a <t-call> from a JS function.
export class TCall extends CodeElement {
  connectedCallback() {
    const expr = this.getAttribute("fn");
    this._label = expr ?? this.fn?.name ?? "f";
    super.connectedCallback();
    if (this.hasAttribute("name") && validName(this)) {
      const args = this._args;
      scopeOf(this).define(this.getAttribute("name"), (s) => {
        const fn = this.fn ?? (expr ? s.eval(expr) : undefined);
        if (typeof fn !== "function") throw new Error(`${expr ?? "fn"} is not a function`);
        return fn(...args.map((arg) => s.get(arg)));
      });
    }
  }

  syntax(multiline) {
    const last = this._els.length - 1;
    const indent = multiline ? "\n    " : "";
    return {
      open: [["fn", this._label], ["punct", "("], indent],
      key: (i) => [["attr", this._args[i]], ["punct", "="]],
      sep: (i) => (i === last ? [] : [["punct", ","], multiline ? indent : " "]),
      close: multiline ? [["punct", ","], "\n", ["punct", ")"]] : [["punct", ")"]],
    };
  }
}
