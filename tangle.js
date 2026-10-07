// tangle.js: reactive documents for static HTML, after Bret Victor's Tangle.
//
// Drop-in usage:
//   <link rel="stylesheet" href="tangle.css">
//   <script type="module" src="tangle.js"></script>
//
//   When you eat <t-num name="cookies" min="0" max="20">3</t-num> cookies,
//   you consume <t-out expr="cookies * 50"></t-out> calories.
//
// Zero dependencies. KaTeX is loaded lazily, and only if the page has a <t-math>;
// likewise Vega, only if it has a <t-vega>, and Observable Plot for <t-obsplot>.
// MIT license.

// ---------------------------------------------------------------------------
// Signals: push-dirty / pull-value, effects flushed in a microtask.
// ---------------------------------------------------------------------------

let observer = null;
const queue = new Set();
let flushScheduled = false;

function track(source) {
  if (!observer) return;
  source.subs.add(observer);
  observer.deps.add(source);
}

function unsubscribe(node) {
  for (const dep of node.deps) dep.subs.delete(node);
  node.deps.clear();
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(flush);
}

function flush() {
  flushScheduled = false;
  let guard = 0;
  while (queue.size) {
    const [next] = queue;
    queue.delete(next);
    next.run();
    if (++guard > 10000) {
      console.error("tangle: effects did not settle (cycle?)");
      queue.clear();
    }
  }
}

class Signal {
  constructor(value) {
    this._value = value;
    this.subs = new Set();
  }
  get value() {
    track(this);
    return this._value;
  }
  set value(next) {
    if (Object.is(next, this._value)) return;
    this._value = next;
    for (const sub of [...this.subs]) sub.mark();
  }
  peek() {
    return this._value;
  }
}

class Computed {
  constructor(fn) {
    this.fn = fn;
    this.subs = new Set();
    this.deps = new Set();
    this.dirty = true;
    this._value = undefined;
    this.error = null;
  }
  mark() {
    if (this.dirty) return;
    this.dirty = true;
    for (const sub of [...this.subs]) sub.mark();
  }
  get value() {
    track(this);
    if (this.dirty) this.recompute();
    if (this.error) throw this.error;
    return this._value;
  }
  peek() {
    return untracked(() => this.value);
  }
  recompute() {
    unsubscribe(this);
    const previous = observer;
    observer = this;
    try {
      this._value = this.fn();
      this.error = null;
    } catch (error) {
      this.error = error;
    } finally {
      observer = previous;
      this.dirty = false;
    }
  }
}

class Effect {
  constructor(fn) {
    this.fn = fn;
    this.deps = new Set();
    this.disposed = false;
    this.run();
  }
  mark() {
    if (this.disposed) return;
    queue.add(this);
    scheduleFlush();
  }
  run() {
    if (this.disposed) return;
    unsubscribe(this);
    const previous = observer;
    observer = this;
    try {
      this.fn();
    } catch (error) {
      console.error("tangle:", error);
    } finally {
      observer = previous;
    }
  }
  dispose() {
    this.disposed = true;
    queue.delete(this);
    unsubscribe(this);
  }
}

export const signal = (value) => new Signal(value);
export const computed = (fn) => new Computed(fn);
export function effect(fn) {
  const e = new Effect(fn);
  return () => e.dispose();
}
export function untracked(fn) {
  const previous = observer;
  observer = null;
  try {
    return fn();
  } finally {
    observer = previous;
  }
}

// ---------------------------------------------------------------------------
// Scopes: named variables, each a signal holding a value or a formula.
// ---------------------------------------------------------------------------

const NAME_RE = /^[A-Za-z_$][\w$]*$/;

class Formula {
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

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export const formats = {
  percent: (v) => `${fixNegZero(Math.round(v * 100).toString())}%`,
  dollars: (v) => `$${fixNegZero(Math.round(v).toLocaleString("en-US"))}`,
  int: (v) => fixNegZero(Math.round(v).toString()),
};

export function registerFormat(name, fn) {
  formats[name] = fn;
}

function fixNegZero(s) {
  return /^-[0.,]*$/.test(s) ? s.slice(1) : s;
}

export function decimals(step) {
  return (String(step).split(".")[1] || "").length;
}

function printf(fmt, value) {
  return fmt.replace(/%([+,]*)(?:\.(\d+))?([dfs%])/g, (_, flags, precision, conv) => {
    if (conv === "%") return "%";
    if (conv === "s") return String(value);
    const digits = conv === "d" ? 0 : precision != null ? Number(precision) : 6;
    const n = conv === "d" ? Math.round(value) : value;
    let s = flags.includes(",")
      ? n.toLocaleString("en-US", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        })
      : n.toFixed(digits);
    s = fixNegZero(s);
    if (flags.includes("+") && !s.startsWith("-")) s = `+${s}`;
    return s;
  });
}

function defaultNumber(value, digits) {
  if (digits != null) return fixNegZero(value.toFixed(digits));
  if (Number.isInteger(value)) return String(value);
  if (Math.abs(value) >= 1000) return fixNegZero(Math.round(value).toString());
  return fixNegZero(String(Number(value.toPrecision(4))));
}

/**
 * Format a value for display.
 * `fmt` is a named format ("percent") or printf-lite ("%.2f", "$%,d", "%+.1f km").
 * Without a format, numbers are rounded to the precision of `step` (if given).
 */
export function formatValue(value, fmt, step) {
  if (value === undefined || value === null) return "…";
  if (fmt && formats[fmt]) return String(formats[fmt](value));
  if (typeof value !== "number") {
    return fmt && fmt.includes("%s") ? printf(fmt, value) : String(value);
  }
  if (Number.isNaN(value)) return "–";
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "-∞";
  if (fmt) return printf(fmt, value);
  return defaultNumber(value, step != null ? decimals(step) : null);
}

// ---------------------------------------------------------------------------
// Numeric constraints
// ---------------------------------------------------------------------------

function limits(meta) {
  return {
    min: meta.min ?? -Infinity,
    max: meta.max ?? Infinity,
    step: meta.step ?? 1,
  };
}

function roundForStep(value, step) {
  return Number(value.toFixed(Math.min(20, decimals(step) + 2)));
}

/** Clamp to [min, max] and snap to the step grid (anchored at min when finite). */
export function snap(value, meta) {
  const { min, max, step } = limits(meta);
  const base = Number.isFinite(min) ? min : 0;
  const snapped = base + Math.round((value - base) / step) * step;
  return roundForStep(Math.max(min, Math.min(max, snapped)), step);
}

function nudge(value, delta, meta) {
  const { min, max, step } = limits(meta);
  return roundForStep(Math.max(min, Math.min(max, value + delta)), step);
}

function parseNumber(text) {
  const n = parseFloat(String(text).replace(/[^\d.eE+-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

// ---------------------------------------------------------------------------
// TeX markers: \tangle[symbol]{name} and \val[format]{expression}
// ---------------------------------------------------------------------------

function matchClose(src, start, open, close) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i;
  }
  throw new Error(`Unbalanced "${open}" at position ${start}`);
}

function skipSpace(src, i) {
  while (i < src.length && /\s/.test(src[i])) i++;
  return i;
}

/** Split TeX source into literal strings and marker objects. */
export function parseTex(src) {
  const parts = [];
  const re = /\\(tangle|val)(?![A-Za-z])/g;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    let i = skipSpace(src, m.index + m[0].length);
    let option = null;
    if (src[i] === "[") {
      const end = matchClose(src, i, "[", "]");
      option = src.slice(i + 1, end).trim();
      i = skipSpace(src, end + 1);
    }
    if (src[i] !== "{") throw new Error(`\\${m[1]} must be followed by {…}`);
    const end = matchClose(src, i, "{", "}");
    const body = src.slice(i + 1, end).trim();
    if (src.slice(last, m.index)) parts.push(src.slice(last, m.index));
    if (m[1] === "tangle") {
      if (!NAME_RE.test(body)) throw new Error(`\\tangle{${body}}: not a valid variable name`);
      parts.push({ type: "param", name: body, symbol: option || null });
    } else {
      compile(body); // surface syntax errors early
      parts.push({ type: "val", expr: body, format: option || null });
    }
    last = end + 1;
    re.lastIndex = last;
  }
  if (src.slice(last)) parts.push(src.slice(last));
  return parts;
}

const TEXT_ESCAPES = {
  "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", $: "\\$", "%": "\\%",
  "#": "\\#", "&": "\\&", _: "\\_", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}",
};

/** Turn a value into TeX: numbers stay math, anything wordy becomes \text{…}. */
export function toTex(value, fmt, step) {
  const s = formatValue(value, fmt, step);
  if (typeof value !== "number" || /[A-Za-z\s]/.test(s)) {
    return `\\text{${s.replace(/[\\{}$%#&_~^]/g, (c) => TEXT_ESCAPES[c])}}`;
  }
  return s
    .replace(/[\\{}$%#&_~^]/g, (c) => (c === "~" || c === "^" ? "" : `\\${c}`))
    .replace(/,/g, "{,}")
    .replace(/∞/g, "\\infty ");
}

// ---------------------------------------------------------------------------
// Function signatures: what tangleCall() reads from a JavaScript function.
// ---------------------------------------------------------------------------

/** Split a parameter list on top-level commas, from the "(" at `open` to its ")". */
function splitParams(src, open) {
  const parts = [];
  let depth = 0;
  let last = open + 1;
  for (let i = open + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === "\\") i++;
    } else if (ch === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      if (i < 0) break;
    } else if (ch === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i) + 1;
      if (i <= 0) break;
    } else if ("([{".includes(ch)) {
      depth++;
    } else if (")]}".includes(ch) && depth-- === 0) {
      parts.push(src.slice(last, i));
      return parts.map((p) => p.trim()).filter(Boolean);
    } else if (ch === "," && depth === 0) {
      parts.push(src.slice(last, i));
      last = i + 1;
    }
  }
  throw new Error("Unbalanced parameter list");
}

/**
 * Read a function's parameters and evaluate their defaults:
 * `function f(a = 1, b = "x", c)` gives `[{ name: "a", value: 1, hasDefault: true }, …]`.
 * Defaults must evaluate to a number, string or boolean on their own.
 */
export function parseParams(fn) {
  const src = Function.prototype.toString.call(fn);
  const bare = /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(src);
  const open = src.indexOf("(");
  if (!bare && open < 0) throw new Error("Can't find the parameter list");
  const parts = bare ? [bare[1]] : splitParams(src, open);
  return parts.map((part) => {
    if (part.startsWith("...")) throw new Error(`Rest parameter "${part}" isn't supported`);
    if (/^[[{]/.test(part)) throw new Error(`Destructured parameter "${part}" isn't supported`);
    const m = /^([A-Za-z_$][\w$]*)\s*(?:=([\s\S]*))?$/.exec(part);
    if (!m) throw new Error(`Can't read parameter "${part}"`);
    const [, name, expr] = m;
    if (expr === undefined) return { name, value: undefined, hasDefault: false };
    let value;
    try {
      value = new Function(`return (${expr}\n);`)();
    } catch (error) {
      throw new Error(`Can't evaluate the default of "${name}": ${error.message}`);
    }
    if (!["number", "string", "boolean"].includes(typeof value)) {
      throw new Error(`The default of "${name}" must be a number, string or boolean`);
    }
    return { name, value, hasDefault: true };
  });
}

// ---------------------------------------------------------------------------
// Lazy loading: KaTeX for <t-math>, Vega for <t-vega>, Plot for <t-obsplot>. Each
// loads only if the page has such an element, and a copy the page already loaded is reused.
// ---------------------------------------------------------------------------

const KATEX_VERSION = "0.19.0";
const CDN = "https://cdn.jsdelivr.net/npm/";
const config = {
  katexUrl: `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.mjs`,
  katexCssUrl: `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`,
  vegaUrl: `${CDN}vega@6.4.0/build/vega.min.js`,
  vegaLiteUrl: `${CDN}vega-lite@6.4.3/build/vega-lite.min.js`,
  vegaEmbedUrl: `${CDN}vega-embed@7.3.0/build/vega-embed.min.js`,
  d3Url: `${CDN}d3@7.9.0/dist/d3.min.js`,
  plotUrl: `${CDN}@observablehq/plot@0.6.17/dist/plot.umd.min.js`,
  pixelsPerStep: 5,
};

/**
 * Override defaults: { katexUrl, katexCssUrl, vegaUrl, vegaLiteUrl, vegaEmbedUrl, d3Url,
 * plotUrl, pixelsPerStep }. Call before KaTeX, Vega or Plot loads.
 */
export function configure(options) {
  Object.assign(config, options);
}

let katexPromise = null;
function loadKatex() {
  return (katexPromise ??= (async () => {
    await null; // let a same-module configure() call run first
    if (globalThis.TangleConfig) Object.assign(config, globalThis.TangleConfig);
    if (globalThis.katex) return globalThis.katex;
    if (!document.querySelector('link[href*="katex"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = config.katexCssUrl;
      document.head.append(link);
    }
    const mod = await import(config.katexUrl);
    return mod.default ?? mod;
  })());
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.append(script);
  });
}

// Vega's builds are classic scripts that set globals, and vega-embed needs the
// other two first, so they load in order. Returns vegaEmbed.
let vegaPromise = null;
function loadVega() {
  return (vegaPromise ??= (async () => {
    await null; // let a same-module configure() call run first
    if (globalThis.TangleConfig) Object.assign(config, globalThis.TangleConfig);
    if (!globalThis.vega) await loadScript(config.vegaUrl);
    if (!globalThis.vegaLite) await loadScript(config.vegaLiteUrl);
    if (!globalThis.vegaEmbed) await loadScript(config.vegaEmbedUrl);
    return globalThis.vegaEmbed;
  })());
}

// Plot's UMD build needs d3 as a global, so d3 loads first. Returns { Plot, d3 }.
let plotPromise = null;
function loadPlot() {
  return (plotPromise ??= (async () => {
    await null; // let a same-module configure() call run first
    if (globalThis.TangleConfig) Object.assign(config, globalThis.TangleConfig);
    if (!globalThis.d3) await loadScript(config.d3Url);
    if (!globalThis.Plot) await loadScript(config.plotUrl);
    return { Plot: globalThis.Plot, d3: globalThis.d3 };
  })());
}

// ---------------------------------------------------------------------------
// Interaction: one document-level controller for every draggable number,
// whether it is a <t-num> in prose or a \tangle{} inside a formula.
// Drags are keyed by variable name (not element) so they survive KaTeX
// re-rendering the DOM underneath the pointer.
// ---------------------------------------------------------------------------

const PARAM = "[data-tangle-param]";
const hover = new Signal(null); // "scopeId:name" under the pointer
const active = new Signal(null); // "scopeId:name" being dragged or edited
const keyOf = (scope, name) => `${scope.id}:${name}`;

let drag = null;
let editor = null;

function paramOf(el) {
  return { scope: scopeOf(el), name: el.dataset.tangleParam };
}

function occurrence(el) {
  const host = el.closest("t-math");
  if (!host) return { el, host: null, index: -1 };
  const all = [...host.querySelectorAll(`.katex-html [data-tangle-param="${el.dataset.tangleParam}"]`)];
  return { el, host, index: all.indexOf(el) };
}

/** Find the element again: the original one, or its re-rendered twin. */
function relocate({ el, host, index }, name) {
  if (el.isConnected || !host) return el;
  return host.querySelectorAll(`.katex-html [data-tangle-param="${name}"]`)[index] ?? null;
}

function decorate(el, scope, name) {
  const meta = scope.slot(name).meta.peek();
  const value = scope.peek(name);
  el.tabIndex = 0;
  el.setAttribute("role", "slider");
  el.setAttribute("aria-label", meta.label ?? name);
  if (typeof value === "number") el.setAttribute("aria-valuenow", value);
  if (meta.min != null) el.setAttribute("aria-valuemin", meta.min);
  if (meta.max != null) el.setAttribute("aria-valuemax", meta.max);
  if (meta.color) el.style.setProperty("--tangle-color", meta.color);
  else el.style.removeProperty("--tangle-color");
}

function onPointerDown(event) {
  const el = event.target.closest?.(PARAM);
  if (!el || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  closeEditor(true);
  const { scope, name } = paramOf(el);
  drag = {
    scope,
    name,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    startX: event.clientX,
    startValue: Number(scope.peek(name)) || 0,
    moved: false,
    where: occurrence(el),
  };
  try {
    document.documentElement.setPointerCapture(event.pointerId);
  } catch {}
  document.documentElement.classList.add("tangle-dragging");
  active.value = keyOf(scope, name);
  hover.value = keyOf(scope, name);
}

function onPointerMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dx = event.clientX - drag.startX;
  if (!drag.moved && Math.abs(dx) < 3) return;
  drag.moved = true;
  event.preventDefault();
  const meta = drag.scope.slot(drag.name).meta.peek();
  const { step } = limits(meta);
  const pps = meta.pixelsPerStep ?? config.pixelsPerStep;
  drag.scope.set(drag.name, nudge(drag.startValue, Math.trunc(dx / pps) * step, meta));
}

function onPointerUp(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const finished = drag;
  drag = null;
  document.documentElement.classList.remove("tangle-dragging");
  if (finished.pointerType !== "mouse") hover.value = null;
  if (event.type === "pointercancel" || finished.moved) {
    active.value = null;
    return;
  }
  const el = relocate(finished.where, finished.name);
  if (el) openEditor(el);
  else active.value = null;
}

function onPointerOver(event) {
  if (drag) return;
  const el = event.target.closest?.(PARAM);
  hover.value = el ? keyOf(scopeOf(el), el.dataset.tangleParam) : null;
}

function onKeyDown(event) {
  const el = event.target.closest?.(PARAM);
  if (!el || event.altKey || event.metaKey || event.ctrlKey) return;
  const { scope, name } = paramOf(el);
  const meta = scope.slot(name).meta.peek();
  const { min, max, step } = limits(meta);
  const value = Number(scope.peek(name)) || 0;
  const big = event.shiftKey ? 10 : 1;
  let next;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowUp":
      next = nudge(value, step * big, meta);
      break;
    case "ArrowLeft":
    case "ArrowDown":
      next = nudge(value, -step * big, meta);
      break;
    case "Home":
      if (Number.isFinite(min)) next = min;
      break;
    case "End":
      if (Number.isFinite(max)) next = max;
      break;
    case "Enter":
    case " ":
      event.preventDefault();
      openEditor(el);
      return;
    default:
      return;
  }
  event.preventDefault();
  if (next !== undefined) scope.set(name, next);
}

// Click without dragging (or press Enter) to type a value. Accepts numbers
// ("1,250") or expressions over the scope ("2 * Math.PI", "cookies + 1").
// A <t-text> opens it in text mode, which keeps whatever is typed.
function openEditor(el, { text = false } = {}) {
  closeEditor(false);
  const scope = scopeOf(el);
  const name = text ? el.getAttribute("name") : el.dataset.tangleParam;
  const meta = scope.slot(name).meta.peek();
  const value = scope.peek(name);
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = text ? "text" : "decimal";
  input.className = text ? "tangle-editor is-text" : "tangle-editor";
  input.setAttribute("aria-label", `Set ${meta.label ?? name}`);
  if (text) input.value = value == null ? "" : String(value);
  else input.value = typeof value === "number" ? formatValue(value, null, meta.step) : "";
  if (meta.color) input.style.setProperty("--tangle-color", meta.color);
  const rect = el.getBoundingClientRect();
  input.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;
  input.style.top = `${rect.bottom + window.scrollY + 6}px`;
  document.body.append(input);
  editor = { input, scope, name, meta, text, where: occurrence(el) };
  active.value = keyOf(scope, name);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      closeEditor(true, { strict: true });
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeEditor(false);
    }
  });
  input.addEventListener("blur", () => closeEditor(true));
  input.focus();
  input.select();
}

function closeEditor(commit, { strict = false } = {}) {
  if (!editor) return;
  const ed = editor;
  if (commit && ed.text) {
    ed.scope.set(ed.name, ed.input.value);
  } else if (commit) {
    const text = ed.input.value.trim();
    let next = Number(text.replace(/,/g, ""));
    if (text === "" || !Number.isFinite(next)) {
      try {
        next = Number(untracked(() => ed.scope.eval(text)));
      } catch {
        next = NaN;
      }
    }
    if (Number.isFinite(next)) {
      ed.scope.set(ed.name, snap(next, ed.meta));
    } else if (strict) {
      ed.input.classList.add("is-invalid");
      ed.input.setAttribute("aria-invalid", "true");
      ed.input.select();
      return;
    }
  }
  editor = null;
  const refocus = document.activeElement === ed.input;
  ed.input.remove();
  active.value = null;
  if (refocus) {
    // After the value lands (and any formula re-renders), return focus.
    queueMicrotask(() => relocate(ed.where, ed.name)?.focus({ preventScroll: true }));
  }
}

function syncClasses(el, scope, name) {
  const key = keyOf(scope, name);
  el.classList.toggle("is-hot", hover.peek() === key);
  el.classList.toggle("is-active", active.peek() === key);
}

// ---------------------------------------------------------------------------
// Custom elements
// ---------------------------------------------------------------------------

// Lets the non-DOM parts of this module load in Node (for tests).
const Base = typeof HTMLElement === "undefined" ? class {} : HTMLElement;

const NUMERIC_META = { min: "min", max: "max", step: "step", "pixels-per-step": "pixelsPerStep" };

/** Read declaration attributes into the variable's metadata and set its initial value. */
function declare(el, scope, name, initial) {
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

function validName(el) {
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
  }
  /** Run `fn(scope)` now and whenever a variable it read changes, until disconnected. */
  watch(fn) {
    (this._disposers ??= []).push(effect(() => fn(this.scope)));
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

class TScope extends Base {
  get scope() {
    return scopeOf(this);
  }
}

const PANEL_CSS = `
  :host {
    position: fixed;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: max-content; /* not squeezed by the viewport edge it's dragged towards */
    min-width: min(240px, calc(100vw - 32px));
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
    border-radius: 10px;
    background: var(--tangle-surface);
    box-shadow: 0 8px 28px rgb(0 0 0 / 0.16);
    --fold: 240ms cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  [part="header"] {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 14px;
    border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
    cursor: grab;
    touch-action: none;
    user-select: none;
    font: 13px ui-sans-serif, system-ui, sans-serif;
    transition: border-color var(--fold);
  }
  :host([collapsed]) [part="header"] { border-bottom-color: transparent; }
  :host(.is-dragging) [part="header"] { cursor: grabbing; }
  .grip { opacity: 0.4; letter-spacing: -2px; }
  [part="label"] {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-weight: 600;
    opacity: 0.75;
  }
  [part="toggle"] {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: none;
    color: inherit;
    cursor: pointer;
    opacity: 0.6;
  }
  [part="toggle"]:hover { opacity: 1; background: color-mix(in srgb, currentColor 10%, transparent); }
  [part="toggle"]:focus-visible { opacity: 1; outline: 2px solid var(--tangle-accent); }
  /* A minus whose vertical bar grows in to make a plus. */
  .icon { position: relative; width: 11px; height: 11px; }
  .icon::before, .icon::after {
    content: "";
    position: absolute;
    inset: 4.75px 0;
    border-radius: 1px;
    background: currentColor;
    transition: transform var(--fold);
  }
  .icon::after { transform: rotate(90deg) scaleX(0); }
  :host([collapsed]) .icon::after { transform: rotate(90deg); }
  /* The body folds by animating its grid row between 1fr and 0fr. */
  .fold {
    display: grid;
    grid-template-rows: 1fr;
    min-height: 0;
    transition: grid-template-rows var(--fold), opacity var(--fold), visibility 0s;
  }
  :host([collapsed]) .fold {
    grid-template-rows: 0fr;
    opacity: 0;
    visibility: hidden;
    transition: grid-template-rows var(--fold), opacity 160ms ease, visibility 0s 240ms;
  }
  .clip { min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
  [part="body"] { min-height: 0; padding: 14px 18px 16px; overflow: auto; }
  [part="body"] ::slotted(:first-child) { margin-top: 0; }
  [part="body"] ::slotted(:last-child) { margin-bottom: 0; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition: none !important; }
  }
`;
const PANEL_CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];
const PANEL_INSET = 16;

// <t-panel corner="top-right" label="Controls" width="280" collapsed>…</t-panel>
// Floats its contents in a fixed panel that stays in view while the page scrolls.
// Drag it by its header; the −/+ button minimizes it to just the header. The
// children stay where they are in the DOM (they're slotted into a shadow root),
// so they keep their scope.
class TPanel extends Base {
  static observedAttributes = ["corner", "width", "label", "collapsed"];

  connectedCallback() {
    if (!this.shadowRoot) this.build();
    // Keep a dragged panel on screen as the window or the panel changes size,
    // including while it unfolds.
    this._onResize ??= () => this._pos && this.moveTo(this._pos.x, this._pos.y);
    this._resizeObserver ??= new ResizeObserver(this._onResize);
    window.addEventListener("resize", this._onResize);
    this._resizeObserver.observe(this);
    this.render();
  }

  disconnectedCallback() {
    window.removeEventListener("resize", this._onResize);
    this._resizeObserver.disconnect();
  }

  attributeChangedCallback() {
    if (this.shadowRoot) this.render();
  }

  get collapsed() {
    return this.hasAttribute("collapsed");
  }
  set collapsed(value) {
    // Keep the expanded width so the minimized header stays a readable bar.
    if (value && !this.collapsed && !this.hasAttribute("width")) this.style.width = `${this.getBoundingClientRect().width}px`;
    this.toggleAttribute("collapsed", Boolean(value));
  }

  build() {
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${PANEL_CSS}</style>
      <div part="header"><span class="grip" aria-hidden="true">⋮⋮</span><span part="label"></span>
        <button part="toggle" type="button"><span class="icon"></span></button></div>
      <div class="fold"><div class="clip"><div part="body"><slot></slot></div></div></div>`;
    const header = root.querySelector('[part="header"]');
    this._label = root.querySelector('[part="label"]');
    this._toggle = root.querySelector('[part="toggle"]');
    this.setAttribute("role", "region");

    this._toggle.addEventListener("click", () => (this.collapsed = !this.collapsed));

    let grab = null;
    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.composedPath().includes(this._toggle)) return;
      const rect = this.getBoundingClientRect();
      grab = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      header.setPointerCapture(event.pointerId);
      this.classList.add("is-dragging");
      event.preventDefault();
    });
    header.addEventListener("pointermove", (event) => {
      if (grab) this.moveTo(event.clientX - grab.x, event.clientY - grab.y);
    });
    const drop = () => {
      grab = null;
      this.classList.remove("is-dragging");
    };
    header.addEventListener("pointerup", drop);
    header.addEventListener("pointercancel", drop);
  }

  /** Places the panel at a viewport position, kept fully on screen. */
  moveTo(x, y) {
    const maxX = Math.max(0, window.innerWidth - this.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - this.offsetHeight);
    this._pos = { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
    Object.assign(this.style, { left: `${this._pos.x}px`, top: `${this._pos.y}px`, right: "", bottom: "" });
  }

  render() {
    const label = this.getAttribute("label") ?? "";
    this._label.textContent = label;
    if (label) this.setAttribute("aria-label", label);
    else this.removeAttribute("aria-label");

    const width = Number(this.getAttribute("width"));
    if (width > 0) this.style.width = `${width}px`;
    else if (!this.collapsed) this.style.width = ""; // shrink-wrap the content

    const collapsed = this.collapsed;
    this._toggle.setAttribute("aria-label", collapsed ? "Expand" : "Minimize");
    this._toggle.setAttribute("aria-expanded", String(!collapsed));

    if (this._pos) return this.moveTo(this._pos.x, this._pos.y); // dragged: stay put
    let corner = this.getAttribute("corner") ?? "bottom-right";
    if (!PANEL_CORNERS.includes(corner)) {
      console.error(`tangle: <t-panel> corner must be one of ${PANEL_CORNERS.join(", ")}`, this);
      corner = "bottom-right";
    }
    const [v, h] = corner.split("-");
    const at = (side) => (side === v || side === h ? `${PANEL_INSET}px` : "");
    Object.assign(this.style, { top: at("top"), bottom: at("bottom"), left: at("left"), right: at("right") });
  }
}

// <t-var name="a" value="2" min="-5" max="5" step="0.1" color="#246bce">
// Declares a variable without showing it (e.g. for formulas).
class TVar extends TangleElement {
  connectedCallback() {
    const name = validName(this);
    if (!name) return;
    const raw = this.getAttribute("value");
    this.declare(name, raw == null ? undefined : parseNumber(raw));
  }
}

// <t-num name="cookies" min="0" max="20" step="1" format="%d">3</t-num>
// A draggable number. Its text is the initial value (and the no-JS fallback).
// Without a value it's just another view of a variable declared elsewhere.
class TNum extends TangleElement {
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

// <t-let name="calories" expr="cookies * 50"></t-let>
// A named computed value, usable by other expressions and formulas.
class TLet extends TangleElement {
  connectedCallback() {
    const name = validName(this);
    if (!name) return;
    scopeOf(this).define(name, this.getAttribute("expr") ?? "undefined");
  }
}

// <t-out expr="cookies * 50" format="%d"></t-out>
class TOut extends TangleElement {
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

// <t-choice name="n" options="yearly:1, monthly:12, daily:365">monthly</t-choice>
// Click to cycle. Options are "label" or "label:value"; numeric values become numbers,
// and true and false become booleans.
// From JavaScript, set `el.options = [{ label, value }, …]` before adding it to the page.
class TChoice extends TangleElement {
  connectedCallback() {
    const name = validName(this);
    if (!name) return;
    const scope = scopeOf(this);
    const options =
      this.options ??
      (this.getAttribute("options") ?? "").split(",").map((raw) => {
        const [label, value = label] = raw.split(":").map((s) => s.trim());
        if (value === "true" || value === "false") return { label, value: value === "true" };
        return { label, value: value !== "" && Number.isFinite(Number(value)) ? Number(value) : value };
      });
    if (!options.length || !options[0].label) {
      console.error('tangle: <t-choice> needs options="a, b, c"', this);
      return;
    }
    this._initial ??= this.getAttribute("value") ?? this.textContent.trim();
    const start =
      options.find((o) => String(o.value) === this._initial) ??
      options.find((o) => o.label === this._initial) ??
      options[0];
    this.declare(name, start.value);
    const indexOf = (value) => options.findIndex((o) => Object.is(o.value, value));
    const cycle = (by) => {
      const i = indexOf(scope.peek(name));
      scope.set(name, options[(i + by + options.length) % options.length].value);
    };
    this.tabIndex = 0;
    this.setAttribute("role", "button");
    this._onClick ??= (event) => cycle(event.shiftKey ? -1 : 1);
    this._onKey ??= (event) => {
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowRight") cycle(1);
      else if (event.key === "ArrowLeft") cycle(-1);
      else return;
      event.preventDefault();
    };
    this.addEventListener("click", this._onClick);
    this.addEventListener("keydown", this._onKey);
    this.watch(() => {
      const meta = scope.meta(name);
      const value = scope.get(name);
      const option = options[indexOf(value)];
      this.textContent = option ? option.label : formatValue(value);
      this.dataset.type = typeof value;
      this.setAttribute("aria-label", `${meta.label ?? name}: ${this.textContent}. Click to change.`);
      if (meta.color) this.style.setProperty("--tangle-color", meta.color);
    });
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("click", this._onClick);
    this.removeEventListener("keydown", this._onKey);
  }
}

// <t-text name="title">Hello</t-text>
// An editable string. Click (or press Enter) to type a new one.
class TText extends TangleElement {
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

// Code is a list of tokens: plain strings, or [kind, text] pairs that become
// <span class="t-code-{kind}"> for syntax highlighting.
function fillCode(el, tokens) {
  el.replaceChildren(
    ...tokens.map((token) => {
      if (typeof token === "string") return token;
      const span = document.createElement("span");
      span.className = `t-code-${token[0]}`;
      span.textContent = token[1];
      return span;
    }),
  );
}

// Shared by <t-call> and <t-tag>: shows the named children as code, adding the
// punctuation around them without moving them. The code stays on one line if it
// fits, and otherwise puts one argument per line, the way Black formats Python.
// Subclasses describe the punctuation, as tokens, in syntax(multiline).
class CodeElement extends TangleElement {
  connectedCallback() {
    if (!this._args) this.build();
    if (typeof ResizeObserver !== "undefined") {
      // Watch the container too: a wrapped call doesn't grow when there's room again.
      let box = this.parentElement;
      while (box && getComputedStyle(box).display === "contents") box = box.parentElement;
      this._resize ??= new ResizeObserver(() => this.layout());
      this._resize.observe(this);
      if (box) this._resize.observe(box);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._resize?.disconnect();
  }

  build() {
    this._els = [...this.children].filter((el) => el.hasAttribute("name"));
    this._args = this._els.map((el) => el.getAttribute("name"));
    this._text = "";
    for (const node of [...this.childNodes]) {
      if (node.nodeType !== 3) continue;
      this._text += node.textContent;
      node.remove();
    }
    this._text = this._text.trim();
    const span = (part) => {
      const el = document.createElement("span");
      el.className = `${this.localName}-${part}`;
      return el;
    };
    this._open = span("open");
    this._close = span("close");
    this._keys = this._els.map((el) => {
      const key = span("key");
      el.before(key);
      return key;
    });
    this._seps = this._els.map((el) => {
      const sep = span("sep");
      el.after(sep);
      return sep;
    });
    this.prepend(this._open);
    this.append(this._close);
    this.layout();
  }

  layout() {
    if (!this._open) return;
    const set = (multiline) => {
      const syntax = this.syntax(multiline);
      this.classList.toggle("is-multiline", multiline);
      fillCode(this._open, syntax.open);
      fillCode(this._close, syntax.close);
      this._els.forEach((_, i) => {
        fillCode(this._keys[i], syntax.key(i));
        fillCode(this._seps[i], syntax.sep(i));
      });
    };
    set(false);
    if (this._els.length && this.clientWidth > 0 && this.scrollWidth > this.clientWidth + 1) set(true);
  }
}

// <t-call fn="train" name="loss"><t-num name="lr" step="0.01">0.1</t-num>…</t-call>
// Shows its children as the arguments of a call: train(lr=0.1, …). With a name,
// the call's result becomes a variable. `fn` names a registered function (or is
// any expression that gives one); tangleCall() builds a <t-call> from a JS function.
class TCall extends CodeElement {
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

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);

// <t-tag tag='input type="range"'><t-num name="max">10</t-num>…</t-tag>
// Shows an HTML tag whose attributes the reader can change, with the live element
// below it. `tag` is the tag name plus any fixed attributes. Each named child is an
// attribute (`attr` overrides the name shown); a child marked `content`, or loose
// text, is what goes between the tags. A true/false value is a boolean attribute.
class TTag extends CodeElement {
  connectedCallback() {
    if (!this._tag) {
      const template = document.createElement("template");
      template.innerHTML = `<${this.getAttribute("tag") || "div"}>`;
      const el = template.content.firstElementChild;
      this._tag = {
        name: el?.localName ?? "div",
        attrs: el ? [...el.attributes].map((a) => [a.name, a.value]) : [],
      };
    }
    super.connectedCallback();
    const scope = scopeOf(this);
    if (!this._preview) {
      this._flags = this._els.map((el, i) => (el.localName === "t-choice" ? this.flag(el, i, scope) : null));
      this._preview = document.createElement("div");
      this._preview.className = "t-tag-preview";
      this.append(this._preview);
    }
    this.watch(() => this.render(scope));
  }

  attrName(i) {
    return this._els[i].getAttribute("attr") ?? this._args[i];
  }

  // A boolean attribute shows as its bare name, which toggles it.
  flag(el, i, scope) {
    const flag = document.createElement("span");
    flag.className = "t-tag-flag";
    flag.hidden = true;
    flag.tabIndex = 0;
    flag.setAttribute("role", "switch");
    const toggle = () => scope.set(this._args[i], !scope.peek(this._args[i]));
    flag.addEventListener("click", toggle);
    flag.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    });
    el.before(flag);
    return flag;
  }

  render(scope) {
    const { name, attrs } = this._tag;
    const el = document.createElement(name);
    for (const [key, value] of attrs) el.setAttribute(key, value);
    let text = this._text;
    let relayout = false;
    this._els.forEach((arg, i) => {
      const value = scope.get(this._args[i]);
      const meta = scope.meta(this._args[i]);
      const shown =
        typeof value === "number"
          ? formatValue(value, arg.getAttribute("format") ?? meta.format, meta.step)
          : value == null ? "" : String(value);
      const isBool = typeof value === "boolean" && i !== this._content && this._flags[i] !== null;
      relayout ||= isBool !== this._bool[i];
      this._bool[i] = isBool;
      const flag = this._flags[i];
      if (flag) untracked(() => {
        arg.hidden = isBool;
        flag.hidden = !isBool;
        flag.textContent = this.attrName(i);
        flag.classList.toggle("is-off", value === false);
        flag.setAttribute("aria-checked", String(value === true));
      });
      if (i === this._content) text = shown;
      else if (isBool) el.toggleAttribute(this.attrName(i), value);
      else if (value !== undefined) el.setAttribute(this.attrName(i), shown);
    });
    if (text && !VOID_TAGS.has(name)) el.textContent = text;
    untracked(() => {
      this._preview.replaceChildren(el);
      if (relayout) this.layout();
    });
  }

  syntax(multiline) {
    const { name, attrs } = this._tag;
    const space = multiline ? "\n    " : " ";
    const attr = (key, value) =>
      value === "" ? [["attr", key]] : [["attr", key], ["punct", "="], ["string", `"${value}"`]];
    const end = [multiline ? "\n" : "", ["punct", ">"]];
    const close = VOID_TAGS.has(name) ? [] : [["punct", "</"], ["tag", name], ["punct", ">"]];
    this._content ??= this._els.findIndex((el) => el.hasAttribute("content"));
    this._bool ??= this._els.map(() => false);
    return {
      open: [["punct", "<"], ["tag", name], ...attrs.flatMap(([key, value]) => [space, ...attr(key, value)])],
      key: (i) =>
        i === this._content ? end
        : this._bool[i] ? [space]
        : [space, ["attr", this.attrName(i)], ["punct", "="], ["string", '"']],
      sep: (i) => (i === this._content || this._bool[i] ? [] : [["string", '"']]),
      close: this._content >= 0 ? close : [...end, this._text, ...close],
    };
  }
}

// <t-math display>f(x) = \tangle{a} x^2 + \tangle[b]{b} x = \val[%.2f]{a + b}</t-math>
// or <t-math tex="…"> (handy inside Markdown, which leaves attributes alone).
//   \tangle{a}       draggable number bound to variable a
//   \tangle[sym]{a}  shows the TeX `sym` until dragged or edited
//   \val[fmt]{expr}  live result of a JS expression, optionally formatted
class TMath extends TangleElement {
  connectedCallback() {
    if (this._parts === undefined) {
      const source = this.getAttribute("tex") ?? this.textContent;
      try {
        this._parts = parseTex(source);
      } catch (error) {
        this._parts = null;
        this.showError(error, source);
      }
    }
    if (!this._parts) return;
    const scope = scopeOf(this);
    const token = (this._token = {});
    loadKatex().then(
      (katex) => {
        if (this._token !== token || !this.isConnected) return;
        this.watch(() => this.render(katex, scope));
        this.watch(() => {
          hover.value, active.value;
          this.syncAll(scope);
        });
      },
      (error) => this.showError(new Error(`Could not load KaTeX: ${error.message}`)),
    );
  }

  disconnectedCallback() {
    this._token = null;
    super.disconnectedCallback();
  }

  showError(error, source) {
    const box = document.createElement("span");
    box.className = "tangle-math-error";
    box.textContent = error.message;
    if (source) box.title = source;
    this.replaceChildren(box);
  }

  params() {
    return this.querySelectorAll(`.katex-html ${PARAM}`);
  }

  syncAll(scope) {
    for (const el of this.params()) syncClasses(el, scope, el.dataset.tangleParam);
  }

  render(katex, scope) {
    let tex = "";
    for (const part of this._parts) {
      if (typeof part === "string") {
        tex += part;
      } else if (part.type === "param") {
        const meta = scope.meta(part.name);
        const value = scope.get(part.name);
        const shown =
          !part.symbol || active.value === keyOf(scope, part.name)
            ? toTex(value, meta.format, meta.step)
            : part.symbol;
        tex += `\\htmlData{tangle-param=${part.name}}{${shown}}`;
      } else {
        let shown;
        try {
          shown = toTex(scope.eval(part.expr), part.format);
        } catch {
          shown = "\\text{?}";
        }
        tex += `\\htmlClass{tangle-val}{${shown}}`;
      }
    }

    untracked(() => {
      // Remember which marker had keyboard focus; rendering replaces it.
      const focused = document.activeElement;
      const refocus = this.contains(focused) && focused.matches(PARAM) ? occurrence(focused) : null;
      try {
        katex.render(tex, this, {
          displayMode: this.hasAttribute("display"),
          throwOnError: true,
          trust: (ctx) => ctx.command === "\\htmlData" || ctx.command === "\\htmlClass",
          strict: (code) => (code === "htmlExtension" ? "ignore" : "warn"),
        });
      } catch (error) {
        this.showError(error, tex);
        return;
      }
      for (const el of this.params()) {
        decorate(el, scope, el.dataset.tangleParam);
        syncClasses(el, scope, el.dataset.tangleParam);
      }
      if (refocus) relocate(refocus, focused.dataset.tangleParam)?.focus({ preventScroll: true });
    });
  }
}

// ---------------------------------------------------------------------------
// Vega: <t-vega> renders a Vega-Lite (or Vega) spec, loading Vega on first use.
// Spec params and named data sources with the name of a variable are bound to it.
// ---------------------------------------------------------------------------

/** What a spec can share with the scope: top-level params, and named data sources anywhere. */
export function vegaBindings(spec) {
  const params = (spec.params ?? spec.signals ?? [])
    .filter((p) => typeof p?.name === "string")
    .map((p) => ({ name: p.name, selection: Boolean(p.select) }));
  const data = new Set();
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (typeof node.data?.name === "string") data.add(node.data.name);
    for (const value of Object.values(node)) walk(value);
  })(spec);
  // Vega specs list their data at the top level: [{ name, values? }, …].
  if (Array.isArray(spec.data)) for (const d of spec.data) if (d?.name && !d.url && !d.source) data.add(d.name);
  return { params, data: [...data] };
}

const MULTI_VIEW = ["concat", "hconcat", "vconcat", "facet", "repeat"];
const isRow = (d) => d !== null && typeof d === "object" && !Array.isArray(d);

/**
 * A Vega changeset that turns `rows` (the tuples Vega holds, or null) into `next`.
 * Rows at the same index are modified field by field, so Vega updates those
 * marks in place instead of removing and re-adding them. Vega's tuples are
 * copies, because modify() writes to them. Returns [changeset, new tuples].
 */
export function diffRows(vega, rows, next) {
  const changes = vega.changeset();
  if (!rows || !next.every(isRow)) {
    const fresh = next.map((d) => (isRow(d) ? { ...d } : d));
    return [changes.remove(() => true).insert(fresh), next.every(isRow) ? fresh : null];
  }
  const n = Math.min(rows.length, next.length);
  for (let i = 0; i < n; i++) {
    for (const [key, value] of Object.entries(next[i])) {
      if (!Object.is(rows[i][key], value)) changes.modify(rows[i], key, value);
    }
  }
  const added = next.slice(n).map((d) => ({ ...d }));
  return [changes.insert(added).remove(rows.slice(n)), rows.slice(0, n).concat(added)];
}

/** A Vega config from the CSS around `el`: text color, --tangle-accent and --tangle-chart-*. */
function vegaTheme(el) {
  const css = getComputedStyle(el);
  const pct = (name, fallback) => {
    const n = parseFloat(css.getPropertyValue(name));
    return (Number.isFinite(n) ? n : fallback) / 100;
  };
  const text = css.color;
  const font = css.getPropertyValue("--tangle-chart-font").match(/([\d.]+)px\s+(.+)$/);
  const size = font ? Number(font[1]) : 12;
  const textOpacity = pct("--tangle-chart-text", 60);
  const gridOpacity = pct("--tangle-chart-grid", 12);
  const labels = { labelColor: text, titleColor: text, labelOpacity: textOpacity, titleOpacity: textOpacity, labelFontSize: size, titleFontSize: size };
  return {
    background: "transparent",
    ...(font && { font: font[2] }),
    mark: { color: css.getPropertyValue("--tangle-accent").trim() || "#246bce" },
    view: { stroke: null },
    axis: {
      ...labels,
      gridColor: text, gridOpacity,
      domainColor: text, domainOpacity: Math.min(1, gridOpacity * 3),
      tickColor: text, tickOpacity: Math.min(1, gridOpacity * 3),
    },
    legend: labels,
    title: { color: text, fontSize: size + 2 },
  };
}

const vegaCharts = new Set();
let themeWatched = false;

// Theme toggles change classes or attributes on <html>, or the OS setting.
// Re-render only the charts whose colors actually changed (a drag also sets a class).
function watchTheme() {
  if (themeWatched) return;
  themeWatched = true;
  const check = () => {
    for (const chart of vegaCharts) {
      if (JSON.stringify(vegaTheme(chart)) !== chart._theme) chart.render();
    }
  };
  new MutationObserver(check).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", check);
}

// <t-vega><script type="application/json">{ …Vega-Lite spec… }</script></t-vega>
// or <t-vega src="chart.vl.json">. renderer="canvas" for many points.
class TVega extends TangleElement {
  connectedCallback() {
    vegaCharts.add(this);
    watchTheme();
    this._spec ??= this.hasAttribute("src")
      ? fetch(this.getAttribute("src")).then((r) => {
          if (!r.ok) throw new Error(`${this.getAttribute("src")}: ${r.status}`);
          return r.json();
        })
      : Promise.resolve().then(() => JSON.parse(this.querySelector("script")?.textContent ?? this.textContent));
    this.render();
  }

  disconnectedCallback() {
    vegaCharts.delete(this);
    this._token = null;
    this.teardown();
  }

  teardown() {
    super.disconnectedCallback(); // stop the binding effects
    this._result?.finalize();
    this._result = null;
  }

  async render() {
    const token = (this._token = {});
    if (!this._target) {
      this._target = document.createElement("div");
      this._target.className = "tangle-vega is-loading";
      this._target.textContent = "Loading chart…"; // Vega is a large download on first use
      this.append(this._target);
    }
    let embed, source;
    try {
      [embed, source] = await Promise.all([loadVega(), this._spec]);
    } catch (error) {
      if (this._token === token) this.showError(error);
      return;
    }
    if (this._token !== token || !this.isConnected) return;
    this.teardown();

    const scope = scopeOf(this);
    const spec = structuredClone(source);
    const { params, data } = vegaBindings(spec);
    // Start from the variables' current values, so the first render is already right.
    for (const p of spec.params ?? spec.signals ?? []) {
      const value = p.select ? undefined : scope.peek(p.name);
      if (value !== undefined) p.value = value;
    }
    if (spec.width === undefined && !MULTI_VIEW.some((k) => k in spec)) spec.width = "container";
    // Fit axes and legend inside the page width, and lay out again when data
    // arrives: a named data source is still empty on the first render.
    spec.autosize ??= { type: spec.width === "container" ? "fit-x" : "pad", contains: "padding", resize: true };

    this._target.classList.remove("is-loading");
    this._target.textContent = "";
    const theme = vegaTheme(this);
    this._theme = JSON.stringify(theme);
    let result;
    try {
      result = await embed(this._target, spec, {
        actions: false,
        defaultStyle: false,
        renderer: this.getAttribute("renderer") ?? "svg",
        config: theme,
        tooltip: { theme: "tangle" }, // styled by tangle.css instead of vega-tooltip's light/dark
      });
    } catch (error) {
      if (this._token === token) this.showError(error);
      return;
    }
    if (this._token !== token || !this.isConnected) return result.finalize();
    this._result = result;
    this._error?.remove();
    const { view } = result;

    // The bindings queue their changes here, and one loop applies them and runs
    // the view, again if more arrived meanwhile. Vega applies a data change
    // against the last finished run, so changes must not overlap runs.
    const signals = new Map();
    const datasets = new Map();
    const tuples = new Map(); // per dataset: Vega's rows, which are our copies
    let syncing = null;
    const sync = () =>
      (syncing ??= (async () => {
        await null; // let the rest of this batch of effects queue their changes
        try {
          while ((signals.size || datasets.size) && this._result === result) {
            for (const [name, value] of signals) view.signal(name, value);
            for (const [name, next] of datasets) {
              const [changes, rows] = diffRows(globalThis.vega, tuples.get(name), next);
              tuples.set(name, rows);
              view.change(name, changes);
            }
            signals.clear();
            datasets.clear();
            await view.runAsync();
          }
        } catch (error) {
          console.error("tangle: <t-vega>", error);
        } finally {
          syncing = null;
        }
      })());

    for (const { name, selection } of params) {
      let signal;
      try {
        signal = view.signal(name);
      } catch {
        continue; // not a top-level signal in the compiled spec
      }
      // Variable → chart. Selections are driven by the reader, so they only go the other way.
      if (!selection) {
        this.watch(() => {
          const value = scope.get(name);
          if (value !== undefined && !Object.is(view.signal(name), value)) {
            signals.set(name, value);
            sync();
          }
        });
      }
      // Chart → variable: Vega's own inputs (bind) and selections set the variable.
      if (scope.peek(name) === undefined) scope.set(name, signal);
      view.addSignalListener(name, (_, value) => {
        if (!Object.is(scope.peek(name), value)) scope.set(name, value);
      });
    }

    for (const name of data) {
      this.watch(() => {
        const value = scope.get(name);
        if (Array.isArray(value)) {
          datasets.set(name, value);
          sync();
        }
      });
    }
    // The data arrives after the first render, so hide the empty chart until it has.
    if (data.length) {
      this._target.style.visibility = "hidden";
      await sync();
      this._target.style.visibility = "";
    }
  }

  showError(error) {
    this._target?.remove();
    this._target = null;
    this._error ??= Object.assign(document.createElement("div"), { className: "tangle-vega-error" });
    this._error.textContent = `t-vega: ${error.message}`;
    this.append(this._error);
  }
}

// ---------------------------------------------------------------------------
// Observable Plot: <t-obsplot> evaluates a JavaScript expression against the
// scope, with Plot and d3 in reach, and redraws whenever a variable it read changes.
// ---------------------------------------------------------------------------

/** Evaluate `expr` against `scope`, with the names in `extra` (e.g. { Plot, d3 }) taking precedence. */
export function evalWith(scope, expr, extra) {
  const target = new Proxy(Object.create(null), {
    has: (_, key) => key in extra || Reflect.has(scope.proxy, key),
    get: (_, key) => (typeof key === "string" && key in extra ? extra[key] : scope.proxy[key]),
  });
  return compile(expr)(target);
}

/**
 * Plot options from what a <t-obsplot> expression returned: an array of marks,
 * an options object, or an element it already made (returned as is). The
 * defaults (width, font) give way to the author's own options.
 */
export function plotOptions(result, { width, font } = {}) {
  if (typeof Node !== "undefined" && result instanceof Node) return result;
  const options = Array.isArray(result) ? { marks: result } : { ...result };
  options.width ??= width;
  options.style = typeof options.style === "string" ? options.style : { overflow: "visible", ...font, ...options.style };
  return options;
}

/** The font from --tangle-chart-font, as Plot style properties. */
function plotFont(el) {
  const font = getComputedStyle(el).getPropertyValue("--tangle-chart-font").match(/([\d.]+)px\s+(.+)$/);
  return font ? { fontSize: `${font[1]}px`, fontFamily: font[2] } : {};
}

// <t-obsplot><script type="text/plain">{ marks: [Plot.dot(rows, { x: "a", y: "b" })] }</script></t-obsplot>
// or <t-obsplot src="chart.js">. With name="x", the datum under the pointer goes into x.
class TObsplot extends TangleElement {
  connectedCallback() {
    this._source ??= this.hasAttribute("src")
      ? fetch(this.getAttribute("src")).then((r) => {
          if (!r.ok) throw new Error(`${this.getAttribute("src")}: ${r.status}`);
          return r.text();
        })
      : Promise.resolve(this.querySelector("script")?.textContent ?? this.textContent);
    if (!this._target) {
      this._target = document.createElement("div");
      this._target.className = "tangle-obsplot is-loading";
      this._target.textContent = "Loading chart…";
      this.append(this._target);
    }
    const token = (this._token = {});
    Promise.all([loadPlot(), this._source]).then(
      ([libs, expr]) => {
        if (this._token === token && this.isConnected) this.start(libs, expr);
      },
      (error) => {
        if (this._token === token) this.showError(error);
      },
    );
  }

  disconnectedCallback() {
    this._token = null;
    this._resize?.disconnect();
    super.disconnectedCallback();
  }

  start(libs, expr) {
    const scope = scopeOf(this);
    const name = this.getAttribute("name");
    // Plot needs a width in pixels: follow the element's.
    const width = new Signal(this.clientWidth || 640);
    this._resize = new ResizeObserver(() => {
      if (this.clientWidth) width.value = this.clientWidth;
    });
    this._resize.observe(this);
    this.watch(() => {
      let figure;
      try {
        // Inside the effect, so every variable the expression (or a channel function) reads is tracked.
        const options = plotOptions(evalWith(scope, expr, libs), { width: width.value, font: plotFont(this) });
        figure = options instanceof Node ? options : libs.Plot.plot(options);
      } catch (error) {
        this.showError(error);
        return;
      }
      this._error?.remove();
      this._target.className = "tangle-obsplot";
      this._target.replaceChildren(figure);
      if (!this._target.isConnected) this.append(this._target);
      if (name) {
        // Chart → variable: the datum under Plot's pointer (tip, pointer, crosshair), or null.
        untracked(() => scope.set(name, figure.value ?? null));
        figure.addEventListener("input", () => scope.set(name, figure.value ?? null));
      }
    });
  }

  showError(error) {
    this._target.remove();
    this._error ??= Object.assign(document.createElement("div"), { className: "tangle-obsplot-error" });
    this._error.textContent = `t-obsplot: ${error.message}`;
    this.append(this._error);
  }
}

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
 * `{ min, max, step, format, color, label, pixelsPerStep, options, value }`,
 * where `options` (values, or `{ label, value }` objects) makes it a choice.
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
      el = document.createElement("t-choice");
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

if (typeof window !== "undefined" && window.customElements) {
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerUp);
  document.addEventListener("pointerover", onPointerOver);
  document.documentElement.addEventListener("pointerleave", () => {
    if (!drag) hover.value = null;
  });
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("dragstart", (event) => {
    if (event.target.closest?.(PARAM)) event.preventDefault();
  });

  const elements = {
    "t-scope": TScope,
    "t-var": TVar,
    "t-num": TNum,
    "t-let": TLet,
    "t-out": TOut,
    "t-choice": TChoice,
    "t-text": TText,
    "t-call": TCall,
    "t-tag": TTag,
    "t-math": TMath,
    "t-vega": TVega,
    "t-obsplot": TObsplot,
    "t-panel": TPanel,
  };
  for (const [tag, cls] of Object.entries(elements)) {
    if (!customElements.get(tag)) customElements.define(tag, cls);
  }
}
