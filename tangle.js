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
// likewise Vega, only if it has a <t-vega>, Observable Plot for <t-obsplot>, and
// JSXGraph for <t-jsxgraph>.
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
  if (pending.size) refreshStale();
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
    this.runs = 0;
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
    this.runs++;
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

// Variables waiting on an answer (a <t-fetch> reloading, say) are pending.
// An element whose effects read one, directly or through formulas, gets the
// class is-stale until the answer lands, so it shows its old value dimmed.
const pending = new Set(); // the def signals of pending variables
const watchers = new Set(); // elements with effects from TangleElement.watch
let staleScheduled = false;

// Bumped when variables, elements or pending requests come and go, for <t-debug>.
const graphVersion = new Signal(0);
const bumpGraph = () => (graphVersion.value = graphVersion.peek() + 1);

function setPending(source, on) {
  if (on === pending.has(source)) return;
  if (on) pending.add(source);
  else pending.delete(source);
  bumpGraph();
  if (staleScheduled) return;
  staleScheduled = true;
  queueMicrotask(refreshStale); // after the effects that the answer re-runs
}

/** Whether `node` reads a pending variable, following its dependencies. */
function readsPending(node, seen = new Set()) {
  for (const dep of node.deps ?? []) {
    if (pending.has(dep)) return true;
    if (seen.has(dep)) continue;
    seen.add(dep);
    if (readsPending(dep, seen)) return true;
  }
  return false;
}

function refreshStale() {
  staleScheduled = false;
  for (const el of watchers) {
    const stale = pending.size > 0 && [...el._effects].some((e) => readsPending(e));
    el.classList?.toggle("is-stale", stale);
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
// Options, for <t-choice> and <t-select>
// ---------------------------------------------------------------------------

/**
 * Parse options="yearly:1, monthly:12" into `[{ label, value }]`. Without a
 * `:value` the label is the value; numeric values become numbers, and true
 * and false become booleans.
 */
export function parseOptions(text) {
  return text.split(",").map((raw) => {
    const [label, value = label] = raw.split(":").map((s) => s.trim());
    if (value === "true" || value === "false") return { label, value: value === "true" };
    return { label, value: value !== "" && Number.isFinite(Number(value)) ? Number(value) : value };
  });
}

/**
 * The options whose label contains `query`, ignoring case: labels that start
 * with it first, then labels with a word that starts with it, then the rest.
 */
export function filterOptions(options, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [...options];
  const rank = (label) => {
    let at = label.indexOf(q);
    if (at <= 0) return at;
    for (; at > 0; at = label.indexOf(q, at + 1)) if (!/[\p{L}\p{N}]/u.test(label[at - 1])) return 1;
    return 2;
  };
  const groups = [[], [], []];
  for (const option of options) {
    const r = rank(String(option.label).toLowerCase());
    if (r >= 0) groups[r].push(option);
  }
  return groups.flat();
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
  jsxgraphUrl: `${CDN}jsxgraph@1.14.0/distrib/jsxgraphcore.js`,
  pixelsPerStep: 5,
};

/**
 * Override defaults: { katexUrl, katexCssUrl, vegaUrl, vegaLiteUrl, vegaEmbedUrl, d3Url,
 * plotUrl, jsxgraphUrl, pixelsPerStep }. Call before KaTeX, Vega, Plot or JSXGraph loads.
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

// JSXGraph's build is a classic script that sets the JXG global. Returns JXG.
let jsxgraphPromise = null;
function loadJsxgraph() {
  return (jsxgraphPromise ??= (async () => {
    await null; // let a same-module configure() call run first
    if (globalThis.TangleConfig) Object.assign(config, globalThis.TangleConfig);
    if (!globalThis.JXG) await loadScript(config.jsxgraphUrl);
    return globalThis.JXG;
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
  // A <t-debug> row names its variable's key itself: it isn't in that variable's scope.
  const el = event.target.closest?.(`${PARAM}, [data-tangle-hover]`);
  hover.value = !el ? null : (el.dataset.tangleHover ?? keyOf(scopeOf(el), el.dataset.tangleParam));
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
  document.body.append(input);
  placeBelow(input, el);
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

/** Centers a popup (already on the page) just under `el`, keeping it inside the window. */
function placeBelow(popup, el) {
  const rect = el.getBoundingClientRect();
  const half = popup.offsetWidth / 2;
  const right = document.documentElement.clientWidth - half - 8;
  const center = Math.max(half + 8, Math.min(rect.left + rect.width / 2, right));
  popup.style.left = `${center + window.scrollX}px`;
  popup.style.top = `${rect.bottom + window.scrollY + 6}px`;
}

// A <t-select> opens a menu: a search field over its options. Typing filters
// them, the arrow keys move the highlight, and Enter or a click picks one.
let menu = null;
let menuCount = 0;

function openMenu(el, options, query = "") {
  closeMenu();
  const scope = scopeOf(el);
  const name = el.getAttribute("name");
  const meta = scope.slot(name).meta.peek();
  const box = document.createElement("div");
  box.className = "tangle-menu";
  if (meta.color) box.style.setProperty("--tangle-color", meta.color);
  const input = document.createElement("input");
  Object.assign(input, { type: "text", value: query, placeholder: "Search…", autocomplete: "off", spellcheck: false });
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-label", `Search ${meta.label ?? name}`);
  const list = document.createElement("ul");
  list.id = `tangle-menu-${++menuCount}`;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", meta.label ?? name);
  input.setAttribute("aria-controls", list.id);
  box.append(input, list);
  document.body.append(box);
  menu = { el, box, input, list, options, scope, name, shown: [], index: -1 };
  el.setAttribute("aria-expanded", "true");
  renderMenu();
  placeBelow(box, el);
  input.addEventListener("input", () => renderMenu());
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") highlight(menu.index + 1);
    else if (event.key === "ArrowUp") highlight(menu.index - 1);
    else if (event.key === "Enter") closeMenu(true);
    else if (event.key === "Escape" || event.key === "Tab") closeMenu();
    else return;
    event.preventDefault();
  });
  input.addEventListener("blur", () => closeMenu());
  // Keep the focus in the search field while the pointer picks.
  list.addEventListener("pointerdown", (event) => event.preventDefault());
  list.addEventListener("pointermove", (event) => {
    const row = event.target.closest("[role=option]");
    if (row) highlight([...list.children].indexOf(row), false);
  });
  list.addEventListener("click", (event) => {
    if (event.target.closest("[role=option]")) closeMenu(true);
  });
  input.focus();
}

/** Shows the options that match the search, highlighting the first, or else the current one. */
function renderMenu() {
  const { input, list, options, scope, name } = menu;
  const query = input.value;
  const current = scope.peek(name);
  menu.shown = filterOptions(options, query);
  list.replaceChildren(
    ...menu.shown.map((option, i) => {
      const row = document.createElement("li");
      row.id = `${list.id}-${i}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(Object.is(option.value, current)));
      row.textContent = option.label;
      return row;
    }),
  );
  if (!menu.shown.length) {
    const empty = document.createElement("li");
    empty.className = "tangle-menu-empty";
    empty.textContent = "No matches";
    list.append(empty);
  }
  highlight(query.trim() ? 0 : menu.shown.findIndex((o) => Object.is(o.value, current)));
}

function highlight(index, scroll = true) {
  const { input, list, shown } = menu;
  menu.index = shown.length ? Math.max(0, Math.min(index, shown.length - 1)) : -1;
  const rows = shown.length ? [...list.children] : [];
  rows.forEach((row, i) => row.classList.toggle("is-highlighted", i === menu.index));
  const row = rows[menu.index];
  if (row) input.setAttribute("aria-activedescendant", row.id);
  else input.removeAttribute("aria-activedescendant");
  // Scroll the list, not the page (scrollIntoView would scroll both).
  if (row && scroll) {
    const bottom = row.offsetTop + row.offsetHeight;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }
}

function closeMenu(pick = false) {
  if (!menu) return;
  const m = menu;
  menu = null;
  const option = pick ? m.shown[m.index] : undefined;
  if (option) m.scope.set(m.name, option.value);
  const refocus = document.activeElement === m.input;
  m.box.remove();
  m.el.setAttribute("aria-expanded", "false");
  if (refocus) m.el.focus({ preventScroll: true });
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

const PAINT_CSS = `
  :host {
    display: block;
    width: fit-content;
    max-width: 100%;
    font: 13px ui-sans-serif, system-ui, sans-serif;
    --line: color-mix(in srgb, currentColor 15%, transparent);
  }
  /* As wide as the canvas: the toolbar wraps instead of widening the element. */
  [part="toolbar"] {
    box-sizing: border-box;
    width: 0;
    min-width: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    padding: 4px;
    border: 1px solid var(--line);
    border-bottom: 0;
    border-radius: 8px 8px 0 0;
    background: var(--tangle-surface);
  }
  .group { display: flex; align-items: center; gap: 2px; }
  .group + .group { padding-left: 6px; border-left: 1px solid var(--line); }
  .group[hidden] { display: none; }
  [part~="button"] {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: none;
    color: inherit;
    cursor: pointer;
    opacity: 0.65;
  }
  [part~="button"]:hover:not(:disabled) { opacity: 1; background: color-mix(in srgb, currentColor 10%, transparent); }
  [part~="button"][aria-pressed="true"] {
    opacity: 1;
    color: var(--tangle-accent);
    background: color-mix(in srgb, var(--tangle-accent) 14%, transparent);
  }
  [part~="button"]:disabled { opacity: 0.25; cursor: default; }
  :focus-visible { outline: 2px solid var(--tangle-accent); outline-offset: 1px; }
  svg { width: 18px; height: 18px; }
  [part="color"] { width: 30px; height: 26px; padding: 0; border: 0; background: none; cursor: pointer; }
  [part="color"][hidden], [part="size"][hidden] { display: none; }
  [part="size"] { width: 96px; margin: 0 4px; accent-color: var(--tangle-accent); }
  [part="paper"] { border: 1px solid var(--line); border-radius: 0 0 8px 8px; overflow: hidden; line-height: 0; }
  [part="paper"].is-clear {
    background-image: repeating-conic-gradient(#d0d0d0 0% 25%, #f0f0f0 0% 50%);
    background-size: 16px 16px;
  }
  canvas { display: block; max-width: 100%; height: auto; touch-action: none; cursor: crosshair; }
  canvas:focus-visible { outline-offset: -2px; }
`;
const PAINT_TOOLS = ["brush", "marker", "eraser", "color"];
const PAINT_UNDO = 20;
// The tools with a thickness slider: [min, max, start] in pixels. The brush is always 2px.
const PAINT_SIZES = { marker: [2, 24, 8], eraser: [4, 60, 20] };
const paintIcon = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const PAINT_ICONS = {
  brush: paintIcon('<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>'),
  marker: paintIcon('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'),
  eraser: paintIcon('<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>'),
  undo: paintIcon('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>'),
  clear: paintIcon('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
};
const PAINT_LABELS = { brush: "Brush", marker: "Marker", eraser: "Eraser" };

function loadImage(src) {
  const img = new Image();
  img.crossOrigin = "anonymous"; // so a CORS-enabled image doesn't block the export
  img.src = src;
  return img.decode().then(() => img);
}

// <t-paint name="art" width="480" height="320" tools="brush marker eraser color"></t-paint>
// A canvas to draw on. The drawing is a variable: a PNG data URL, made when a stroke
// ends. Setting the variable (to a data URL or an image URL) loads that picture, and
// the variable then becomes the canvas's PNG.
class TPaint extends TangleElement {
  /** The canvas with the ink: transparent where nothing is drawn, without the paper. */
  get canvas() {
    return this._canvas;
  }
  /** The drawing as a PNG data URL, as of the last stroke. */
  get value() {
    return this._value;
  }

  connectedCallback() {
    if (!this.shadowRoot) {
      this.build();
      this._started = this.start();
    }
    this._name = this.hasAttribute("name") ? validName(this) : null;
    const token = (this._token = {});
    const begin = () => {
      if (this._token !== token || !this.isConnected) return;
      if (!this._name) {
        if (this._value === undefined) this.export();
        return;
      }
      // A value the canvas didn't make (set from JS, say) is loaded into it.
      this.watch((scope) => {
        const value = scope.get(this._name);
        untracked(() => {
          if (value === undefined) this.export();
          else if (value !== this._value) this.load(value);
        });
      });
    };
    // Without a src image there's nothing to wait for, so the variable is set right away.
    if (this._started) this._started.then(begin);
    else begin();
  }

  disconnectedCallback() {
    this._token = null;
    super.disconnectedCallback();
  }

  build() {
    let tools = (this.getAttribute("tools") ?? "").split(/[\s,]+/).filter(Boolean);
    if (!tools.length) tools = PAINT_TOOLS;
    if (tools.some((t) => !PAINT_TOOLS.includes(t)) || tools.every((t) => t === "color")) {
      console.error(`tangle: <t-paint> tools are ${PAINT_TOOLS.join(", ")}, with at least one to draw with`, this);
      tools = PAINT_TOOLS;
    }
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${PAINT_CSS}</style>
      <div part="toolbar" role="toolbar">
        <span class="group tools"></span>
        <span class="group"></span>
        <span class="group settings"><input part="color" type="color"><input part="size" type="range"></span>
      </div>
      <div part="paper"><canvas part="canvas" tabindex="0" role="img"></canvas></div>`;
    const [toolGroup, actionGroup, settings] = root.querySelectorAll(".group");
    this._settings = settings;
    this._paper = root.querySelector('[part="paper"]');
    this._canvas = root.querySelector("canvas");
    this._ctx = this._canvas.getContext("2d", { willReadFrequently: true });
    this._colorInput = root.querySelector('[part="color"]');
    this._sizeInput = root.querySelector('[part="size"]');
    this._hasColor = tools.includes("color");
    this._sizes = Object.fromEntries(Object.entries(PAINT_SIZES).map(([tool, [, , start]]) => [tool, start]));
    this._undo = [];

    const button = (label, svg) => {
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("part", "button");
      el.setAttribute("aria-label", label);
      el.title = label;
      el.innerHTML = svg;
      return el;
    };
    this._toolButtons = tools
      .filter((tool) => tool !== "color")
      .map((tool) => {
        const el = button(PAINT_LABELS[tool], PAINT_ICONS[tool]);
        el.dataset.tool = tool;
        el.addEventListener("click", () => this.choose(tool));
        return el;
      });
    toolGroup.append(...this._toolButtons);
    this._undoButton = button("Undo", PAINT_ICONS.undo);
    this._undoButton.addEventListener("click", () => this.undo());
    const clear = button("Clear", PAINT_ICONS.clear);
    clear.addEventListener("click", () => this.clear());
    actionGroup.append(this._undoButton, clear);

    // The color picker needs #rrggbb, which is what a canvas gives back for any opaque CSS color.
    this._ctx.fillStyle = this.getAttribute("color") ?? "#000000";
    this._color = this._colorInput.value = this._ctx.fillStyle.startsWith("#") ? this._ctx.fillStyle : "#000000";
    this._colorInput.setAttribute("aria-label", "Color");
    this._colorInput.addEventListener("input", () => (this._color = this._colorInput.value));
    this._sizeInput.addEventListener("input", () => (this._sizes[this._tool] = Number(this._sizeInput.value)));

    const canvas = this._canvas;
    canvas.setAttribute("aria-label", this.getAttribute("label") ?? this.getAttribute("name") ?? "Drawing");
    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      return [
        ((event.clientX - rect.left) * canvas.width) / rect.width,
        ((event.clientY - rect.top) * canvas.height) / rect.height,
      ];
    };
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || this._stroke) return;
      event.preventDefault();
      canvas.focus({ preventScroll: true, focusVisible: false }); // for Ctrl+Z, without a focus ring
      canvas.setPointerCapture(event.pointerId);
      this._loading = null; // the reader's stroke wins over a picture still loading
      this.snapshot();
      const at = point(event);
      this._stroke = { id: event.pointerId, last: at };
      this.paint(at, at);
    });
    canvas.addEventListener("pointermove", (event) => {
      const stroke = this._stroke;
      if (!stroke || event.pointerId !== stroke.id) return;
      const events = event.getCoalescedEvents?.() ?? [];
      for (const e of events.length ? events : [event]) {
        const at = point(e);
        this.paint(stroke.last, at);
        stroke.last = at;
      }
    });
    const end = (event) => {
      if (!this._stroke || event.pointerId !== this._stroke.id) return;
      this._stroke = null;
      this.export();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    this.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        this.undo();
      }
    });

    this._paper.style.backgroundColor = this.getAttribute("background") ?? "white";
    canvas.width = Number(this.getAttribute("width")) || 480;
    canvas.height = Number(this.getAttribute("height")) || 320;
    this.choose(this._toolButtons[0].dataset.tool);
    this.sync();
  }

  /** Sizes the canvas to the src image and draws it, for Clear to go back to. Null without one. */
  start() {
    this._paper.classList.toggle("is-clear", getComputedStyle(this._paper).backgroundColor === "rgba(0, 0, 0, 0)");
    const src = this.getAttribute("src");
    return src ? this.startWith(src) : null;
  }

  async startWith(src) {
    let img;
    try {
      img = await loadImage(src);
    } catch {
      console.error(`tangle: <t-paint> could not load ${src} (a cross-origin image needs CORS)`, this);
      return;
    }
    // Without a width or height, they follow the image.
    let width = Number(this.getAttribute("width")) || 0;
    let height = Number(this.getAttribute("height")) || 0;
    const ratio = img.naturalWidth / img.naturalHeight;
    if (!width && !height) [width, height] = [img.naturalWidth, img.naturalHeight];
    else if (!height) height = Math.round(width / ratio);
    else if (!width) width = Math.round(height * ratio);
    this._canvas.width = width;
    this._canvas.height = height;
    this._ctx.drawImage(img, 0, 0, width, height);
    this._original = img;
  }

  choose(tool) {
    this._tool = tool;
    for (const el of this._toolButtons) el.setAttribute("aria-pressed", String(el.dataset.tool === tool));
    this._colorInput.hidden = !this._hasColor || tool === "eraser";
    const size = PAINT_SIZES[tool];
    this._sizeInput.hidden = !size;
    if (size) {
      Object.assign(this._sizeInput, { min: size[0], max: size[1], value: this._sizes[tool] });
      this._sizeInput.setAttribute("aria-label", `${PAINT_LABELS[tool]} size`);
    }
    this._settings.hidden = this._colorInput.hidden && this._sizeInput.hidden;
  }

  paint([x0, y0], [x1, y1]) {
    const ctx = this._ctx;
    ctx.save();
    ctx.globalCompositeOperation = this._tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = this._color;
    ctx.lineWidth = this._tool === "brush" ? 2 : this._sizes[this._tool];
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  /** Remembers the canvas, for undo. */
  snapshot() {
    const { width, height } = this._canvas;
    this._undo.push(this._ctx.getImageData(0, 0, width, height));
    if (this._undo.length > PAINT_UNDO) this._undo.shift();
    this.sync();
  }

  undo() {
    const last = this._undo.pop();
    if (!last) return;
    this._loading = null;
    this._ctx.putImageData(last, 0, 0);
    this.export();
  }

  /** Back to the src image, or to an empty canvas. Undo brings the drawing back. */
  clear() {
    this._loading = null;
    this.snapshot();
    const { width, height } = this._canvas;
    this._ctx.clearRect(0, 0, width, height);
    if (this._original) this._ctx.drawImage(this._original, 0, 0, width, height);
    this.export();
  }

  /** Shows a picture: the variable's new value. An empty value clears the canvas. */
  async load(src) {
    const token = (this._loading = {});
    const img = src ? await loadImage(src).catch(() => null) : null;
    if (this._loading !== token) return;
    if (src && !img) return console.error("tangle: <t-paint> could not load the picture", this);
    this.snapshot();
    const { width, height } = this._canvas;
    this._ctx.clearRect(0, 0, width, height);
    if (img) this._ctx.drawImage(img, 0, 0, width, height);
    // Now that the canvas shows it, the variable becomes its PNG, like after a stroke.
    this.export();
  }

  /** Puts the drawing, on its paper, in the variable as a PNG data URL. */
  export() {
    const { width, height } = this._canvas;
    const out = Object.assign(document.createElement("canvas"), { width, height });
    const ctx = out.getContext("2d");
    ctx.fillStyle = getComputedStyle(this._paper).backgroundColor;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(this._canvas, 0, 0);
    try {
      this._value = out.toDataURL("image/png");
    } catch (error) {
      console.error("tangle: <t-paint> can't export a picture from another origin without CORS", error);
      return;
    }
    this.sync();
    if (this._name) this.scope.set(this._name, this._value);
  }

  sync() {
    this._undoButton.disabled = !this._undo.length;
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

// Shared by <t-choice> and <t-select>: a variable that holds one of a list of options.
// Options are "label" or "label:value"; numeric values become numbers, and true and
// false become booleans. From JavaScript, set `el.options = [{ label, value }, …]`
// before adding the element to the page. Subclasses say how the reader picks, in
// handlers(), an object of event listeners.
class ChoiceElement extends TangleElement {
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

// <t-choice name="n" options="yearly:1, monthly:12, daily:365">monthly</t-choice>
// Click to cycle through the options.
class TChoice extends ChoiceElement {
  handlers() {
    return {
      click: (event) => this.step(event.shiftKey ? -1 : 1),
      keydown: (event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "ArrowRight") this.step(1);
        else if (event.key === "ArrowLeft") this.step(-1);
        else return;
        event.preventDefault();
      },
    };
  }
}

// <t-select name="g" options="Mercury:3.7, Venus:8.87, Earth:9.81, …">Earth</t-select>
// Click to open a menu of the options, and type to search it. For long lists.
class TSelect extends ChoiceElement {
  connectedCallback() {
    super.connectedCallback();
    if (!this._options) return;
    this.setAttribute("aria-haspopup", "listbox");
    this.setAttribute("aria-expanded", "false");
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    if (menu?.el === this) closeMenu();
  }
  handlers() {
    let wasOpen = false;
    return {
      // A click on the word while its menu is open closes the menu (the search field
      // loses focus first), rather than opening it again.
      pointerdown: () => (wasOpen = menu?.el === this),
      click: () => {
        if (!wasOpen) openMenu(this, this._options);
        wasOpen = false;
      },
      keydown: (event) => {
        if (event.altKey || event.metaKey || event.ctrlKey) return;
        if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") openMenu(this, this._options);
        else if (event.key === "ArrowRight") this.step(1);
        else if (event.key === "ArrowLeft") this.step(-1);
        else if (event.key.length === 1) openMenu(this, this._options, event.key);
        else return;
        event.preventDefault();
      },
    };
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

// ---------------------------------------------------------------------------
// Requests: <t-fetch> puts a backend's answer in a variable.
// ---------------------------------------------------------------------------

/**
 * The request a <t-fetch> sends, from its attributes: `url` is a template whose
 * ${…} parts are expressions, `params` an expression giving the query string,
 * `body` one giving the JSON body. Returns { url, init, key }, where `key` is
 * the same for the same request.
 */
export function buildRequest(scope, { url, params, body, method }) {
  let href = String(scope.eval(`\`${url.replace(/`/g, "\\`")}\``));
  if (params) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(scope.eval(params) ?? {})) {
      if (value != null) query.append(key, String(value));
    }
    const qs = query.toString();
    if (qs) href += (href.includes("?") ? "&" : "?") + qs;
  }
  const init = { method: (method || (body ? "POST" : "GET")).toUpperCase() };
  if (body) {
    init.body = JSON.stringify(scope.eval(body));
    init.headers = { "Content-Type": "application/json" };
  }
  return { url: href, init, key: `${init.method} ${href} ${init.body ?? ""}` };
}

// Answers seen on this page, shared by every <t-fetch>, newest last.
const fetchCache = new Map();
const FETCH_CACHE_SIZE = 200;
const STORAGE_PREFIX = "tangle-fetch:";

function remember(key, data) {
  fetchCache.delete(key);
  fetchCache.set(key, data);
  if (fetchCache.size > FETCH_CACHE_SIZE) fetchCache.delete(fetchCache.keys().next().value);
}

// localStorage can be missing, full or blocked; the cache is then just skipped.
function stored(key) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function store(key, data) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data));
  } catch {}
}

// <t-fetch name="info" url="data/${planet}.json"></t-fetch>
// or <t-fetch name="pred" url="/api/predict" body="{ age, income }" loading="busy">.
// Sends a request built from variables, again whenever they change, and puts the
// answer in a variable. Only the newest answer lands. While it waits, the variable
// keeps its old value and the elements showing it dim. Answers are cached for the
// page; cache="local" also keeps them in localStorage, and cache="none" turns it off.
class TFetch extends TangleElement {
  connectedCallback() {
    this._name = validName(this);
    if (!this._name) return;
    if (!this.hasAttribute("url")) return console.error('tangle: <t-fetch> needs a url="…"', this);
    this.scope.slot(this._name).kind = "fetch";
    this._last = null;
    this.watch((scope) => {
      let request;
      try {
        request = buildRequest(scope, {
          url: this.getAttribute("url"),
          params: this.getAttribute("params"),
          body: this.getAttribute("body"),
          method: this.getAttribute("method"),
        });
      } catch (error) {
        this._last = null;
        untracked(() => this.stop(error));
        return;
      }
      if (request.key === this._last) return; // e.g. a rounded variable that didn't change the URL
      this._last = request.key;
      untracked(() => this.request(request));
    });
  }

  disconnectedCallback() {
    this.stop();
    super.disconnectedCallback();
  }

  request(request) {
    const cache = this.getAttribute("cache") ?? "page";
    const key = `${this.getAttribute("as") ?? "json"} ${request.key}`;
    let hit = cache === "none" ? undefined : fetchCache.get(key);
    if (hit === undefined && cache === "local") hit = stored(key);
    if (hit !== undefined) {
      this.stop();
      this.scope.set(this._name, hit);
      // An answer kept from an earlier visit may be out of date: ask again, quietly.
      if (cache === "local" && !fetchCache.has(key)) this.send(request, key, { quiet: true });
      else this.settle(null);
      return;
    }
    this.send(request, key, { quiet: false });
  }

  send({ url, init }, key, { quiet }) {
    this.stop();
    const token = (this._token = {});
    if (!quiet) this.setLoading(true);
    const wait = Number(this.getAttribute("debounce") ?? 100);
    this._timer = setTimeout(async () => {
      const controller = (this._controller = new AbortController());
      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`.trim());
        const data = this.getAttribute("as") === "text" ? await response.text() : await response.json();
        if (this._token !== token) return;
        const cache = this.getAttribute("cache") ?? "page";
        if (cache !== "none") remember(key, data);
        if (cache === "local") store(key, data);
        this.scope.set(this._name, data);
        this.settle(null);
      } catch (error) {
        if (this._token === token && error.name !== "AbortError") this.settle(error);
      }
    }, Number.isFinite(wait) ? Math.max(0, wait) : 100);
  }

  /** Drops the request on its way, if any. With an error, reports it. */
  stop(error) {
    clearTimeout(this._timer);
    this._controller?.abort();
    this._token = null;
    if (error) this.settle(error);
    else this.setLoading(false);
  }

  settle(error) {
    this.setLoading(false);
    this.classList.toggle("is-error", Boolean(error));
    if (error) {
      this.title = error.message;
      console.error(`tangle: <t-fetch name="${this._name}">`, error.message);
    } else {
      this.removeAttribute("title");
    }
    const name = this.getAttribute("error");
    if (name) this.scope.set(name, error ? error.message : null);
  }

  setLoading(on) {
    if (!this._name) return;
    this.scope.setPending(this._name, on);
    const name = this.getAttribute("loading");
    if (name) this.scope.set(name, on);
  }
}

// ---------------------------------------------------------------------------
// Debugging: <t-debug> shows every variable, what it reads and what reads it.
// ---------------------------------------------------------------------------

/**
 * The variables of `scope` as data, which is what <t-debug> shows: one row per
 * variable with its `value` (or `error`), its `kind` ("value", "formula", "fetch",
 * or "unset" if something reads it but nothing sets it), whether it's `pending`,
 * how many times it has `runs`, the variables it `reads` and is `readBy`, and the
 * `elements` whose effects read it.
 */
export function inspectScope(scope) {
  return untracked(() => {
    const names = new Map(); // cell → variable name
    for (const [name, slot] of scope.slots) names.set(slot.cell, name);
    const rows = new Map();
    for (const [name, slot] of scope.slots) {
      const def = slot.def.peek();
      let value;
      let error = null;
      try {
        value = slot.cell.value;
      } catch (e) {
        error = e?.message ?? String(e);
      }
      const kind = def instanceof Formula ? "formula" : (slot.kind ?? (def === undefined ? "unset" : "value"));
      const reads = [...slot.cell.deps].filter((d) => d !== slot.cell && names.has(d)).map((d) => names.get(d));
      rows.set(name, {
        name, kind, value, error, reads,
        pending: pending.has(slot.def),
        runs: slot.cell.runs,
        readBy: [],
        elements: [],
      });
    }
    for (const row of rows.values()) for (const name of row.reads) rows.get(name).readBy.push(row.name);
    for (const el of watchers) {
      const read = new Set();
      for (const e of el._effects) for (const d of e.deps) if (names.has(d)) read.add(names.get(d));
      for (const name of read) rows.get(name).elements.push(el);
    }
    return [...rows.values()];
  });
}

const DEBUG_COLUMN_GAP = 48;
const DEBUG_ROW_GAP = 12;
const DEBUG_NODE_HEIGHT = 38;
const DEBUG_CHAR = 7.3; // the width of a character of the 12px monospace font, roughly

/**
 * Where <t-debug> draws each variable: left to right in columns, each formula
 * one column after the furthest variable it reads, ordered within a column to
 * keep edges short. Takes rows like inspectScope's, returns { nodes, edges,
 * width, height }, with nodes in column order.
 */
export function layoutGraph(rows) {
  const byName = new Map(rows.map((row) => [row.name, row]));
  const depth = new Map();
  const depthOf = (row, seen = new Set()) => {
    if (depth.has(row.name)) return depth.get(row.name);
    if (seen.has(row.name)) return 0; // a cycle
    seen.add(row.name);
    const d = Math.max(-1, ...row.reads.filter((n) => byName.has(n)).map((n) => depthOf(byName.get(n), seen))) + 1;
    depth.set(row.name, d);
    return d;
  };
  const columns = [];
  rows.forEach((row) => (columns[depthOf(row)] ??= []).push(row));
  for (let i = 0; i < columns.length; i++) columns[i] ??= [];

  // Order each column by the average position of the variables it reads, then
  // of the ones that read it, a few times over (the barycenter heuristic).
  const rank = new Map();
  // A box's position is where its center ends up, in boxes from the top: columns are centered.
  const tallest = Math.max(0, ...columns.map((col) => col.length));
  const index = () => columns.forEach((col) => col.forEach((row, i) => rank.set(row.name, (tallest - col.length) / 2 + i)));
  const mean = (names, fallback) => {
    const known = names.filter((n) => rank.has(n));
    return known.length ? known.reduce((sum, n) => sum + rank.get(n), 0) / known.length : fallback;
  };
  const order = (col, neighbours) => {
    const keyed = col.map((row) => [mean(neighbours(row), rank.get(row.name)), row]);
    keyed.sort((a, b) => a[0] - b[0]);
    col.splice(0, col.length, ...keyed.map(([, row]) => row));
  };
  index();
  for (let sweep = 0; sweep < 4; sweep++) {
    for (const col of columns.slice(1)) order(col, (row) => row.reads), index();
    for (const col of columns.slice(0, -1).reverse()) order(col, (row) => row.readBy), index();
  }

  const nodes = [];
  const at = new Map();
  const height = tallest * DEBUG_NODE_HEIGHT + Math.max(0, tallest - 1) * DEBUG_ROW_GAP;
  let x = 1; // room for the outline of the nodes on the edge
  for (const col of columns) {
    const labels = col.map((row) => (row.error ? `⚠ ${row.error}` : preview(row.value, 20)));
    const width = Math.max(64, ...col.map((row, i) => Math.max(row.name.length, labels[i].length) * DEBUG_CHAR + 20));
    const used = col.length * DEBUG_NODE_HEIGHT + Math.max(0, col.length - 1) * DEBUG_ROW_GAP;
    col.forEach((row, i) => {
      const node = { row, label: labels[i], x, y: 1 + (height - used) / 2 + i * (DEBUG_NODE_HEIGHT + DEBUG_ROW_GAP), width, height: DEBUG_NODE_HEIGHT };
      nodes.push(node);
      at.set(row.name, node);
    });
    x += width + DEBUG_COLUMN_GAP;
  }
  const edges = rows.flatMap((row) => row.reads.filter((n) => at.has(n)).map((n) => ({ from: at.get(n), to: at.get(row.name) })));
  return { nodes, edges, width: Math.max(0, x - DEBUG_COLUMN_GAP) + 2, height: height + 2 };
}

function htmlNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svgNode(tag, attrs, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text != null) node.textContent = text;
  return node;
}

/** A short, one-line version of any value, for <t-debug>. */
function preview(value, max = 48) {
  if (typeof value === "function") return `ƒ ${value.name || "anonymous"}`;
  if (typeof value === "number" || typeof value === "boolean" || value == null) return String(value);
  let s;
  try {
    s = JSON.stringify(value) ?? String(value);
  } catch {
    s = String(value);
  }
  if (s.length <= max) return s;
  return Array.isArray(value) ? `Array(${value.length}) ${s.slice(0, max - 12)}…` : `${s.slice(0, max - 1)}…`;
}

// <t-debug></t-debug>
// A live table of variables: their values, what each reads and what reads it, and
// which elements show it. Inside a <t-scope> it shows that scope, elsewhere every
// scope on the page. Hovering a row outlines the elements that show the variable.
// Add ?tangle-debug to any page's URL to float one over it.
class TDebug extends Base {
  connectedCallback() {
    this._seen ??= new Map(); // the values shown last time, to flash the ones that change
    this._outlined = new Set();
    // A plain effect, not watch(): the table isn't a view of the variables, so it doesn't dim.
    this._dispose = effect(() => {
      graphVersion.value, hover.value;
      for (const [, scope] of this.scopes()) {
        for (const slot of scope.slots.values()) {
          slot.def.value;
          try {
            slot.cell.value;
          } catch {}
        }
      }
      this._frame ??= requestAnimationFrame(() => {
        this._frame = null;
        if (this.isConnected) this.render();
      });
    });
    this._onClick ??= (event) => {
      const target = event.target.closest?.(".t-debug-node, .t-debug-value");
      if (target) console.log(target.dataset.name, target._value); // the whole value, to explore
    };
    this.addEventListener("click", this._onClick);
  }

  disconnectedCallback() {
    this._dispose?.();
    cancelAnimationFrame(this._frame);
    this._frame = null;
    this.outline(new Set());
    this.removeEventListener("click", this._onClick);
  }

  /** [label, scope] for each scope shown. */
  scopes() {
    if (this.closest("t-scope")) return [["", scopeOf(this)]];
    const hosts = [...document.querySelectorAll("t-scope")];
    return [
      ["page", scopeOf(document)],
      ...hosts.map((host, i) => [host.id ? `#${host.id}` : `<t-scope> ${i + 1}`, scopeOf(host)]),
    ].filter(([, scope]) => scope.slots.size);
  }

  render() {
    const scopes = this.scopes();
    const outlined = new Set();
    const parts = [];
    const table = htmlNode("table", "t-debug-table");
    const head = table.createTHead().insertRow();
    for (const title of ["variable", "value", "reads", "read by"]) head.append(htmlNode("th", null, title));
    const body = table.createTBody();
    for (const [label, scope] of scopes) {
      const rows = inspectScope(scope).map((row) => {
        const key = keyOf(scope, row.name);
        const changed = this._seen.has(key) && !Object.is(this._seen.get(key), row.value);
        this._seen.set(key, row.value);
        const hot = hover.peek() === key;
        if (hot) for (const e of row.elements) outlined.add(e);
        return { ...row, key, changed, hot, color: scope.slot(row.name).meta.peek().color };
      });
      if (scopes.length > 1) {
        parts.push(htmlNode("div", "t-debug-scope", label));
        body.insertRow().append(Object.assign(htmlNode("th", "t-debug-scope", label), { colSpan: 4 }));
      }
      const layout = layoutGraph(rows);
      parts.push(this.graph(layout, rows.find((row) => row.hot)));
      for (const { row } of layout.nodes) body.append(this.tableRow(row));
    }
    if (!parts.length) parts.push(htmlNode("div", "t-debug-empty", "No variables yet."));
    const details = htmlNode("details", "t-debug-details");
    details.open = Boolean(this._tableOpen);
    details.addEventListener("toggle", () => (this._tableOpen = details.open));
    details.append(htmlNode("summary", null, "table"), table);
    this.replaceChildren(...parts, details);
    this.outline(outlined);
  }

  /** The variables as a graph: an edge from each variable to the formulas that read it. */
  graph({ nodes, edges, width, height }, hot) {
    const svg = svgNode("svg", { class: "t-debug-graph", width, height, viewBox: `0 0 ${width} ${height}` });
    for (const { from, to } of edges) {
      const x1 = from.x + from.width;
      const y1 = from.y + from.height / 2;
      const x2 = to.x;
      const y2 = to.y + to.height / 2;
      const mid = (x1 + x2) / 2;
      const lit = hot && (from.row === hot || to.row === hot);
      svg.append(svgNode("path", {
        class: lit ? "t-debug-edge is-hot" : hot ? "t-debug-edge is-faded" : "t-debug-edge",
        d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`,
      }));
    }
    for (const node of nodes) {
      const { row } = node;
      const kind = row.pending ? "loading" : row.kind;
      const g = svgNode("g", {
        class: `t-debug-node is-${kind}${row.hot ? " is-hot" : ""}${row.changed ? " is-changed" : ""}${row.error ? " is-error" : ""}`,
        transform: `translate(${node.x},${node.y})`,
        "data-tangle-hover": row.key,
      });
      if (row.color) g.style.setProperty("--tangle-color", row.color);
      g._value = row.error ?? row.value;
      g.dataset.name = row.name;
      g.append(
        svgNode("rect", { width: node.width, height: node.height, rx: 6 }),
        svgNode("text", { x: 10, y: 15, class: "t-debug-node-name" }, row.name),
        svgNode("text", { x: 10, y: 29, class: "t-debug-node-value" }, node.label),
        svgNode("title", {}, `${row.name} (${row.kind === "unset" ? "never set" : kind}${row.kind === "formula" ? `, ran ${row.runs}×` : ""})\n${row.error ?? preview(row.value, 2000)}`),
      );
      svg.append(g);
    }
    return svg;
  }

  tableRow(row) {
    const tr = htmlNode("tr");
    tr.dataset.tangleHover = row.key;
    tr.classList.toggle("is-changed", row.changed);
    tr.classList.toggle("is-hot", row.hot);
    const name = htmlNode("td", "t-debug-name", row.name);
    if (row.color) name.style.setProperty("--tangle-color", row.color);
    const kind = row.pending ? "loading" : row.kind === "unset" ? "never set" : row.kind;
    const runs = row.kind === "formula" ? ` ×${row.runs}` : "";
    name.append(htmlNode("span", `t-debug-kind is-${row.pending ? "loading" : row.kind}`, kind + runs));
    const value = htmlNode("td", "t-debug-value", row.error ? `⚠ ${row.error}` : preview(row.value));
    value.classList.toggle("is-error", Boolean(row.error) || row.kind === "unset");
    value.dataset.name = row.name;
    value._value = row.error ?? row.value;
    value.title = row.error ?? preview(row.value, 2000);
    const counts = new Map();
    for (const e of row.elements) counts.set(e.localName, (counts.get(e.localName) ?? 0) + 1);
    const shown = [...counts].map(([tag, n]) => (n > 1 ? `<${tag}> ×${n}` : `<${tag}>`));
    tr.append(name, value, htmlNode("td", null, row.reads.join(", ")), htmlNode("td", null, [...row.readBy, ...shown].join(", ")));
    return tr;
  }

  outline(elements) {
    for (const el of this._outlined) if (!elements.has(el)) el.classList.remove("t-debug-target");
    for (const el of elements) el.classList.add("t-debug-target");
    this._outlined = elements;
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

/** The scope's names, with the ones in `extra` taking precedence: the `with` target of evalWith. */
function withExtra(scope, extra) {
  return new Proxy(Object.create(null), {
    has: (_, key) => key in extra || Reflect.has(scope.proxy, key),
    get: (_, key) => (typeof key === "string" && key in extra ? extra[key] : scope.proxy[key]),
  });
}

/** Evaluate `expr` against `scope`, with the names in `extra` (e.g. { Plot, d3 }) taking precedence. */
export function evalWith(scope, expr, extra) {
  return compile(expr)(withExtra(scope, extra));
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
// JSXGraph: <t-jsxgraph> runs a script once to build a board. Functions on the
// board can read variables, and points made with point() set them when dragged.
// ---------------------------------------------------------------------------

/** Element defaults that draw in the page's colors, so the board follows the theme. */
function jsxgraphTheme(el) {
  const css = getComputedStyle(el);
  const pct = (name, fallback) => {
    const n = parseFloat(css.getPropertyValue(name));
    return (Number.isFinite(n) ? n : fallback) / 100;
  };
  const font = css.getPropertyValue("--tangle-chart-font").match(/([\d.]+)px/);
  const ink = (color) => ({ strokeColor: color, highlightStrokeColor: color, fillColor: color, highlightFillColor: color });
  const accent = ink("var(--tangle-accent)");
  const grid = pct("--tangle-chart-grid", 12);
  const label = { strokeColor: "currentColor", strokeOpacity: pct("--tangle-chart-text", 60), fontSize: font ? Number(font[1]) : 12 };
  const axis = {
    ...ink("currentColor"), strokeOpacity: Math.min(1, grid * 3), highlightStrokeOpacity: Math.min(1, grid * 3),
    strokeWidth: 1, highlightStrokeWidth: 1, lastArrow: false, withLabel: false,
    ticks: { ...ink("currentColor"), strokeOpacity: grid, highlightStrokeOpacity: grid, majorHeight: -1, minorTicks: 0, label },
  };
  return {
    axis,
    elements: { point: { ...accent, size: 4, withLabel: false, showInfobox: false },
      line: { ...accent, strokeWidth: 2.5, highlightStrokeWidth: 4 },
      curve: { ...accent, strokeWidth: 2.5, highlightStrokeWidth: 4 },
      circle: { ...accent, strokeWidth: 2.5, highlightStrokeWidth: 4, fillOpacity: 0, highlightFillOpacity: 0 },
      polygon: { ...accent, fillOpacity: 0.16, highlightFillOpacity: 0.16 },
      text: { ...ink("currentColor"), fontSize: label.fontSize },
      label: { ...ink("currentColor"), fontSize: label.fontSize } },
  };
}

// An element's own color stays its color on hover: highlight* defaults to it.
const HIGHLIGHT = {
  strokeColor: "highlightStrokeColor", fillColor: "highlightFillColor",
  strokeOpacity: "highlightStrokeOpacity", fillOpacity: "highlightFillOpacity", cssClass: "highlightCssClass",
};

// <t-jsxgraph x="0 100" y="0 100" axis><script type="text/plain">…</script></t-jsxgraph>
// or <t-jsxgraph src="board.js">. The script runs once, with board, JXG and point() in reach.
class TJsxgraph extends TangleElement {
  connectedCallback() {
    this._source ??= this.hasAttribute("src")
      ? fetch(this.getAttribute("src")).then((r) => {
          if (!r.ok) throw new Error(`${this.getAttribute("src")}: ${r.status}`);
          return r.text();
        })
      : Promise.resolve(this.querySelector("script")?.textContent ?? this.textContent);
    if (!this._target) {
      this._target = document.createElement("div");
      this._target.className = "tangle-jsxgraph is-loading";
      this._target.textContent = "Loading board…";
      this.append(this._target);
    }
    const token = (this._token = {});
    Promise.all([loadJsxgraph(), this._source]).then(
      ([JXG, body]) => {
        if (this._token === token && this.isConnected) this.start(JXG, body);
      },
      (error) => {
        if (this._token === token) this.showError(error);
      },
    );
  }

  disconnectedCallback() {
    this._token = null;
    for (const type of ["pointerdown", "pointermove"]) removeEventListener(type, this._forgetPosition, true);
    if (this._board) this._jxg.JSXGraph.freeBoard(this._board);
    this._board = null;
    super.disconnectedCallback();
  }

  start(JXG, body) {
    const scope = scopeOf(this);
    const range = (attr, fallback) => {
      const [lo, hi] = (this.getAttribute(attr) ?? fallback).trim().split(/[\s,]+/).map(Number);
      return [lo, hi];
    };
    const [x0, x1] = range("x", "-5 5");
    const [y0, y1] = range("y", "-5 5");
    const theme = jsxgraphTheme(this);
    this._target.className = "tangle-jsxgraph";
    this._target.textContent = "";
    this._target.id ||= `tangle-jsxgraph-${++jsxgraphCount}`;
    let board;
    try {
      board = JXG.JSXGraph.initBoard(this._target.id, {
        boundingbox: [x0, y1, x1, y0], keepAspectRatio: false,
        axis: this.hasAttribute("axis"), defaultAxes: { x: theme.axis, y: theme.axis },
        showNavigation: false, showCopyright: false, showInfobox: false,
        pan: { enabled: false }, zoom: { enabled: false },
      });
    } catch (error) {
      this.showError(error);
      return;
    }
    this._jxg = JXG;
    this._board = board;
    // JSXGraph caches where the board is on the page, for a second and for a whole drag. Text above
    // it that changes length moves it, so forget the cached spot before JSXGraph reads a pointer.
    this._forgetPosition = () => (board.cPos = []);
    for (const type of ["pointerdown", "pointermove"]) addEventListener(type, this._forgetPosition, true);
    for (const [type, defaults] of Object.entries(theme.elements)) Object.assign(board.options[type], defaults);
    const create = board.create.bind(board);
    board.create = (type, parents, attributes = {}) => {
      const own = { ...attributes };
      for (const [key, highlight] of Object.entries(HIGHLIGHT)) {
        if (key in own && !(highlight in own)) own[highlight] = own[key];
      }
      return create(type, parents, own);
    };

    // Updates the board makes for the page (below) aren't the reader's, so they don't set variables.
    let quiet = false;
    const quietly = (fn) => {
      quiet = true;
      try {
        fn();
      } finally {
        quiet = false;
      }
    };
    // A coordinate is a variable's name, or a number for one that stays put.
    const read = (coord) => (typeof coord === "number" ? coord : scope.peek(coord));
    const fit = (coord, value) => {
      if (typeof coord === "number") return coord;
      const meta = scope.meta(coord);
      return meta.min == null && meta.max == null && meta.step == null ? value : snap(value, meta);
    };
    const bound = [];
    const point = (x, y, attributes = {}) => {
      const p = board.create("point", [read(x), read(y)], attributes);
      bound.push({ p, x, y });
      // Variable → point, when something else on the page changes it.
      this.watch(() => {
        const at = [x, y].map((coord) => (typeof coord === "number" ? coord : scope.get(coord)));
        if (at[0] !== p.X() || at[1] !== p.Y()) {
          quietly(() => {
            p.setPosition(JXG.COORDS_BY_USER, at);
            board.update();
          });
        }
      });
      return p;
    };
    // Point → variable, after the reader drags (or arrow-keys) anything on the board. The
    // variables snap to their min, max and step, and the points follow them a moment later.
    board.on("update", () => {
      if (quiet) return;
      const values = {};
      let moved = false;
      for (const { p, x, y } of bound) {
        const at = [fit(x, p.X()), fit(y, p.Y())];
        if (typeof x === "string") values[x] = at[0];
        if (typeof y === "string") values[y] = at[1];
        moved ||= at[0] !== p.X() || at[1] !== p.Y();
      }
      untracked(() => scope.setValues(values));
      // A point whose variable changed follows it in its own effect. One that moved without
      // changing it (off a fixed coordinate, or less than a step) goes back here.
      if (moved) {
        queueMicrotask(() => {
          const off = bound.filter(({ p, x, y }) => read(x) !== p.X() || read(y) !== p.Y());
          if (!off.length) return;
          quietly(() => {
            for (const { p, x, y } of off) p.setPosition(JXG.COORDS_BY_USER, [read(x), read(y)]);
            board.update();
          });
        });
      }
    });

    try {
      // Sloppy mode, so `with` is allowed: the script sees the page's variables directly.
      new Function("$scope", `with ($scope) {\n${body}\n}`)(withExtra(scope, { board, JXG, point }));
    } catch (error) {
      this.showError(error);
      return;
    }
    // Functions on the board (coordinates, visible, …) run during an update, so updating inside
    // an effect tracks every variable they read, and the board updates when one changes.
    this.watch(() => quietly(() => board.update()));
  }

  showError(error) {
    this._target.remove();
    this._error ??= Object.assign(document.createElement("div"), { className: "tangle-jsxgraph-error" });
    this._error.textContent = `t-jsxgraph: ${error.message}`;
    this.append(this._error);
  }
}
let jsxgraphCount = 0;

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
    "t-select": TSelect,
    "t-text": TText,
    "t-call": TCall,
    "t-fetch": TFetch,
    "t-debug": TDebug,
    "t-tag": TTag,
    "t-math": TMath,
    "t-vega": TVega,
    "t-obsplot": TObsplot,
    "t-jsxgraph": TJsxgraph,
    "t-panel": TPanel,
    "t-paint": TPaint,
  };
  for (const [tag, cls] of Object.entries(elements)) {
    if (!customElements.get(tag)) customElements.define(tag, cls);
  }

  // ?tangle-debug in the URL floats a <t-debug> over any page.
  if (new URLSearchParams(location.search).has("tangle-debug")) {
    const addDebug = () => {
      const panel = document.createElement("t-panel");
      panel.setAttribute("label", "Debug");
      panel.setAttribute("corner", "bottom-left");
      panel.append(document.createElement("t-debug"));
      document.body.append(panel);
    };
    if (document.body) addDebug();
    else document.addEventListener("DOMContentLoaded", addDebug);
  }
}
