import { Signal, Computed, bumpGraph, effect, untracked, setPending } from "./signals.js";

// ---------------------------------------------------------------------------
// Scopes: named variables, each a signal holding a value or a formula.
// ---------------------------------------------------------------------------

export const NAME_RE = /^[A-Za-z_$][\w$]*$/;

export class Formula {
  constructor(fn) {
    this.fn = fn;
  }
}

// Names an expression can use besides scope variables: functions registered
// with registerFunction(), and a short allowlist of standard JS globals. Any
// other name is a scope variable, even before it is declared. So lookup never
// depends on declaration order or on whatever happens to live on `window`.
const ALLOWED_GLOBALS = new Set([
  "Math", "Number", "String", "Boolean", "Array", "Object", "JSON", "Date", "Intl",
  "parseInt", "parseFloat", "isNaN", "isFinite", "Infinity", "NaN", "undefined",
]);
const functions = new Map();
const functionsVersion = new Signal(0);

/** Make `fn` callable by name from every expression, e.g. registerFunction("clamp", …). */
export function registerFunction(name, fn) {
  if (!NAME_RE.test(name)) throw new Error(`registerFunction: "${name}" is not a valid name`);
  functions.set(name, fn);
  functionsVersion.value++; // expressions that ran before registration re-run
}

let scopeCount = 0;

export class Scope {
  constructor() {
    this.id = ++scopeCount;
    this.slots = new Map();
    const scope = this;
    // The `with` target for expressions: scope variables first, then
    // registered functions. Allowlisted globals fall through to the real ones.
    this.proxy = new Proxy(Object.create(null), {
      has(_, key) {
        return typeof key === "string" && !ALLOWED_GLOBALS.has(key);
      },
      get(_, key) {
        if (typeof key !== "string") return undefined;
        // A variable wins once it holds something; an empty (lazily created)
        // slot doesn't hide a function. Both reads subscribe, so registering
        // or setting either one later re-runs the expression.
        const slot = scope.slots.get(key);
        if (!slot || slot.def.value === undefined) {
          functionsVersion.value;
          if (functions.has(key)) return functions.get(key);
        }
        return scope.get(key);
      },
    });
  }

  slot(name) {
    let slot = this.slots.get(name);
    if (!slot) {
      const def = new Signal(undefined);
      slot = {
        def,
        meta: new Signal({}),
        initialized: false,
        cell: new Computed(() => {
          const d = def.value;
          return d instanceof Formula ? d.fn() : d;
        }),
      };
      this.slots.set(name, slot);
      bumpGraph();
    }
    return slot;
  }

  /** Reactive read: inside an effect or computed, re-runs when `name` changes. */
  get(name) {
    return this.slot(name).cell.value;
  }
  peek(name) {
    return untracked(() => this.get(name));
  }
  set(name, value) {
    this.slot(name).def.value = value;
  }
  /** Set several variables at once. */
  setValues(values) {
    for (const [name, value] of Object.entries(values)) this.set(name, value);
  }
  /** Define `name` as a computed value: a function `(scope) => value` or an expression string. */
  define(name, fnOrExpr) {
    const fn =
      typeof fnOrExpr === "string" ? () => this.eval(fnOrExpr) : () => fnOrExpr(this);
    this.slot(name).def.value = new Formula(fn);
  }
  /** Mark `name` as waiting on a new value: elements that show it dim until it's unmarked. */
  setPending(name, on = true) {
    setPending(this.slot(name).def, Boolean(on));
  }
  meta(name) {
    return this.slot(name).meta.value;
  }
  setMeta(name, patch) {
    const slot = this.slot(name);
    slot.meta.value = { ...slot.meta.peek(), ...patch };
  }
  /** Evaluate a JS expression against this scope (reactively, if inside an effect). */
  eval(expr) {
    return compile(expr)(this.proxy);
  }
  effect(fn) {
    return effect(() => fn(this));
  }
}

const compiled = new Map();
export function compile(expr) {
  let fn = compiled.get(expr);
  if (!fn) {
    // Function bodies are sloppy-mode unless they opt in, so `with` is allowed here.
    fn = new Function("$scope", `with ($scope) { return (${expr}\n); }`);
    compiled.set(expr, fn);
  }
  return fn;
}

const scopes = new WeakMap();
let rootScope = null;

/** The scope an element belongs to: its nearest <t-scope>, else the page-wide scope. */
export function scopeOf(node) {
  const host =
    node && node.nodeType === 1 && node.closest ? node.closest("t-scope") : null;
  if (!host) return (rootScope ??= new Scope());
  let scope = scopes.get(host);
  if (!scope) scopes.set(host, (scope = new Scope()));
  return scope;
}

/** The scope's names, with the ones in `extra` taking precedence: the `with` target of evalWith. */
export function withExtra(scope, extra) {
  return new Proxy(Object.create(null), {
    has: (_, key) => key in extra || Reflect.has(scope.proxy, key),
    get: (_, key) => (typeof key === "string" && key in extra ? extra[key] : scope.proxy[key]),
  });
}

/** Evaluate `expr` against `scope`, with the names in `extra` (e.g. { Plot, d3 }) taking precedence. */
export function evalWith(scope, expr, extra) {
  return compile(expr)(withExtra(scope, extra));
}
