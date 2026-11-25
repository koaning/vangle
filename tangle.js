// tangle.js: reactive documents for static HTML, after Bret Victor's Tangle.
//
// Drop-in usage:
//   <link rel="stylesheet" href="tangle.css">
//   <script type="module" src="tangle.js"></script>
//
//   When you eat <t-num name="cookies" min="0" max="20">3</t-num> cookies,
//   you consume <t-out expr="cookies * 50"></t-out> calories.
//
// Zero dependencies. KaTeX is loaded lazily, and only if the page has a <t-math>,
// a <t-formula-dag> or math in a <t-flow> note; likewise Vega, only if it has a
// <t-vega>, Observable Plot for <t-obsplot>, d3 for <t-graph>, JSXGraph for
// <t-jsxgraph>, and CodeMirror for <t-codecell>.
// MIT license.
//
// Built by `make build` from src/. Edit the files there, not this one.

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
    const slot = this.slot(name);
    const before = slot.previewing ? slot.baseline : slot.def.peek();
    slot.previewing = false;
    slot.baseline = undefined;
    slot.def.value = value;
    if (slot.prev && !Object.is(value, before)) {
      this.set(slot.prev, before === undefined ? value : before);
    }
  }
  /** Set a live, uncommitted value during a drag, edit or menu browse; end with commit() or revert(). */
  preview(name, value) {
    const slot = this.slot(name);
    if (!slot.previewing) {
      slot.baseline = slot.def.peek();
      slot.previewing = true;
    }
    slot.def.value = value;
  }
  /** Finish an active preview, keeping the current value as committed. */
  commit(name) {
    const slot = this.slots.get(name);
    if (!slot?.previewing) return;
    const before = slot.baseline;
    const after = slot.def.peek();
    slot.previewing = false;
    slot.baseline = undefined;
    if (slot.prev && !Object.is(after, before)) {
      this.set(slot.prev, before === undefined ? after : before);
    }
  }
  /** Cancel an active preview, restoring the value from before preview() started. */
  revert(name) {
    const slot = this.slots.get(name);
    if (!slot?.previewing) return;
    const before = slot.baseline;
    slot.previewing = false;
    slot.baseline = undefined;
    slot.def.value = before;
  }
  /** Store `name`'s previous committed value in `prevName` whenever `name` commits a change. */
  trackPrevious(name, prevName) {
    const slot = this.slot(name);
    slot.prev = prevName;
    const cur = slot.previewing ? slot.baseline : slot.def.peek();
    if (cur !== undefined && this.slot(prevName).def.peek() === undefined) {
      this.set(prevName, cur);
    }
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
// Lazy loading: KaTeX for <t-math>, Vega for <t-vega>, Plot for <t-obsplot>,
// d3 for <t-graph>, CodeMirror for <t-codecell>. Each
// loads only if the page has such an element, and a copy the page already loaded is reused.
// ---------------------------------------------------------------------------

const KATEX_VERSION = "0.19.0";
const CDN = "https://cdn.jsdelivr.net/npm/";
// CodeMirror's packages must share one copy of @codemirror/state and view, so
// they come from esm.sh with the shared ones pinned.
const CM_DEPS = "?deps=@codemirror/state@6.7.6,@codemirror/view@6.43.15,@codemirror/language@6.13.1,@lezer/highlight@1.2.5";
const config = {
  katexUrl: `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.mjs`,
  katexCssUrl: `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`,
  vegaUrl: `${CDN}vega@6.4.0/build/vega.min.js`,
  vegaLiteUrl: `${CDN}vega-lite@6.4.3/build/vega-lite.min.js`,
  vegaEmbedUrl: `${CDN}vega-embed@7.3.0/build/vega-embed.min.js`,
  d3Url: `${CDN}d3@7.9.0/dist/d3.min.js`,
  plotUrl: `${CDN}@observablehq/plot@0.6.17/dist/plot.umd.min.js`,
  jsxgraphUrl: `${CDN}jsxgraph@1.14.0/distrib/jsxgraphcore.js`,
  codemirrorUrl: `https://esm.sh/codemirror@6.0.2${CM_DEPS}`,
  // With state as its only pinned dependency, esm.sh gives the copy of view the others use.
  codemirrorViewUrl: "https://esm.sh/@codemirror/view@6.43.15?deps=@codemirror/state@6.7.6",
  codemirrorJsUrl: `https://esm.sh/@codemirror/lang-javascript@6.2.5${CM_DEPS}`,
  codemirrorLanguageUrl: `https://esm.sh/@codemirror/language@6.13.1${CM_DEPS}`,
  lezerHighlightUrl: "https://esm.sh/@lezer/highlight@1.2.5",
  pixelsPerStep: 5,
};

/**
 * Override defaults: { katexUrl, katexCssUrl, vegaUrl, vegaLiteUrl, vegaEmbedUrl, d3Url,
 * plotUrl, jsxgraphUrl, codemirrorUrl, codemirrorViewUrl, codemirrorJsUrl, codemirrorLanguageUrl,
 * lezerHighlightUrl, pixelsPerStep }. Call before KaTeX, Vega, d3, Plot, JSXGraph or CodeMirror loads.
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

// d3's build is a classic script that sets the d3 global. Returns d3.
let d3Promise = null;
function loadD3() {
  return (d3Promise ??= (async () => {
    await null; // let a same-module configure() call run first
    if (globalThis.TangleConfig) Object.assign(config, globalThis.TangleConfig);
    if (!globalThis.d3) await loadScript(config.d3Url);
    return globalThis.d3;
  })());
}

// Plot's UMD build needs d3 as a global, so d3 loads first. Returns { Plot, d3 }.
let plotPromise = null;
function loadPlot() {
  return (plotPromise ??= (async () => {
    await loadD3();
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

// CodeMirror 6 is ES modules. Returns { EditorView, ViewPlugin, Decoration, basicSetup,
// javascript, syntaxHighlighting, syntaxTree, classHighlighter }.
let codemirrorPromise = null;
function loadCodemirror() {
  return (codemirrorPromise ??= (async () => {
    await null; // let a same-module configure() call run first
    if (globalThis.TangleConfig) Object.assign(config, globalThis.TangleConfig);
    const [cm, view, js, language, highlight] = await Promise.all([
      import(config.codemirrorUrl),
      import(config.codemirrorViewUrl),
      import(config.codemirrorJsUrl),
      import(config.codemirrorLanguageUrl),
      import(config.lezerHighlightUrl),
    ]);
    return {
      EditorView: cm.EditorView,
      ViewPlugin: view.ViewPlugin,
      Decoration: view.Decoration,
      basicSetup: cm.basicSetup,
      javascript: js.javascript,
      syntaxHighlighting: language.syntaxHighlighting,
      syntaxTree: language.syntaxTree,
      classHighlighter: highlight.classHighlighter,
    };
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
  const host = el.closest("t-math, t-formula-dag");
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
  drag.scope.preview(drag.name, nudge(drag.startValue, Math.trunc(dx / pps) * step, meta));
}

function onPointerUp(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const finished = drag;
  drag = null;
  document.documentElement.classList.remove("tangle-dragging");
  if (finished.pointerType !== "mouse") hover.value = null;
  if (event.type === "pointercancel" || finished.moved) {
    if (finished.moved) finished.scope.commit(finished.name);
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
  if (text) {
    input.addEventListener("input", () => scope.preview(name, input.value));
  }
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
  if (ed.text) {
    if (commit) {
      ed.scope.preview(ed.name, ed.input.value);
      ed.scope.commit(ed.name);
    } else {
      ed.scope.revert(ed.name);
    }
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
  menu = { el, box, input, list, options, scope, name, original: scope.peek(name), shown: [], index: -1 };
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
  const { input, list, options, original } = menu;
  const query = input.value;
  menu.shown = filterOptions(options, query);
  list.replaceChildren(
    ...menu.shown.map((option, i) => {
      const row = document.createElement("li");
      row.id = `${list.id}-${i}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(Object.is(option.value, original)));
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
  highlight(query.trim() ? 0 : menu.shown.findIndex((o) => Object.is(o.value, original)));
}

function highlight(index, scroll = true) {
  const { input, list, shown, scope, name } = menu;
  menu.index = shown.length ? Math.max(0, Math.min(index, shown.length - 1)) : -1;
  const rows = shown.length ? [...list.children] : [];
  rows.forEach((row, i) => row.classList.toggle("is-highlighted", i === menu.index));
  const row = rows[menu.index];
  if (row) {
    input.setAttribute("aria-activedescendant", row.id);
    scope.preview(name, shown[menu.index].value);
  } else {
    input.removeAttribute("aria-activedescendant");
    scope.revert(name);
  }
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
  if (option) {
    m.scope.preview(m.name, option.value);
    m.scope.commit(m.name);
  } else {
    m.scope.revert(m.name);
  }
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

// The document-level listeners behind all of the above. Called once, in a browser.
function listen() {
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
}

// ---------------------------------------------------------------------------
// TeX markers: \tangle[symbol]{name} and \val[format]{expression}
// ---------------------------------------------------------------------------

/** The index of the bracket that closes the one at `start` (skipping backslash escapes). */
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

/**
 * The TeX for parsed parts (from parseTex) right now: \tangle markers show
 * their variable's value (or their symbol, unless being dragged or edited) and
 * \val markers their result. `text` maps the literal strings in between.
 * Reactive: inside an effect, re-runs when a value it showed changes.
 */
function partsTex(parts, scope, text = (s) => s) {
  let tex = "";
  for (const part of parts) {
    if (typeof part === "string") {
      tex += text(part);
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
  return tex;
}

// ---------------------------------------------------------------------------
// DAG layout for <t-formula-dag>: layering, ordering within a layer, routes
// through the layers an edge skips, and the plain geometry the arrows use.
// No DOM here: boxes are { left, right, top, bottom } in px.
// ---------------------------------------------------------------------------

// Waypoint ids: an edge that skips a layer threads one per skipped layer.
// "!" can't start a formula name, so these never collide with one.
const DAG_WAYPOINT = "!wp";
const DAG_NEAR_X = 6; // two vertical runs closer than this read as one line

/** One cycle among `edges` as a list of names (first equals last), or null. */
function dagCycle(names, edges) {
  const children = new Map(names.map((n) => [n, []]));
  for (const [src, dst] of edges) children.get(src).push(dst);
  const state = new Map(); // name -> "visiting" | "done"
  const stack = [];
  const visit = (n) => {
    state.set(n, "visiting");
    stack.push(n);
    for (const c of children.get(n)) {
      if (state.get(c) === "visiting") return [...stack.slice(stack.indexOf(c)), c];
      if (!state.has(c)) {
        const found = visit(c);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(n, "done");
    return null;
  };
  for (const n of names) {
    if (state.has(n)) continue;
    const found = visit(n);
    if (found) return found;
  }
  return null;
}

/**
 * The layer of each node (0 = top), as a Map: one below the deepest node it
 * comes from, so nodes without parents share the top layer. `minRows` (a Map)
 * pushes a node down to at least that layer, and everything below it follows,
 * so a minimum never puts a node above one it comes from. `edges` must be acyclic.
 */
function dagLayers(names, edges, minRows = new Map()) {
  const parents = new Map(names.map((n) => [n, []]));
  for (const [src, dst] of edges) parents.get(dst).push(src);
  const layer = new Map();
  const place = (n) => {
    if (!layer.has(n)) {
      const below = 1 + Math.max(-1, ...parents.get(n).map(place));
      layer.set(n, Math.max(minRows.get(n) ?? 0, below));
    }
    return layer.get(n);
  };
  names.forEach(place);
  return layer;
}

/** Every ordering of `items`, starting with `items` itself. */
function* dagPermutations(items) {
  if (items.length <= 1) {
    yield items.slice();
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of dagPermutations(rest)) yield [items[i], ...p];
  }
}

/** The first of `candidates` with the lowest `score` (stops early at zero). */
function dagBest(candidates, score) {
  let best = null;
  let bestCost = Infinity;
  for (const c of candidates) {
    const cost = score(c);
    if (cost < bestCost) {
      best = c;
      bestCost = cost;
      if (cost === 0) break;
    }
  }
  return best;
}

/**
 * Order the nodes within each layer to reduce crossings, and split every edge
 * that skips layers with waypoints. `layerOf` maps a node to its layer (from
 * dagLayers); `names` seeds each layer's order. Returns { layers, routes }:
 * `layers` top to bottom, each a list of ids (names or waypoints), and one
 * route [src, ...waypoints, dst] per edge. Layers wider than `cap` keep their
 * seeded order instead of trying every permutation. Empty layers are dropped.
 * Edges whose index is in `direct` still count for ordering but get no
 * waypoints: their route is just [src, dst], for arrows routed freely.
 */
function dagOrder(names, layerOf, edges, { sweeps = 8, cap = 6, direct = new Set() } = {}) {
  const deepest = Math.max(0, ...names.map((n) => layerOf.get(n)));
  const layers = Array.from({ length: deepest + 1 }, () => []);
  for (const n of names) layers[layerOf.get(n)].push(n);

  const below = new Map(); // id -> ids one layer down, after splitting
  const link = (a, b) => (below.has(a) ? below.get(a).push(b) : below.set(a, [b]));
  const routes = [];
  let waypoints = 0;
  edges.forEach(([src, dst], i) => {
    if (direct.has(i)) {
      link(src, dst);
      routes.push([src, dst]);
      return;
    }
    let prev = src;
    const chain = [src];
    for (let l = layerOf.get(src) + 1; l < layerOf.get(dst); l++) {
      const wp = `${DAG_WAYPOINT}${waypoints++}`;
      layers[l].push(wp);
      link(prev, wp);
      chain.push(wp);
      prev = wp;
    }
    link(prev, dst);
    chain.push(dst);
    routes.push(chain);
  });

  const crossings = (upper, lower) => {
    const pos = new Map(lower.map((n, i) => [n, i]));
    const segs = [];
    upper.forEach((n, i) => {
      for (const c of below.get(n) ?? []) if (pos.has(c)) segs.push([i, pos.get(c)]);
    });
    let count = 0;
    for (let a = 0; a < segs.length; a++) {
      for (let b = a + 1; b < segs.length; b++) {
        if ((segs[a][0] - segs[b][0]) * (segs[a][1] - segs[b][1]) < 0) count++;
      }
    }
    return count;
  };
  const best = (layer, score) => dagBest(dagPermutations(layer), score);
  for (let s = 0; s < sweeps; s++) {
    for (let l = 1; l <= deepest; l++) {
      if (layers[l].length <= cap) layers[l] = best(layers[l], (p) => crossings(layers[l - 1], p));
    }
    for (let l = deepest - 1; l >= 0; l--) {
      if (layers[l].length <= cap) layers[l] = best(layers[l], (p) => crossings(p, layers[l + 1]));
    }
  }
  // A minimum row can leave layers that nothing (not even a waypoint) passes through.
  return { layers: layers.filter((l) => l.length), routes };
}

/** Everything reachable from `start` along `next` (a Map of id -> ids), not counting `start`. */
function dagReach(start, next) {
  const seen = new Set();
  const todo = [start];
  while (todo.length) {
    for (const m of next.get(todo.pop()) ?? []) {
      if (!seen.has(m)) {
        seen.add(m);
        todo.push(m);
      }
    }
  }
  return seen;
}

/** The box around `boxes`, or null when there are none. */
function rectUnion(boxes) {
  if (!boxes.length) return null;
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    right: Math.max(...boxes.map((b) => b.right)),
    top: Math.min(...boxes.map((b) => b.top)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

/**
 * Where an arrow lands on the symbol box `sym`: "top" when no glyph covers
 * it, otherwise "right" or "left" (whichever is clear, preferring the side
 * facing the arrow, which comes down at `fromX`). `pad` is how much vertical
 * clearance a side run keeps from the glyphs next to the symbol.
 */
function landingSide(sym, glyphs, fromX, pad = 4) {
  // Anything starting higher up over the symbol's x-range covers it: a
  // fraction bar or numerator, a limit, or a radical (whose SVG also reaches
  // down past the symbol, so don't require it to end above).
  const above = glyphs.some((g) => g.right > sym.left + 1 && g.left < sym.right - 1 && g.top < sym.top - 2);
  if (!above) return "top";
  const rowMates = glyphs.filter((g) => g.bottom > sym.top - pad && g.top < sym.bottom + pad);
  const rightClear = !rowMates.some((g) => g.left >= sym.right - 1);
  const leftClear = !rowMates.some((g) => g.right <= sym.left + 1);
  const preferRight = fromX >= (sym.left + sym.right) / 2;
  if (rightClear && (preferRight || !leftClear)) return "right";
  if (leftClear) return "left";
  return "top";
}

/**
 * The cost of stacking producers' tracks top to bottom in `order` inside one
 * gap between rows. `bySrc` maps a producer to its segments { from, to }: a
 * segment drops at `from`, runs along the track, and drops again at `to`.
 * Track i above track j crosses when i's lower drop lands inside j's run, or
 * j's upper drop starts inside i's run. When i's lower drop and j's upper drop
 * share (almost) the same x, the two read as one line: worse than a crossing.
 */
function trackCrossings(order, bySrc) {
  let count = 0;
  const inside = (x, s) => x > Math.min(s.from, s.to) + 1 && x < Math.max(s.from, s.to) - 1;
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      for (const s of bySrc.get(order[i])) {
        for (const u of bySrc.get(order[j])) {
          if (inside(s.to, u)) count++;
          if (inside(u.from, s)) count++;
          if (Math.abs(s.to - u.from) < DAG_NEAR_X) count += 2;
        }
      }
    }
  }
  return count;
}

/** The order of the tracks in a gap with the fewest crossings (`seed` when more than `cap`). */
function trackOrder(seed, bySrc, cap = 6) {
  if (seed.length > cap) return seed;
  return dagBest(dagPermutations(seed), (order) => trackCrossings(order, bySrc));
}

/**
 * Spread labels along one row. Each item { cx, w } wants to sit centered on
 * cx, may not overlap the item before it (keeping `gap`), and must clear
 * `blocks` ({ left, right } spans the row can't use). Each gets the free x
 * nearest its wanted one: the wanted x itself, or flush against a block.
 * Sets item.x; items must be sorted by cx.
 */
function packRow(items, blocks, gap = 12) {
  let floor = -Infinity;
  for (const item of items) {
    const want = Math.max(item.cx - item.w / 2, floor);
    const free = (x) => x >= floor && !blocks.some((b) => x < b.right && x + item.w > b.left);
    const candidates = [want, ...blocks.flatMap((b) => [b.left - item.w, b.right])].filter(free);
    item.x = candidates.length
      ? candidates.reduce((best, x) => (Math.abs(x - want) < Math.abs(best - want) ? x : best))
      : want;
    floor = item.x + item.w + gap;
  }
  return items;
}

// ---------------------------------------------------------------------------
// The spec of a <t-formula-dag>: formulas that refer to each other's outputs
// with \use{name}, notes, and parameters. Checked and turned into a model the
// element draws, with the layout already worked out. No DOM here.
// ---------------------------------------------------------------------------

// Formula and note names end up inside \htmlData{key=name}, so keep them plain.
const DAG_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const DAG_NOTE_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
// \use{name}, and an exponent right after it (see cardTex).
const DAG_USE_RE = /\\use\s*\{([^}]*)\}(\^(?:\{[^{}]*\}|[^{}\s\\]))?/g;
const DAG_MARKER_RE = /\\(use|tangle|val|note)(?![A-Za-z])/;
const DAG_PALETTE_SIZE = 8; // --tangle-dag-1 … --tangle-dag-8
const DAG_SPEC_KEYS = ["formulas", "notes", "params", "legend", "reset"];
const DAG_FORMULA_KEYS = ["tex", "symbol", "label", "value", "format", "color", "row"];
const DAG_NOTE_KEYS = ["text", "side", "color"];
const DAG_PARAM_KEYS = ["value", "min", "max", "step", "pixelsPerStep", "label", "format", "color", "symbol"];
const DAG_SIDES = ["auto", "top", "bottom"];

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Split `tex` at its first top-level "=" into [lhs, rest]. Top-level means
 * outside any {…} group, so the "=" in \sum_{i=1} doesn't count. Null when
 * there is no such "=" or nothing before it.
 */
function splitLhs(tex) {
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    const ch = tex[i];
    if (ch === "\\") {
      i++; // \{ \} \= are not groups or splits
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
    } else if (ch === "=" && depth === 0) {
      const lhs = tex.slice(0, i).trim();
      return lhs ? [lhs, tex.slice(i + 1)] : null;
    }
  }
  return null;
}

/** Throw unless every { in `tex` has its } (KaTeX's own message wouldn't say which formula). */
function checkBraces(tex) {
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    if (tex[i] === "\\") i++;
    else if (tex[i] === "{") depth++;
    else if (tex[i] === "}" && --depth < 0) throw new Error('a "}" has no matching "{"');
  }
  if (depth) throw new Error('a "{" is never closed');
}

/** The \note{name}{body} at `start` (where "\note" begins): its name and where its body ends. */
function noteAt(tex, start) {
  const i = skipSpace(tex, start + "\\note".length);
  if (tex[i] !== "{") throw new Error("\\note must be followed by {name}{tex}");
  const nameEnd = matchClose(tex, i, "{", "}");
  const j = skipSpace(tex, nameEnd + 1);
  if (tex[j] !== "{") throw new Error("\\note must be followed by {name}{tex}");
  const bodyEnd = matchClose(tex, j, "{", "}");
  return { name: tex.slice(i + 1, nameEnd).trim(), bodyStart: j + 1, bodyEnd };
}

/** Replace every \note{name}{body} in `tex` with fn(name, body), inner notes first. */
function mapNotes(tex, fn) {
  const re = /\\note(?![A-Za-z])/g;
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(tex))) {
    const { name, bodyStart, bodyEnd } = noteAt(tex, m.index);
    out += tex.slice(last, m.index) + fn(name, mapNotes(tex.slice(bodyStart, bodyEnd), fn));
    last = bodyEnd + 1;
    re.lastIndex = last;
  }
  return out + tex.slice(last);
}

/** `tex` with every \note{name}{body} unwrapped to just its body. */
function stripNotes(tex) {
  return mapNotes(tex, (_, body) => body);
}

/** The name of the note when `tex` is exactly one \note{name}{…}, else null. */
function wholeNote(tex) {
  const t = tex.trim();
  if (!/^\\note(?![A-Za-z])/.test(t)) return null;
  const { name, bodyEnd } = noteAt(t, 0);
  return bodyEnd === t.length - 1 ? name : null;
}

/** A name as TeX, for a symbol nobody gave: x stays x, rate becomes \mathrm{rate}. */
function nameTex(name) {
  return /^[A-Za-z]$/.test(name) ? name : `\\mathrm{${name.replace(/_/g, "\\_")}}`;
}

/** A color option: "a b" is a in light mode and b in dark mode. */
function dagColor(color) {
  const pair = color.trim().split(/\s+/);
  return pair.length === 2 ? `light-dark(${pair[0]}, ${pair[1]})` : color.trim();
}

function checkKeys(obj, allowed, what) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw new Error(`${what}: unknown key "${key}" (use ${allowed.join(", ")})`);
  }
}

/**
 * Check a <t-formula-dag> spec and work out its layout. Throws an Error
 * saying what's wrong. Returns { formulas, edges, layers, routes, notes,
 * params, legend, reset }:
 * - formulas: [{ name, tex, lhs, body, symbol, label, value, format, color, outNote, row, uses }]
 *   in spec order. `lhs` is TeX (notes expanded) or null; `body` is the parsed
 *   right-hand side; `color` is a CSS color for formulas others use, else null.
 * - edges: [producer, consumer] pairs, once each, in the order the uses appear.
 * - layers, routes: from dagOrder, top to bottom. A formula sits one row below
 *   the deepest formula it uses, or lower if its `row` says so.
 * - notes: { name: { text, side, color, formula, param } }, `param` set when
 *   the note wraps exactly one \tangle.
 * - params: [{ name, symbol, config }] for every \tangle, the spec's params first.
 */
export function formulaDag(spec) {
  try {
    return buildFormulaDag(spec);
  } catch (error) {
    throw new Error(`t-formula-dag: ${error.message}`);
  }
}

function buildFormulaDag(spec) {
  if (!isPlainObject(spec)) throw new Error("the spec must be an object, like { formulas: { … } }");
  checkKeys(spec, DAG_SPEC_KEYS, "the spec");
  if (!isPlainObject(spec.formulas) || !Object.keys(spec.formulas).length) {
    throw new Error("formulas must be a non-empty object of names to TeX");
  }
  for (const key of ["legend", "reset"]) {
    if (spec[key] !== undefined && typeof spec[key] !== "boolean") throw new Error(`${key} must be true or false`);
  }
  const names = Object.keys(spec.formulas);
  const known = new Set(names);
  const noteHome = new Map(); // note -> the formula it's marked in
  const noteParam = new Map(); // note -> the parameter it wraps
  const paramSymbol = new Map(); // parameter -> its first \tangle[symbol], in order of appearance

  const formulas = names.map((name) => {
    if (!DAG_NAME_RE.test(name)) {
      throw new Error(`formula name "${name}" must start with a letter and use only letters, digits and _`);
    }
    let f = spec.formulas[name];
    if (typeof f === "string") f = { tex: f };
    if (!isPlainObject(f)) throw new Error(`formula "${name}" must be a TeX string or an object with tex`);
    checkKeys(f, DAG_FORMULA_KEYS, `formula "${name}"`);
    if (typeof f.tex !== "string" || !f.tex.trim()) throw new Error(`formula "${name}" needs a non-empty tex string`);
    try {
      return parseFormula(name, f);
    } catch (error) {
      throw new Error(`formula "${name}": ${error.message}`);
    }
  });

  function parseFormula(name, f) {
    checkBraces(f.tex);
    const split = splitLhs(f.tex);
    const [lhsTex, rhsTex] = split ?? [null, f.tex];
    if (lhsTex && /\\(use|tangle|val)(?![A-Za-z])/.test(lhsTex)) {
      throw new Error("the left of its = can't hold \\use, \\tangle or \\val");
    }
    const symbol = f.symbol ?? (lhsTex ? stripNotes(lhsTex) : nameTex(name));
    const label = f.label ?? name;
    for (const [key, v] of [["symbol", symbol], ["label", label]]) {
      if (typeof v !== "string" || !v.trim()) throw new Error(`${key} must be a non-empty string`);
    }
    if (DAG_MARKER_RE.test(symbol)) throw new Error("symbol can't hold \\use, \\tangle, \\val or \\note");
    if (f.value !== undefined && typeof f.value !== "string" && typeof f.value !== "function") {
      throw new Error("value must be an expression string or a function");
    }
    if (typeof f.value === "string") compile(f.value); // surface syntax errors now
    if (f.format !== undefined && typeof f.format !== "string") throw new Error("format must be a string");
    if (f.color !== undefined && (typeof f.color !== "string" || !f.color.trim())) {
      throw new Error("color must be a CSS color, or two: light and dark");
    }
    if (f.row !== undefined && !(Number.isInteger(f.row) && f.row >= 0)) {
      throw new Error("row must be a whole number, 0 or more (0 is the top row)");
    }

    const expand = (tex) =>
      mapNotes(tex, (note, body) => {
        if (!DAG_NOTE_NAME_RE.test(note)) {
          throw new Error(`note name "${note}" must start with a letter and use only letters, digits, _ and -`);
        }
        const home = noteHome.get(note);
        if (home && home !== name) throw new Error(`note "${note}" is marked in more than one formula: ${home}, ${name}`);
        noteHome.set(note, name);
        const inner = parseTex(body.trim());
        if (inner.length === 1 && inner[0].type === "param") noteParam.set(note, inner[0].name);
        return `\\htmlData{note=${note}}{${body}}`;
      });
    const lhs = lhsTex ? expand(lhsTex) : null;
    const body = parseTex(expand(rhsTex));

    const uses = [];
    for (const part of body) {
      if (typeof part !== "string") {
        if (part.type === "param" && !paramSymbol.get(part.name)) paramSymbol.set(part.name, part.symbol);
        continue;
      }
      for (const [, used] of part.matchAll(DAG_USE_RE)) {
        const u = used.trim();
        if (u === name) throw new Error(`it can't \\use{${u}} itself`);
        if (!known.has(u)) throw new Error(`\\use{${u}}: there is no formula "${u}"`);
        if (!uses.includes(u)) uses.push(u);
      }
    }
    return {
      name,
      tex: f.tex,
      lhs,
      body,
      symbol,
      label,
      value: f.value ?? null,
      format: f.format ?? null,
      color: f.color === undefined ? null : dagColor(f.color),
      outNote: lhsTex ? wholeNote(lhsTex) : null,
      row: f.row ?? 0,
      uses,
    };
  }

  const edges = [];
  for (const f of formulas) for (const u of f.uses) edges.push([u, f.name]);
  const cycle = dagCycle(names, edges);
  if (cycle) throw new Error(`formulas must not form a cycle: ${cycle.join(" -> ")}`);

  // Color means "this came from formula X": only producers get one.
  const producers = new Set(edges.map(([src]) => src));
  let next = 0;
  for (const f of formulas) {
    if (!producers.has(f.name)) continue;
    const index = next++;
    f.color ??= `var(--tangle-dag-${(index % DAG_PALETTE_SIZE) + 1})`;
  }

  // Notes: one for every \note marker, and no others.
  const rawNotes = spec.notes ?? {};
  if (!isPlainObject(rawNotes)) throw new Error("notes must be an object of names to text");
  const notes = {};
  for (const [name, raw] of Object.entries(rawNotes)) {
    const n = typeof raw === "string" ? { text: raw } : raw;
    if (!isPlainObject(n)) throw new Error(`note "${name}" must be text or an object with text`);
    checkKeys(n, DAG_NOTE_KEYS, `note "${name}"`);
    if (typeof n.text !== "string" || !n.text.trim()) throw new Error(`note "${name}" needs some text`);
    const side = n.side ?? "auto";
    if (!DAG_SIDES.includes(side)) throw new Error(`note "${name}": side must be ${DAG_SIDES.join(", ")}`);
    if (n.color !== undefined && (typeof n.color !== "string" || !n.color.trim())) {
      throw new Error(`note "${name}": color must be a CSS color, or two: light and dark`);
    }
    if (!noteHome.has(name)) throw new Error(`note "${name}" isn't marked with \\note{${name}}{…} in any formula`);
    notes[name] = {
      text: n.text,
      side,
      color: n.color === undefined ? null : dagColor(n.color),
      formula: noteHome.get(name),
      param: noteParam.get(name) ?? null,
    };
  }
  for (const name of noteHome.keys()) {
    if (!notes[name]) throw new Error(`\\note{${name}} has no text: add notes: { ${name}: "…" }`);
  }

  // Parameters: every \tangle; the spec may configure them.
  const rawParams = spec.params ?? {};
  if (!isPlainObject(rawParams)) throw new Error("params must be an object of names to settings");
  for (const [name, config] of Object.entries(rawParams)) {
    if (!paramSymbol.has(name)) throw new Error(`params.${name}: no formula has \\tangle{${name}}`);
    if (!isPlainObject(config)) throw new Error(`params.${name} must be an object like { value: 1, min: 0 }`);
    checkKeys(config, DAG_PARAM_KEYS, `params.${name}`);
  }
  for (const name of paramSymbol.keys()) {
    if (known.has(name)) throw new Error(`"${name}" is both a formula and a \\tangle parameter: rename one`);
  }
  const order = [...Object.keys(rawParams), ...[...paramSymbol.keys()].filter((p) => !(p in rawParams))];
  const params = order.map((name) => {
    const { symbol, ...config } = rawParams[name] ?? {};
    return { name, symbol: symbol ?? paramSymbol.get(name) ?? nameTex(name), config };
  });

  const minRows = new Map(formulas.map((f) => [f.name, f.row]));
  const { layers, routes } = dagOrder(names, dagLayers(names, edges, minRows), edges);
  return {
    formulas,
    edges,
    layers,
    routes,
    notes,
    params,
    legend: spec.legend ?? true,
    reset: spec.reset ?? true,
  };
}

/**
 * The TeX a formula's card shows right now. `ctx` supplies:
 * - symbol(name): a formula's output symbol;
 * - revealed(name): whether a formula shows its value instead;
 * - valueTex(name): that value as TeX;
 * - markers(parts, text): TeX for parsed parts, mapping literal strings with `text`.
 * Each \use{name} becomes the producer's symbol (or value), wrapped in
 * \htmlData{fdag-use=name}; the output symbol is wrapped in fdag-out.
 */
function cardTex(f, ctx) {
  // An exponent right after a subscripted symbol (\use{vy}^2 with v_y) moves
  // inside it, so KaTeX stacks v_y^2 instead of raising the 2 over all of v_y.
  const text = (s) =>
    s.replace(DAG_USE_RE, (_, used, sup = "") => {
      const name = used.trim();
      const symbol = ctx.symbol(name);
      const content = ctx.revealed(name) ? ctx.valueTex(name) : symbol;
      const absorb = sup && symbol.includes("_") && !symbol.includes("^");
      return absorb
        ? `\\htmlData{fdag-use=${name}}{${content}${sup}}`
        : `\\htmlData{fdag-use=${name}}{${content}}${sup}`;
    });
  let tex = ctx.markers(f.body, text);
  const live = ctx.revealed(f.name);
  if (f.lhs) {
    // A note wrapping the whole output stays on the value, so it still points at something.
    let out = f.lhs;
    if (live) out = f.outNote ? `\\htmlData{note=${f.outNote}}{${ctx.valueTex(f.name)}}` : ctx.valueTex(f.name);
    tex = `\\htmlData{fdag-out=${f.name}}{${out}} =${tex}`;
  } else if (live) {
    // No output symbol to replace: close the formula with its value.
    tex += ` = \\htmlData{fdag-value=${f.name}}{${ctx.valueTex(f.name)}}`;
  }
  return tex;
}

/** Note text as pieces: { text } plain, { bold } for **bold**, { math } for $tex$. */
function noteParts(text) {
  const parts = [];
  text.split(/\$([^$]+)\$/).forEach((piece, i) => {
    if (i % 2) return parts.push({ math: piece });
    piece.split(/\*\*(.+?)\*\*/).forEach((t, j) => {
      if (t) parts.push(j % 2 ? { bold: t } : { text: t });
    });
  });
  return parts;
}

/**
 * The variables `name` reads, directly or through the formulas it reads, as
 * a Set. Only what it read the last time it ran: call scope.get(name) first.
 */
function variablesRead(scope, name) {
  const names = new Map(); // a variable's def signal and cell -> its name
  for (const [n, slot] of scope.slots) {
    names.set(slot.def, n);
    names.set(slot.cell, n);
  }
  const out = new Set();
  const seen = new Set();
  const walk = (node) => {
    for (const dep of node.deps ?? []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      const n = names.get(dep);
      if (n !== undefined && n !== name) out.add(n);
      walk(dep);
    }
  };
  walk(scope.slot(name).cell);
  return out;
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
// Engines run the code of a <t-codecell>. A language's engine is a factory that
// gives each cell its own runner: { run(code, inputs, { timeout }), dispose() }.
// run resolves to { value, logs } or rejects with an Error that may carry a
// `line` and `logs`. The built-in "js" engine runs code in a Web Worker, away
// from the page: no DOM, no page variables, and it's stopped if it runs too long.
// ---------------------------------------------------------------------------


const engines = new Map();
// Bumped by registerEngine, so a cell waiting on its engine runs once it's there.
const enginesVersion = new Signal(0);

/**
 * Teach <t-codecell lang="…"> a language. `factory()` is called once per cell and
 * returns { run(code, inputs, { timeout }) → Promise<{ value, logs }>, dispose?() }.
 * `inputs` maps the page variables the code mentions to their values.
 */
export function registerEngine(lang, factory) {
  engines.set(lang, factory);
  enginesVersion.value = enginesVersion.peek() + 1;
}

/** A runner for one cell, or null if no engine knows `lang`. */
function createRunner(lang) {
  const factory = engines.get(lang);
  return factory ? factory() : null;
}

/**
 * The body of the async function a JS cell runs: the code itself if it's a
 * function body (with `return`), or `return (code)` if it's one expression.
 * Runs inside the worker too, so it's written to stand alone.
 */
function wrapCode(code) {
  const AsyncFunction = (async () => {}).constructor;
  const expression = `return (${code}\n);`;
  try {
    new AsyncFunction(expression);
    return expression;
  } catch {
    return code;
  }
}

/**
 * `code` with its comments, strings and the text of template literals blanked
 * out (the ${…} parts stay), so what's left are names and punctuation.
 */
function stripCode(code) {
  let out = "";
  let i = 0;
  const templates = []; // for each open ${…}, how many { deep it is
  const skipText = (end) => {
    while (i < code.length && !end()) i += code[i] === "\\" ? 2 : 1;
  };
  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];
    if (c === "/" && next === "/") {
      skipText(() => code[i] === "\n");
      out += " ";
    } else if (c === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end < 0 ? code.length : end + 2;
      out += " ";
    } else if (c === '"' || c === "'") {
      i++;
      skipText(() => code[i] === c || code[i] === "\n");
      i++;
      out += " ";
    } else if (c === "`" || (c === "}" && templates.at(-1) === 0)) {
      if (c === "}") templates.pop();
      i++;
      skipText(() => code[i] === "`" || (code[i] === "$" && code[i + 1] === "{"));
      if (code[i] === "$") {
        templates.push(0);
        i += 2;
      } else i++;
      out += " ";
    } else {
      if (templates.length && c === "{") templates[templates.length - 1]++;
      if (templates.length && c === "}") templates[templates.length - 1]--;
      out += c;
      i++;
    }
  }
  return out;
}

/** The names in `names` that `code` mentions, outside strings, comments and property access. */
function cellInputs(code, names) {
  const known = new Set(names);
  const found = new Set();
  for (const [, dot, name] of stripCode(code).matchAll(/(\.\s*)?(?<![\w$])([A-Za-z_$][\w$]*)/g)) {
    if (!dot && known.has(name)) found.add(name);
  }
  return [...found];
}

// The worker's side. Code runs as an async function inside `with (inputs)`, so
// page variables read like globals, and the code's own `let x` can shadow them.
// The sourceURL comment names the code in stack traces, which gives error lines.
const WORKER_SOURCE = `
const AsyncFunction = (async () => {}).constructor;
${wrapCode}
const CELL = "tangle-cell";
const lineOf = (error) => Number(String(error?.stack).match(new RegExp(CELL + ":(\\\\d+)"))?.[1]);
let offset = 0; // how many lines the engine puts before the body
try {
  new Function("throw new Error()\\n//# sourceURL=" + CELL)();
} catch (error) {
  offset = (lineOf(error) || 1) - 1;
}
const show = (value) => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};
let logs = [];
for (const level of ["log", "info", "warn", "error", "debug"]) {
  console[level] = (...args) => logs.push({ level, text: args.map(show).join(" ") });
}
onmessage = async ({ data: { id, code, inputs } }) => {
  logs = [];
  try {
    const run = new AsyncFunction("$inputs", "with ($inputs) {" + wrapCode(code) + "\\n}\\n//# sourceURL=" + CELL);
    const value = await run(inputs);
    try {
      postMessage({ id, value, logs });
    } catch (error) {
      postMessage({ id, logs, error: { message: "The result can't leave the sandbox: " + error.message } });
    }
  } catch (error) {
    const line = lineOf(error) - offset;
    postMessage({ id, logs, error: { message: String(error?.name ? error.name + ": " + error.message : error), line: line > 0 ? line : null } });
  }
};
`;

let workerUrl = null;

/** The built-in "js" engine: one worker per cell, replaced when a run is cut short. */
function jsEngine() {
  let worker = null;
  let current = null; // { id, timer, reject } of the run in progress
  let ids = 0;
  const kill = () => {
    worker?.terminate();
    worker = null;
  };
  const finish = () => {
    clearTimeout(current?.timer);
    current = null;
  };
  return {
    run(code, inputs, { timeout = 2000 } = {}) {
      // A newer run replaces one still going: stop it rather than queue behind it.
      if (current) {
        current.reject(Object.assign(new Error("replaced by a newer run"), { name: "AbortError" }));
        finish();
        kill();
      }
      workerUrl ??= URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
      worker ??= new Worker(workerUrl);
      const id = ++ids;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          finish();
          kill();
          reject(new Error(`Stopped after ${timeout} ms. Is there an endless loop?`));
        }, timeout);
        current = { id, timer, reject };
        // Errors outside the run (a worker that fails to start, say) end the run in progress.
        worker.onerror = (event) => {
          event.preventDefault();
          if (current?.id !== id) return;
          finish();
          reject(new Error(event.message || "The sandbox failed."));
        };
        worker.onmessage = ({ data }) => {
          if (data.id !== current?.id) return;
          finish();
          if (data.error) reject(Object.assign(new Error(data.error.message), { line: data.error.line, logs: data.logs }));
          else resolve({ value: data.value, logs: data.logs });
        };
        try {
          worker.postMessage({ id, code, inputs });
        } catch (error) {
          finish();
          const name = Object.keys(inputs).find((key) => {
            try {
              structuredClone(inputs[key]);
              return false;
            } catch {
              return true;
            }
          });
          reject(new Error(name ? `${name} can't be sent to the sandbox: ${error.message}` : error.message));
        }
      });
    },
    dispose() {
      finish();
      kill();
    },
  };
}

registerEngine("js", jsEngine);

// ---------------------------------------------------------------------------
// Custom elements
// ---------------------------------------------------------------------------

// Lets the non-DOM parts of this module load in Node (for tests).
const Base = typeof HTMLElement === "undefined" ? class {} : HTMLElement;

const NUMERIC_META = { min: "min", max: "max", step: "step", "pixels-per-step": "pixelsPerStep" };
const PREVIOUS_TAGS = new Set(["t-num", "t-var", "t-text", "t-select"]);

/** Read declaration attributes into the variable's metadata and set its initial value. */
function declare(el, scope, name, initial) {
  const patch = {};
  for (const [attr, key] of Object.entries(NUMERIC_META)) {
    if (el.hasAttribute(attr)) patch[key] = Number(el.getAttribute(attr));
  }
  for (const attr of ["color", "label", "format"]) {
    if (el.hasAttribute(attr)) patch[attr] = el.getAttribute(attr);
  }
  // A <t-num>'s format only becomes the variable's default if none is set yet.
  if (el.localName === "t-num" && scope.slot(name).meta.peek().format) delete patch.format;
  if (PREVIOUS_TAGS.has(el.localName) && el.hasAttribute("previous")) {
    const prev = el.getAttribute("previous");
    if (prev && NAME_RE.test(prev) && prev !== name) scope.trackPrevious(name, prev);
    else console.error(`tangle: <${el.localName}> needs a valid previous="…" (different from name)`, el);
  }
  declareMeta(scope, name, patch, initial);
}

/**
 * Merge `patch` (min, max, step, pixelsPerStep, color, label, format) into the
 * variable's metadata, and give it `initial` unless something already did.
 * A color "a b" means a in light mode and b in dark mode.
 */
function declareMeta(scope, name, patch, initial) {
  patch = { ...patch };
  const color = typeof patch.color === "string" ? patch.color.trim().split(/\s+/) : null;
  if (color?.length === 2) patch.color = `light-dark(${color[0]}, ${color[1]})`;
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

// The model behind <t-sketch>, without the DOM: a board of strokes in canvas
// coordinates (y down), read and written as JSON in the format of the
// Sketcher app (https://github.com/koaning/sketcher), plus the viewport, hit
// tests, edits and straight-line snapping. Strokes are immutable: edits return
// new strokes, so the renderer can cache a Path2D per stroke object.

const SKETCH_VERSION = 2;
const SKETCH_BACKGROUNDS = ["plain", "dots", "grid"];
/** Grid spacing at 100% zoom, in canvas units. */
const SKETCH_GRID = 24;
/** Snapped angles are multiples of 15°. */
const SKETCH_ANGLE_STEP = Math.PI / 12;

const sketchRgba = (r, g, b, a = 1) => ({ r, g, b, a });
/** Ink on paper, slot for slot with the dark palette: black, gray, blue, red, green, yellow. */
const SKETCH_LIGHT = [
  sketchRgba(0.11, 0.11, 0.12),
  sketchRgba(0.54, 0.54, 0.56),
  sketchRgba(0.05, 0.42, 0.88),
  sketchRgba(0.86, 0.2, 0.2),
  sketchRgba(0.13, 0.56, 0.32),
  sketchRgba(0.98, 0.74, 0.1),
];
/** Chalk on slate: white, gray, sky, coral, mint, yellow. */
const SKETCH_DARK = [
  sketchRgba(0.95, 0.95, 0.93),
  sketchRgba(0.62, 0.62, 0.64),
  sketchRgba(0.42, 0.72, 1.0),
  sketchRgba(1.0, 0.47, 0.43),
  sketchRgba(0.38, 0.85, 0.56),
  sketchRgba(1.0, 0.85, 0.32),
];

/** A new upper-case UUID. randomUUID needs a secure context (https or localhost); elsewhere, build one. */
function sketchID() {
  if (crypto.randomUUID) return crypto.randomUUID().toUpperCase();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function emptySketch(background = "dots") {
  return { version: SKETCH_VERSION, strokes: [], math: [], background };
}

/** A palette stroke takes its slot's color in the current theme; other strokes keep theirs. */
function sketchStrokeColor(stroke, dark) {
  const palette = dark ? SKETCH_DARK : SKETCH_LIGHT;
  const slot = stroke.swatch;
  return slot !== null && slot >= 0 && slot < palette.length ? palette[slot] : stroke.color;
}

function sketchCss(c, alpha = 1) {
  const to = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgba(${to(c.r)}, ${to(c.g)}, ${to(c.b)}, ${c.a * alpha})`;
}

// ---------------------------------------------------------------------------
// Rectangles: { x, y, w, h }, or null for "nothing".
// ---------------------------------------------------------------------------

function sketchBoundsOf(points) {
  if (!points.length) return null;
  let minX = points[0].x, minY = points[0].y, maxX = minX, maxY = minY;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function sketchUnion(a, b) {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

const sketchOutset = (r, d) => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

const rectsMeet = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

const sketchContains = (r, p) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

const sketchDistance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/** The points' box, outset by half the line width (and a pixel). */
function sketchStrokeBounds(stroke) {
  const b = sketchBoundsOf(stroke.points);
  return b && sketchOutset(b, stroke.width / 2 + 1);
}

function sketchContentBounds(strokes) {
  let r = null;
  for (const s of strokes) r = sketchUnion(r, sketchStrokeBounds(s));
  return r;
}

// ---------------------------------------------------------------------------
// The JSON format (Sketcher's `.sketcher` files): points are [x, y] arrays, `swatch` is left out when
// null, ids are upper case, and keys are sorted at every level. The board's
// `math` layer is kept as it is, so a file from the app keeps its typeset math,
// but <t-sketch> doesn't draw it.
// ---------------------------------------------------------------------------

function sketchFail(what) {
  throw new Error(`Not a Sketcher board: bad ${what}`);
}

function sketchNum(v, what) {
  if (typeof v !== "number" || !Number.isFinite(v)) sketchFail(what);
  return v;
}

function sketchObj(v, what) {
  if (typeof v !== "object" || v === null || Array.isArray(v)) sketchFail(what);
  return v;
}

function sketchArr(v, what) {
  if (!Array.isArray(v)) sketchFail(what);
  return v;
}

function decodeSketchStroke(v) {
  const o = sketchObj(v, "stroke");
  if (o.tool !== "pen" && o.tool !== "marker") sketchFail("tool");
  if (typeof o.id !== "string") sketchFail("id");
  const c = sketchObj(o.color, "color");
  return {
    id: o.id.toUpperCase(),
    tool: o.tool,
    color: sketchRgba(sketchNum(c.r, "color"), sketchNum(c.g, "color"), sketchNum(c.b, "color"), sketchNum(c.a, "color")),
    swatch: o.swatch === undefined || o.swatch === null ? null : sketchNum(o.swatch, "swatch"),
    width: sketchNum(o.width, "width"),
    points: sketchArr(o.points, "points").map((p) => {
      if (!Array.isArray(p) || p.length !== 2) sketchFail("point");
      return { x: sketchNum(p[0], "point"), y: sketchNum(p[1], "point") };
    }),
  };
}

/** A board from its JSON (an object or a string). Version 1 boards, without math, are upgraded. */
function decodeSketch(json) {
  if (typeof json === "string") {
    try {
      json = JSON.parse(json);
    } catch {
      throw new Error("Not a Sketcher board: invalid JSON");
    }
  }
  const o = sketchObj(json, "board");
  sketchNum(o.version, "version");
  if (!SKETCH_BACKGROUNDS.includes(o.background)) sketchFail("background");
  return {
    version: SKETCH_VERSION,
    strokes: sketchArr(o.strokes, "strokes").map(decodeSketchStroke),
    math: o.math === undefined || o.math === null ? [] : sketchArr(o.math, "math"),
    background: o.background,
  };
}

function encodeSketchStroke(s) {
  const out = { color: { a: s.color.a, b: s.color.b, g: s.color.g, r: s.color.r }, id: s.id };
  out.points = s.points.map((p) => [p.x, p.y]);
  if (s.swatch !== null) out.swatch = s.swatch;
  out.tool = s.tool;
  out.width = s.width;
  return out;
}

/** The board as plain JSON, with its keys in sorted order: what `JSON.stringify` makes a file of. */
function encodeSketch(board) {
  return {
    background: board.background,
    math: board.math,
    strokes: board.strokes.map(encodeSketchStroke),
    version: SKETCH_VERSION,
  };
}

/** Some strokes, for the clipboard. */
const encodeSketchFragment = (strokes) => ({ math: [], strokes: strokes.map(encodeSketchStroke) });

function decodeSketchFragment(json) {
  const o = sketchObj(json, "fragment");
  return sketchArr(o.strokes ?? [], "strokes").map(decodeSketchStroke);
}

// ---------------------------------------------------------------------------
// Viewport: view = canvas * scale + offset. Immutable.
// ---------------------------------------------------------------------------

class SketchViewport {
  static min = 0.1;
  static max = 8;

  constructor(offset = { x: 0, y: 0 }, scale = 1) {
    this.offset = offset;
    this.scale = Math.min(SketchViewport.max, Math.max(SketchViewport.min, scale));
  }

  toView(p) {
    return { x: p.x * this.scale + this.offset.x, y: p.y * this.scale + this.offset.y };
  }

  toCanvas(p) {
    return { x: (p.x - this.offset.x) / this.scale, y: (p.y - this.offset.y) / this.scale };
  }

  rectToView(r) {
    const o = this.toView(r);
    return { x: o.x, y: o.y, w: r.w * this.scale, h: r.h * this.scale };
  }

  rectToCanvas(r) {
    const o = this.toCanvas(r);
    return { x: o.x, y: o.y, w: r.w / this.scale, h: r.h / this.scale };
  }

  panned(dx, dy) {
    return new SketchViewport({ x: this.offset.x + dx, y: this.offset.y + dy }, this.scale);
  }

  /** Zooms by `factor`, keeping the canvas point under `anchor` (in view coordinates) in place. */
  zoomed(factor, anchor) {
    return this.zoomedTo(this.scale * factor, anchor);
  }

  zoomedTo(scale, anchor) {
    const c = this.toCanvas(anchor);
    const s = new SketchViewport(this.offset, scale).scale;
    return new SketchViewport({ x: anchor.x - c.x * s, y: anchor.y - c.y * s }, s);
  }

  /** A viewport that fits `content` into a view of `size`, with padding. It never zooms in past 100%. */
  static fitting(content, size, padding = 40) {
    if (!content || (content.w <= 0 && content.h <= 0) || size.w <= 2 * padding || size.h <= 2 * padding) {
      return new SketchViewport();
    }
    const sx = (size.w - 2 * padding) / Math.max(content.w, 1);
    const sy = (size.h - 2 * padding) / Math.max(content.h, 1);
    const s = new SketchViewport(undefined, Math.min(1, sx, sy)).scale;
    const cx = content.x + content.w / 2, cy = content.y + content.h / 2;
    return new SketchViewport({ x: size.w / 2 - cx * s, y: size.h / 2 - cy * s }, s);
  }
}

/** The grid spacing at a zoom level: doubled until the lines are at least 12px apart on screen. */
function sketchGridStep(scale) {
  let step = SKETCH_GRID;
  while (step * scale < 12) step *= 2;
  return step;
}

// ---------------------------------------------------------------------------
// Paths: quadratic curves through the midpoints of the segments. A single point
// is a dot (the stroke has round caps).
// ---------------------------------------------------------------------------

function sketchSmooth(points, sink) {
  const n = points.length;
  if (!n) return sink;
  sink.moveTo(points[0].x, points[0].y);
  if (n <= 2) {
    sink.lineTo(points[n - 1].x, points[n - 1].y);
    return sink;
  }
  for (let i = 1; i < n - 1; i++) {
    const p = points[i], q = points[i + 1];
    sink.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
  }
  sink.lineTo(points[n - 1].x, points[n - 1].y);
  return sink;
}

// ---------------------------------------------------------------------------
// Hit tests
// ---------------------------------------------------------------------------

function pointSegmentDistance(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq)) : 0;
  return Math.hypot(a.x + t * abx - p.x, a.y + t * aby - p.y);
}

function segmentsCross(p1, p2, p3, p4) {
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segmentDistance(a1, a2, b1, b2) {
  if (segmentsCross(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointSegmentDistance(a1, b1, b2),
    pointSegmentDistance(a2, b1, b2),
    pointSegmentDistance(b1, a1, a2),
    pointSegmentDistance(b2, a1, a2),
  );
}

/** Whether the eraser, swept from `e1` to `e2` with this radius, touches the stroke. */
function sketchTouched(stroke, e1, e2, radius) {
  const reach = radius + stroke.width / 2;
  const bounds = sketchStrokeBounds(stroke);
  const sweep = sketchOutset(sketchBoundsOf([e1, e2]), reach);
  if (!bounds || !rectsMeet(bounds, sweep)) return false;
  const pts = stroke.points;
  if (pts.length === 1) return pointSegmentDistance(pts[0], e1, e2) <= reach;
  for (let i = 0; i < pts.length - 1; i++) {
    if (segmentDistance(pts[i], pts[i + 1], e1, e2) <= reach) return true;
  }
  return false;
}

/** Even-odd point in polygon. The polygon closes itself. */
function sketchInPolygon(polygon, p) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The ids of the strokes with at least half their points inside the lasso. */
function sketchLassoed(lasso, strokes) {
  const box = sketchBoundsOf(lasso);
  if (lasso.length < 3 || !box) return [];
  return strokes
    .filter((s) => {
      const b = sketchStrokeBounds(s);
      if (!b || !rectsMeet(b, box)) return false;
      const inside = s.points.reduce((n, p) => n + (sketchInPolygon(lasso, p) ? 1 : 0), 0);
      return inside / s.points.length >= 0.5;
    })
    .map((s) => s.id);
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

const sketchMoved = (s, dx, dy) => ({ ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) });

/** Scales the points and the line width about `anchor`. */
function sketchScaled(s, f, anchor) {
  const points = s.points.map((p) => ({ x: anchor.x + (p.x - anchor.x) * f, y: anchor.y + (p.y - anchor.y) * f }));
  return { ...s, points, width: s.width * f };
}

/** Copies of the strokes, moved by (dx, dy), with fresh ids. */
const sketchCopies = (strokes, dx, dy) => strokes.map((s) => ({ ...sketchMoved(s, dx, dy), id: sketchID() }));

// ---------------------------------------------------------------------------
// Straight lines: Shift snaps the angle to 15° steps, Option/Alt snaps the ends
// to the grid. With both, the end lands on the grid only where that keeps the
// angle (0°, 45°, 90°, …).
// ---------------------------------------------------------------------------

const sketchToGrid = (p, step) => ({ x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step });

/** The end of a line from `start` toward `end` at the nearest 15° angle, as long as `end`'s projection onto it. */
function angleSnapped(start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  if (!dx && !dy) return start;
  const angle = Math.round(Math.atan2(dy, dx) / SKETCH_ANGLE_STEP) * SKETCH_ANGLE_STEP;
  const ux = Math.cos(angle), uy = Math.sin(angle);
  const length = dx * ux + dy * uy;
  // Exact zeros keep horizontal and vertical lines straight.
  return {
    x: start.x + (Math.abs(ux) < 1e-12 ? 0 : ux * length),
    y: start.y + (Math.abs(uy) < 1e-12 ? 0 : uy * length),
  };
}

/** A straight line from `start` to `end`: one point when it has no length, else two. */
function sketchLine(start, end, { angle = false, grid = null } = {}) {
  let a = start, b = end;
  if (grid) a = sketchToGrid(a, grid);
  if (angle) {
    b = angleSnapped(a, b);
    if (grid) {
      const g = sketchToGrid(b, grid);
      const cross = (b.x - a.x) * (g.y - a.y) - (b.y - a.y) * (g.x - a.x);
      if (Math.abs(cross) < 1e-6 * grid * grid) b = g;
    }
  } else if (grid) {
    b = sketchToGrid(b, grid);
  }
  return a.x === b.x && a.y === b.y ? [a] : [a, b];
}

/** The board with points rounded to a tenth and widths to a hundredth: smaller to paste into a page. */
function sketchRounded(board) {
  const round = (v, f) => Math.round(v * f) / f;
  const strokes = board.strokes.map((s) => ({
    ...s,
    width: round(s.width, 100),
    points: s.points.map((p) => ({ x: round(p.x, 10), y: round(p.y, 10) })),
  }));
  return { ...board, strokes };
}

// Ported from the board of Sketcher (https://github.com/koaning/sketcher), without its math layer.

const SKETCH_CSS = `
  /* No font here: the cards inherit from the element, and should look like the page. */
  :host {
    display: block;
    --line: color-mix(in srgb, currentColor 15%, transparent);
    --glass: color-mix(in srgb, var(--tangle-surface, #fff) 80%, transparent);
  }
  * { box-sizing: border-box; }
  .glass { font: 13px ui-sans-serif, system-ui, sans-serif; }
  [part="board"] {
    position: relative;
    height: 400px;
    min-height: 160px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 8px;
    outline: none;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }
  [part="board"]:focus-visible { outline: 2px solid var(--tangle-accent); outline-offset: 1px; }
  /* The board scrolls with two fingers only while it has focus, so show when it does. */
  [part="board"] { transition: border-color 0.15s, box-shadow 0.15s; }
  :host(:focus-within) [part="board"] {
    border-color: var(--tangle-accent);
    box-shadow: 0 0 0 1px var(--tangle-accent);
  }
  canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
  /* Light paper: ink multiplies, like a highlighter on a printed chart. */
  [part="board"]:not(.dark) .ink { mix-blend-mode: multiply; }
  .viewing .ink { pointer-events: none; }
  .cards { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-origin: 0 0; }
  ::slotted(*) { cursor: auto; }
  :host(:fullscreen) { background: var(--tangle-surface, #fff); }
  :host(:fullscreen) [part="board"] { height: 100vh !important; border: 0; border-radius: 0; }
  [part="viewbar"] { position: absolute; right: 8px; bottom: 8px; display: flex; padding: 2px; border-radius: 10px; z-index: 2; }
  .glass {
    background: var(--glass);
    border: 1px solid var(--line);
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.1);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
  [part="palette"] {
    position: absolute;
    left: 8px;
    top: 8px;
    max-width: calc(100% - 16px);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 3px 5px;
    border-radius: 10px;
    z-index: 2;
  }
  .section { display: flex; align-items: center; gap: 1px; }
  .section + .section { padding-left: 4px; border-left: 1px solid var(--line); }
  button {
    all: unset;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    color: inherit;
    cursor: pointer;
  }
  button svg { width: 16px; height: 16px; }
  button:hover:not(:disabled) { background: color-mix(in srgb, currentColor 9%, transparent); }
  button[aria-pressed="true"] {
    color: var(--tangle-accent);
    background: color-mix(in srgb, var(--tangle-accent) 15%, transparent);
  }
  button:disabled { opacity: 0.3; cursor: default; }
  button:focus-visible { outline: 2px solid var(--tangle-accent); }
  .width { width: 20px; }
  .width span { display: block; border-radius: 50%; background: currentColor; }
  .width[aria-pressed="true"] { color: inherit; background: color-mix(in srgb, currentColor 14%, transparent); }
  [part~="swatch"] { width: 22px; border-radius: 50%; }
  [part~="swatch"] span {
    display: block;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 15%, transparent);
  }
  [part~="swatch"][aria-pressed="true"] {
    background: none;
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, currentColor 70%, transparent);
  }
  [part="selection-bar"] { position: absolute; display: flex; padding: 2px; border-radius: 10px; z-index: 2; }
  [part="menu"] {
    position: absolute;
    min-width: 180px;
    padding: 4px;
    border-radius: 8px;
    z-index: 3;
    display: flex;
    flex-direction: column;
  }
  [part="menu"] button {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    width: auto;
    height: auto;
    padding: 4px 9px;
    border-radius: 5px;
  }
  [part="menu"] button:hover:not(:disabled), [part="menu"] button:focus-visible {
    background: var(--tangle-accent);
    color: var(--tangle-surface, #fff);
    outline: none;
  }
  kbd { font: inherit; opacity: 0.55; }
  hr { border: 0; height: 1px; margin: 4px 8px; background: var(--line); }
  [part="toast"] {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    padding: 6px 12px;
    border-radius: 8px;
    z-index: 4;
  }
  [hidden] { display: none !important; }
`;

/** Thin, medium and thick, in screen pixels. */
const SKETCH_WIDTHS = { pen: [1.5, 2.5, 6], marker: [10, 20, 36] };
/** The eraser's radius, and the least distance between two captured points, in screen pixels. */
const SKETCH_ERASER = 10;
const SKETCH_SPACING = 1.5;
const SKETCH_HANDLE = 5;
const SKETCH_UNDO = 500;
/** Highlights are drawn opaque and put down once at this opacity, so overlaps don't darken. */
const SKETCH_MARKER_ALPHA = { light: 0.35, dark: 0.55 };

// Icons in the style of Lucide (https://lucide.dev, ISC license).
const sketchIcon = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const SKETCH_ICONS = {
  pen: sketchIcon('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'),
  marker: sketchIcon('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'),
  eraser: sketchIcon('<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/>'),
  select: sketchIcon('<path d="M3.704 14.467A10 8 0 0 1 2 10a10 8 0 0 1 20 0 10 8 0 0 1-10 8 10 8 0 0 1-5.181-1.158"/><path d="M7 22a5 5 0 0 1-2-3.994"/><circle cx="5" cy="16" r="2"/>'),
  undo: sketchIcon('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: sketchIcon('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  plain: sketchIcon('<rect width="18" height="18" x="3" y="3" rx="2"/>'),
  dots: sketchIcon('<circle cx="6" cy="6" r=".6"/><circle cx="12" cy="6" r=".6"/><circle cx="18" cy="6" r=".6"/><circle cx="6" cy="12" r=".6"/><circle cx="12" cy="12" r=".6"/><circle cx="18" cy="12" r=".6"/><circle cx="6" cy="18" r=".6"/><circle cx="12" cy="18" r=".6"/><circle cx="18" cy="18" r=".6"/>'),
  grid: sketchIcon('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>'),
  eye: sketchIcon('<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>'),
  code: sketchIcon('<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>'),
  fit: sketchIcon('<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>'),
  expand: sketchIcon('<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>'),
  shrink: sketchIcon('<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>'),
  trash: sketchIcon('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
};
const SKETCH_TOOL_NAMES = { pen: "Pen (P)", marker: "Marker (M)", eraser: "Eraser (E)", select: "Select (S)" };
const SKETCH_BACKGROUND_NAMES = { plain: "Plain", dots: "Dots", grid: "Grid" };

const sketchIsMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** A shortcut's label: ⇧⌘E on a Mac, Ctrl+Shift+E elsewhere. */
function sketchKeys(key, { shift = false, mod = true } = {}) {
  if (sketchIsMac) return `${shift ? "⇧" : ""}${mod ? "⌘" : ""}${key}`;
  return [mod ? "Ctrl" : "", shift ? "Shift" : "", key].filter(Boolean).join("+");
}

/** The smoothed path of a stroke, cached per stroke object (strokes don't change). */
const sketchPaths = new WeakMap();
function sketchPath(stroke) {
  let path = sketchPaths.get(stroke);
  if (!path) sketchPaths.set(stroke, (path = sketchSmooth(stroke.points, new Path2D())));
  return path;
}

/** The last strokes copied on this page, for when the system clipboard can't be used. */
let sketchClipboard = null;
/** An offscreen canvas that flattens a group of highlights, reused. */
let sketchScratch = null;

/** Whether a CSS color is light, judging by its red, green and blue. */
function sketchIsLight(color) {
  const [r, g, b] = (color.match(/[\d.]+/g) ?? [0, 0, 0]).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 128;
}

const sketchCursors = new Map();
/** A round cursor with a light and a dark outline, so it shows on any ink. */
function sketchCursor(diameter, fill) {
  const key = `${diameter}|${fill}`;
  let cursor = sketchCursors.get(key);
  if (!cursor) {
    const size = Math.ceil(diameter + 4);
    const c = size / 2, r = diameter / 2;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      (fill ? `<circle cx="${c}" cy="${c}" r="${r}" fill="${fill}"/>` : "") +
      `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2"/>` +
      `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(0,0,0,0.6)" stroke-width="1"/></svg>`;
    cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(c)} ${Math.round(c)}, crosshair`;
    sketchCursors.set(key, cursor);
  }
  return cursor;
}

/**
 * Draws strokes on a context that is in canvas coordinates. Highlights go first,
 * under the pen ink: each color's highlights are stroked opaque into a scratch
 * canvas and put down once, translucent, so overlapping strokes of one color
 * don't get darker. Different colors still mix where they cross.
 */
function sketchDrawInk(ctx, items, dark) {
  const groups = new Map();
  for (const item of items) {
    if (item.stroke.tool !== "marker") continue;
    const color = sketchCss(sketchStrokeColor(item.stroke, dark));
    if (!groups.has(color)) groups.set(color, []);
    groups.get(color).push(item);
  }
  for (const [color, group] of groups) sketchDrawHighlights(ctx, group, color, dark);
  ctx.save();
  ctx.lineCap = ctx.lineJoin = "round";
  for (const { stroke, path } of items) {
    if (stroke.tool !== "pen") continue;
    ctx.strokeStyle = sketchCss(sketchStrokeColor(stroke, dark));
    ctx.lineWidth = stroke.width;
    ctx.stroke(path);
  }
  ctx.restore();
}

function sketchDrawHighlights(ctx, items, color, dark) {
  let bounds = null;
  for (const { stroke } of items) bounds = sketchUnion(bounds, sketchStrokeBounds(stroke));
  if (!bounds) return;
  // The group's box in device pixels, clipped to the target.
  const t = ctx.getTransform();
  const x0 = Math.max(0, Math.floor(t.a * bounds.x + t.e));
  const y0 = Math.max(0, Math.floor(t.d * bounds.y + t.f));
  const x1 = Math.min(ctx.canvas.width, Math.ceil(t.a * (bounds.x + bounds.w) + t.e));
  const y1 = Math.min(ctx.canvas.height, Math.ceil(t.d * (bounds.y + bounds.h) + t.f));
  if (x1 <= x0 || y1 <= y0) return;
  sketchScratch ??= document.createElement("canvas");
  if (sketchScratch.width < ctx.canvas.width) sketchScratch.width = ctx.canvas.width;
  if (sketchScratch.height < ctx.canvas.height) sketchScratch.height = ctx.canvas.height;
  const s = sketchScratch.getContext("2d");
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.clearRect(x0, y0, x1 - x0, y1 - y0);
  s.setTransform(t);
  s.strokeStyle = color;
  s.lineCap = s.lineJoin = "round";
  for (const { stroke, path } of items) {
    s.lineWidth = stroke.width;
    s.stroke(path);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = dark ? SKETCH_MARKER_ALPHA.dark : SKETCH_MARKER_ALPHA.light;
  // Multiply darkens like highlighter on paper; on a dark board it would vanish.
  ctx.globalCompositeOperation = dark ? "source-over" : "multiply";
  ctx.drawImage(sketchScratch, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

/** Dots or grid lines, in view coordinates, so they keep their size on screen. */
function sketchDrawBackground(ctx, background, view, dark, size) {
  if (background === "plain") return;
  const step = sketchGridStep(view.scale);
  const topLeft = view.toCanvas({ x: 0, y: 0 });
  const bottomRight = view.toCanvas({ x: size.w, y: size.h });
  const startX = Math.floor(topLeft.x / step) * step;
  const startY = Math.floor(topLeft.y / step) * step;
  ctx.save();
  ctx.beginPath();
  if (background === "dots") {
    for (let y = startY; y <= bottomRight.y + step; y += step) {
      for (let x = startX; x <= bottomRight.x + step; x += step) {
        const p = view.toView({ x, y });
        ctx.moveTo(p.x + 1.1, p.y);
        ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
      }
    }
    ctx.fillStyle = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.16)";
    ctx.fill();
  } else {
    for (let x = startX; x <= bottomRight.x + step; x += step) {
      const vx = Math.round(view.toView({ x, y: 0 }).x) + 0.5;
      ctx.moveTo(vx, 0);
      ctx.lineTo(vx, size.h);
    }
    for (let y = startY; y <= bottomRight.y + step; y += step) {
      const vy = Math.round(view.toView({ x: 0, y }).y) + 0.5;
      ctx.moveTo(0, vy);
      ctx.lineTo(size.w, vy);
    }
    ctx.strokeStyle = dark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.07)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

/** Children that aren't drawn, so they aren't cards. */
const SKETCH_HIDDEN = new Set(["script", "style", "template", "t-let", "t-var", "t-fetch"]);
/** A card's width without a data-width, in board units. */
const SKETCH_CARD_WIDTH = 280;

const sketchAttr = (v) => String(v).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

// <t-sketch name="board" height="400" background="dots" mode="edit">
//   <p data-x="0" data-y="0">…any HTML, vangle elements included…</p>
// </t-sketch>
// An infinite whiteboard: pen, highlighter, eraser and lasso on a canvas you pan
// and zoom. Its children are cards on the board, which you move and draw around.
// The drawing is a variable: the board as JSON, set once per
// finished stroke or edit. Setting the variable shows that board. In view mode
// the board only pans and zooms; Export makes a view-mode copy to paste into a page.
class TSketch extends TangleElement {
  /** The board as JSON: `{ background, math, strokes, version }`. */
  get value() {
    return this._value;
  }

  connectedCallback() {
    if (!this.shadowRoot) this.build();
    this.listenToPage();
    this._name = this.hasAttribute("name") ? validName(this) : null;
    if (!this._name) {
      if (this._value === undefined) this.publish();
      return;
    }
    this.watch((scope) => {
      const value = scope.get(this._name);
      untracked(() => {
        if (value === undefined || value === null || value === "") this.publish();
        else if (value !== this._value) this.load(value);
      });
    });
  }

  disconnectedCallback() {
    for (const stop of this._pageListeners ?? []) stop();
    this._pageListeners = [];
    super.disconnectedCallback();
  }

  build() {
    const background = this.getAttribute("background") ?? "dots";
    if (!SKETCH_BACKGROUNDS.includes(background)) {
      console.error(`tangle: <t-sketch> background is ${SKETCH_BACKGROUNDS.join(", ")}`, this);
    }
    this._mode = this.getAttribute("mode") === "view" ? "view" : "edit";
    this._preview = false;
    this._board = { ...emptySketch(SKETCH_BACKGROUNDS.includes(background) ? background : "dots"), cards: new Map() };
    this._view = new SketchViewport();
    this._tool = "pen";
    this._widthIndex = 1;
    this._swatch = 0;
    this._undo = [];
    this._redo = [];
    this._selection = new Set(); // stroke ids, and card elements
    this._erased = new Set();
    this._gesture = null;
    this._touches = new Map();
    this._size = { w: 0, h: 0 };
    this._dark = false;
    this._edits = 0; // boards set or edits made, so a late src file doesn't overwrite them
    this._children = new Map(); // element → { source, card }

    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${SKETCH_CSS}</style>
      <div part="board" tabindex="0" role="application">
        <canvas class="paper"></canvas>
        <div class="cards"><slot></slot></div>
        <canvas part="canvas" class="ink"></canvas>
        <div part="palette" class="glass" role="toolbar"></div>
        <div part="viewbar" class="glass"></div>
        <div part="selection-bar" class="glass" hidden></div>
        <div part="menu" class="glass" role="menu" hidden></div>
        <div part="toast" class="glass" role="status" hidden></div>
      </div>`;
    const $ = (part) => root.querySelector(`[part="${part}"]`);
    this._root = $("board");
    this._paperCanvas = root.querySelector(".paper");
    this._canvas = $("canvas");
    this._cardLayer = root.querySelector(".cards");
    this._ctx = this._canvas.getContext("2d");
    this._palette = $("palette");
    this._viewbar = $("viewbar");
    this._menu = $("menu");
    this._bar = $("selection-bar");
    this._toast = $("toast");
    this._root.setAttribute("aria-label", this.getAttribute("label") ?? this.getAttribute("name") ?? "Whiteboard");
    const height = Number(this.getAttribute("height"));
    if (height > 0) this._root.style.height = `${height}px`;
    this.buildPalette(this._palette);
    this._fitButton = this.button(SKETCH_ICONS.fit, `Zoom to fit (${sketchKeys("0")})`, () => this.zoomToFit());
    this._editButton = this.button(SKETCH_ICONS.pen, "Back to editing (Esc)", () => this.setPreview(false));
    this._screenButtons = [this.button("", "", () => this.toggleFullScreen()), this.button("", "", () => this.toggleFullScreen())];
    this._viewbar.append(this._fitButton, this._screenButtons[1], this._editButton);
    this._palette.lastElementChild.append(this._screenButtons[0]);
    // Full screen or back: fit the board to its new size.
    this.addEventListener("fullscreenchange", () => {
      this._fitLater = true;
      this.refresh();
    });
    this._bar.append(this.button(SKETCH_ICONS.trash, "Delete (⌫)", () => this.deleteSelection()));
    for (const el of [this._palette, this._viewbar, this._bar, this._menu]) {
      el.addEventListener("pointerdown", (e) => e.stopPropagation());
      el.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    this._toast.addEventListener("pointerdown", () => (this._toast.hidden = true));

    // On the board, not the ink canvas: in view mode the ink lets pointers through to the cards.
    const board = this._root;
    board.addEventListener("pointerdown", (e) => this.pointerDown(e));
    board.addEventListener("pointermove", (e) => this.pointerMove(e));
    board.addEventListener("pointerup", (e) => this.pointerUp(e));
    board.addEventListener("pointercancel", (e) => this.pointerCancel(e));
    board.addEventListener("pointerleave", () => {
      if (!this._gesture) this._hover = null;
    });
    board.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    board.addEventListener("contextmenu", (e) => this.contextMenu(e));
    board.addEventListener("keydown", (e) => this.keyDown(e));
    board.addEventListener("keyup", (e) => this.keyUp(e));
    board.addEventListener("focusout", (e) => {
      if (board.contains(e.relatedTarget)) return;
      this._menu.hidden = true;
      this._space = false;
      this.updateCursor();
    });
    // Safari's trackpad pinch comes as gesture events too; the wheel handler zooms.
    board.addEventListener("gesturestart", (e) => e.preventDefault());
    new ResizeObserver(() => this.resized()).observe(board);
    // Cards change size as charts load: keep them in view until the reader does anything
    // with the board or a card, so dragging a number never makes the board jump.
    const settle = () => (this._viewMoved = true);
    this.addEventListener("pointerdown", settle, true);
    this.addEventListener("keydown", settle, true);
    this._cardResize = new ResizeObserver(() => {
      if (!this._viewMoved && this._size.w) this.zoomToFit();
      else this.requestRender();
    });
    new MutationObserver(() => this.readChildren()).observe(this, { childList: true });
    this.readChildren();

    const src = this.getAttribute("src");
    if (src) this.fetchBoard(src);
    this.refresh();
  }

  buildPalette(palette) {
    const section = (buttons) => {
      const el = document.createElement("div");
      el.className = "section";
      el.append(...buttons);
      palette.append(el);
    };
    this._toolButtons = Object.entries(SKETCH_TOOL_NAMES).map(([tool, title]) =>
      this.button(SKETCH_ICONS[tool], title, () => this.setTool(tool)),
    );
    this._widthButtons = ["Thin", "Medium", "Thick"].map((name, i) => {
      const b = this.button("", `${name} ([ and ])`, () => {
        this._widthIndex = i;
        this.refresh();
      });
      b.classList.add("width");
      const d = 3 + i * 2.5;
      b.innerHTML = `<span style="width:${d}px;height:${d}px"></span>`;
      return b;
    });
    this._swatchButtons = SKETCH_LIGHT.map((_, i) => {
      const b = this.button("<span></span>", `Color ${i + 1}`, () => this.setSwatch(i));
      b.setAttribute("part", "button swatch");
      return b;
    });
    this._backgroundButton = this.button("", "", () => {
      const i = SKETCH_BACKGROUNDS.indexOf(this._board.background);
      this.commit({ ...this._board, background: SKETCH_BACKGROUNDS[(i + 1) % SKETCH_BACKGROUNDS.length] });
    });
    this._undoButton = this.button(SKETCH_ICONS.undo, `Undo (${sketchKeys("Z")})`, () => this.undo());
    this._redoButton = this.button(SKETCH_ICONS.redo, `Redo (${sketchKeys("Z", { shift: true })})`, () => this.redo());
    const preview = this.button(SKETCH_ICONS.eye, "Preview: the board as readers see it", () => this.setPreview(true));
    const exportButton = this.button(SKETCH_ICONS.code, "Export: copy the HTML of a view-only board", () => this.copyHTML());
    section(this._toolButtons);
    section(this._widthButtons);
    section(this._swatchButtons);
    section([this._backgroundButton, this._undoButton, this._redoButton]);
    section([preview, exportButton]);
  }

  get fullScreen() {
    return document.fullscreenElement === this;
  }

  toggleFullScreen() {
    if (this.fullScreen) document.exitFullscreen();
    else this.requestFullscreen?.().catch(() => this.showToast("This browser won't show the board full screen"));
  }

  /** A button that doesn't take focus, so keys keep going to the board. */
  button(icon, title, action) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("part", "button");
    b.title = title;
    b.setAttribute("aria-label", title.replace(/ \(.*\)$|: .*$/, ""));
    b.innerHTML = icon;
    b.addEventListener("pointerdown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      action();
    });
    return b;
  }

  /** Clipboard events and theme changes reach the board through the page. */
  listenToPage() {
    if (this._pageListeners?.length) return;
    const stops = (this._pageListeners = []);
    const listen = (target, type, fn) => {
      target.addEventListener(type, fn);
      stops.push(() => target.removeEventListener(type, fn));
    };
    for (const type of ["copy", "cut", "paste"]) {
      listen(document, type, (e) => {
        if (!this.hasFocus || this.viewing) return;
        e.preventDefault();
        this._pendingClipboard = null;
        if (type === "paste") this.paste(e.clipboardData);
        else this.copy(type, e.clipboardData);
      });
    }
    listen(matchMedia("(prefers-color-scheme: dark)"), "change", () => this.themeChanged());
    const observer = new MutationObserver(() => this.themeChanged());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    stops.push(() => observer.disconnect());
    this.themeChanged();
  }

  /** Whether the board itself, not a card on it, has focus. */
  get hasFocus() {
    return !!this.shadowRoot.activeElement;
  }

  /** Whether the reader is only looking: view mode, or a preview of it. */
  get viewing() {
    return this._mode === "view" || this._preview;
  }

  setPreview(on) {
    if (this._mode === "view") return;
    this._preview = on;
    this._selection.clear();
    this.cancelGesture();
    this._root.focus({ preventScroll: true, focusVisible: false });
    this.refresh();
  }

  // -------------------------------------------------------------------------
  // Cards: the board's children, placed in board coordinates
  // -------------------------------------------------------------------------

  /**
   * Takes in children the board hasn't seen. Their HTML is kept as it was when
   * they arrived, before vangle elements in them render, for Export. An inline
   * `<script type="application/json">` is a board to start from.
   */
  readChildren() {
    const seen = new Set();
    let cards = null;
    for (const el of this.children) {
      seen.add(el);
      if (this._children.has(el)) continue;
      const tag = el.localName;
      if (tag === "script" && el.type === "application/json") {
        this._children.set(el, { board: true });
        if (!this._edits) this.loadInline(el.textContent);
        continue;
      }
      const card = !SKETCH_HIDDEN.has(tag);
      this._children.set(el, { source: el.outerHTML, card });
      if (!card) continue;
      cards ??= new Map(this._board.cards);
      const x = Number(el.dataset.x), y = Number(el.dataset.y);
      const width = Number(el.dataset.width) || SKETCH_CARD_WIDTH;
      Object.assign(el.style, { position: "absolute", margin: "0", boxSizing: "border-box", width: `${width}px` });
      // Without a place, a card goes to the right of the others.
      let place = { x, y };
      if (!Number.isFinite(x) || !Number.isFinite(y) || el.dataset.x === undefined || el.dataset.y === undefined) {
        let right = null;
        for (const [, p] of cards) right = Math.max(right ?? -Infinity, p.x + p.w);
        place = { x: right === null ? 0 : right + 40, y: 0 };
      }
      cards.set(el, { ...place, w: width });
      this._cardResize.observe(el);
    }
    for (const el of this._children.keys()) {
      if (seen.has(el)) continue;
      this._children.delete(el);
      this._cardResize.unobserve(el);
      cards ??= new Map(this._board.cards);
      cards.delete(el);
      this._selection.delete(el);
    }
    if (cards) {
      this._board = { ...this._board, cards };
      this.requestRender();
    }
  }

  loadInline(text) {
    try {
      this.setBoard(decodeSketch(text));
      this._edits = 0; // it's where the board starts, so a src may still replace it
    } catch (error) {
      console.error(`tangle: <t-sketch> ${error.message}`, this);
    }
  }

  get cards() {
    return [...this._board.cards.keys()].filter((el) => this._children.get(el)?.card);
  }

  /** A card's box in board coordinates. Its height is what the page lays it out at. */
  cardRect(el) {
    const p = this._board.cards.get(el);
    return { x: p.x, y: p.y, w: el.offsetWidth || p.w, h: el.offsetHeight };
  }

  /** The topmost card under a board point. */
  cardAt(p) {
    const cards = this.cards;
    for (let i = cards.length - 1; i >= 0; i--) if (sketchContains(this.cardRect(cards[i]), p)) return cards[i];
    return null;
  }

  /** The card an event came from, if any. */
  cardOf(e) {
    return e.composedPath().find((node) => this._children.get(node)?.card) ?? null;
  }

  /** The ink and the cards. */
  contentBounds() {
    let r = sketchContentBounds(this._board.strokes);
    for (const el of this.cards) r = sketchUnion(r, this.cardRect(el));
    return r;
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  /**
   * The HTML of a view-only copy of this board: the same attributes, the cards
   * where they are now, and the ink as JSON. Paste it into a page.
   */
  exportHTML() {
    const attrs = [...this.attributes]
      .filter((a) => a.name !== "mode" && a.name !== "src")
      .map((a) => (a.value === "" ? ` ${a.name}` : ` ${a.name}="${sketchAttr(a.value)}"`))
      .join("");
    const lines = [`<t-sketch mode="view"${attrs}>`];
    const template = document.createElement("template");
    for (const [el, child] of this._children) {
      if (child.board) continue;
      let html = child.source;
      const place = this._board.cards.get(el);
      if (child.card && place) {
        template.innerHTML = html;
        const copy = template.content.firstElementChild;
        copy.dataset.x = Math.round(place.x);
        copy.dataset.y = Math.round(place.y);
        html = copy.outerHTML;
      }
      lines.push(`  ${html}`);
    }
    const json = JSON.stringify(encodeSketch(sketchRounded(this._board))).replaceAll("<", "\\u003c");
    lines.push(`  <script type="application/json">${json}</script>`, "</t-sketch>");
    return lines.join("\n");
  }

  copyHTML() {
    const html = this.exportHTML();
    const done = () => this.showToast("Copied the HTML of a view-only board");
    const failed = () => {
      console.log(html);
      this.showToast("Couldn't copy: the HTML is in the console");
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(html).then(done, failed);
    else failed();
  }

  // -------------------------------------------------------------------------
  // The board and its variable
  // -------------------------------------------------------------------------

  /** Loads the src file, unless the board changed while it was on its way. */
  async fetchBoard(src) {
    const edits = this._edits;
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const board = decodeSketch(await response.json());
      if (this._edits !== edits) return;
      this.setBoard(board);
      this.publish();
    } catch (error) {
      console.error(`tangle: <t-sketch> could not load ${src}: ${error.message}`, this);
    }
  }

  /**
   * Shows a board from the variable. Given as a string, it goes back into the
   * variable as JSON; an object stays as it is, so two boards with one name
   * don't keep handing each other new objects.
   */
  load(value) {
    let board;
    try {
      board = decodeSketch(value);
    } catch (error) {
      console.error(`tangle: <t-sketch> ${error.message}`, this);
      return;
    }
    this.setBoard(board);
    if (typeof value === "string") this.publish();
    else this._value = value;
  }

  /** Replaces the ink, and fits the view to the board. The cards stay. Undo starts over. */
  setBoard(board) {
    this._edits++;
    this.cancelGesture();
    this._board = { ...board, cards: this._board.cards };
    this._undo = [];
    this._redo = [];
    this._selection.clear();
    this._viewMoved = false;
    if (this._size.w) this.zoomToFit();
    else this._fitLater = true;
    this.refresh();
  }

  /** Records an edit for undo, and puts the board in the variable. */
  commit(next) {
    this._undo.push(this._board);
    if (this._undo.length > SKETCH_UNDO) this._undo.shift();
    this._redo = [];
    this._board = next;
    this.changed();
  }

  undo() {
    const last = this._undo.pop();
    if (!last) return;
    this._redo.push(this._board);
    this._board = last;
    this.changed();
  }

  redo() {
    const next = this._redo.pop();
    if (!next) return;
    this._undo.push(this._board);
    this._board = next;
    this.changed();
  }

  changed() {
    this._edits++;
    this.cancelGesture();
    const ids = new Set(this._board.strokes.map((s) => s.id));
    for (const item of this._selection) if (!ids.has(item) && !this._board.cards.has(item)) this._selection.delete(item);
    this.refresh();
    this.publish();
  }

  publish() {
    this._value = encodeSketch(this._board);
    if (this._name) this.scope.set(this._name, this._value);
    this.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // -------------------------------------------------------------------------
  // Tools, selection, theme
  // -------------------------------------------------------------------------

  setTool(tool) {
    if (tool !== "select") this._selection.clear();
    this._tool = tool;
    this.refresh();
  }

  /** Picking a color goes back to drawing. */
  setSwatch(i) {
    this._swatch = i;
    if (this._tool === "eraser" || this._tool === "select") this._tool = "pen";
    this._selection.clear();
    this.refresh();
  }

  /** The current tool's line width, in screen pixels. */
  get screenWidth() {
    if (this._tool === "eraser") return SKETCH_ERASER * 2;
    return SKETCH_WIDTHS[this._tool === "marker" ? "marker" : "pen"][this._widthIndex];
  }

  get palette() {
    return this._dark ? SKETCH_DARK : SKETCH_LIGHT;
  }

  /** The selected strokes. */
  get selected() {
    return this._board.strokes.filter((s) => this._selection.has(s.id));
  }

  get selectedCards() {
    return this.cards.filter((el) => this._selection.has(el));
  }

  get selectionBounds() {
    if (!this._selection.size) return null;
    let r = sketchContentBounds(this.selected);
    for (const el of this.selectedCards) r = sketchUnion(r, this.cardRect(el));
    return r;
  }

  selectAll() {
    this._tool = "select";
    this._selection = new Set([...this._board.strokes.map((s) => s.id), ...this.cards]);
    this.refresh();
  }

  /** Deletes the selected strokes. Cards are the page's HTML, so they stay. */
  deleteSelection() {
    if (!this.selected.length) return;
    const strokes = this._board.strokes.filter((s) => !this._selection.has(s.id));
    this._selection.clear();
    this.commit({ ...this._board, strokes });
  }

  clearBoard() {
    if (!this._board.strokes.length) return;
    this._selection.clear();
    this.commit({ ...this._board, strokes: [] });
  }

  /** The page is dark when its text is light. The paper is the page's surface. */
  themeChanged() {
    const style = getComputedStyle(this);
    const dark = sketchIsLight(style.color);
    const paper = style.getPropertyValue("--tangle-surface").trim() || (dark ? "#1e1f22" : "#fbfbf8");
    const accent = style.getPropertyValue("--tangle-accent").trim() || "#246bce";
    if (dark === this._dark && paper === this._paper && accent === this._accent) return;
    Object.assign(this, { _dark: dark, _paper: paper, _accent: accent });
    this.refresh();
  }

  /** Updates the palette and redraws. */
  refresh() {
    const viewing = this.viewing;
    this._root.classList.toggle("viewing", viewing);
    this._root.classList.toggle("dark", this._dark);
    this._palette.hidden = viewing;
    this._viewbar.hidden = !viewing;
    this._editButton.hidden = !this._preview;
    for (const b of this._screenButtons) {
      b.innerHTML = this.fullScreen ? SKETCH_ICONS.shrink : SKETCH_ICONS.expand;
      b.title = this.fullScreen ? "Exit full screen (Esc)" : "Full screen";
      b.setAttribute("aria-label", b.title.replace(/ \(.*\)$/, ""));
    }
    this._toolButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(Object.keys(SKETCH_TOOL_NAMES)[i] === this._tool)));
    this._widthButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === this._widthIndex)));
    const drawing = this._tool === "pen" || this._tool === "marker";
    this._swatchButtons.forEach((b, i) => {
      b.setAttribute("aria-pressed", String(drawing && i === this._swatch));
      b.firstElementChild.style.background = sketchCss(this.palette[i]);
    });
    const bg = this._board.background;
    const next = SKETCH_BACKGROUNDS[(SKETCH_BACKGROUNDS.indexOf(bg) + 1) % SKETCH_BACKGROUNDS.length];
    this._backgroundButton.innerHTML = SKETCH_ICONS[bg];
    this._backgroundButton.title = `Background: ${SKETCH_BACKGROUND_NAMES[bg]} (click for ${SKETCH_BACKGROUND_NAMES[next]})`;
    this._backgroundButton.setAttribute("aria-label", `Background: ${SKETCH_BACKGROUND_NAMES[bg]}`);
    this._undoButton.disabled = !this._undo.length;
    this._redoButton.disabled = !this._redo.length;
    this.requestRender();
  }

  showToast(message) {
    this._toast.textContent = message;
    this._toast.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => (this._toast.hidden = true), 2500);
  }

  // -------------------------------------------------------------------------
  // View
  // -------------------------------------------------------------------------

  get viewCenter() {
    return { x: this._size.w / 2, y: this._size.h / 2 };
  }

  zoomToFit() {
    this._view = SketchViewport.fitting(this.contentBounds(), this._size);
    this.requestRender();
  }

  zoomToActualSize() {
    this._viewMoved = true;
    this._view = this._view.zoomedTo(1, this.viewCenter);
    this.requestRender();
  }

  zoomBy(factor) {
    this._viewMoved = true;
    this._view = this._view.zoomed(factor, this.viewCenter);
    this.requestRender();
  }

  resized() {
    const w = this._root.clientWidth, h = this._root.clientHeight;
    if (w === this._size.w && h === this._size.h) return;
    this._size = { w, h };
    if (w && h && (this._fitLater || !this._sized || !this._viewMoved)) {
      this._sized = true;
      this._fitLater = false;
      this.zoomToFit();
    }
    this.render();
  }

  // -------------------------------------------------------------------------
  // Pointer
  // -------------------------------------------------------------------------

  viewPoint(e) {
    const r = this._root.getBoundingClientRect();
    return { x: e.clientX - r.left - this._root.clientLeft, y: e.clientY - r.top - this._root.clientTop };
  }

  pointerDown(e) {
    // In view mode, the cards are live: their own elements handle the pointer.
    if (this.viewing && this.cardOf(e)) return;
    this._menu.hidden = true;
    this._root.focus({ preventScroll: true, focusVisible: false });
    const v = this.viewPoint(e);
    this._hover = v;
    if (e.pointerType === "touch") {
      this._touches.set(e.pointerId, v);
      if (this._touches.size === 2) {
        // A second finger turns whatever the first one started into a pan and zoom.
        this.cancelGesture();
        this._gesture = { kind: "pinch", last: this.pinchState() };
        return;
      }
      if (this._touches.size > 2) return;
    }
    if (this._gesture || e.button === 2) return;
    try {
      this._root.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer can't be captured.
    }
    const id = e.pointerId;
    if (e.button === 1 || this._space || this.viewing) {
      e.preventDefault();
      this._gesture = { kind: "pan", id, last: v };
      this.requestRender();
      return;
    }
    if (e.button !== 0) return;
    const p = this._view.toCanvas(v);
    // A pen's eraser end reports the eraser button.
    const tool = e.pointerType === "pen" && e.buttons & 32 ? "eraser" : this._tool;
    if (tool === "pen" || tool === "marker") {
      const stroke = {
        id: sketchID(),
        tool,
        color: this.palette[this._swatch],
        swatch: this._swatch,
        width: this.screenWidth / this._view.scale,
        points: [p],
      };
      this._gesture = { kind: "stroke", id, stroke, raw: [p], end: p, shift: e.shiftKey, alt: e.altKey };
    } else if (tool === "eraser") {
      this._erased = new Set();
      this._gesture = { kind: "erase", id, last: p };
      this.erase(p, p);
    } else {
      this.selectDown(id, p);
    }
    this.requestRender();
  }

  pointerMove(e) {
    const v = this.viewPoint(e);
    this._hover = v;
    const g = this._gesture;
    if (e.pointerType === "touch" && this._touches.has(e.pointerId)) {
      this._touches.set(e.pointerId, v);
      if (g?.kind === "pinch") {
        const next = this.pinchState();
        let view = this._view.panned(next.center.x - g.last.center.x, next.center.y - g.last.center.y);
        if (g.last.spread > 0 && next.spread > 0) view = view.zoomed(next.spread / g.last.spread, next.center);
        this._view = view;
        this._viewMoved = true;
        g.last = next;
        this.requestRender();
        return;
      }
    }
    if (!g) return this.updateCursor();
    if (g.kind === "pinch" || g.id !== e.pointerId) return;
    if (g.kind === "pan") {
      this._view = this._view.panned(v.x - g.last.x, v.y - g.last.y);
      this._viewMoved = true;
      g.last = v;
      return this.requestRender();
    }
    // Every sample counts for ink; otherwise browsers send one move per frame.
    const samples = e.getCoalescedEvents?.() ?? [];
    const points = (samples.length ? samples : [e]).map((s) => this._view.toCanvas(this.viewPoint(s)));
    const spacing = SKETCH_SPACING / this._view.scale;
    for (const p of points) {
      if (g.kind === "stroke") {
        if (sketchDistance(g.raw.at(-1), p) >= spacing) g.raw.push(p);
        g.end = p;
      } else if (g.kind === "erase") {
        this.erase(g.last, p);
        g.last = p;
      } else if (g.kind === "lasso") {
        if (sketchDistance(g.points.at(-1), p) >= spacing) g.points.push(p);
      } else if (g.kind === "scale") {
        // The pointer, projected onto the diagonal, so the scale stays uniform.
        const dx = g.start.x - g.anchor.x, dy = g.start.y - g.anchor.y;
        const lengthSq = dx * dx + dy * dy;
        if (lengthSq > 0) {
          const t = ((p.x - g.anchor.x) * dx + (p.y - g.anchor.y) * dy) / lengthSq;
          g.factor = Math.max(0.05, Math.min(20, t));
        }
      } else if (g.kind === "move") {
        g.offset = { x: p.x - g.anchor.x, y: p.y - g.anchor.y };
      }
    }
    if (g.kind === "stroke") this.shapeStroke(g, e.shiftKey, e.altKey);
    this.requestRender();
  }

  /** Freehand, or with Shift or Option/Alt held, a straight line. The keys can change mid-stroke. */
  shapeStroke(g, shift, alt) {
    g.shift = shift;
    g.alt = alt;
    g.stroke.points = shift || alt
      ? sketchLine(g.raw[0], g.end, { angle: shift, grid: alt ? sketchGridStep(this._view.scale) : null })
      : g.raw;
  }

  pointerUp(e) {
    if (e.pointerType === "touch") {
      this._touches.delete(e.pointerId);
      if (this._gesture?.kind === "pinch") {
        if (this._touches.size < 2) this._gesture = null;
        return;
      }
    }
    const g = this._gesture;
    if (!g || g.kind === "pinch" || g.id !== e.pointerId) return;
    this._gesture = null;
    if (g.kind === "stroke") {
      const p = this._view.toCanvas(this.viewPoint(e));
      const last = g.raw.at(-1);
      if (last.x !== p.x || last.y !== p.y) g.raw.push(p);
      g.end = p;
      this.shapeStroke(g, g.shift, g.alt);
      const stroke = { ...g.stroke, points: [...g.stroke.points] };
      this.commit({ ...this._board, strokes: [...this._board.strokes, stroke] });
    } else if (g.kind === "erase") {
      const ids = this._erased;
      this._erased = new Set();
      if (ids.size) this.commit({ ...this._board, strokes: this._board.strokes.filter((s) => !ids.has(s.id)) });
    } else if (g.kind === "lasso") {
      const box = sketchBoundsOf(g.points);
      // A click, not a drag, just clears the selection. A card is picked when its middle is in the lasso.
      if (Math.max(box.w, box.h) * this._view.scale > 4) {
        const cards = this.cards.filter((el) => {
          const r = this.cardRect(el);
          return sketchInPolygon(g.points, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
        });
        this._selection = new Set([...sketchLassoed(g.points, this._board.strokes), ...cards]);
      }
    } else if (g.kind === "move") {
      const { x: dx, y: dy } = g.offset;
      if (Math.hypot(dx, dy) > 0.01) {
        const strokes = this._board.strokes.map((s) => (this._selection.has(s.id) ? sketchMoved(s, dx, dy) : s));
        const cards = new Map(this._board.cards);
        for (const el of this.selectedCards) {
          const p = cards.get(el);
          cards.set(el, { ...p, x: p.x + dx, y: p.y + dy });
        }
        this.commit({ ...this._board, strokes, cards });
      }
    } else if (g.kind === "scale") {
      if (Math.abs(g.factor - 1) > 0.001) {
        const strokes = this._board.strokes.map((s) => (this._selection.has(s.id) ? sketchScaled(s, g.factor, g.anchor) : s));
        this.commit({ ...this._board, strokes });
      }
    }
    this.requestRender();
  }

  pointerCancel(e) {
    this._touches.delete(e.pointerId);
    const g = this._gesture;
    if (g?.kind === "pinch" && this._touches.size < 2) this._gesture = null;
    else if (g && g.kind !== "pinch" && g.id === e.pointerId) this.cancelGesture();
  }

  pinchState() {
    const [a, b] = [...this._touches.values()];
    return { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, spread: sketchDistance(a, b) };
  }

  /** Drops a gesture without committing it: Esc, a second finger, a cancelled pointer. */
  cancelGesture() {
    this._gesture = null;
    this._erased = new Set();
    this.requestRender();
  }

  erase(a, b) {
    const radius = SKETCH_ERASER / this._view.scale;
    for (const s of this._board.strokes) {
      if (!this._erased.has(s.id) && sketchTouched(s, a, b, radius)) this._erased.add(s.id);
    }
  }

  /** The resize handle, in view coordinates. Only ink resizes, so a selection with cards has none. */
  get handleCenter() {
    const bounds = this.selectionBounds;
    if (!bounds || this._tool !== "select" || this.viewing || this.selectedCards.length) return null;
    const r = sketchOutset(this._view.rectToView(this.previewRect(bounds)), 6);
    return { x: r.x + r.w, y: r.y + r.h };
  }

  onHandle(v) {
    const handle = this.handleCenter;
    return !!handle && !!v && sketchDistance(v, handle) <= SKETCH_HANDLE + 6;
  }

  selectDown(id, p) {
    const bounds = this.selectionBounds;
    const card = this.cardAt(p);
    if (bounds && this.onHandle(this._view.toView(p)) && (bounds.w > 0 || bounds.h > 0)) {
      this._gesture = { kind: "scale", id, anchor: { x: bounds.x, y: bounds.y }, start: p, factor: 1 };
    } else if (bounds && sketchContains(sketchOutset(bounds, 8 / this._view.scale), p)) {
      this._gesture = { kind: "move", id, anchor: p, offset: { x: 0, y: 0 } };
    } else if (card) {
      // A card can be grabbed without lassoing it first.
      this._selection = new Set([card]);
      this._gesture = { kind: "move", id, anchor: p, offset: { x: 0, y: 0 } };
    } else {
      this._selection = new Set();
      this._gesture = { kind: "lasso", id, points: [p] };
    }
  }

  /** The live move or resize, as `p * s + t`. */
  get preview() {
    const g = this._gesture;
    if (g?.kind === "move") return { s: 1, tx: g.offset.x, ty: g.offset.y };
    if (g?.kind === "scale") return { s: g.factor, tx: g.anchor.x * (1 - g.factor), ty: g.anchor.y * (1 - g.factor) };
    return null;
  }

  previewRect(r) {
    const t = this.preview;
    return t ? { x: r.x * t.s + t.tx, y: r.y * t.s + t.ty, w: r.w * t.s, h: r.h * t.s } : r;
  }

  // -------------------------------------------------------------------------
  // Clipboard and images
  // -------------------------------------------------------------------------

  copy(kind, data) {
    const strokes = this.selected;
    if (!strokes.length) return;
    sketchClipboard = strokes;
    const json = JSON.stringify(encodeSketchFragment(strokes));
    const text = JSON.stringify({ type: "sketcher-fragment", fragment: encodeSketchFragment(strokes) });
    if (data) {
      data.setData("application/x-sketcher-fragment", json);
      data.setData("text/plain", text);
    } else {
      navigator.clipboard?.writeText(text).catch(() => {});
    }
    if (kind === "cut") this.deleteSelection();
  }

  /** Pastes under the pointer when it's over the board, else next to the original. */
  paste(data) {
    const strokes = this.readClipboard(data);
    if (!strokes?.length) return;
    const bounds = sketchContentBounds(strokes);
    let dx = 16 / this._view.scale, dy = dx;
    if (this._hover && bounds) {
      const target = this._view.toCanvas(this._hover);
      dx = target.x - (bounds.x + bounds.w / 2);
      dy = target.y - (bounds.y + bounds.h / 2);
    }
    const copies = sketchCopies(strokes, dx, dy);
    this._tool = "select";
    this.commit({ ...this._board, strokes: [...this._board.strokes, ...copies] });
    this._selection = new Set(copies.map((s) => s.id));
    this.refresh();
  }

  readClipboard(data) {
    if (data) {
      try {
        const raw = data.getData("application/x-sketcher-fragment");
        if (raw) return decodeSketchFragment(JSON.parse(raw));
      } catch {
        // fall through
      }
      try {
        const parsed = JSON.parse(data.getData("text/plain"));
        if (parsed?.type === "sketcher-fragment") return decodeSketchFragment(parsed.fragment);
      } catch {
        // not ours
      }
      // Something else is on the clipboard: only paste our own copy when nothing at all is.
      if (data.types.length) return null;
    }
    return sketchClipboard;
  }

  /**
   * The strokes (by default all the ink) on paper, cropped to the ink plus
   * padding: a canvas, or null when there's no ink. Cards aren't in it.
   */
  image(strokes = this._board.strokes, scale = 2, padding = 32) {
    const content = sketchContentBounds(strokes);
    if (!content) return null;
    const r = sketchOutset(content, padding);
    const x = Math.floor(r.x), y = Math.floor(r.y);
    const w = Math.ceil(r.x + r.w) - x, h = Math.ceil(r.y + r.h) - y;
    const canvas = Object.assign(document.createElement("canvas"), { width: Math.floor(w * scale), height: Math.floor(h * scale) });
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = this._paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
    sketchDrawInk(ctx, strokes.map((stroke) => ({ stroke, path: sketchPath(stroke) })), this._dark);
    return canvas;
  }

  /** The ink as a PNG data URL, cropped to it, or null when there's none. */
  toPNG({ scale = 2, padding = 32 } = {}) {
    return this.image(this._board.strokes, scale, padding)?.toDataURL("image/png") ?? null;
  }

  exportPNG() {
    const canvas = this.image();
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${this.getAttribute("name") || "sketch"}.png`;
    a.click();
  }

  /** Copies the selected ink, or all of it, to the clipboard as a picture. */
  copyAsImage() {
    const canvas = this.image(this.selected.length ? this.selected : this._board.strokes);
    if (!canvas || !navigator.clipboard?.write) return;
    const blob = new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(
      () => this.showToast("Copied as an image"),
      () => this.showToast("Couldn't copy to the clipboard"),
    );
  }

  // -------------------------------------------------------------------------
  // Wheel, keys and menu
  // -------------------------------------------------------------------------

  /**
   * Ctrl/⌘ + wheel and trackpad pinches zoom. A plain wheel pans once the board
   * has focus; before that it scrolls the page, so a board doesn't trap the scroll.
   */
  wheel(e) {
    const zoom = e.ctrlKey || e.metaKey;
    if (!zoom && !this.matches(":focus-within")) {
      // The page scrolls. Say once in a while how to scroll the board instead.
      const now = performance.now();
      if (!(now - this._hinted < 8000)) {
        this._hinted = now;
        this.showToast("Click the board to pan it with two fingers");
      }
      return;
    }
    e.preventDefault();
    this._menu.hidden = true;
    this._viewMoved = true;
    const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (zoom) this._view = this._view.zoomed(Math.exp(-e.deltaY * lines * 0.01), this.viewPoint(e));
    else this._view = this._view.panned(-e.deltaX * lines, -e.deltaY * lines);
    this.requestRender();
  }

  keyDown(e) {
    // Keys typed into a card are the card's.
    if (!this.shadowRoot.contains(e.composedPath()[0])) return;
    // Keep page shortcuts away while the board has focus.
    e.stopPropagation();
    const mod = sketchIsMac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    if (e.key === "Shift" || e.key === "Alt") {
      const g = this._gesture;
      if (g?.kind === "stroke") {
        this.shapeStroke(g, e.shiftKey, e.altKey);
        this.requestRender();
      }
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      if (!e.repeat) {
        this._space = true;
        this.updateCursor();
      }
      return;
    }
    if (this.viewing) {
      if (e.key === "Escape" && this._preview) this.setPreview(false);
      else if (mod && ["=", "+", "-", "_", "0"].includes(key)) {
        e.preventDefault();
        this.modKey(key, e);
      } else if (e.shiftKey && e.code === "Digit0") this.zoomToActualSize();
      return;
    }
    if (mod) {
      if (this.modKey(key, e)) e.preventDefault();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") {
      if (!this._menu.hidden) this._menu.hidden = true;
      else if (this._gesture && this._gesture.kind !== "pan" && this._gesture.kind !== "pinch") this.cancelGesture();
      else {
        this._selection.clear();
        this.requestRender();
      }
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      if (this._selection.size) {
        e.preventDefault();
        this.deleteSelection();
      }
      return;
    }
    // Shift+0 stands in for ⌘1, which browsers keep for switching tabs.
    if (e.shiftKey && e.code === "Digit0") return this.zoomToActualSize();
    const digit = /^Digit([1-6])$/.exec(e.code);
    if (digit) return this.setSwatch(Number(digit[1]) - 1);
    const tool = { p: "pen", b: "pen", m: "marker", h: "marker", e: "eraser", s: "select" }[key];
    if (tool) return this.setTool(tool);
    if (e.key === "[" || e.key === "]") {
      this._widthIndex = Math.max(0, Math.min(2, this._widthIndex + (e.key === "[" ? -1 : 1)));
      this.refresh();
    }
  }

  /** ⌘ (or Ctrl) shortcuts. Returns whether the key was used. */
  modKey(key, e) {
    switch (key) {
      case "z":
        if (e.shiftKey) this.redo();
        else this.undo();
        return true;
      case "y":
        if (sketchIsMac) return false;
        this.redo();
        return true;
      case "a":
        this.selectAll();
        return true;
      case "=":
      case "+":
        this.zoomBy(1.25);
        return true;
      case "-":
      case "_":
        this.zoomBy(0.8);
        return true;
      case "0":
        this.zoomToFit();
        return true;
      case "backspace":
      case "delete":
        if (!e.shiftKey) return false;
        this.clearBoard();
        return true;
      case "e":
        if (!e.shiftKey) return false;
        this.exportPNG();
        return true;
      case "c":
      case "x":
      case "v":
        if (key === "c" && e.shiftKey) {
          this.copyAsImage();
          return true;
        }
        // Let the browser fire its clipboard event; if it doesn't, use the page's own clipboard.
        this._pendingClipboard = key === "c" ? "copy" : key === "x" ? "cut" : "paste";
        setTimeout(() => {
          const pending = this._pendingClipboard;
          this._pendingClipboard = null;
          if (pending === "paste") this.paste(null);
          else if (pending) this.copy(pending, null);
        });
        return false;
    }
    return false;
  }

  keyUp(e) {
    if (!this.shadowRoot.contains(e.composedPath()[0])) return;
    e.stopPropagation();
    if (e.key === " ") {
      this._space = false;
      this.updateCursor();
    }
    if ((e.key === "Shift" || e.key === "Alt") && this._gesture?.kind === "stroke") {
      this.shapeStroke(this._gesture, e.shiftKey, e.altKey);
      this.requestRender();
    }
  }

  contextMenu(e) {
    // Viewing, the page's own menu is fine.
    if (this.viewing) return;
    e.preventDefault();
    this.cancelGesture();
    const v = this.viewPoint(e);
    const empty = !this._board.strokes.length;
    const entries = this.selected.length
      ? [
          { label: "Cut", keys: sketchKeys("X"), action: () => this.copy("cut", null) },
          { label: "Copy", keys: sketchKeys("C"), action: () => this.copy("copy", null) },
          { label: "Copy as Image", keys: sketchKeys("C", { shift: true }), action: () => this.copyAsImage() },
          "-",
          { label: "Delete", keys: "⌫", action: () => this.deleteSelection() },
        ]
      : [
          { label: "Paste", keys: sketchKeys("V"), disabled: !sketchClipboard, action: () => this.paste(null) },
          { label: "Select All", keys: sketchKeys("A"), action: () => this.selectAll() },
          "-",
          { label: "Zoom to Fit", keys: sketchKeys("0"), action: () => this.zoomToFit() },
          { label: "Actual Size", keys: sketchKeys("0", { shift: true, mod: false }), action: () => this.zoomToActualSize() },
          "-",
          { label: "Preview", keys: "", action: () => this.setPreview(true) },
          { label: "Copy HTML for a Page", keys: "", action: () => this.copyHTML() },
          { label: "Copy as Image", keys: sketchKeys("C", { shift: true }), disabled: empty, action: () => this.copyAsImage() },
          { label: "Export as PNG", keys: sketchKeys("E", { shift: true }), disabled: empty, action: () => this.exportPNG() },
          "-",
          { label: "Clear", keys: sketchKeys("⌫", { shift: true }), disabled: empty, action: () => this.clearBoard() },
        ];
    const menu = this._menu;
    menu.replaceChildren(
      ...entries.map((entry) => {
        if (entry === "-") return document.createElement("hr");
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "menuitem");
        b.textContent = entry.label;
        const kbd = document.createElement("kbd");
        kbd.textContent = entry.keys;
        b.append(kbd);
        b.disabled = !!entry.disabled;
        b.addEventListener("click", (event) => {
          event.stopPropagation();
          menu.hidden = true;
          entry.action();
        });
        return b;
      }),
    );
    menu.hidden = false;
    const x = Math.max(4, Math.min(v.x, this._size.w - menu.offsetWidth - 4));
    const y = Math.max(4, Math.min(v.y, this._size.h - menu.offsetHeight - 4));
    Object.assign(menu.style, { left: `${x}px`, top: `${y}px` });
    this.requestRender();
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  requestRender() {
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = 0;
      this.render();
    });
  }

  /** Sizes a canvas to the board in device pixels and resets its transform. */
  prepare(canvas) {
    const { w, h } = this._size;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [ctx, dpr];
  }

  render() {
    const { w, h } = this._size;
    const view = this._view;
    const dark = this._dark;
    const preview = this.preview;

    // Underneath: the paper, with its dots or grid while editing.
    const [paper] = this.prepare(this._paperCanvas);
    paper.fillStyle = this._paper;
    paper.fillRect(0, 0, w, h);
    if (!this.viewing) sketchDrawBackground(paper, this._board.background, view, dark, this._size);

    // In between: the cards, in board coordinates.
    this._cardLayer.style.transform = `translate(${view.offset.x}px, ${view.offset.y}px) scale(${view.scale})`;
    for (const [el, p] of this._board.cards) {
      const moving = preview && this._selection.has(el);
      el.style.left = `${p.x + (moving ? preview.tx : 0)}px`;
      el.style.top = `${p.y + (moving ? preview.ty : 0)}px`;
    }

    // On top: the ink.
    const [ctx, dpr] = this.prepare(this._canvas);
    ctx.clearRect(0, 0, w, h);
    const px = 1 / view.scale;
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.offset.x, dpr * view.offset.y);
    const visible = view.rectToCanvas({ x: 0, y: 0, w, h });
    const items = [];
    for (const stroke of this._board.strokes) {
      if (this._erased.has(stroke.id)) continue;
      const selected = this._selection.has(stroke.id);
      let item = { stroke, path: sketchPath(stroke) };
      let bounds = sketchStrokeBounds(stroke);
      if (selected && preview) {
        const path = new Path2D();
        path.addPath(item.path, new DOMMatrix([preview.s, 0, 0, preview.s, preview.tx, preview.ty]));
        item = { stroke: { ...stroke, width: stroke.width * preview.s }, path };
        bounds = bounds && this.previewRect(bounds);
      }
      if (!bounds || bounds.x > visible.x + visible.w || bounds.x + bounds.w < visible.x) continue;
      if (bounds.y > visible.y + visible.h || bounds.y + bounds.h < visible.y) continue;
      if (selected) {
        // A halo in the accent color.
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.strokeStyle = this._accent;
        ctx.lineWidth = item.stroke.width + 7 * px;
        ctx.lineCap = ctx.lineJoin = "round";
        ctx.stroke(item.path);
        ctx.restore();
      }
      items.push(item);
    }
    const g = this._gesture;
    if (g?.kind === "stroke") items.push({ stroke: g.stroke, path: sketchSmooth(g.stroke.points, new Path2D()) });
    sketchDrawInk(ctx, items, dark);
    if (!this.viewing) {
      this.drawCardOutlines(ctx, px);
      this.drawSelection(ctx, px);
    }
    this.placeSelectionBar();
    this.updateCursor();
  }

  /** While editing, a faint outline shows where each card is. */
  drawCardOutlines(ctx, px) {
    ctx.save();
    ctx.strokeStyle = this._dark ? "rgba(255, 255, 255, 0.25)" : "rgba(0, 0, 0, 0.2)";
    ctx.lineWidth = px;
    ctx.setLineDash([3 * px, 3 * px]);
    for (const el of this.cards) {
      const r = sketchOutset(this.previewRect(this.cardRect(el)), 4 * px);
      if (!this._selection.has(el)) ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    ctx.restore();
  }

  drawSelection(ctx, px) {
    const g = this._gesture;
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = this._accent;
    if (g?.kind === "lasso" && g.points.length > 1) {
      ctx.beginPath();
      g.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.globalAlpha = 0.06;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.25 * px;
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.stroke();
    }
    const bounds = this.selectionBounds;
    if (bounds) {
      const r = sketchOutset(this.previewRect(bounds), 6 * px);
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 6 * px);
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = px;
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.stroke();
      if (this.handleCenter) {
        ctx.beginPath();
        ctx.arc(r.x + r.w, r.y + r.h, SKETCH_HANDLE * px, 0, Math.PI * 2);
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        ctx.fillStyle = this._paper;
        ctx.fill();
        ctx.lineWidth = 1.5 * px;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  placeSelectionBar() {
    const bar = this._bar;
    const bounds = this.selectionBounds;
    const busy = this._gesture && this._gesture.kind !== "pan" && this._gesture.kind !== "pinch";
    bar.hidden = !bounds || !!busy || this.viewing || !this.selected.length;
    if (bar.hidden) return;
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    const r = this._view.rectToView(bounds);
    let x = r.x + r.w / 2 - bw / 2;
    let y = r.y - bh - 14;
    if (y < 8) y = r.y + r.h + 14;
    x = Math.max(8, Math.min(this._size.w - bw - 8, x));
    y = Math.max(8, Math.min(this._size.h - bh - 8, y));
    Object.assign(bar.style, { left: `${x}px`, top: `${y}px` });
  }

  updateCursor() {
    const cursor = this.cursor();
    if (this._root.style.cursor !== cursor) this._root.style.cursor = cursor;
  }

  cursor() {
    const g = this._gesture;
    if (g?.kind === "pan" || g?.kind === "move") return "grabbing";
    if (this._space || this.viewing) return "grab";
    if (g?.kind === "scale") return "nwse-resize";
    if (this._tool === "eraser") return sketchCursor(SKETCH_ERASER * 2, null);
    if (this._tool === "select") {
      if (this.onHandle(this._hover)) return "nwse-resize";
      return this._hover && this.cardAt(this._view.toCanvas(this._hover)) ? "move" : "crosshair";
    }
    const color = this.palette[this._swatch];
    const marker = this._tool === "marker";
    const alpha = this._dark ? SKETCH_MARKER_ALPHA.dark : SKETCH_MARKER_ALPHA.light;
    return sketchCursor(Math.max(this.screenWidth, 4), sketchCss(color, marker ? alpha : 1));
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
 * variable with its `value` (or `error`), its `kind` ("value", "formula", "fetch", "codecell",
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

/** A short, one-line version of any value, for <t-debug> and <t-codecell>. */
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

// ---------------------------------------------------------------------------
// Code cells: <t-codecell> is code the reader edits, run in a sandbox, with its
// result in a variable.
// ---------------------------------------------------------------------------

/** `text` without the indentation its lines share, and without blank lines at either end. */
function dedent(text) {
  const lines = text.replace(/^\s*\n/, "").trimEnd().split("\n");
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].length));
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join("\n");
}

const sameInputs = (a, b) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
};

// <t-codecell name="total"><script type="text/plain">return prices.reduce((a, b) => a + b, 0)</script></t-codecell>
// Code the reader can edit. It runs in a Web Worker whenever it, or a page
// variable it mentions, changes, and its result goes into the variable `name`.
// While it runs, the old result stays and elements that show it dim. Below the
// editor are anything it logged and errors, and with `output` the result too.
// With `copy`, a button puts the code on the clipboard.
class TCodeCell extends TangleElement {
  connectedCallback() {
    this._name = this.hasAttribute("name") ? validName(this) : null;
    if (this.hasAttribute("name") && !this._name) return;
    if (!this._editor) this.build();
    if (this._name) this.scope.slot(this._name).kind = "codecell";
    this._last = null;
    this.watch((scope) => {
      this._force.value;
      const engines = this._runner ? null : enginesVersion.value; // waiting on its engine
      graphVersion.value; // so a variable declared after the cell is still found
      const code = this._code.value;
      const page = [...scope.slots.keys()].filter((n) => n !== this._name);
      untracked(() => this.markPage(scope, page));
      const names = cellInputs(code, page);
      const inputs = {};
      for (const name of names) {
        try {
          const value = scope.get(name);
          if (value !== undefined) inputs[name] = value;
        } catch {} // a formula that fails is left out, so the code sees it as not defined
      }
      // graphVersion also changes when nothing this cell reads did: skip those.
      const run = { code, inputs, engines, force: this._force.peek() };
      const last = this._last;
      const same = last && last.code === code && (engines === null || last.engines === engines) && last.force === run.force;
      if (same && sameInputs(last.inputs, inputs)) return;
      this._last = run;
      untracked(() => this.run(code, inputs));
    });
  }

  disconnectedCallback() {
    this.stop();
    this._runner?.dispose?.();
    this._runner = null;
    super.disconnectedCallback();
  }

  build() {
    const script = this.querySelector('script[type="text/plain"]');
    if (!script) {
      // Code written straight into the element: take it out, to show it in the editor instead.
      this._text = this.textContent;
      this.replaceChildren();
    }
    this._initial = dedent(script ? script.textContent : this._text);
    this._code = new Signal(this._initial);
    this._force = new Signal(0);
    this._page = new Set(); // the page's variables, which the editor marks in the code

    this._editor = document.createElement("div");
    this._editor.className = "t-codecell-editor";
    const pre = document.createElement("pre");
    pre.className = "t-codecell-pre";
    pre.textContent = this._initial;
    this._editor.append(pre);

    const bar = (this._bar = document.createElement("div"));
    bar.hidden = true;
    bar.className = "t-codecell-bar";
    this._status = document.createElement("span");
    this._status.className = "t-codecell-status";
    this._reset = document.createElement("button");
    this._reset.type = "button";
    this._reset.className = "t-codecell-reset";
    this._reset.textContent = "Reset";
    this._reset.hidden = true;
    this._reset.addEventListener("click", () => this.setText(this._initial));
    this._copy = document.createElement("button");
    this._copy.type = "button";
    this._copy.className = "t-codecell-copy";
    this._copy.textContent = "Copy";
    this._copy.addEventListener("click", () => this.copy());
    bar.append(this._status, this._reset, this._copy);

    this._output = document.createElement("div");
    this._output.className = "t-codecell-output";
    this._output.setAttribute("aria-live", "polite");
    this.append(this._editor, bar, this._output);
    this.syncBar();

    // Mod-Enter runs now, without waiting for the pause after typing. Capture it
    // before CodeMirror, which would insert a blank line.
    this.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
        event.preventDefault();
        event.stopPropagation();
        clearTimeout(this._typing);
        this._code.value = this.text();
        this._force.value++;
      },
      true,
    );

    loadCodemirror().then(
      (cm) => this.mount(cm),
      (error) => {
        console.error("tangle: <t-codecell> could not load CodeMirror, using a plain text area", error);
        this.mountTextarea();
      },
    );
  }

  /** The editor: CodeMirror, with the theme's colors. */
  mount(cm) {
    const { EditorView, basicSetup, javascript, syntaxHighlighting, classHighlighter } = cm;
    const lang = this.getAttribute("lang") ?? "js";
    this._view = new EditorView({
      doc: this._code.peek(),
      extensions: [
        basicSetup,
        lang === "js" ? [javascript(), this.pageMarks(cm)] : [],
        syntaxHighlighting(classHighlighter),
        EditorView.contentAttributes.of({ "aria-label": this.getAttribute("label") ?? `${this._name ?? "code"} (${lang})` }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) this.edited();
        }),
        EditorView.theme({
          "&": { color: "inherit", backgroundColor: "transparent" },
          "&.cm-focused": { outline: "none" },
          ".cm-content": { caretColor: "var(--tangle-accent)" },
          ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--tangle-accent)" },
          "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
            { backgroundColor: "color-mix(in srgb, var(--tangle-accent) 25%, transparent)" },
          // Opaque, so code scrolled sideways doesn't show through the sticky gutter.
          ".cm-gutters": {
            backgroundColor: "var(--tangle-surface)",
            color: "color-mix(in srgb, currentColor 45%, transparent)",
            border: "none",
          },
          ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--tangle-accent) 6%, transparent)" },
          ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
            backgroundColor: "color-mix(in srgb, var(--tangle-accent) 20%, transparent)",
            outline: "none",
          },
          ".cm-tooltip": { backgroundColor: "var(--tangle-surface)", color: "inherit" },
        }),
      ],
    });
    this._editor.replaceChildren(this._view.dom);
  }

  /** Keeps the names of the page's variables, and has the editor mark them again when they change. */
  markPage(scope, names) {
    const page = new Set(names.filter((name) => scope.slots.get(name).def.peek() !== undefined));
    if (page.size === this._page.size && [...page].every((name) => this._page.has(name))) return;
    this._page = page;
    this._view?.dispatch({});
  }

  /**
   * Marks the names in the code that come from the page, tinted like the values the reader
   * changes in the prose. A name the code declares itself is its own, and isn't marked.
   */
  pageMarks({ ViewPlugin, Decoration, syntaxTree }) {
    const cell = this;
    const mark = Decoration.mark({ class: "t-codecell-page" });
    const build = (state) => {
      const own = new Set();
      const uses = [];
      syntaxTree(state).iterate({
        enter({ name, from, to }) {
          if (name === "VariableDefinition") own.add(state.sliceDoc(from, to));
          else if (name === "VariableName") uses.push({ from, to, text: state.sliceDoc(from, to) });
        },
      });
      const marks = uses.filter(({ text }) => cell._page.has(text) && !own.has(text));
      return Decoration.set(marks.map(({ from, to }) => mark.range(from, to)));
    };
    return ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.page = cell._page;
          this.decorations = build(view.state);
        }
        update(update) {
          // The tree grows as the parser catches up, so a new tree is a reason too.
          const tree = syntaxTree(update.state) !== syntaxTree(update.startState);
          if (!update.docChanged && !tree && this.page === cell._page) return;
          this.page = cell._page;
          this.decorations = build(update.state);
        }
      },
      { decorations: (plugin) => plugin.decorations },
    );
  }

  /** Without CodeMirror (offline, say), a plain text area does the job. */
  mountTextarea() {
    const area = (this._area = document.createElement("textarea"));
    area.className = "t-codecell-textarea";
    area.spellcheck = false;
    area.value = this._code.peek();
    area.rows = Math.max(3, area.value.split("\n").length);
    area.setAttribute("aria-label", this.getAttribute("label") ?? this._name ?? "code");
    area.addEventListener("input", () => this.edited());
    this._editor.replaceChildren(area);
  }

  text() {
    return this._view ? this._view.state.doc.toString() : this._area ? this._area.value : this._code.peek();
  }

  setText(text) {
    if (this._view) this._view.dispatch({ changes: { from: 0, to: this._view.state.doc.length, insert: text } });
    else if (this._area) {
      this._area.value = text;
      this.edited();
    }
  }

  /** After a pause in typing, the new code runs. */
  edited() {
    const text = this.text();
    this._reset.hidden = text === this._initial;
    this.syncBar();
    clearTimeout(this._typing);
    const wait = Number(this.getAttribute("debounce") ?? 400);
    this._typing = setTimeout(() => (this._code.value = text), Number.isFinite(wait) ? Math.max(0, wait) : 400);
  }

  run(code, inputs) {
    this.stop();
    const lang = this.getAttribute("lang") ?? "js";
    this._runner ??= createRunner(lang);
    if (!this._runner) return this.settle({ error: new Error(`No engine for lang="${lang}". See registerEngine.`) });
    const token = (this._token = {});
    this.setPending(true);
    const timeout = Number(this.getAttribute("timeout") ?? 2000);
    const started = performance.now();
    const runner = this._runner;
    // In a promise, so an engine that throws instead of rejecting is handled the same way.
    new Promise((resolve) => resolve(runner.run(code, inputs, { timeout: Number.isFinite(timeout) ? timeout : 2000 }))).then(
      ({ value, logs }) => {
        if (this._token !== token) return;
        if (this._name) this.scope.set(this._name, value);
        this.settle({ value, logs, ms: performance.now() - started });
      },
      (error) => {
        if (this._token !== token || error?.name === "AbortError") return;
        this.settle({ error, logs: error?.logs });
      },
    );
  }

  stop() {
    this._token = null;
    this.setPending(false);
  }

  /** Show how the run went: what it logged, then its value or its error. */
  settle({ value, error, logs = [], ms }) {
    this._token = null;
    this.setPending(false);
    this.classList.toggle("is-error", Boolean(error));
    const lines = logs.map(({ level, text }) => {
      const line = document.createElement("div");
      line.className = `t-codecell-log is-${level}`;
      line.textContent = text;
      return line;
    });
    // The value shows with `output`, or when it has nowhere else to go. Errors and logs always show.
    const showValue = this.hasAttribute("output") || !this._name;
    let result = document.createElement("div");
    if (error) {
      result.className = "t-codecell-error";
      result.textContent = error.line ? `Line ${error.line}: ${error.message}` : error.message;
      console.error(`tangle: <t-codecell${this._name ? ` name="${this._name}"` : ""}>`, result.textContent);
    } else if (showValue) {
      result.className = "t-codecell-value";
      result.textContent = preview(value, 400);
    } else result = null;
    this._output.replaceChildren(...lines, ...(result ? [result] : []));
    this._status.textContent = showValue && !error && ms != null ? `ran in ${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms` : "";
    this.syncBar();
    const name = this.getAttribute("error");
    if (name) this.scope.set(name, error ? result.textContent : null);
  }

  /** The bar under the editor only takes up room when it has something in it. */
  syncBar() {
    this._copy.hidden = !this.hasAttribute("copy");
    this._bar.hidden = this._reset.hidden && this._copy.hidden && !this._status.textContent;
  }

  static observedAttributes = ["copy"];
  attributeChangedCallback() {
    if (this._bar) this.syncBar();
  }

  /** Puts the code, as edited, on the clipboard, and says so on the button for a moment. */
  async copy() {
    let done = false;
    try {
      await navigator.clipboard.writeText(this.text());
      done = true;
    } catch (error) {
      console.error("tangle: <t-codecell> could not copy", error);
    }
    this._copy.textContent = done ? "Copied" : "Copy failed";
    clearTimeout(this._copied);
    this._copied = setTimeout(() => (this._copy.textContent = "Copy"), 1500);
  }

  setPending(on) {
    this.classList.toggle("is-running", on);
    if (this._name) this.scope.setPending(this._name, on);
  }
}

// Attributes whose live element the reader can change, and that are read back.
const LIVE = new Set(["value", "checked"]);

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);

// <t-tag tag='input type="range"'><t-num name="max">10</t-num>…</t-tag>
// Shows an HTML tag whose attributes the reader can change, with the live element
// below it. `tag` is the tag name plus any fixed attributes. Each named child is an
// attribute (`attr` overrides the name shown); a child marked `content`, or loose
// text, is what goes between the tags. A true/false value is a boolean attribute.
// It works both ways for `value` and `checked`: moving the slider or typing in the
// field below sets the variable behind that attribute.
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
      this._preview.addEventListener("input", () => this.sync(scope));
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

  // The reader changed the live element: copy its `value` and `checked` back into
  // the variables behind those attributes.
  sync(scope) {
    const el = this._preview.firstElementChild;
    if (!el || el.localName.includes("-")) return;
    this._els.forEach((_, i) => {
      const prop = this.attrName(i);
      if (i === this._content || !LIVE.has(prop) || !(prop in el)) return;
      const old = scope.peek(this._args[i]);
      let next = el[prop];
      if (typeof old === "number") next = Number(next);
      else if (typeof old === "boolean") next = Boolean(next);
      if (typeof next === "number" && !Number.isFinite(next)) return;
      scope.set(this._args[i], next);
    });
  }

  render(scope) {
    const { name, attrs } = this._tag;
    const want = new Map(attrs);
    const live = new Map();
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
      const attr = this.attrName(i);
      if (i === this._content) text = shown;
      else if (isBool) value ? want.set(attr, "") : want.delete(attr);
      else if (value !== undefined) want.set(attr, shown);
      if (i !== this._content && LIVE.has(attr) && value !== undefined) live.set(attr, isBool ? value : shown);
    });
    untracked(() => {
      // A plain element is updated in place, so a slider keeps being dragged and a
      // field keeps its focus. vangle's own elements are made anew, to read their attributes.
      const plain = !name.includes("-");
      let el = this._preview.firstElementChild;
      const reuse = plain && el?.localName === name;
      if (!reuse) el = document.createElement(name);
      for (const { name: key } of [...el.attributes]) if (!want.has(key)) el.removeAttribute(key);
      for (const [key, value] of want) if (el.getAttribute(key) !== value) el.setAttribute(key, value);
      if (!VOID_TAGS.has(name) && el.textContent !== text) el.textContent = text;
      if (plain) for (const [key, value] of live) if (key in el && el[key] !== value) el[key] = value;
      if (!reuse) this._preview.replaceChildren(el);
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
    const tex = partsTex(this._parts, scope);

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
// <t-formula-dag>: formulas in rows, one row per dependency depth, with an
// arrow from each formula's output symbol to every place another formula
// uses it (\use{name}). Formulas can carry draggable numbers (\tangle),
// live results (\val), notes (\note), and a value of their own.
// ---------------------------------------------------------------------------

const DAG_HEAD_LEN = 7; // arrowhead length, px
const DAG_HEAD_HALF = 3.5; // arrowhead half-width
const DAG_LAND_GAP = 3; // between an arrow tip and the ink it points at
const DAG_SIDE_GAP = 12; // how far beside a formula a side-landing arrow comes down
const DAG_SIDE_PAD = 4; // vertical clearance a side landing keeps from glyphs
const DAG_CORNER = 7; // radius of an arrow's turns
const DAG_NOTE_PAD_Y = 4; // card edge to a row of note labels
const DAG_NOTE_ARROW_SPACE = 22; // formula to a row of note labels
const DAG_NOTE_GAP = 12; // between two labels in a row
const DAG_NOTE_CLEARANCE = 3; // between a note arrow's end and what it touches
const DAG_NOTE_HEAD_LEN = 6;
const DAG_NOTE_HEAD_HALF = 3.5;
const DAG_LANE_CLEARANCE = 8; // labels keep this far from a DAG arrow passing by
const DAG_NOTE_SIDE_SPACE = 20; // a left-hand note's label to the output symbol
const DAG_KATEX = {
  displayMode: true,
  throwOnError: true,
  trust: (ctx) => ctx.command === "\\htmlData" || ctx.command === "\\htmlClass",
  strict: (code) => (code === "htmlExtension" ? "ignore" : "warn"),
};

/** KaTeX's leaf boxes: glyph text, rules (fraction bars) and SVGs (radicals). Struts are skipped. */
function glyphLeaves(root) {
  const out = [];
  const walk = (node) => {
    if (node instanceof SVGElement) return out.push(node);
    const cls = node.classList;
    if (cls.contains("pstrut") || cls.contains("strut") || cls.contains("vlist-s")) return;
    if (!node.children.length) {
      const r = node.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push(node);
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(root);
  return out;
}

// A text box spans the font's whole ascent and descent, well past the ink.
// Measure the glyphs on a canvas and trim the box to the ink, so arrows land
// on the symbol rather than on the empty space above it.
let dagCanvas = null;
const dagMetrics = new Map(); // font + text -> TextMetrics
function inkRect(el) {
  const r = el.getBoundingClientRect();
  const text = el.textContent;
  if (el instanceof SVGElement || !text || !text.trim()) return r;
  const cs = getComputedStyle(el);
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const key = `${font}\n${text}`;
  let m = dagMetrics.get(key);
  if (!m) {
    dagCanvas ??= document.createElement("canvas").getContext("2d");
    dagCanvas.font = font;
    m = dagCanvas.measureText(text);
    // Before the KaTeX fonts load the metrics are for a fallback font: don't keep those.
    if (document.fonts?.status !== "loading") dagMetrics.set(key, m);
  }
  if (!m.fontBoundingBoxAscent) return r;
  const baseline = r.top + m.fontBoundingBoxAscent;
  return {
    left: r.left,
    right: r.right,
    top: baseline - m.actualBoundingBoxAscent,
    bottom: baseline + m.actualBoundingBoxDescent,
  };
}

const dagDiv = (className) => Object.assign(document.createElement("div"), { className });

// <t-formula-dag name="picked">
//   <script type="text/plain">
//   {
//     formulas: {
//       mu: String.raw`\mu = \frac{1}{n}\sum_i x_i`,
//       z: { tex: String.raw`z = \frac{\tangle{x} - \use{mu}}{\sigma}`, value: "(x - mu) / sigma" },
//     },
//   }
//   </script>
// </t-formula-dag>
class TFormulaDag extends TangleElement {
  connectedCallback() {
    if (this._model === undefined) {
      try {
        this._model = this.readSpec();
      } catch (error) {
        this._model = null;
        this.showError(error);
      }
    }
    if (!this._model) return;
    if (!this._root) {
      this._root = dagDiv("tangle-dag is-loading");
      this._root.textContent = "Loading formulas…";
      this.append(this._root);
    }
    const token = (this._token = {});
    loadKatex().then(
      (katex) => {
        if (this._token === token && this.isConnected) this.start(katex);
      },
      (error) => {
        if (this._token === token) this.showError(new Error(`t-formula-dag: could not load KaTeX: ${error.message}`));
      },
    );
  }

  disconnectedCallback() {
    this._token = null;
    this._resize?.disconnect();
    super.disconnectedCallback();
  }

  /** Evaluate the spec, check it, and define each formula's value in the scope. */
  readSpec() {
    const scope = this.scope;
    const source = this.querySelector(":scope > script")?.textContent ?? "";
    if (!source.trim()) {
      throw new Error('t-formula-dag: put the spec in a <script type="text/plain"> inside it');
    }
    let spec;
    try {
      // Once, untracked: only a formula's value is reactive. Functions in the
      // spec close over the scope, so `() => v * t` reads v and t when it runs.
      spec = untracked(() => evalWith(scope, source, {}));
    } catch (error) {
      throw new Error(`t-formula-dag: the spec: ${error.message}`);
    }
    const model = formulaDag(spec);
    for (const p of model.params) {
      const { value, ...meta } = p.config;
      declareMeta(scope, p.name, meta, value);
    }
    for (const f of model.formulas) {
      if (f.value == null) continue;
      const def = scope.slot(f.name).def.peek();
      if (def !== undefined && !(def instanceof Formula)) {
        console.warn(`t-formula-dag: formula "${f.name}" replaces the variable of the same name`, this);
      }
      scope.define(f.name, f.value);
    }
    this._byName = new Map(model.formulas.map((f) => [f.name, f]));
    return model;
  }

  showError(error) {
    this._root?.remove();
    this._root = null;
    this._error ??= dagDiv("tangle-dag-error");
    this._error.textContent = error.message;
    this.append(this._error);
  }

  // ---- the edges, as data -------------------------------------------------

  /** [producer, consumer] pairs: which formula's output each formula uses. */
  get edges() {
    return (this._model?.edges ?? []).map((e) => [...e]);
  }
  /** The formulas `name` uses, directly or not. */
  upstream(name) {
    return [...dagReach(name, this.adjacency(1, 0))];
  }
  /** The formulas that use `name`, directly or not. */
  downstream(name) {
    return [...dagReach(name, this.adjacency(0, 1))];
  }
  adjacency(from, to) {
    const next = new Map();
    for (const e of this._model?.edges ?? []) {
      if (!next.has(e[from])) next.set(e[from], []);
      next.get(e[from]).push(e[to]);
    }
    return next;
  }

  // ---- building -------------------------------------------------------------

  start(katex) {
    const scope = this.scope;
    const model = this._model;
    this._katex = katex;
    this._cards = new Map(); // name -> { card, stage, tex, tints, noteArrows, labels, caption }
    this._lanes = new Map(); // waypoint -> lane element
    this._rows = [];
    this._rowOf = new Map();
    this._lastTex = new Map();
    this._edgeEls = [];
    this._blocks = {}; // card -> { top: [x], bottom: [x] }: where DAG arrows cross its label rows
    this._focused = null;
    this._noteHover = null;
    this._producers = new Set(model.edges.map(([src]) => src));
    // What Reset goes back to: the values once everything on the page has declared.
    this._initial = Object.fromEntries(model.params.map((p) => [p.name, scope.peek(p.name)]));

    const root = this._root;
    root.className = "tangle-dag";
    const board = (this._board = dagDiv("tangle-dag-board"));
    for (const layer of model.layers) {
      const row = dagDiv("tangle-dag-row");
      for (const id of layer) {
        this._rowOf.set(id, this._rows.length);
        if (this._byName.has(id)) {
          row.append(this.buildCard(this._byName.get(id)));
        } else {
          // An empty lane for an edge that skips this row.
          const lane = dagDiv("tangle-dag-lane");
          this._lanes.set(id, lane);
          row.append(lane);
        }
      }
      this._rows.push(row);
      board.append(row);
    }
    this._svg = svgNode("svg", { class: "tangle-dag-edges", "aria-hidden": "true" });
    board.append(this._svg);
    root.replaceChildren(board);
    const footer = this.buildFooter();
    if (footer) root.append(footer);

    for (const f of model.formulas) this.watch(() => this.renderCard(f, scope));
    this.watch(() => {
      hover.value, active.value;
      untracked(() => this.syncLinks(scope));
    });
    const name = this.getAttribute("name");
    if (name) {
      this.watch(() => {
        const picked = scope.get(name);
        for (const [id, { card }] of this._cards) card.classList.toggle("is-selected", id === picked);
      });
    }

    if (!this._listening) {
      this._listening = true;
      root.addEventListener("pointerover", (event) => this.noteHoverAt(event.target));
      root.addEventListener("focusin", (event) => this.noteHoverAt(event.target));
      root.addEventListener("pointerleave", () => this.setNoteHover(null));
    }
    this._resize = new ResizeObserver(() => this.relayoutSoon());
    this._resize.observe(root);
    document.fonts?.ready.then(() => {
      dagMetrics.clear();
      this.relayoutSoon();
    });
    this.relayout();
  }

  buildCard(f) {
    const card = dagDiv("tangle-dag-card");
    card.dataset.node = f.name;
    const stage = dagDiv("tangle-dag-stage");
    const tints = svgNode("svg", { class: "tangle-dag-tints", "aria-hidden": "true" });
    const tex = dagDiv("tangle-dag-tex");
    const noteArrows = svgNode("svg", { class: "tangle-dag-note-arrows", "aria-hidden": "true" });
    stage.append(tints, tex, noteArrows);
    const labels = new Map();
    for (const [name, note] of Object.entries(this._model.notes)) {
      if (note.formula !== f.name) continue;
      const label = dagDiv("tangle-dag-note");
      label.dataset.note = name;
      this.noteContent(label, note.text);
      stage.append(label);
      labels.set(name, label);
    }
    const caption = dagDiv("tangle-dag-caption");
    caption.textContent = f.label;
    card.append(stage, caption);
    card.addEventListener("mouseenter", () => this.focus(f.name));
    card.addEventListener("mouseleave", () => this.focus(null));
    const name = this.getAttribute("name");
    if (name) {
      card.classList.add("is-pickable");
      card.addEventListener("click", (event) => {
        if (event.target.closest(`${PARAM}, .tangle-dag-note`)) return;
        const scope = this.scope;
        scope.set(name, scope.peek(name) === f.name ? null : f.name);
      });
    }
    this._cards.set(f.name, { card, stage, tex, tints, noteArrows, labels, caption });
    return card;
  }

  /** Note text: plain, with **bold** and $math$. Built as DOM, never as HTML. */
  noteContent(el, text) {
    for (const part of noteParts(text)) {
      if (part.math !== undefined) {
        const span = document.createElement("span");
        this._katex.render(part.math, span, { throwOnError: false });
        el.append(span);
      } else if (part.bold !== undefined) {
        el.append(Object.assign(document.createElement("strong"), { textContent: part.bold }));
      } else {
        el.append(part.text);
      }
    }
  }

  /** The legend (one chip per number, then one per formula value) and Reset. */
  buildFooter() {
    const model = this._model;
    const scope = this.scope;
    const valued = model.formulas.filter((f) => f.value != null);
    const legend = model.legend && (model.params.length || valued.length);
    const reset = model.reset && model.params.length;
    if (!legend && !reset) return null;
    const footer = dagDiv("tangle-dag-footer");
    if (legend) {
      const strip = dagDiv("tangle-dag-legend");
      if (model.params.length) {
        const row = dagDiv("tangle-dag-legend-row");
        for (const p of model.params) {
          const chip = dagDiv("tangle-dag-chip");
          const symbol = dagDiv("tangle-dag-chip-symbol");
          this._katex.render(p.symbol, symbol, { throwOnError: false });
          const label = dagDiv("tangle-dag-chip-label");
          const value = dagDiv("tangle-dag-chip-value");
          chip.append(symbol, label, value);
          this.makeDraggable(p.name, chip);
          this.watch(() => {
            const meta = scope.meta(p.name);
            label.textContent = meta.label ?? "";
            value.textContent = formatValue(scope.get(p.name), meta.format, meta.step);
          });
          row.append(chip);
        }
        strip.append(row);
      }
      if (valued.length) {
        const row = dagDiv("tangle-dag-legend-row");
        for (const f of valued) {
          const chip = dagDiv("tangle-dag-chip is-output");
          chip.dataset.tangleHover = keyOf(scope, f.name);
          const symbol = dagDiv("tangle-dag-chip-symbol");
          this._katex.render(f.symbol, symbol, { throwOnError: false });
          if (f.color) symbol.style.setProperty("--tangle-dag-c", f.color);
          chip.append(symbol);
          if (f.label !== f.name) {
            const label = dagDiv("tangle-dag-chip-label");
            label.textContent = f.label;
            chip.append(label);
          }
          const value = dagDiv("tangle-dag-chip-value");
          chip.append(value);
          this.watch(() => {
            try {
              value.textContent = formatValue(scope.get(f.name), f.format);
              chip.classList.remove("is-error");
              chip.title = "";
            } catch (error) {
              value.textContent = "⚠";
              chip.classList.add("is-error");
              chip.title = error?.message ?? String(error);
            }
          });
          row.append(chip);
        }
        strip.append(row);
      }
      footer.append(strip);
    }
    if (reset) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tangle-dag-reset";
      button.textContent = "Reset";
      button.addEventListener("click", () => scope.setValues(this._initial));
      this.watch(() => {
        const changed = model.params.some((p) => !Object.is(scope.get(p.name), this._initial[p.name]));
        button.classList.toggle("is-changed", changed);
      });
      footer.append(button);
    }
    return footer;
  }

  // ---- rendering a card -----------------------------------------------------

  /** The name of the variable being dragged or edited, if it's in this scope. */
  activeName(scope) {
    const key = active.value;
    const prefix = `${scope.id}:`;
    return key && key.startsWith(prefix) ? key.slice(prefix.length) : null;
  }

  /** A formula shows its value instead of its symbol while a variable it reads is changing. */
  revealed(name, scope) {
    const f = this._byName.get(name);
    const changing = this.activeName(scope);
    if (f.value == null || !changing) return false;
    return untracked(() => {
      try {
        scope.get(name); // so its dependencies are known
      } catch {}
      return variablesRead(scope, name).has(changing);
    });
  }

  valueTex(name, scope) {
    try {
      return toTex(scope.get(name), this._byName.get(name).format);
    } catch {
      return "\\text{?}";
    }
  }

  renderCard(f, scope) {
    const tex = cardTex(f, {
      symbol: (n) => this._byName.get(n).symbol,
      revealed: (n) => this.revealed(n, scope),
      valueTex: (n) => this.valueTex(n, scope),
      markers: (parts, text) => partsTex(parts, scope, text),
    });
    untracked(() => {
      if (this._lastTex.get(f.name) === tex) return;
      this._lastTex.set(f.name, tex);
      const { tex: target } = this._cards.get(f.name);
      // Remember which number had keyboard focus; rendering replaces it.
      const focused = document.activeElement;
      const refocus = target.contains(focused) && focused.matches(PARAM) ? occurrence(focused) : null;
      try {
        this._katex.render(tex, target, DAG_KATEX);
        target.classList.remove("is-error");
        target.title = "";
      } catch (error) {
        target.textContent = f.tex;
        target.classList.add("is-error");
        target.title = error.message;
        console.error(`t-formula-dag: formula "${f.name}": ${error.message}`, this);
      }
      this.decorateCard(f, target, scope);
      if (refocus) relocate(refocus, focused.dataset.tangleParam)?.focus({ preventScroll: true });
      this.relayoutSoon();
    });
  }

  /** Color and wire up the markers in a freshly rendered card. */
  decorateCard(f, target, scope) {
    const html = target.querySelector(".katex-html");
    if (!html) return;
    const out = html.querySelector("[data-fdag-out]");
    if (out) {
      out.dataset.tangleHover = keyOf(scope, f.name);
      if (f.color) out.style.setProperty("--tangle-dag-c", f.color);
    }
    for (const use of html.querySelectorAll("[data-fdag-use]")) {
      const producer = this._byName.get(use.dataset.fdagUse);
      use.dataset.tangleHover = keyOf(scope, producer.name);
      if (producer.color) use.style.setProperty("--tangle-dag-c", producer.color);
    }
    for (const el of html.querySelectorAll(PARAM)) {
      decorate(el, scope, el.dataset.tangleParam);
      syncClasses(el, scope, el.dataset.tangleParam);
    }
    for (const term of html.querySelectorAll("[data-note]")) {
      const note = this._model.notes[term.dataset.note];
      term.classList.add("tangle-dag-term");
      term.tabIndex = 0;
      term.setAttribute("aria-label", note.text);
    }
    this.colorNotes(scope);
    this.syncLinks(scope);
    this.spaceNumbersAfterDigits(html);
  }

  /** A note takes its own color, else the color of the number it wraps, else the note gray. */
  noteColor(note, scope) {
    if (note.color) return note.color;
    if (note.param) return scope.meta(note.param).color ?? "currentColor";
    return "var(--tangle-dag-note)";
  }

  colorNotes(scope) {
    for (const el of this._root.querySelectorAll("[data-note]")) {
      const note = this._model.notes[el.dataset.note];
      if (note) el.style.setProperty("--tangle-dag-c", this.noteColor(note, scope));
    }
  }

  // A number shown right after a digit reads as one number (2σ with σ = 1.7
  // shows as "21.7"): give such a number a small gap.
  spaceNumbersAfterDigits(html) {
    const walker = document.createTreeWalker(html, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    let previous = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent.trim();
      if (!text) continue;
      const marker = node.parentElement.closest("[data-tangle-param], [data-fdag-use], [data-fdag-out]");
      if (marker && !seen.has(marker)) {
        seen.add(marker);
        marker.classList.toggle("tangle-dag-gap", /[0-9.]$/.test(previous) && /^[0-9.]/.test(text));
      }
      previous = text;
    }
  }

  /** Light up what's under the pointer everywhere it shows: a number, or a formula's output. */
  syncLinks(scope) {
    if (!this._root) return;
    const key = hover.peek();
    for (const el of this._root.querySelectorAll(".katex-html [data-tangle-param]")) {
      syncClasses(el, scope, el.dataset.tangleParam);
    }
    for (const el of this._root.querySelectorAll("[data-tangle-hover]")) {
      el.classList.toggle("is-hot", key === el.dataset.tangleHover);
    }
    this.applyNoteHover();
  }

  // ---- notes --------------------------------------------------------------

  /** The note that explains a number: the one wrapping exactly that \tangle. */
  noteForParam(param) {
    return Object.entries(this._model.notes).find(([, note]) => note.param === param)?.[0] ?? null;
  }

  noteHoverAt(target) {
    const label = target.closest?.(".tangle-dag-note");
    if (label) return this.setNoteHover(label.dataset.note);
    const param = target.closest?.(PARAM);
    const paramNote = param ? this.noteForParam(param.dataset.tangleParam) : null;
    if (paramNote) return this.setNoteHover(paramNote);
    this.setNoteHover(target.closest?.(".katex-html [data-note]")?.dataset.note ?? null);
  }

  setNoteHover(name) {
    this._noteHover = name;
    this.applyNoteHover();
  }

  /** The highlighted note (a dragged number's beats the hovered one) lifts; the others fade. */
  applyNoteHover() {
    if (!this._board) return;
    const changing = untracked(() => this.activeName(this.scope));
    const name = (changing && this.noteForParam(changing)) || this._noteHover;
    const on = Boolean(name) && name in this._model.notes;
    this._root.classList.toggle("has-note-hover", on);
    for (const el of this._board.querySelectorAll("[data-note]")) {
      el.classList.toggle("is-hovered", on && el.dataset.note === name);
    }
  }

  /** Lay out the notes of card `id` around the arrow columns in this._blocks. */
  layoutNotes(id) {
    const { stage, tex, tints, noteArrows, labels } = this._cards.get(id);
    tints.replaceChildren();
    noteArrows.replaceChildren();
    stage.style.padding = "";
    if (!labels.size) return;
    const notes = this._model.notes;
    const scope = this.scope;
    const blocks = this._blocks[id] ?? { top: [], bottom: [] };

    const base = () => stage.getBoundingClientRect();
    const rel = (r, b = base()) => ({
      left: r.left - b.left,
      right: r.right - b.left,
      top: r.top - b.top,
      bottom: r.bottom - b.top,
      cx: r.left - b.left + (r.right - r.left) / 2,
      cy: r.top - b.top + (r.bottom - r.top) / 2,
    });
    const html = tex.querySelector(".katex-html");
    const termOf = (name) => html?.querySelector(`[data-note="${name}"]`);
    const termBox = (term) => rel(rectUnion(glyphLeaves(term).map(inkRect)) ?? term.getBoundingClientRect());

    // 1. A side per note: parts above the formula's middle go up, parts below
    //    go down, and a note on the output symbol goes left (arrows come in
    //    above it and leave below it). The rest take the side fewer arrows
    //    cross, then balance.
    const texBox = rel(tex.getBoundingClientRect());
    // The formula's own width: the tex box stretches with the card.
    const ink = html && rectUnion(glyphLeaves(html).map(inkRect));
    const formulaW = ink ? rel(ink).right - texBox.left : texBox.right - texBox.left;
    const out = html?.querySelector("[data-fdag-out]");
    const items = [];
    const counts = { top: 0, bottom: 0 };
    const undecided = [];
    for (const [name, label] of labels) {
      const term = termOf(name);
      // A live value can stand in for a noted part: hide its note meanwhile.
      label.style.display = term ? "" : "none";
      if (!term) continue;
      label.style.setProperty("--tangle-dag-c", this.noteColor(notes[name], scope));
      const box = termBox(term);
      const item = {
        name,
        side: notes[name].side,
        label,
        cx: box.cx - texBox.left,
        leftRel: box.left - texBox.left,
        cyRel: box.cy - texBox.top,
      };
      if (item.side === "auto" && out?.contains(term)) item.side = "left";
      label.classList.toggle("is-left", item.side === "left");
      item.w = label.offsetWidth;
      item.h = label.offsetHeight;
      items.push(item);
      if (item.side === "auto") {
        const offset = box.cy - texBox.cy;
        if (offset < -4) item.side = "top";
        else if (offset > 4) item.side = "bottom";
        else undecided.push(item);
      }
      if (item.side === "top" || item.side === "bottom") counts[item.side]++;
    }
    const crossing = (item, side) =>
      blocks[side].filter(
        (x) => x > item.cx - item.w / 2 - DAG_LANE_CLEARANCE && x < item.cx + item.w / 2 + DAG_LANE_CLEARANCE,
      ).length;
    for (const item of undecided) {
      const top = crossing(item, "top");
      const bottom = crossing(item, "bottom");
      item.side = top !== bottom ? (top < bottom ? "top" : "bottom") : counts.top <= counts.bottom ? "top" : "bottom";
      counts[item.side]++;
    }

    // 2. One row of labels per side, clear of the DAG arrows passing through
    //    it (x relative to the formula's left edge).
    const heights = {};
    let minX = 0;
    let maxX = formulaW;
    for (const side of ["top", "bottom"]) {
      const row = items.filter((item) => item.side === side).sort((a, b) => a.cx - b.cx);
      const sideBlocks = blocks[side].map((x) => ({ left: x - DAG_LANE_CLEARANCE, right: x + DAG_LANE_CLEARANCE }));
      packRow(row, sideBlocks, DAG_NOTE_GAP);
      heights[side] = row.length ? Math.max(...row.map((item) => item.h)) : 0;
      for (const item of row) {
        minX = Math.min(minX, item.x);
        maxX = Math.max(maxX, item.x + item.w);
      }
    }
    // Left-hand labels stack, centered on their terms' height.
    const lefts = items.filter((item) => item.side === "left");
    let needTop = 0;
    let needBottom = 0;
    if (lefts.length) {
      const stack = lefts.reduce((sum, item) => sum + item.h, 0) + (DAG_NOTE_GAP / 2) * (lefts.length - 1);
      const cy = lefts.reduce((sum, item) => sum + item.cyRel, 0) / lefts.length;
      const edge = Math.min(...lefts.map((item) => item.leftRel)) - DAG_NOTE_SIDE_SPACE;
      let y = cy - stack / 2;
      for (const item of lefts) {
        item.x = edge - item.w;
        item.yRel = y;
        y += item.h + DAG_NOTE_GAP / 2;
        minX = Math.min(minX, item.x);
      }
      const texH = texBox.bottom - texBox.top;
      needTop = Math.max(0, -(cy - stack / 2)) + (cy - stack / 2 < 0 ? DAG_NOTE_PAD_Y : 0);
      needBottom = Math.max(0, cy + stack / 2 - texH) + (cy + stack / 2 > texH ? DAG_NOTE_PAD_Y : 0);
    }
    const band = (side) => (heights[side] ? DAG_NOTE_ARROW_SPACE + heights[side] + DAG_NOTE_PAD_Y : 0);
    // Labels wider than the formula widen the card instead of spilling out.
    stage.style.paddingTop = `${Math.max(band("top"), needTop)}px`;
    stage.style.paddingBottom = `${Math.max(band("bottom"), needBottom)}px`;
    stage.style.paddingLeft = `${-minX}px`;
    stage.style.paddingRight = `${maxX - formulaW}px`;

    // 3. The padding moved the formula: measure again and place the labels.
    const formula = rel(tex.getBoundingClientRect());
    for (const item of items) {
      const top =
        item.side === "left"
          ? formula.top + item.yRel
          : item.side === "top"
            ? formula.top - DAG_NOTE_ARROW_SPACE - item.h
            : formula.bottom + DAG_NOTE_ARROW_SPACE;
      item.label.style.left = `${formula.left + item.x}px`;
      item.label.style.top = `${top}px`;
    }

    // 4. A soft tint behind every noted part.
    for (const node of html?.querySelectorAll("[data-note]") ?? []) {
      const note = notes[node.dataset.note];
      if (!note) continue;
      const box = termBox(node);
      const rect = svgNode("rect", {
        class: "tangle-dag-tint",
        x: box.left - 3,
        y: box.top - 3,
        width: box.right - box.left + 6,
        height: box.bottom - box.top + 6,
        rx: 4,
      });
      rect.dataset.note = node.dataset.note;
      rect.style.setProperty("--tangle-dag-c", this.noteColor(note, scope));
      tints.append(rect);
    }

    // 5. A gentle curve from each label to its term, with an open chevron, so
    //    notes read differently from the DAG's filled arrows.
    for (const item of items) {
      const term = termBox(termOf(item.name));
      const label = rel(item.label.getBoundingClientRect());
      let paths;
      if (item.side === "left") {
        const from = { x: label.right + DAG_NOTE_CLEARANCE, y: (label.top + label.bottom) / 2 };
        const to = { x: term.left - DAG_NOTE_CLEARANCE - 2, y: term.cy };
        const midX = (from.x + to.x) / 2;
        const backX = to.x - DAG_NOTE_HEAD_LEN;
        paths = [
          `M ${from.x} ${from.y} C ${midX} ${from.y} ${midX} ${to.y} ${to.x} ${to.y}`,
          `M ${backX} ${to.y - DAG_NOTE_HEAD_HALF} L ${to.x} ${to.y} L ${backX} ${to.y + DAG_NOTE_HEAD_HALF}`,
        ];
      } else {
        const top = item.side === "top";
        const fromX = Math.max(label.left + 8, Math.min(term.cx, label.right - 8));
        const from = { x: fromX, y: top ? label.bottom + DAG_NOTE_CLEARANCE : label.top - DAG_NOTE_CLEARANCE };
        const to = { x: term.cx, y: top ? term.top - DAG_NOTE_CLEARANCE - 3 : term.bottom + DAG_NOTE_CLEARANCE + 3 };
        const midY = (from.y + to.y) / 2;
        const backY = to.y - (Math.sign(to.y - from.y) || 1) * DAG_NOTE_HEAD_LEN;
        paths = [
          `M ${from.x} ${from.y} C ${from.x} ${midY} ${to.x} ${midY} ${to.x} ${to.y}`,
          `M ${to.x - DAG_NOTE_HEAD_HALF} ${backY} L ${to.x} ${to.y} L ${to.x + DAG_NOTE_HEAD_HALF} ${backY}`,
        ];
      }
      const group = svgNode("g", { class: "tangle-dag-note-arrow" });
      group.dataset.note = item.name;
      group.style.setProperty("--tangle-dag-c", this.noteColor(notes[item.name], scope));
      for (const d of paths) group.append(svgNode("path", { d }));
      noteArrows.append(group);
    }
  }

  // ---- layout -----------------------------------------------------------------

  // Notes move formulas and arrows move notes: lay the notes out around the
  // last known arrow columns, draw the arrows, and again if the columns moved.
  relayout() {
    if (!this._board || !this.isConnected) return;
    const before = JSON.stringify(this._blocks);
    for (const id of this._cards.keys()) this.layoutNotes(id);
    this.draw();
    if (JSON.stringify(this._blocks) !== before) {
      for (const id of this._cards.keys()) this.layoutNotes(id);
      this.draw();
    }
    this.applyNoteHover();
  }

  relayoutSoon() {
    if (this._relayoutQueued) return;
    this._relayoutQueued = true;
    requestAnimationFrame(() => {
      this._relayoutQueued = false;
      this.relayout();
    });
  }

  draw() {
    const svg = this._svg;
    svg.replaceChildren();
    this._edgeEls = [];
    const base = this._board.getBoundingClientRect();
    const rel = (r) => ({ left: r.left - base.left, right: r.right - base.left, top: r.top - base.top, bottom: r.bottom - base.top });
    const box = (node) => rel(node.getBoundingClientRect());
    const cards = this._cards;
    const producers = this._producers;
    const rowBoxes = this._rows.map(box);
    const htmlOf = (id) => cards.get(id).tex.querySelector(".katex-html");

    // Per card: the ink box of every glyph, and of the formula as a whole.
    const glyphs = new Map();
    const formulaInk = new Map();
    const texLeft = new Map();
    for (const [id, parts] of cards) {
      const html = htmlOf(id);
      const g = html ? glyphLeaves(html).map((el) => ({ el, ...rel(inkRect(el)) })) : [];
      glyphs.set(id, g);
      formulaInk.set(id, rectUnion(g) ?? box(parts.card));
      texLeft.set(id, box(parts.tex).left);
    }
    const inkOf = (id, node) => rectUnion(glyphs.get(id).filter((g) => node.contains(g.el))) ?? box(node);

    // A formula's outgoing arrows share one stem, dropping from under its output symbol.
    const stems = new Map();
    for (const id of cards.keys()) {
      const out = htmlOf(id)?.querySelector("[data-fdag-out]");
      const sym = out ? inkOf(id, out) : formulaInk.get(id);
      stems.set(id, { x: (sym.left + sym.right) / 2, top: sym.bottom + DAG_LAND_GAP, width: sym.right - sym.left });
    }
    // A caption sits right of its formula's stem, never across it.
    for (const id of producers) {
      const { card, caption } = cards.get(id);
      const pad = parseFloat(getComputedStyle(card).paddingLeft) || 0;
      const margin = `${Math.max(0, Math.round(stems.get(id).x - box(card).left - pad + 8))}px`;
      if (caption.style.marginLeft !== margin) caption.style.marginLeft = margin;
    }
    const blocks = {};
    const block = (id, side, x) => (blocks[id] ??= { top: [], bottom: [] })[side].push(Math.round(x - texLeft.get(id)));
    for (const id of producers) block(id, "bottom", stems.get(id).x);

    // 1. Every arrow's columns: the x it holds in each row it passes.
    const arrows = [];
    for (const route of this._model.routes) {
      const src = route[0];
      const dst = route[route.length - 1];
      const ink = formulaInk.get(dst);
      const uses = [...(htmlOf(dst)?.querySelectorAll(`[data-fdag-use="${src}"]`) ?? [])];
      for (const use of uses.length ? uses : [null]) {
        let landing;
        if (!use) {
          // The use is hidden (a live value stands in): land on the formula.
          const x = (ink.left + ink.right) / 2;
          landing = { side: "top", x, tip: { x, y: ink.top - DAG_LAND_GAP } };
        } else {
          const sym = inkOf(dst, use);
          const cx = (sym.left + sym.right) / 2;
          const cy = (sym.top + sym.bottom) / 2;
          // Keep clear of the target's other glyphs and of its own stem.
          const others = glyphs.get(dst).filter((g) => !use.contains(g.el));
          if (producers.has(dst)) {
            const st = stems.get(dst);
            others.push({ left: st.x - st.width / 2, right: st.x + st.width / 2, top: st.top, bottom: box(cards.get(dst).card).bottom });
          }
          const side = landingSide(sym, others, stems.get(src).x, DAG_SIDE_PAD);
          if (side === "top") landing = { side, x: cx, tip: { x: cx, y: sym.top - DAG_LAND_GAP } };
          else if (side === "right") landing = { side, x: ink.right + DAG_SIDE_GAP, tip: { x: sym.right + DAG_LAND_GAP, y: cy } };
          else landing = { side, x: ink.left - DAG_SIDE_GAP, tip: { x: sym.left - DAG_LAND_GAP, y: cy } };
        }
        block(dst, "top", landing.x);
        // A long edge threads one lane per row it skips. Lanes sit at
        // different x in each row: straighten them into one vertical line
        // when that line clears every formula in those rows.
        const waypoints = route.slice(1, -1);
        let laneXs = waypoints.map((wp) => {
          const lane = box(this._lanes.get(wp));
          return (lane.left + lane.right) / 2;
        });
        if (laneXs.length > 1) {
          const passed = waypoints
            .flatMap((wp) => [...this._rows[this._rowOf.get(wp)].children])
            .filter((n) => n.classList.contains("tangle-dag-card"))
            .map(box);
          const clear = (x) => passed.every((b) => x < b.left - 6 || x > b.right + 6);
          const straight = [Math.max(...laneXs), Math.min(...laneXs)].find(clear);
          if (straight !== undefined) laneXs = laneXs.map(() => straight);
        }
        arrows.push({ src, dst, row: this._rowOf.get(src), xs: [stems.get(src).x, ...laneXs, landing.x], landing });
      }
    }
    this._blocks = blocks;

    // 2. Each gap between two rows gets one horizontal track per producer that
    //    jogs sideways there, shared by its arrows. Stack them with the fewest crossings.
    const segs = new Map(); // gap -> Map(src -> [{ from, to }])
    for (const a of arrows) {
      a.xs.forEach((x, k) => {
        if (k === a.xs.length - 1 || Math.abs(a.xs[k + 1] - x) < 1) return;
        const gap = a.row + k;
        if (!segs.has(gap)) segs.set(gap, new Map());
        const bySrc = segs.get(gap);
        if (!bySrc.has(a.src)) bySrc.set(a.src, []);
        bySrc.get(a.src).push({ from: x, to: a.xs[k + 1] });
      });
    }
    const tracks = new Map();
    for (const [gap, bySrc] of segs) {
      const seed = [...bySrc.keys()].sort((p, q) => stems.get(p).x - stems.get(q).x);
      tracks.set(gap, trackOrder(seed, bySrc));
    }
    const trackY = (gap, src) => {
      const top = rowBoxes[gap].bottom;
      const list = tracks.get(gap);
      return top + ((rowBoxes[gap + 1].top - top) * (list.indexOf(src) + 1)) / (list.length + 1);
    };

    // 3. Draw: down, a rounded jog along the track, down again; then into the
    //    symbol from above or, when something covers it, from the side.
    for (const a of arrows) {
      const { tip, side } = a.landing;
      let d = `M ${a.xs[0]} ${stems.get(a.src).top}`;
      a.xs.forEach((x, k) => {
        if (k === a.xs.length - 1) return;
        const next = a.xs[k + 1];
        if (Math.abs(next - x) < 1) return;
        const ty = trackY(a.row + k, a.src);
        const s = Math.sign(next - x);
        const r = Math.min(DAG_CORNER, Math.abs(next - x) / 2);
        d += ` L ${x} ${ty - r} Q ${x} ${ty}, ${x + s * r} ${ty}`;
        d += ` L ${next - s * r} ${ty} Q ${next} ${ty}, ${next} ${ty + r}`;
      });
      const last = a.xs[a.xs.length - 1];
      let dir = { x: 0, y: 1 };
      if (side !== "top") {
        const s = side === "right" ? -1 : 1; // the direction of travel into the symbol
        d += ` L ${last} ${tip.y - DAG_CORNER} Q ${last} ${tip.y}, ${last + s * DAG_CORNER} ${tip.y}`;
        dir = { x: s, y: 0 };
      }
      // Stop the line at the arrowhead's base so it doesn't poke through.
      d += ` L ${tip.x - dir.x * DAG_HEAD_LEN * 0.8} ${tip.y - dir.y * DAG_HEAD_LEN * 0.8}`;
      const bx = tip.x - dir.x * DAG_HEAD_LEN;
      const by = tip.y - dir.y * DAG_HEAD_LEN;
      const head =
        `M ${tip.x} ${tip.y} L ${bx - dir.y * DAG_HEAD_HALF} ${by + dir.x * DAG_HEAD_HALF} ` +
        `L ${bx + dir.y * DAG_HEAD_HALF} ${by - dir.x * DAG_HEAD_HALF} Z`;
      const color = this._byName.get(a.src).color;
      const els = [svgNode("path", { d, class: "tangle-dag-edge" }), svgNode("path", { d: head, class: "tangle-dag-head" })];
      for (const el of els) el.style.setProperty("--tangle-dag-c", color);
      svg.append(...els);
      this._edgeEls.push({ src: a.src, dst: a.dst, els });
    }
    this.focus(this._focused);
  }

  // ---- hover --------------------------------------------------------------

  /** Hovering a card keeps it, everything upstream and everything downstream; the rest dims. */
  focus(name) {
    this._focused = name;
    const dim = (el, on) => el.classList.toggle("is-dim", on);
    if (!name) {
      for (const { card } of this._cards.values()) dim(card, false);
      for (const e of this._edgeEls) e.els.forEach((el) => dim(el, false));
      return;
    }
    const ups = dagReach(name, this.adjacency(1, 0)).add(name);
    const downs = dagReach(name, this.adjacency(0, 1)).add(name);
    for (const [id, { card }] of this._cards) dim(card, !ups.has(id) && !downs.has(id));
    for (const e of this._edgeEls) {
      const keep = (ups.has(e.src) && ups.has(e.dst)) || (downs.has(e.src) && downs.has(e.dst));
      e.els.forEach((el) => dim(el, !keep));
    }
  }
}

// ---------------------------------------------------------------------------
// <t-flow>, without the DOM: checking the spec, inferring the arrows from what
// each node reads and defines, layering, placing the nodes, and the geometry
// of the arrows. Boxes are { left, right, top, bottom } in px, in a "frame"
// where the layers stack top to bottom: for direction "right" the element
// swaps x and y on the way in and out, so one router serves both directions.
// ---------------------------------------------------------------------------

const FLOW_SIDES = ["top", "bottom", "left", "right"];
const FLOW_KEYS = ["direction", "align", "nodes", "edges", "groups", "infer", "edgeLabels"];
const FLOW_NODE_KEYS = ["label", "note", "fold", "row", "beside", "width"];
const FLOW_EDGE_KEYS = ["label", "exit", "enter", "color", "dashed"];
const FLOW_GROUP_KEYS = ["label", "nodes", "collapsed"];
const FLOW_ALIGNS = { down: ["center", "left", "right"], right: ["center", "top", "bottom"] };
// Where an arrow leaves and lands when nothing says otherwise: out the far side, in at the near one.
const FLOW_DEFAULT_SIDES = { down: ["bottom", "top"], right: ["right", "left"] };
// A widget placed beside its anchor: [the widget's side facing the anchor, the anchor's side facing it].
const FLOW_FACING = { down: ["left", "right"], right: ["top", "bottom"] };
// A side's name in the transposed frame (and back: the map is its own inverse).
const FLOW_FLIP = { top: "left", left: "top", bottom: "right", right: "bottom" };

const flowFail = (message) => {
  throw new Error(`t-flow: ${message}`);
};
const flowPlain = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const flowList = (items) => items.map((s) => `"${s}"`).join(", ");

function flowKeys(obj, allowed, where) {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length) flowFail(`${where} has unknown ${extra.length > 1 ? "keys" : "key"} ${flowList(extra)}; use ${flowList(allowed)}`);
}

/** One end of an arrow, `"left"` or `["left", 0.3]`, as { side, at } (at is null for "spread out"). */
function flowPort(value, where) {
  const [side, at = null] = Array.isArray(value) ? value : [value];
  if (!FLOW_SIDES.includes(side)) flowFail(`${where} must be one of ${flowList(FLOW_SIDES)}, got ${JSON.stringify(side)}`);
  if (at !== null && !(typeof at === "number" && at >= 0 && at <= 1)) {
    flowFail(`${where}: the position must be a number from 0 to 1, got ${JSON.stringify(at)}`);
  }
  return { side, at };
}

/**
 * Check a <t-flow> spec against the ids of its nodes, and fill in the
 * defaults. Throws an Error that says what's wrong. Returns { direction,
 * align, infer, edgeLabels, nodes: Map(id -> options), edges, groups }.
 */
function flowSpec(spec, ids) {
  spec ??= {};
  if (!flowPlain(spec)) flowFail("the spec must be an object");
  flowKeys(spec, FLOW_KEYS, "the spec");
  const known = new Set(ids);
  const node = (id, where) => {
    if (!known.has(id)) {
      flowFail(`${where} names "${id}", which isn't a node. The nodes are ${ids.length ? flowList(ids) : "(none)"}`);
    }
    return id;
  };

  const direction = spec.direction ?? "down";
  if (!(direction in FLOW_ALIGNS)) flowFail(`direction must be "down" or "right", got ${JSON.stringify(direction)}`);
  const align = spec.align ?? "center";
  if (!FLOW_ALIGNS[direction].includes(align)) {
    flowFail(`with direction "${direction}", align must be one of ${flowList(FLOW_ALIGNS[direction])}, got ${JSON.stringify(align)}`);
  }
  for (const key of ["infer", "edgeLabels"]) {
    if (spec[key] !== undefined && typeof spec[key] !== "boolean") flowFail(`${key} must be true or false`);
  }

  const nodes = new Map(ids.map((id) => [id, { label: null, note: null, fold: null, row: null, beside: null, width: null }]));
  if (spec.nodes !== undefined && !flowPlain(spec.nodes)) flowFail("nodes must be an object, keyed by node id");
  for (const [id, raw] of Object.entries(spec.nodes ?? {})) {
    node(id, "nodes");
    const c = typeof raw === "string" ? { label: raw } : raw;
    if (!flowPlain(c)) flowFail(`nodes.${id} must be an object (or a string, its label)`);
    flowKeys(c, FLOW_NODE_KEYS, `nodes.${id}`);
    const n = nodes.get(id);
    if (c.label != null) n.label = String(c.label);
    if (c.note != null) n.note = String(c.note);
    if (c.fold != null && c.fold !== false) {
      if (![true, "open", "closed"].includes(c.fold)) flowFail(`nodes.${id}.fold must be true, "open" or "closed"`);
      n.fold = c.fold === "closed" ? "closed" : "open";
    }
    if (c.row != null) {
      if (!Number.isInteger(c.row) || c.row < 0) flowFail(`nodes.${id}.row must be a whole number from 0, got ${JSON.stringify(c.row)}`);
      n.row = c.row;
    }
    if (c.beside != null) {
      const [anchor, side = "after"] = Array.isArray(c.beside) ? c.beside : [c.beside];
      node(anchor, `nodes.${id}.beside`);
      if (side !== "before" && side !== "after") flowFail(`nodes.${id}.beside: the side must be "before" or "after"`);
      if (anchor === id) flowFail(`nodes.${id} can't sit beside itself`);
      n.beside = { anchor, before: side === "before" };
    }
    if (c.width != null) {
      if (typeof c.width === "number") n.width = `${c.width}px`;
      else if (typeof c.width === "string") n.width = c.width;
      else flowFail(`nodes.${id}.width must be a number of pixels or a CSS length`);
    }
  }
  for (const [id, n] of nodes) {
    if (!n.beside) continue;
    if (nodes.get(n.beside.anchor).beside) {
      flowFail(`nodes.${id} sits beside "${n.beside.anchor}", which itself sits beside another node; anchor it on one that doesn't`);
    }
    if (n.row != null) flowFail(`nodes.${id} sits beside "${n.beside.anchor}", so it takes that row; give the row to "${n.beside.anchor}" instead`);
  }

  if (spec.edges !== undefined && !Array.isArray(spec.edges)) flowFail("edges must be a list of [from, to] or [from, to, options]");
  const edges = [];
  const seen = new Set();
  for (const e of spec.edges ?? []) {
    if (!Array.isArray(e) || e.length < 2 || e.length > 3) flowFail(`each edge must be [from, to] or [from, to, options], got ${JSON.stringify(e)}`);
    const [src, dst, raw] = e;
    const name = `[${JSON.stringify(src)}, ${JSON.stringify(dst)}]`;
    node(src, `the edge ${name}`);
    node(dst, `the edge ${name}`);
    if (src === dst) flowFail(`the edge ${name} goes from a node to itself`);
    if (seen.has(`${src} ${dst}`)) flowFail(`the edge ${name} is given twice`);
    seen.add(`${src} ${dst}`);
    if (raw === false) {
      edges.push({ src, dst, drop: true, opts: {} });
      continue;
    }
    const c = raw == null ? {} : typeof raw === "string" ? { label: raw } : raw;
    if (!flowPlain(c)) flowFail(`the edge ${name}: options must be a label, an object, or false to drop it`);
    flowKeys(c, FLOW_EDGE_KEYS, `the edge ${name}`);
    const opts = {};
    if (c.label != null) opts.label = String(c.label);
    if (c.color != null) opts.color = String(c.color);
    if (c.dashed) opts.dashed = true;
    for (const k of ["exit", "enter"]) if (c[k] != null) opts[k] = flowPort(c[k], `the edge ${name}: ${k}`);
    edges.push({ src, dst, drop: false, opts });
  }

  if (spec.groups !== undefined && !Array.isArray(spec.groups)) flowFail("groups must be a list of { label, nodes }");
  const grouped = new Map();
  const groups = (spec.groups ?? []).map((g, i) => {
    if (!flowPlain(g)) flowFail(`groups[${i}] must be an object: { label, nodes, collapsed }`);
    flowKeys(g, FLOW_GROUP_KEYS, `groups[${i}]`);
    const label = String(g.label ?? `group ${i + 1}`);
    if (!Array.isArray(g.nodes) || !g.nodes.length) flowFail(`the group "${label}" needs a list of nodes`);
    const members = new Set(g.nodes.map((id) => node(id, `the group "${label}"`)));
    for (const id of members) {
      if (grouped.has(id)) flowFail(`"${id}" is in both the group "${grouped.get(id)}" and the group "${label}"`);
      grouped.set(id, label);
    }
    return { id: `!g${i}`, label, members: ids.filter((id) => members.has(id)), collapsed: Boolean(g.collapsed) };
  });

  return { direction, align, infer: spec.infer ?? true, edgeLabels: spec.edgeLabels ?? false, nodes, edges, groups };
}

/**
 * The arrows the data implies. `nodes` is [{ id, defines, reads }] (lists or
 * Sets of variable names); `formulaReads` maps each formula variable to the
 * variables it reads. A → B when B reads something A defines, also through
 * formulas no node defines, and through the formulas B defines itself.
 * Returns Map("src dst" -> Set of the variables of A it carries).
 */
function flowInfer(nodes, formulaReads = new Map()) {
  const owner = new Map();
  for (const n of nodes) for (const name of n.defines) if (!owner.has(name)) owner.set(name, n.id);
  const edges = new Map();
  for (const n of nodes) {
    const seen = new Set();
    const visit = (name) => {
      if (seen.has(name)) return;
      seen.add(name);
      const o = owner.get(name);
      if (o !== undefined) {
        if (o !== n.id) {
          const key = `${o} ${n.id}`;
          if (!edges.has(key)) edges.set(key, new Set());
          edges.get(key).add(name);
        }
        return;
      }
      for (const m of formulaReads.get(name) ?? []) visit(m);
    };
    for (const name of n.reads) visit(name);
    for (const name of n.defines) {
      seen.add(name);
      for (const m of formulaReads.get(name) ?? []) visit(m);
    }
  }
  return edges;
}

/** `edges` (a Map keyed "src dst") without the ones a longer path already implies. */
function flowReduce(edges) {
  const next = new Map();
  for (const key of edges.keys()) {
    const [s, d] = key.split(" ");
    if (!next.has(s)) next.set(s, []);
    next.get(s).push(d);
  }
  const out = new Map();
  for (const [key, value] of edges) {
    const [s, d] = key.split(" ");
    const others = (next.get(s) ?? []).filter((c) => c !== d);
    const implied = others.some((c) => c === d || dagReach(c, next).has(d));
    if (!implied) out.set(key, value);
  }
  return out;
}

/**
 * Every arrow to draw: the inferred ones (unless the spec says infer: false),
 * with the spec's edges laid over them, in node order. Each is { src, dst,
 * label, exit, enter, color, dashed, inferred }.
 */
function flowEdges(inferred, model, ids) {
  const at = new Map(ids.map((id, i) => [id, i]));
  const out = new Map();
  if (model.infer) {
    for (const [key, names] of inferred) {
      const [src, dst] = key.split(" ");
      out.set(key, { src, dst, label: model.edgeLabels ? [...names].join(", ") : null, inferred: true });
    }
  }
  for (const e of model.edges) {
    const key = `${e.src} ${e.dst}`;
    if (e.drop) out.delete(key);
    else out.set(key, { src: e.src, dst: e.dst, label: null, inferred: false, ...out.get(key), ...e.opts });
  }
  return [...out.values()].sort((p, q) => at.get(p.src) - at.get(q.src) || at.get(p.dst) - at.get(q.dst));
}

const flowCycleText = (cycle) => cycle.map((id) => `"${id}"`).join(" → ");

/**
 * Lay the graph out in rows, with the groups in `folded` folded to one pill
 * each. Returns { rows, routes, rowOf, hidden }: `rows` top to bottom, each a
 * list of cells { id, before, after, lane } (lane for an arrow skipping the
 * row, before/after for nodes placed beside it); `routes` one per arrow,
 * { edge, src, dst, chain, ported, exit, enter } with sides in real (not frame) terms.
 * Throws when the arrows go round in a circle, or a group can't be folded.
 */
function flowGraph(ids, edges, model, folded = new Set()) {
  const cycle = dagCycle(ids, edges.map((e) => [e.src, e.dst]));
  if (cycle) flowFail(`the arrows go round in a circle: ${flowCycleText(cycle)}. Drop one with [from, to, false]`);
  // A group folds into one pill, so nothing outside it may sit on a path between two of its nodes.
  const down = new Map();
  const up = new Map();
  for (const e of edges) {
    (down.get(e.src) ?? down.set(e.src, []).get(e.src)).push(e.dst);
    (up.get(e.dst) ?? up.set(e.dst, []).get(e.dst)).push(e.src);
  }
  for (const g of model.groups) {
    const reach = (next) => new Set(g.members.flatMap((m) => [...dagReach(m, next)]));
    const below = reach(down);
    const between = [...reach(up)].filter((id) => below.has(id) && !g.members.includes(id));
    if (between.length) {
      flowFail(`the group "${g.label}" must include "${between[0]}": it sits on a path between two of the group's nodes`);
    }
  }

  const pillOf = new Map();
  for (const g of model.groups) if (folded.has(g.id)) for (const m of g.members) pillOf.set(m, g.id);
  const shown = (id) => pillOf.get(id) ?? id;
  const visible = [];
  for (const id of ids) {
    const v = shown(id);
    if (!visible.includes(v)) visible.push(v);
  }
  const hidden = new Set(pillOf.keys());

  const beside = new Map();
  for (const [id, n] of model.nodes) {
    if (n.beside && !hidden.has(id) && !hidden.has(n.beside.anchor)) beside.set(id, n.beside);
  }
  const anchorOf = (id) => beside.get(id)?.anchor ?? id;
  const [defaultExit, defaultEnter] = FLOW_DEFAULT_SIDES[model.direction];
  const facing = FLOW_FACING[model.direction];

  // Arrows into or out of a folded group land on its pill; two that now join the same pair are drawn once.
  const routes = [];
  const joined = new Set();
  for (const e of edges) {
    const src = shown(e.src);
    const dst = shown(e.dst);
    if (src === dst || joined.has(`${src} ${dst}`)) continue;
    joined.add(`${src} ${dst}`);
    let exit = src === e.src ? e.exit : undefined;
    let enter = dst === e.dst ? e.enter : undefined;
    if (exit && exit.side === defaultExit && exit.at === null) exit = undefined;
    if (enter && enter.side === defaultEnter && enter.at === null) enter = undefined;
    // An arrow between a node and the one it sits beside joins their facing sides.
    let sides = null;
    if (beside.get(src)?.anchor === dst) sides = beside.get(src).before ? [...facing].reverse() : facing;
    else if (beside.get(dst)?.anchor === src) sides = beside.get(dst).before ? facing : [...facing].reverse();
    if (sides) {
      exit ??= { side: sides[0], at: null };
      enter ??= { side: sides[1], at: null };
    }
    routes.push({ edge: e, src, dst, chain: null, ported: Boolean(exit || enter), exit, enter });
  }

  const layered = visible.filter((id) => !beside.has(id));
  const layerEdges = [];
  for (const r of routes) {
    const s = anchorOf(r.src);
    const d = anchorOf(r.dst);
    if (s !== d) layerEdges.push({ r, pair: [s, d] });
  }
  const tied = dagCycle(layered, layerEdges.map((l) => l.pair));
  if (tied) {
    flowFail(`beside puts a node in its anchor's row, but the arrows then run in a circle (${flowCycleText(tied)}), so one would have to sit above the other`);
  }
  const minRows = new Map();
  for (const id of layered) if (model.nodes.get(id)?.row != null) minRows.set(id, model.nodes.get(id).row);
  const layerOf = dagLayers(layered, layerEdges.map((l) => l.pair), minRows);
  const direct = new Set();
  layerEdges.forEach((l, i) => l.r.ported && direct.add(i));
  const { layers, routes: chains } = dagOrder(layered, layerOf, layerEdges.map((l) => l.pair), { direct });
  layerEdges.forEach((l, i) => {
    l.r.chain = [l.r.src, ...chains[i].slice(1, -1), l.r.dst];
  });
  for (const r of routes) r.chain ??= [r.src, r.dst];

  const rowOf = new Map();
  const rows = layers.map((layer, i) =>
    layer.map((id) => {
      rowOf.set(id, i);
      return { id, lane: id.startsWith(DAG_WAYPOINT), before: [], after: [] };
    }),
  );
  for (const [id, b] of beside) {
    const row = rows[rowOf.get(b.anchor)];
    row.find((c) => c.id === b.anchor)[b.before ? "before" : "after"].push(id);
    rowOf.set(id, rowOf.get(b.anchor));
  }
  for (const row of rows) for (const c of row) c.before.reverse(); // nearest the anchor first, as given
  return { rows, routes, rowOf, hidden };
}

/**
 * Where each node goes, in frame coordinates. `size(id)` is { w, h }: w across
 * the flow, h along it. Rows stack with `layerGap` between them; within a
 * row, cells sit `nodeGap` apart. "center" centers each row on its own; any
 * other align puts the k-th cell of every row in one column (counted from
 * the far end for "right" and "bottom"), with the anchor on the column's
 * center line, so a chain down a column gets straight arrows. Returns
 * { pos: Map(id -> box), rowBoxes, width, height }.
 */
function flowPlace(rows, size, { align = "center", nodeGap = 40, layerGap = 64, lane = 14 } = {}) {
  const sz = (cell, id) => (cell.lane ? { w: lane, h: 0 } : size(id));
  const span = (ids) => ids.reduce((sum, id) => sum + size(id).w + nodeGap, 0);
  const heights = rows.map((row) => Math.max(0, ...row.flatMap((c) => [c.id, ...c.before, ...c.after].map((id) => sz(c, id).h))));
  const rowBoxes = [];
  let y = 0;
  for (const h of heights) {
    rowBoxes.push({ top: y, bottom: y + h });
    y += h + layerGap;
  }
  const height = Math.max(0, y - layerGap);
  const pos = new Map();
  const put = (cell, id, left, r) => {
    const { w, h } = sz(cell, id);
    const box = rowBoxes[r];
    const top = cell.lane ? box.top : box.top + (box.bottom - box.top - h) / 2;
    pos.set(id, { left, right: left + w, top, bottom: cell.lane ? box.bottom : top + h });
  };
  // Lay out one cell with its anchor's left edge at x: the before nodes run leftwards from it.
  const putCell = (cell, x, r) => {
    let left = x;
    for (const id of cell.before) {
      left -= nodeGap + size(id).w;
      put(cell, id, left, r);
    }
    put(cell, cell.id, x, r);
    let right = x + sz(cell, cell.id).w;
    for (const id of cell.after) {
      put(cell, id, right + nodeGap, r);
      right += nodeGap + size(id).w;
    }
  };

  let width = 0;
  if (align === "center") {
    const widths = rows.map((row) => row.reduce((sum, c) => sum + span(c.before) + sz(c, c.id).w + span(c.after), 0) + nodeGap * (row.length - 1));
    width = Math.max(0, ...widths);
    rows.forEach((row, r) => {
      let x = (width - widths[r]) / 2;
      for (const c of row) {
        putCell(c, x + span(c.before), r);
        x += span(c.before) + sz(c, c.id).w + span(c.after) + nodeGap;
      }
    });
  } else {
    const cols = Math.max(0, ...rows.map((row) => row.length));
    const fromEnd = align === "right" || align === "bottom";
    const colOf = (row, k) => (fromEnd ? cols - row.length + k : k);
    const anchorW = Array(cols).fill(0);
    const sideW = Array(cols).fill(0);
    rows.forEach((row) =>
      row.forEach((c, k) => {
        const col = colOf(row, k);
        anchorW[col] = Math.max(anchorW[col], sz(c, c.id).w);
        sideW[col] = Math.max(sideW[col], span(c.before), span(c.after));
      }),
    );
    const colX = [];
    for (let k = 0; k < cols; k++) {
      colX.push(width);
      width += anchorW[k] + 2 * sideW[k] + (k < cols - 1 ? nodeGap : 0);
    }
    rows.forEach((row, r) =>
      row.forEach((c, k) => {
        const col = colOf(row, k);
        const center = colX[col] + sideW[col] + anchorW[col] / 2;
        putCell(c, center - sz(c, c.id).w / 2, r);
      }),
    );
  }
  return { pos, rowBoxes, width, height };
}

// ---- arrow geometry -----------------------------------------------------

const FLOW_CORNER = 8;
const FLOW_HEAD_LEN = 7;
const FLOW_HEAD_HALF = 3.6;
const FLOW_STUB = 16;
const FLOW_CLEAR = 10;
const FLOW_SLOT_GAP = 16; // closest an arrow tip may land to another arrow's straight drop
const FLOW_SLOT_INSET = 6; // closest an arrow tip may land to a node's corner
const FLOW_NORMAL = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

const flowDist = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);
const flowDir = (p, q) => [Math.sign(Math.round(q.x - p.x)), Math.sign(Math.round(q.y - p.y))];
const flowSame = (u, v) => u[0] === v[0] && u[1] === v[1];
const flowFlat = (p, q) => Math.abs(p.y - q.y) < 0.5;
const flowOverlap = (a0, a1, b0, b1) => Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1));
const flowMid = (b) => (b.left + b.right) / 2;
const flowPad = (b, pad) => ({ left: b.left - pad, right: b.right + pad, top: b.top - pad, bottom: b.bottom + pad });
const flowOverlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** Does the axis-aligned segment p→q pass through box `o`? */
function flowHits(p, q, o) {
  if (flowFlat(p, q)) return p.y > o.top && p.y < o.bottom && Math.max(p.x, q.x) > o.left && Math.min(p.x, q.x) < o.right;
  return p.x > o.left && p.x < o.right && Math.max(p.y, q.y) > o.top && Math.min(p.y, q.y) < o.bottom;
}

// How the leg p→q meets the polylines already drawn: legs it runs on top of, and legs it crosses.
function flowMeets(p, q, lines) {
  let along = 0;
  let cross = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [u, v] = [line[i - 1], line[i]];
      if (flowFlat(p, q) === flowFlat(u, v)) {
        const near = flowFlat(p, q)
          ? Math.abs(p.y - u.y) < 6 && flowOverlap(p.x, q.x, u.x, v.x) > 2
          : Math.abs(p.x - u.x) < 6 && flowOverlap(p.y, q.y, u.y, v.y) > 2;
        if (near) along++;
      } else {
        const [h0, h1, w] = flowFlat(p, q) ? [p, q, u] : [u, v, p];
        const [w0, w1] = flowFlat(p, q) ? [u, v] : [p, q];
        if (w.x > Math.min(h0.x, h1.x) && w.x < Math.max(h0.x, h1.x) && h0.y > Math.min(w0.y, w1.y) && h0.y < Math.max(w0.y, w1.y)) cross++;
      }
    }
  }
  return { along, cross };
}

function flowSimplify(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && flowDist(last, p) < 0.5) continue;
    if (last && Math.abs(last.x - p.x) > 0.5 && Math.abs(last.y - p.y) > 0.5) return null;
    if (out.length > 1 && flowSame(flowDir(out[out.length - 2], last), flowDir(last, p))) out.pop();
    out.push(p);
  }
  return out.length > 1 ? out : null;
}

/** Where an arrow end sits on a box: { x, y, nx, ny }, `out` px off the side, along its outward normal. */
function flowPortPoint(box, side, at, out = 0) {
  const [nx, ny] = FLOW_NORMAL[side];
  const x = side === "left" ? box.left : side === "right" ? box.right : box.left + at * (box.right - box.left);
  const y = side === "top" ? box.top : side === "bottom" ? box.bottom : box.top + at * (box.bottom - box.top);
  return { x: x + nx * out, y: y + ny * out, nx, ny };
}

/**
 * An axis-aligned route from exit point `a` to arrow tip `b` (each with its
 * outward normal): the elbow shape with the fewest bends that leaves `a`
 * along its normal and enters `b` against its own, preferring shapes clear of
 * the `obstacles` and of the arrows already drawn (`lines`).
 */
function flowOrthoRoute(a, b, obstacles = [], lines = []) {
  const d0 = [a.nx, a.ny];
  const d1 = [-b.nx, -b.ny];
  const p1 = { x: a.x + a.nx * FLOW_STUB, y: a.y + a.ny * FLOW_STUB };
  const p2 = { x: b.x + b.nx * FLOW_STUB, y: b.y + b.ny * FLOW_STUB };
  const legs = lines.flatMap((l) => l.slice(1).map((q, i) => [l[i], q]));
  const yms = [
    (p1.y + p2.y) / 2,
    ...obstacles.flatMap((o) => [o.top - FLOW_CLEAR, o.bottom + FLOW_CLEAR]),
    ...legs.filter(([u, v]) => flowFlat(u, v)).flatMap(([u]) => [u.y - FLOW_CLEAR, u.y + FLOW_CLEAR]),
  ];
  const xms = [
    (p1.x + p2.x) / 2,
    ...obstacles.flatMap((o) => [o.left - FLOW_CLEAR, o.right + FLOW_CLEAR]),
    ...legs.filter(([u, v]) => !flowFlat(u, v)).flatMap(([u]) => [u.x - FLOW_CLEAR, u.x + FLOW_CLEAR]),
  ];
  const shapes = [
    [],
    [{ x: a.x, y: b.y }],
    [{ x: b.x, y: a.y }],
    [p1, { x: p1.x, y: p2.y }, p2],
    [p1, { x: p2.x, y: p1.y }, p2],
    ...yms.map((ym) => [p1, { x: p1.x, y: ym }, { x: p2.x, y: ym }, p2]),
    ...xms.map((xm) => [p1, { x: xm, y: p1.y }, { x: xm, y: p2.y }, p2]),
  ];
  let best = null;
  for (const mid of shapes) {
    const pts = flowSimplify([a, ...mid, b]);
    if (!pts) continue;
    const dirs = pts.slice(1).map((q, i) => flowDir(pts[i], q));
    if (!flowSame(dirs[0], d0) || !flowSame(dirs[dirs.length - 1], d1)) continue;
    if (dirs.some((d, i) => i && d[0] === -dirs[i - 1][0] && d[1] === -dirs[i - 1][1])) continue;
    if (flowDist(pts[pts.length - 2], b) < FLOW_HEAD_LEN + 3) continue;
    let len = 0;
    let blocked = 0;
    let along = 0;
    let cross = 0;
    for (let i = 1; i < pts.length; i++) {
      len += flowDist(pts[i - 1], pts[i]);
      for (const o of obstacles) if (flowHits(pts[i - 1], pts[i], o)) blocked++;
      const m = flowMeets(pts[i - 1], pts[i], lines);
      along += m.along;
      cross += m.cross;
    }
    const score = blocked * 1e6 + along * 1e5 + (pts.length - 2) * 1000 + cross * 300 + len;
    if (!best || score < best.score) best = { pts, score };
  }
  return best ? best.pts : [a, p1, { x: p1.x, y: p2.y }, p2, b];
}

/** An SVG path through `pts` with rounded corners. */
function flowRounded(pts) {
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [p, c, n] = [pts[i - 1], pts[i], pts[i + 1]];
    const r = Math.min(FLOW_CORNER, flowDist(p, c) / 2, flowDist(c, n) / 2);
    const u = flowDir(p, c);
    const v = flowDir(c, n);
    d += ` L ${c.x - u[0] * r} ${c.y - u[1] * r} Q ${c.x} ${c.y} ${c.x + v[0] * r} ${c.y + v[1] * r}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

/** A filled arrowhead with its tip at `b`, pointing along the unit vector `d`. */
function flowHead(b, d) {
  const bx = b.x - d[0] * FLOW_HEAD_LEN;
  const by = b.y - d[1] * FLOW_HEAD_LEN;
  const [qx, qy] = [-d[1] * FLOW_HEAD_HALF, d[0] * FLOW_HEAD_HALF];
  return `M ${b.x} ${b.y} L ${bx + qx} ${by + qy} L ${bx - qx} ${by - qy} Z`;
}

/**
 * Label spots beside the long legs of a polyline, longest first: { x, y, h, v }
 * where h and v say which way the label extends ("after" = towards +x/+y).
 */
function flowAlong(line) {
  const legs = line
    .slice(1)
    .map((q, i) => [line[i], q])
    .filter(([p, q]) => flowDist(p, q) > 28);
  legs.sort((u, v) => flowDist(v[0], v[1]) - flowDist(u[0], u[1]));
  return legs.flatMap(([p, q]) => {
    const [mx, my] = [(p.x + q.x) / 2, (p.y + q.y) / 2];
    return flowFlat(p, q)
      ? [{ x: mx, y: my - 4, h: "center", v: "before" }, { x: mx, y: my + 4, h: "center", v: "after" }]
      : [{ x: mx + 6, y: my, h: "after", v: "center" }, { x: mx - 6, y: my, h: "before", v: "center" }];
  });
}

/**
 * Where the arrows landing on one edge of a box (from `left` to `right`)
 * touch it, given where each comes from (`froms`, sorted): spread across the
 * middle, except that an arrow whose source is right above drops straight
 * down and the others make room for it.
 */
function flowSlots(froms, left, right) {
  const n = froms.length;
  const center = (left + right) / 2;
  const span = Math.min((right - left) * 0.6, 40 * n);
  const xs = froms.map((_, k) => center - span / 2 + (span * (k + 0.5)) / n);
  const lo0 = left + FLOW_SLOT_INSET;
  const hi0 = right - FLOW_SLOT_INSET;
  const straight = [];
  froms.forEach((from, k) => {
    const ok = from - lo0 >= FLOW_SLOT_GAP * (k + 1) && hi0 - from >= FLOW_SLOT_GAP * (n - k);
    if (ok && straight.every((j) => from - froms[j] >= 2 * FLOW_SLOT_GAP)) straight.push(k);
  });
  for (const k of straight) xs[k] = froms[k];
  for (let k = 0; k < n; k++) {
    if (straight.includes(k)) continue;
    let e = k;
    while (e + 1 < n && !straight.includes(e + 1)) e++;
    const lo = k > 0 ? xs[k - 1] : lo0;
    const hi = e + 1 < n ? xs[e + 1] : hi0;
    const fits = xs.slice(k, e + 1).every((x) => x > lo + (k > 0 ? FLOW_SLOT_GAP : 0) && x < hi - (e + 1 < n ? FLOW_SLOT_GAP : 0));
    if (!fits) for (let j = k; j <= e; j++) xs[j] = lo + ((hi - lo) * (j - k + 1)) / (e - k + 2);
    k = e;
  }
  return xs;
}

/**
 * The order to stack the horizontal tracks in one gap between rows, fewest
 * crossings first. `bySrc` maps a source to its jogs [{ from, to }]; `seed`
 * is the order to start from (and keep, past `cap` sources).
 */
function flowTracks(seed, bySrc, cap = 7) {
  const inside = (x, s) => x > Math.min(s.from, s.to) + 0.5 && x < Math.max(s.from, s.to) - 0.5;
  const above = (P, Q) => {
    let n = 0;
    for (const p of P) for (const q of Q) n += inside(q.from, p) + inside(p.to, q);
    return n;
  };
  const cost = (order) => {
    let n = 0;
    for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) n += above(bySrc.get(order[i]), bySrc.get(order[j]));
    return n;
  };
  if (seed.length > cap) return seed;
  let best = seed;
  let bestCost = cost(seed);
  for (const order of dagPermutations(seed)) {
    if (bestCost === 0) break;
    const c = cost(order);
    if (c < bestCost) [best, bestCost] = [order, c];
  }
  return best;
}

// ---------------------------------------------------------------------------
// <t-flow>: live elements laid out as a DAG. Each child is a node; an arrow
// runs from one node to another when the second reads a variable the first
// defines. A spec in a <script type="text/plain"> adds, restyles or drops
// arrows, and places, labels, annotates and folds the nodes.
// ---------------------------------------------------------------------------

// Children that aren't nodes: they show nothing (t-var, t-let and t-fetch
// still define variables, which the arrows look through).
const FLOW_SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "LINK", "META", "T-VAR", "T-LET", "T-FETCH"]);
const FLOW_PADDING = { across: 24, along: 14 }; // around the board, in frame terms
const FLOW_GAP = 3; // between an arrow tip and the node it points at
const FLOW_SHIFT = { after: "0", before: "-100%", center: "-50%" };
const FLOW_CHEVRON = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 3.75 L5 6.25 L7.5 3.75"/></svg>';
const flowDiv = (className, text) => {
  const el = Object.assign(document.createElement("div"), { className });
  if (text != null) el.textContent = text;
  return el;
};
const flowCalm = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The variables the elements in `root` define in `scope`, in document order. */
function flowNamesIn(root, scope) {
  const out = [];
  const add = (name) => name && !out.includes(name) && out.push(name);
  for (const el of [root, ...root.querySelectorAll("*")]) {
    const tag = el.localName;
    if (!tag.startsWith("t-") || tag === "t-out" || tag === "t-tag" || scopeOf(el) !== scope) continue;
    add(el.getAttribute("name"));
    if (tag === "t-fetch" || tag === "t-codecell") {
      add(el.getAttribute("error"));
      add(el.getAttribute("loading"));
    }
    if (tag === "t-formula-dag") {
      for (const f of el._model?.formulas ?? []) if (f.value != null) add(f.name);
      for (const p of el._model?.params ?? []) add(p.name);
    }
  }
  return out;
}

// <t-flow>
//   <p>Angle <t-num name="angle" min="5" max="85">35</t-num>°</p>
//   <t-codecell name="path">…reads angle…</t-codecell>
//   <t-obsplot>…reads path…</t-obsplot>
//   <script type="text/plain">{ nodes: { path: { label: "simulate" } } }</script>
// </t-flow>
class TFlow extends TangleElement {
  connectedCallback() {
    // The children have to be there: wait for them if the page is still loading.
    if (document.readyState === "loading" && this._model === undefined) {
      document.addEventListener("DOMContentLoaded", () => this.isConnected && this.connectedCallback(), { once: true });
      return;
    }
    if (this._model === undefined) {
      try {
        this.build();
      } catch (error) {
        this._model = null;
        this.showError(error);
      }
    }
    if (!this._model) return;
    this._valueFx = new Map();
    this._resize = new ResizeObserver(() => this.schedule("layout"));
    for (const item of this._items.values()) this._resize.observe(item);
    this._stopGraph = effect(() => {
      graphVersion.value;
      untracked(() => this.schedule("graph"));
    });
    this.schedule("graph");
  }

  disconnectedCallback() {
    this._resize?.disconnect();
    this._stopGraph?.();
    for (const stop of this._valueFx?.values() ?? []) stop();
    this._valueFx?.clear();
    cancelAnimationFrame(this._frame);
    this._frame = null;
    super.disconnectedCallback();
  }

  showError(error) {
    this._error ??= flowDiv("tangle-flow-error");
    this._error.textContent = error.message;
    if (!this._error.isConnected) this.prepend(this._error);
  }

  // ---- the arrows, as data --------------------------------------------------

  /** [from, to] pairs: the arrows drawn, by node id. */
  get edges() {
    return (this._edges ?? []).map((e) => [e.src, e.dst]);
  }
  /** The nodes that feed `id`, directly or not. */
  upstream(id) {
    return [...dagReach(id, this.adjacency("dst", "src"))];
  }
  /** The nodes `id` feeds, directly or not. */
  downstream(id) {
    return [...dagReach(id, this.adjacency("src", "dst"))];
  }
  adjacency(from, to) {
    const next = new Map();
    for (const e of this._edges ?? []) {
      if (!next.has(e[from])) next.set(e[from], []);
      next.get(e[from]).push(e[to]);
    }
    return next;
  }

  // ---- building -------------------------------------------------------------

  /** Read the spec, then wrap each child in an absolutely placed item. Runs once. */
  build() {
    const scope = this.scope;
    const kids = [...this.children].filter((el) => !FLOW_SKIP.has(el.tagName) && !el.classList.contains("tangle-flow-error"));
    const ids = kids.map((el, i) => {
      if (el.id) return el.id;
      const names = flowNamesIn(el, scope);
      return names.length === 1 ? names[0] : `n${i}`;
    });
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) throw new Error(`t-flow: two nodes are both "${dup}"; give one of them an id="…"`);
    const source = this.querySelector(':scope > script[type="text/plain"]')?.textContent ?? "";
    let spec = {};
    if (source.trim()) {
      try {
        spec = untracked(() => evalWith(scope, source, {}));
      } catch (error) {
        throw new Error(`t-flow: the spec: ${error.message}`);
      }
    }
    const model = flowSpec(spec, ids);
    this._ids = ids;
    this._edges = [];
    this._defines = new Map();
    this._folded = new Set([
      ...ids.filter((id) => model.nodes.get(id).fold === "closed"),
      ...model.groups.filter((g) => g.collapsed).map((g) => g.id),
    ]);

    const T = model.direction === "right";
    const root = flowDiv("tangle-flow");
    root.dataset.direction = model.direction;
    const board = flowDiv("tangle-flow-board");
    const svg = svgNode("svg", { class: "tangle-flow-svg", "aria-hidden": "true" });
    const frame = svgNode("g", T ? { transform: "matrix(0 1 1 0 0 0)" } : {});
    this._frames = svgNode("g", {});
    this._canvas = svgNode("g", {});
    frame.append(this._frames, this._canvas);
    svg.append(frame);
    board.append(svg);

    this._items = new Map();
    this._nodes = new Map();
    this._bodies = new Map();
    this._notes = new Map();
    this._folds = new Map();
    if (kids.length) kids[0].before(root);
    else this.append(root);
    kids.forEach((el, i) => {
      const id = ids[i];
      const opts = model.nodes.get(id);
      const body = flowDiv("tangle-flow-body");
      if (opts.width) body.style.width = opts.width;
      body.append(el);
      const node = flowDiv("tangle-flow-node");
      node.append(body);
      if (opts.label) node.append(flowDiv("tangle-flow-caption", opts.label));
      if (opts.fold) {
        // Folded, a node shows only its caption: the id stands in when it has none.
        if (!opts.label) node.append(flowDiv("tangle-flow-caption tangle-flow-fold-label", id));
        node.append(this.foldButton(id, opts.label ?? id));
      }
      const item = flowDiv("tangle-flow-item");
      item.dataset.flowNode = id;
      item.append(node);
      if (opts.note) {
        const note = flowDiv("tangle-flow-note");
        this.noteContent(note, opts.note);
        item.append(note);
        this._notes.set(id, note);
      }
      board.append(item);
      this._items.set(id, item);
      this._nodes.set(id, node);
      this._bodies.set(id, body);
    });

    // A group folds into a pill that waits, hidden, until it's needed; open, it has a tab.
    this._tabs = new Map();
    const tabs = flowDiv("tangle-flow-tabs");
    for (const g of model.groups) {
      const node = flowDiv("tangle-flow-node is-folded is-pill");
      node.append(flowDiv("tangle-flow-caption", g.label), this.foldButton(g.id, g.label));
      const item = flowDiv("tangle-flow-item");
      item.dataset.flowNode = g.id;
      item.append(node);
      board.append(item);
      this._items.set(g.id, item);
      this._nodes.set(g.id, node);
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "tangle-flow-tab";
      tab.innerHTML = FLOW_CHEVRON;
      tab.append(g.label);
      tab.setAttribute("aria-label", `Hide ${g.label}`);
      tab.addEventListener("click", () => this.toggle(g.id));
      tabs.append(tab);
      this._tabs.set(g.id, tab);
    }
    this._labels = flowDiv("tangle-flow-labels");
    board.append(this._labels, tabs);
    root.append(board);
    this._root = root;
    this._board = board;
    this._model = model;
    this.applyFolds();
  }

  foldButton(id, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tangle-flow-fold";
    button.innerHTML = FLOW_CHEVRON;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggle(id);
    });
    this._folds.set(id, { button, label });
    return button;
  }

  /** Note text: plain, with **bold** and $math$ (KaTeX loads only for notes that have some). */
  noteContent(el, text) {
    for (const part of noteParts(text)) {
      if (part.math !== undefined) {
        const span = document.createElement("span");
        span.textContent = part.math;
        el.append(span);
        loadKatex().then((katex) => {
          katex.render(part.math, span, { throwOnError: false });
          this.schedule("layout");
        }, () => {});
      } else if (part.bold !== undefined) {
        el.append(Object.assign(document.createElement("strong"), { textContent: part.bold }));
      } else {
        el.append(part.text);
      }
    }
  }

  // ---- what reads what ------------------------------------------------------

  /** The id of the node `el` sits in (in this flow, not one nested in it). */
  nodeOf(el) {
    let item = el.closest?.(".tangle-flow-item");
    while (item && item.parentElement !== this._board) item = item.parentElement?.closest(".tangle-flow-item");
    return item?.dataset.flowNode;
  }

  /** Work out the arrows from what each node reads and defines right now; lay out again if they changed. */
  updateGraph() {
    const scope = this.scope;
    const nodes = untracked(() => {
      const names = new Map(); // a variable's def signal and cell -> its name
      for (const [name, slot] of scope.slots) {
        names.set(slot.def, name);
        names.set(slot.cell, name);
      }
      const formulaReads = new Map();
      for (const [name, slot] of scope.slots) {
        if (!(slot.def.peek() instanceof Formula)) continue;
        formulaReads.set(name, [...slot.cell.deps].map((d) => names.get(d)).filter((n) => n !== undefined && n !== name));
      }
      const reads = new Map(this._ids.map((id) => [id, new Set()]));
      for (const el of watchers) {
        const id = this.nodeOf(el);
        if (!reads.has(id)) continue;
        for (const e of el._effects ?? []) {
          for (const d of e.deps) if (names.has(d)) reads.get(id).add(names.get(d));
        }
      }
      const nodes = this._ids.map((id) => ({ id, defines: flowNamesIn(this._bodies.get(id), scope), reads: reads.get(id) }));
      nodes.formulaReads = formulaReads;
      return nodes;
    });
    this._defines = new Map(nodes.map((n) => [n.id, n.defines]));
    this.watchValues();
    const edges = flowEdges(flowReduce(flowInfer(nodes, nodes.formulaReads)), this._model, this._ids);
    const key = JSON.stringify(edges);
    if (key === this._edgesKey) return;
    this._edgesKey = key;
    this._edges = edges;
    this.schedule("layout");
  }

  /** One effect per variable a node defines: what reads what can change with the values. */
  watchValues() {
    const scope = this.scope;
    for (const names of this._defines.values()) {
      for (const name of names) {
        if (this._valueFx.has(name)) continue;
        let first = true;
        this._valueFx.set(name, effect(() => {
          try {
            scope.get(name);
          } catch {} // a failing formula still counts as a change
          if (first) {
            first = false;
            return;
          }
          untracked(() => this.schedule("graph"));
        }));
      }
    }
  }

  /** Run updateGraph and/or relayout on the next frame, once however often it's asked. */
  schedule(what) {
    (this._need ??= new Set()).add(what);
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => {
      const need = this._need;
      this._need = new Set();
      if (this.isConnected && this._model) {
        if (need.has("graph")) this.updateGraph();
        if (this._need.delete("layout") || need.has("layout")) this.relayout();
      }
      this._frame = null;
      // Whatever that asked for again waits for the next frame.
      const rest = [...this._need];
      this._need = new Set();
      for (const w of rest) this.schedule(w);
    });
  }

  // ---- folding ----------------------------------------------------------------

  applyFolds() {
    const model = this._model;
    const away = new Set();
    for (const g of model.groups) {
      if (this._folded.has(g.id)) g.members.forEach((m) => away.add(m));
      else away.add(g.id);
    }
    for (const [id, item] of this._items) {
      item.classList.toggle("is-away", away.has(id));
      const node = this._nodes.get(id);
      if (!node.classList.contains("is-pill")) node.classList.toggle("is-folded", this._folded.has(id));
    }
    for (const [id, { button, label }] of this._folds) {
      const open = !this._folded.has(id);
      button.setAttribute("aria-expanded", String(open));
      button.setAttribute("aria-label", `${open ? "Hide" : "Show"} ${label}`);
    }
  }

  /** Fold `id` (a node or a group) if it's open, open it if it's folded. */
  toggle(id) {
    if (!this._model) return;
    if (this._folded.has(id)) this._folded.delete(id);
    else this._folded.add(id);
    const wasAway = new Set([...this._items].filter(([, item]) => item.classList.contains("is-away")).map(([k]) => k));
    const animate = !flowCalm();
    if (animate) {
      // The nodes that stay glide to their new places; the arrows fade out and back.
      this._root.classList.add("is-moving");
      clearTimeout(this._moving);
      this._moving = setTimeout(() => this._root.classList.remove("is-moving"), 240);
    }
    this.applyFolds();
    this.relayout();
    if (animate) {
      for (const [k, item] of this._items) {
        if (wasAway.has(k) && !item.classList.contains("is-away")) {
          item.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, delay: 40, easing: "ease-out", fill: "backwards" });
        }
      }
    }
  }

  // ---- layout -----------------------------------------------------------------

  relayout() {
    if (!this._board || !this.isConnected) return;
    const model = this._model;
    const T = model.direction === "right";
    let graph;
    try {
      graph = flowGraph(this._ids, this._edges, model, this._folded);
      this._graphError?.remove();
    } catch (error) {
      this._graphError ??= flowDiv("tangle-flow-error");
      this._graphError.textContent = error.message;
      this._root.before(this._graphError);
      graph = flowGraph(this._ids, [], model, this._folded);
    }
    this._graph = graph;
    const style = getComputedStyle(this._root);
    const px = (name, fallback) => {
      const v = parseFloat(style.getPropertyValue(name));
      return Number.isFinite(v) ? v : fallback;
    };
    const sizes = new Map();
    const size = (id) => {
      if (!sizes.has(id)) {
        const item = this._items.get(id);
        const [w, h] = [item.offsetWidth, item.offsetHeight];
        sizes.set(id, T ? { w: h, h: w } : { w, h });
      }
      return sizes.get(id);
    };
    const place = flowPlace(graph.rows, size, {
      align: model.align,
      nodeGap: px("--tangle-flow-node-gap", 40),
      layerGap: px("--tangle-flow-layer-gap", 56),
    });
    const { across, along } = FLOW_PADDING;
    const shift = (b) => ({ left: b.left + across, right: b.right + across, top: b.top + along, bottom: b.bottom + along });
    this._pos = new Map();
    for (const [id, b] of place.pos) {
      const f = shift(b);
      this._pos.set(id, f);
      if (id.startsWith(DAG_WAYPOINT)) continue;
      const item = this._items.get(id);
      item.style.left = `${T ? f.top : f.left}px`;
      item.style.top = `${T ? f.left : f.top}px`;
    }
    this._rowBoxes = place.rowBoxes.map((r) => ({ top: r.top + along, bottom: r.bottom + along }));
    const [w, h] = [place.width + 2 * across, place.height + 2 * along];
    this._board.style.width = `${T ? h : w}px`;
    this._board.style.height = `${T ? w : h}px`;
    this.draw();
  }

  /** A box measured on the board, in frame terms. */
  frameBox(left, top, width, height) {
    const b = { left, right: left + width, top, bottom: top + height };
    return this._model.direction === "right" ? { left: b.top, right: b.bottom, top: b.left, bottom: b.right } : b;
  }

  draw() {
    const T = this._model.direction === "right";
    const graph = this._graph;
    this._canvas.replaceChildren();
    this._frames.replaceChildren();
    this._labels.replaceChildren();
    const fside = (side) => (T ? FLOW_FLIP[side] : side);

    // Every node's box (not its note's), every note's, every lane's.
    const boxOf = new Map();
    const noteBox = new Map();
    for (const [id, f] of this._pos) {
      if (id.startsWith(DAG_WAYPOINT)) {
        boxOf.set(id, f);
        continue;
      }
      const item = this._items.get(id);
      const node = this._nodes.get(id);
      const [x, y] = [parseFloat(item.style.left), parseFloat(item.style.top)];
      boxOf.set(id, this.frameBox(x + node.offsetLeft, y + node.offsetTop, node.offsetWidth, node.offsetHeight));
      const note = this._notes.get(id);
      if (note) noteBox.set(id, this.frameBox(x + note.offsetLeft, y + note.offsetTop, note.offsetWidth, note.offsetHeight));
    }
    const rowOf = graph.rowOf;
    const rowBoxes = this._rowBoxes;
    const lines = []; // every polyline drawn, so later arrows and labels keep clear of them
    const pending = []; // labels to place once every arrow is down

    // Arrows are drawn one source at a time, each line over a halo of the
    // background, so where a later arrow crosses an earlier one there's a gap.
    const bySource = new Map();
    const drawEdge = (r, d, head) => {
      if (!bySource.has(r.src)) {
        const g = svgNode("g", {});
        const halos = svgNode("g", {});
        const strokes = svgNode("g", {});
        g.append(halos, strokes);
        this._canvas.append(g);
        bySource.set(r.src, { halos, strokes });
      }
      const { halos, strokes } = bySource.get(r.src);
      const line = svgNode("path", { class: "tangle-flow-edge", d });
      const tip = svgNode("path", { class: "tangle-flow-head", d: head });
      if (r.edge.color) {
        line.style.stroke = r.edge.color;
        tip.style.fill = tip.style.stroke = r.edge.color;
      }
      if (r.edge.dashed) line.style.strokeDasharray = "5 4";
      halos.append(svgNode("path", { class: "tangle-flow-halo", d }));
      strokes.append(line, tip);
    };

    const shown = graph.routes.filter((r) => boxOf.has(r.src) && boxOf.has(r.dst));
    const ported = shown.filter((r) => r.ported);
    const arrows = shown
      .filter((r) => !r.ported)
      .map((r) => ({ r, xs: [flowMid(boxOf.get(r.src)), ...r.chain.slice(1, -1).map((w) => flowMid(boxOf.get(w)))] }));
    const ends = ported.map((r) => ({
      r,
      exit: r.exit ? { side: fside(r.exit.side), at: r.exit.at } : { side: "bottom", at: null },
      enter: r.enter ? { side: fside(r.enter.side), at: r.enter.at } : { side: "top", at: null },
    }));

    // 1. Each arrow landing on a node's top edge gets its own slot there, ordered by where it comes from.
    const incoming = new Map();
    const land = (dst, entry) => (incoming.get(dst) ?? incoming.set(dst, []).get(dst)).push(entry);
    for (const a of arrows) land(a.r.dst, { a, from: a.xs.at(-1) });
    for (const e of ends) {
      if (e.enter.side !== "top" || e.enter.at != null) continue;
      const s = boxOf.get(e.r.src);
      const from = e.exit.side === "left" ? s.left : e.exit.side === "right" ? s.right : s.left + (e.exit.at ?? 0.5) * (s.right - s.left);
      land(e.r.dst, { e, from });
    }
    for (const [dst, list] of incoming) {
      const b = boxOf.get(dst);
      list.sort((p, q) => p.from - q.from);
      const xs = flowSlots(list.map((l) => l.from), b.left, b.right);
      list.forEach((item, k) => {
        if (item.e) item.e.enter.at = (xs[k] - b.left) / (b.right - b.left);
        else {
          item.a.xs.push(xs[k]);
          item.a.labelLeft = list.length > 1 && k < (list.length - 1) / 2;
        }
      });
    }

    // 2. One horizontal track per source in each gap it jogs through, so the
    //    arrows from one node share a bus, stacked with the fewest crossings.
    const jogs = new Map();
    for (const a of arrows) {
      a.xs.forEach((x, k) => {
        if (k === a.xs.length - 1 || Math.abs(a.xs[k + 1] - x) < 1) return;
        const gap = rowOf.get(a.r.chain[k]);
        if (!jogs.has(gap)) jogs.set(gap, new Map());
        const bySrc = jogs.get(gap);
        if (!bySrc.has(a.r.src)) bySrc.set(a.r.src, []);
        bySrc.get(a.r.src).push({ from: x, to: a.xs[k + 1] });
      });
    }
    const tracks = new Map();
    for (const [gap, bySrc] of jogs) {
      const seed = [...bySrc.keys()].sort((p, q) => flowMid(boxOf.get(p)) - flowMid(boxOf.get(q)));
      tracks.set(gap, flowTracks(seed, bySrc));
    }
    const trackY = (gap, src) => {
      const top = rowBoxes[gap].bottom;
      const list = tracks.get(gap);
      return top + ((rowBoxes[gap + 1].top - top) * (list.indexOf(src) + 1)) / (list.length + 1);
    };

    // 3. Down out of the source, along the track, down into the target.
    for (const a of arrows) {
      const y0 = boxOf.get(a.r.src).bottom;
      let d = `M ${a.xs[0]} ${y0}`;
      const line = [{ x: a.xs[0], y: y0 }];
      let lastY = rowBoxes[rowOf.get(a.r.dst) - 1]?.bottom ?? y0;
      a.xs.forEach((x, k) => {
        if (k === a.xs.length - 1) return;
        const next = a.xs[k + 1];
        if (Math.abs(next - x) < 1) return;
        const ty = trackY(rowOf.get(a.r.chain[k]), a.r.src);
        const s = Math.sign(next - x);
        const r = Math.min(FLOW_CORNER, Math.abs(next - x) / 2);
        d += ` L ${x} ${ty - r} Q ${x} ${ty} ${x + s * r} ${ty}`;
        d += ` L ${next - s * r} ${ty} Q ${next} ${ty} ${next} ${ty + r}`;
        line.push({ x, y: ty }, { x: next, y: ty });
        lastY = Math.max(lastY, ty);
      });
      const end = a.xs.at(-1);
      const tip = { x: end, y: boxOf.get(a.r.dst).top - FLOW_GAP };
      d += ` L ${end} ${tip.y - FLOW_HEAD_LEN * 0.8}`;
      line.push(tip);
      lines.push(line);
      drawEdge(a.r, d, flowHead(tip, [0, 1]));
      if (a.r.edge.label) {
        const m = (lastY + tip.y) / 2;
        const side = (left) => ({ x: left ? end - 6 : end + 6, y: m, h: left ? "before" : "after", v: "center" });
        pending.push({ text: a.r.edge.label, options: [side(a.labelLeft), side(!a.labelLeft), ...flowAlong(line)] });
      }
    }

    // 4. Arrows with ports: an elbow route between the named sides, around
    //    every other node, note and arrow. Ends sharing a side spread along it.
    const shared = new Map();
    for (const e of ends) {
      for (const [k, id, far] of [["exit", e.r.src, e.r.dst], ["enter", e.r.dst, e.r.src]]) {
        if (e[k].at != null) continue;
        const key = `${id} ${e[k].side}`;
        (shared.get(key) ?? shared.set(key, []).get(key)).push({ end: e[k], far });
      }
    }
    for (const list of shared.values()) {
      const horiz = ["top", "bottom"].includes(list[0].end.side);
      const c = (id) => (horiz ? flowMid(boxOf.get(id)) : (boxOf.get(id).top + boxOf.get(id).bottom) / 2);
      list.sort((p, q) => c(p.far) - c(q.far));
      list.forEach((x, k) => (x.end.at = list.length === 1 ? 0.5 : 0.2 + (0.6 * (k + 0.5)) / list.length));
    }
    const nodeBoxes = [...boxOf].filter(([id]) => !id.startsWith(DAG_WAYPOINT));
    for (const e of ends) {
      const a = flowPortPoint(boxOf.get(e.r.src), e.exit.side, e.exit.at, 0);
      const b = flowPortPoint(boxOf.get(e.r.dst), e.enter.side, e.enter.at, FLOW_GAP);
      const obstacles = [
        ...nodeBoxes.filter(([id]) => id !== e.r.src && id !== e.r.dst).map(([, box]) => flowPad(box, 4)),
        ...[...noteBox.values()].map((box) => flowPad(box, 4)),
      ];
      const pts = flowOrthoRoute(a, b, obstacles, lines);
      lines.push(pts);
      const dir = [-b.nx, -b.ny];
      const stop = { x: b.x - dir[0] * FLOW_HEAD_LEN * 0.8, y: b.y - dir[1] * FLOW_HEAD_LEN * 0.8 };
      drawEdge(e.r, flowRounded([...pts.slice(0, -1), stop]), flowHead(b, dir));
      if (e.r.edge.label) pending.push({ text: e.r.edge.label, options: flowAlong(pts) });
    }

    // 5. Labels: the first spot that clears the arrows, nodes, notes and labels so far.
    const base = this._board.getBoundingClientRect();
    const measure = (el) => {
      const r = el.getBoundingClientRect();
      return this.frameBox(r.left - base.left, r.top - base.top, r.width, r.height);
    };
    const putLabel = (el, o) => {
      const [x, y, h, v] = T ? [o.y, o.x, o.v, o.h] : [o.x, o.y, o.h, o.v];
      Object.assign(el.style, { left: `${x}px`, top: `${y}px`, transform: `translate(${FLOW_SHIFT[h]}, ${FLOW_SHIFT[v]})` });
    };
    const blockers = [...nodeBoxes.map(([, box]) => box), ...noteBox.values()];
    for (const { text, options } of pending) {
      if (!options.length) continue;
      const el = flowDiv("tangle-flow-label", text);
      this._labels.append(el);
      let pick = null;
      for (const o of options) {
        putLabel(el, o);
        const r = flowPad(measure(el), 2);
        const clash = blockers.some((b) => flowOverlaps(r, b)) || lines.some((l) => l.some((q, i) => i && flowHits(l[i - 1], q, r)));
        if (!clash) {
          pick = o;
          break;
        }
      }
      putLabel(el, pick ?? options[0]);
      blockers.push(measure(el));
    }

    // 6. Open groups: a faint dashed frame around their nodes, and a tab on its top-right corner that folds them.
    for (const g of this._model.groups) {
      const tab = this._tabs.get(g.id);
      const boxes = this._folded.has(g.id) ? [] : g.members.flatMap((id) => [boxOf.get(id), noteBox.get(id)]).filter(Boolean);
      tab.classList.toggle("is-away", !boxes.length);
      if (!boxes.length) continue;
      const f = flowPad({
        left: Math.min(...boxes.map((b) => b.left)),
        right: Math.max(...boxes.map((b) => b.right)),
        top: Math.min(...boxes.map((b) => b.top)),
        bottom: Math.max(...boxes.map((b) => b.bottom)),
      }, 12);
      this._frames.append(svgNode("rect", {
        class: "tangle-flow-frame", x: f.left, y: f.top, width: f.right - f.left, height: f.bottom - f.top, rx: 12,
      }));
      // The tab sits on a corner of the frame (on the real board): the first
      // one, from the top right, that no arrow runs through.
      const real = T ? { left: f.top, right: f.bottom, top: f.left, bottom: f.right } : f;
      const corners = [
        [real.right - 14, real.top, "-100%"], [real.right - 14, real.bottom, "-100%"],
        [real.left + 14, real.top, "0"], [real.left + 14, real.bottom, "0"],
      ];
      let pick = corners[0];
      for (const corner of corners) {
        Object.assign(tab.style, { left: `${corner[0]}px`, top: `${corner[1]}px`, transform: `translate(${corner[2]}, -50%)` });
        const r = flowPad(measure(tab), 3);
        if (!lines.some((l) => l.some((q, i) => i && flowHits(l[i - 1], q, r)))) {
          pick = corner;
          break;
        }
      }
      Object.assign(tab.style, { left: `${pick[0]}px`, top: `${pick[1]}px`, transform: `translate(${pick[2]}, -50%)` });
      blockers.push(measure(tab));
    }

    // 7. Notes: a short arrow from the note onto its node.
    for (const [id, n] of noteBox) {
      const c = boxOf.get(id);
      if (!c) continue;
      const y = Math.max(c.top + 8, Math.min(c.bottom - 8, (n.top + n.bottom) / 2));
      const [from, to] = [n.left - 6, c.right + 5];
      if (from - to < 8) continue;
      this._canvas.append(svgNode("path", {
        class: "tangle-flow-note-arrow",
        d: `M ${from} ${y} L ${to} ${y} M ${to + 5} ${y - 3.5} L ${to} ${y} L ${to + 5} ${y + 3.5}`,
      }));
    }
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
      this._previewed = new Set();
      this._dragging = false;
      const stop = () => {
        if (!this._dragging) return;
        this._dragging = false;
        const scope = scopeOf(this);
        for (const name of this._previewed) scope.commit(name);
        this._previewed.clear();
        removeEventListener("pointerup", stop);
        removeEventListener("pointercancel", stop);
      };
      this._target.addEventListener(
        "pointerdown",
        () => {
          this._dragging = true;
          addEventListener("pointerup", stop);
          addEventListener("pointercancel", stop);
        },
        { capture: true },
      );
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
        if (Object.is(scope.peek(name), value)) return;
        if (this._dragging) {
          scope.preview(name, value);
          this._previewed.add(name);
        } else {
          scope.set(name, value);
        }
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
    let dragging = false;
    const previewed = new Set();
    const stopDrag = () => {
      if (!dragging) return;
      dragging = false;
      for (const name of previewed) scope.commit(name);
      previewed.clear();
      removeEventListener("pointerup", stopDrag);
      removeEventListener("pointercancel", stopDrag);
    };
    this._target.addEventListener(
      "pointerdown",
      () => {
        dragging = true;
        addEventListener("pointerup", stopDrag);
        addEventListener("pointercancel", stopDrag);
      },
      { capture: true },
    );

    const bound = [];
    const point = (x, y, attributes = {}) => {
      const p = board.create("point", [read(x), read(y)], attributes);
      bound.push({ p, x, y });
      // A point tied to a variable shows a hand you can grab. The style is inline, since
      // JSXGraph swaps the class attribute on hover.
      if ((typeof x === "string" || typeof y === "string") && !attributes.fixed && p.rendNode) {
        p.rendNode.style.cursor = "grab";
        p.on("down", () => {
          const root = document.documentElement;
          root.classList.add("tangle-grabbing");
          const stop = () => {
            root.classList.remove("tangle-grabbing");
            removeEventListener("pointerup", stop);
            removeEventListener("pointercancel", stop);
          };
          addEventListener("pointerup", stop);
          addEventListener("pointercancel", stop);
        });
      }
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
      untracked(() => {
        if (!dragging) return scope.setValues(values);
        for (const [k, v] of Object.entries(values)) {
          scope.preview(k, v);
          previewed.add(k);
        }
      });
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
// <t-graph>: nodes and edges from an expression, laid out by d3-force. The
// expression reruns when a variable it read changes, and nodes that stay keep
// their place. The picked node (name) and the hovered one (hover) are variables.
// ---------------------------------------------------------------------------

const GRAPH_KEYS = ["nodes", "edges", "directed"];
const GRAPH_RADIUS = 8; // a node's radius without a size
const GRAPH_PAD = 4; // between the box's edge and a node
const GRAPH_LABEL = 14; // room for the label under a node
const GRAPH_HEAD = 7; // arrowhead length
const GRAPH_HEAD_HALF = 3.5;

const graphKey = String;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Ids made unique the way GraphWidget does: a second "a" becomes "a-1". */
function uniqueId(id, used) {
  let out = id;
  for (let k = 1; used.has(out); k++) out = `${id}-${k}`;
  used.add(out);
  return out;
}

/**
 * A graph spec, normalized. A node is a string or number (its id and its name), or an
 * object with any of id, name, size, color, data. An edge is a [source, target] pair, or
 * an object with source, target and any of id, name, width, color, data. Endpoints are
 * ids, unique names, or indexes into the nodes. Every node and edge gets a string id.
 */
export function graphData(spec) {
  if (!isObject(spec)) throw new Error("the expression should give { nodes, edges }");
  const unknown = Object.keys(spec).filter((k) => !GRAPH_KEYS.includes(k));
  if (unknown.length) throw new Error(`unknown key ${unknown.join(", ")} (the keys are ${GRAPH_KEYS.join(", ")})`);
  const rawNodes = spec.nodes ?? [];
  const rawEdges = spec.edges ?? [];
  if (!Array.isArray(rawNodes)) throw new Error("nodes should be an array");
  if (!Array.isArray(rawEdges)) throw new Error("edges should be an array");

  // A name that appears once can be a node's id.
  const nameCount = new Map();
  const count = (name) => nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
  for (const n of rawNodes) {
    if (!isObject(n)) count(graphKey(n));
    else if (n.id == null && n.name != null) count(graphKey(n.name));
  }
  const usedNodes = new Set();
  const nodes = rawNodes.map((n, i) => {
    let node, id;
    if (isObject(n)) {
      node = { ...n };
      if (node.name != null) node.name = graphKey(node.name);
      if (node.id != null) id = graphKey(node.id);
      else if (node.name != null && nameCount.get(node.name) === 1) id = node.name;
      else id = `node-${i}`;
    } else {
      node = { name: graphKey(n) };
      id = nameCount.get(node.name) === 1 ? node.name : `node-${i}`;
    }
    node.id = uniqueId(id, usedNodes);
    return node;
  });

  // Endpoints: an id, then a name only one node has, then an index.
  const lookup = new Map(nodes.map((n) => [n.id, n.id]));
  const names = new Map();
  for (const n of nodes) if (n.name != null) names.set(n.name, names.has(n.name) ? null : n.id);
  for (const [name, id] of names) if (id !== null && !lookup.has(name)) lookup.set(name, id);
  const resolve = (end) => {
    const id = lookup.get(graphKey(end));
    if (id !== undefined) return id;
    if (Number.isInteger(end) && end >= 0 && end < nodes.length) return nodes[end].id;
    throw new Error(`an edge goes to ${JSON.stringify(end)}, which isn't a node`);
  };
  const usedEdges = new Set();
  const edges = rawEdges.map((e, i) => {
    let edge;
    if (Array.isArray(e) && e.length >= 2) edge = { source: e[0], target: e[1] };
    else if (isObject(e) && "source" in e && "target" in e) edge = { ...e };
    else throw new Error("an edge should be a [source, target] pair or { source, target }");
    edge.source = resolve(edge.source);
    edge.target = resolve(edge.target);
    if (edge.name != null) edge.name = graphKey(edge.name);
    edge.id = uniqueId(graphKey(edge.id ?? `edge-${i}`), usedEdges);
    return edge;
  });

  return {
    nodes,
    edges,
    directed: Boolean(spec.directed),
  };
}

/** A color: a number n is the theme's --tangle-dag-n, and "a b" is a in light mode, b in dark. */
function graphColor(color, fallback) {
  if (typeof color === "number") return `var(--tangle-dag-${(((Math.round(color) - 1) % 8) + 8) % 8 + 1})`;
  if (typeof color !== "string" || !color.trim()) return fallback;
  const parts = color.trim().split(/\s+/);
  return parts.length === 2 ? `light-dark(${parts[0]}, ${parts[1]})` : color;
}

const reducedMotion = () => Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

const radiusOf = (n) => Math.max(2, Number(n.size) || GRAPH_RADIUS);

/** Whether two values hold the same node data, to stop a graph that reads its own pick from looping. */
function sameNode(a, b) {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** The id a variable's value names: a node object's id, or an id itself. */
function idOf(value) {
  if (value == null) return null;
  return isObject(value) ? (value.id == null ? null : graphKey(value.id)) : graphKey(value);
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// <t-graph name="picked" hover="h"><script type="text/plain">{ nodes, edges }</script></t-graph>
// or <t-graph src="graph.js">.
class TGraph extends TangleElement {
  connectedCallback() {
    this._source ??= this.hasAttribute("src")
      ? fetch(this.getAttribute("src")).then((r) => {
          if (!r.ok) throw new Error(`${this.getAttribute("src")}: ${r.status}`);
          return r.text();
        })
      : Promise.resolve(this.querySelector("script")?.textContent ?? this.textContent);
    if (!this._box) {
      this._box = document.createElement("div");
      this._box.className = "tangle-graph is-loading";
      this._box.textContent = "Loading graph…";
      this.append(this._box);
    }
    const token = (this._token = {});
    Promise.all([loadD3(), this._source]).then(
      ([d3, expr]) => {
        if (this._token === token && this.isConnected) this.start(d3, expr);
      },
      (error) => {
        if (this._token === token) this.showError(error);
      },
    );
  }

  disconnectedCallback() {
    this._token = null;
    this._resize?.disconnect();
    this._sim?.stop();
    cancelAnimationFrame(this._fitFrame);
    super.disconnectedCallback();
  }

  start(d3, expr) {
    const scope = this.scope;
    if (!this._svg) this.build(d3);
    this._resize = new ResizeObserver(() => {
      if (this.clientWidth && this.clientWidth !== this._width) this.resize();
    });
    this._resize.observe(this);
    this.watch(() => {
      let data;
      try {
        // Inside the effect, so every variable the expression reads is tracked.
        data = graphData(evalWith(scope, expr, { d3 }));
      } catch (error) {
        this.showError(error);
        return;
      }
      untracked(() => this.draw(data));
    });
    const name = this.getAttribute("name");
    if (name) {
      this.watch(() => {
        const id = idOf(scope.get(name));
        untracked(() => {
          this._picked = id;
          this.paintPicked();
        });
      });
    }
  }

  build(d3) {
    this._d3 = d3;
    this._box.className = "tangle-graph";
    this._box.textContent = "";
    this._svg = svgEl("svg", { class: "tangle-graph-svg" });
    this._svg.setAttribute("aria-label", this.getAttribute("label") ?? "Graph");
    this._edgeLayer = svgEl("g", { class: "tangle-graph-edges" });
    this._labelLayer = svgEl("g", { class: "tangle-graph-edge-labels" });
    this._nodeLayer = svgEl("g", { class: "tangle-graph-nodes" });
    // The view is what the reader zooms. Inside it, the fit scales the layout to the box.
    this._view = svgEl("g", { class: "tangle-graph-view" });
    this._fit = svgEl("g", { class: "tangle-graph-fit" });
    this._fit.append(this._edgeLayer, this._labelLayer, this._nodeLayer);
    this._view.append(this._fit);
    this._svg.append(this._view);
    this._bounded = this.hasAttribute("bounded");
    this._tip = Object.assign(document.createElement("div"), { className: "tangle-graph-tooltip", hidden: true });
    this._box.append(this._svg, this._tip);
    if (this.hasAttribute("zoom")) this.makeZoomable(d3);

    // How it's shown is up to the attributes; the expression only says what the graph is.
    const attr = (name, fallback) => Number(this.getAttribute(name)) || fallback;
    this._height = attr("height", 400);
    this._nodes = []; // the layout's nodes, each { id, spec, x, y, ... }
    this._edges = [];
    this._sim = d3
      .forceSimulation()
      .force("link", d3.forceLink().id((d) => d.id).distance(attr("distance", 60)))
      .force("charge", d3.forceManyBody().strength(attr("charge", -160)))
      .force("x", d3.forceX().strength(0.06))
      .force("y", d3.forceY().strength(0.06))
      .force("collide", d3.forceCollide().radius((d) => radiusOf(d.spec) + 4))
      .on("tick", () => this.tick())
      .stop();

    this._svg.addEventListener("click", (event) => {
      if (event.target === this._svg) this.pick(null);
    });
  }

  /**
   * Ctrl or Cmd with the wheel zooms, and so does a pinch. Dragging the background pans.
   * A plain wheel still scrolls the page, and shows a hint. Reset goes back to the whole graph.
   */
  makeZoomable(d3) {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform ?? "");
    this._reset = Object.assign(document.createElement("button"), {
      type: "button",
      className: "tangle-graph-reset",
      textContent: "Reset zoom",
      hidden: true,
    });
    this._hint = Object.assign(document.createElement("div"), {
      className: "tangle-graph-hint",
      textContent: `${mac ? "⌘" : "Ctrl"} + scroll to zoom`,
      hidden: true,
    });
    this._box.append(this._reset, this._hint);
    this._zoom = d3
      .zoom()
      .scaleExtent([1, 8])
      .filter((event) => (event.type === "wheel" ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.button))
      .on("zoom", ({ transform }) => {
        this._view.setAttribute("transform", transform);
        this._reset.hidden = transform.k === 1 && !transform.x && !transform.y;
        this._hint.hidden = true;
      });
    const svg = d3.select(this._svg).call(this._zoom).on("dblclick.zoom", null);
    this._reset.addEventListener("click", () => {
      (reducedMotion() ? svg : svg.transition().duration(300)).call(this._zoom.transform, d3.zoomIdentity);
    });
    this._svg.addEventListener(
      "wheel",
      (event) => {
        if (event.ctrlKey || event.metaKey) return;
        this._hint.hidden = false;
        clearTimeout(this._hintTimer);
        this._hintTimer = setTimeout(() => (this._hint.hidden = true), 1200);
      },
      { passive: true },
    );
  }

  /** Puts a node, or null, in the name variable. */
  pick(node) {
    const name = this.getAttribute("name");
    if (!name) return;
    const scope = this.scope;
    const now = idOf(scope.peek(name));
    scope.set(name, node && now !== node.id ? node.spec : null);
  }

  setHover(node) {
    const name = this.getAttribute("hover");
    if (name) this.scope.set(name, node ? node.spec : null);
  }

  /** Shows a new spec. Nodes that keep their id keep their place; new ones start next to a neighbour. */
  draw(data) {
    this._error?.remove();
    if (!this._box.isConnected) this.append(this._box);
    this._data = data;
    const old = new Map(this._nodes.map((n) => [n.id, n]));
    const width = this.clientWidth || this._width || 640;
    const placed = new Map();
    let kept = 0;
    this._nodes = data.nodes.map((spec, i) => {
      const prev = old.get(spec.id);
      if (prev) {
        kept++;
        prev.spec = spec;
        placed.set(spec.id, prev);
        return prev;
      }
      const node = { id: spec.id, spec };
      if (Number.isFinite(spec.x) && Number.isFinite(spec.y)) Object.assign(node, { x: spec.x, y: spec.y });
      else {
        // Next to a neighbour that's already placed, else on a sunflower spiral round the middle.
        const edge = data.edges.find((e) => (e.source === spec.id && placed.has(e.target)) || (e.target === spec.id && placed.has(e.source)));
        if (edge) {
          const anchor = placed.get(edge.source === spec.id ? edge.target : edge.source);
          const angle = i * 2.399963229728653;
          Object.assign(node, { x: anchor.x + Math.cos(angle) * 30, y: anchor.y + Math.sin(angle) * 30 });
        } else {
          const angle = i * 2.399963229728653;
          const r = 10 * Math.sqrt(i + 1);
          Object.assign(node, { x: width / 2 + Math.cos(angle) * r, y: this._height / 2 + Math.sin(angle) * r });
        }
      }
      placed.set(spec.id, node);
      return node;
    });
    this._edges = data.edges.map((spec) => ({ id: spec.id, spec, source: spec.source, target: spec.target }));

    const sim = this._sim;
    const topology = `${data.nodes.map((n) => n.id).join("\n")}\n\n${data.edges.map((e) => `${e.source}\n${e.target}`).join("\n")}`;
    const moved = topology !== this._topology;
    this._topology = topology;
    sim.nodes(this._nodes);
    sim.force("link").links(this._edges);
    sim.force("collide").radius((d) => radiusOf(d.spec) + 4);
    this.render();
    this.size(width);
    if (moved) {
      // A mostly new graph is laid out before it's shown, so it appears settled and fitted.
      // A few new nodes or edges animate, nudging the rest.
      const fresh = 1 - kept / Math.max(1, this._nodes.length);
      if (fresh > 0.5 || reducedMotion()) {
        sim.alpha(fresh > 0.5 ? 1 : Math.max(0.3, fresh));
        for (let i = 0; i < 300 && sim.alpha() > sim.alphaMin(); i++) sim.tick();
        sim.stop();
        this.settled(false);
      } else this.relayout(Math.max(0.3, fresh));
    } else this.tick();

    // The variables follow the new spec: a node that's gone is null, one that changed is its
    // new object, and an id set from elsewhere becomes its node. An id with no node yet stays.
    for (const attr of ["name", "hover"]) {
      const name = this.getAttribute(attr);
      const value = name ? this.scope.peek(name) : null;
      if (value == null) continue;
      const node = placed.get(idOf(value));
      if (!node) {
        if (isObject(value)) this.scope.set(name, null);
      } else if (!sameNode(value, node.spec)) this.scope.set(name, node.spec);
    }
  }

  /** Makes the elements for the current nodes and edges, keyed by id. */
  render() {
    const d3 = this._d3;
    const data = this._data;
    const pickable = this.hasAttribute("name");
    // Nodes the reader can pick are buttons, which an img would hide from screen readers.
    this._svg.setAttribute("role", pickable ? "group" : "img");

    d3.select(this._edgeLayer)
      .selectAll("g.tangle-graph-edge")
      .data(this._edges, (d) => d.id)
      .join((enter) => {
        const g = enter.append("g").attr("class", "tangle-graph-edge");
        g.append("path").attr("class", "tangle-graph-line");
        g.append("path").attr("class", "tangle-graph-head");
        return g;
      })
      .style("--edge", (d) => graphColor(d.spec.color, null))
      .each(function (d) {
        this.firstChild.setAttribute("stroke-width", Math.max(0.5, Number(d.spec.width) || 1.5));
        this.lastChild.setAttribute("display", data.directed ? "inline" : "none");
      })
      .on("pointerenter", (event, d) => this.showTip(event, d.spec))
      .on("pointerleave", () => this.hideTip());

    d3.select(this._labelLayer)
      .selectAll("text")
      .data(this._edges.filter((e) => e.spec.name), (d) => d.id)
      .join("text")
      .attr("class", "tangle-graph-edge-label")
      .text((d) => d.spec.name);

    const drag = d3
      .drag()
      .clickDistance(4)
      .on("start", (event, d) => {
        if (!event.active) this._sim.alphaTarget(0.2).restart();
        this._dragging = true;
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) this._sim.alphaTarget(0);
        this._dragging = false;
        this._refit = true; // a node dragged out of view is brought back in
        d.fx = d.fy = null;
      });
    d3.select(this._nodeLayer)
      .selectAll("g.tangle-graph-node")
      .data(this._nodes, (d) => d.id)
      .join((enter) => {
        const g = enter.append("g").attr("class", "tangle-graph-node");
        g.append("circle");
        g.append("text").attr("class", "tangle-graph-label");
        g.call(drag)
          .on("pointerenter", (event, d) => {
            this.showTip(event, d.spec);
            this.setHover(d);
          })
          .on("pointerleave", () => {
            this.hideTip();
            this.setHover(null);
          })
          .on("click", (event, d) => this.pick(d))
          .on("keydown", (event, d) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            this.pick(d);
          })
          .on("focus", (event, d) => this.setHover(d))
          .on("blur", () => this.setHover(null));
        return g;
      })
      .attr("tabindex", pickable ? 0 : null)
      .attr("role", pickable ? "button" : null)
      .attr("aria-label", (d) => d.spec.name ?? d.id)
      .classed("is-pickable", pickable)
      .style("--node", (d) => graphColor(d.spec.color, null))
      .each(function (d) {
        const r = radiusOf(d.spec);
        this.firstChild.setAttribute("r", r);
        const label = this.lastChild;
        label.setAttribute("y", r + 12);
        label.textContent = d.spec.name ?? "";
      });
    this.paintPicked();
  }

  paintPicked() {
    if (!this._nodeLayer) return;
    for (const g of this._nodeLayer.children) {
      const on = g.__data__?.id === this._picked;
      g.classList.toggle("is-picked", on);
      if (g.hasAttribute("role")) g.setAttribute("aria-pressed", String(on));
    }
  }

  size(width) {
    this._width = width;
    const h = this._height;
    this._svg.setAttribute("width", width);
    this._svg.setAttribute("height", h);
    this._svg.setAttribute("viewBox", `0 0 ${width} ${h}`);
    this._sim.force("x").x(width / 2);
    this._sim.force("y").y(h / 2);
    // Panning stops at the graph's edges: the layout never leaves the box.
    this._zoom?.extent([[0, 0], [width, h]]).translateExtent([[0, 0], [width, h]]);
  }

  resize() {
    if (!this._data) return;
    this.size(this.clientWidth);
    if (this._bounded) this.relayout(0.3);
    else this.fitTo(this.fitFor(), false); // the layout doesn't depend on the width: only the fit does
  }

  /** Animates the layout from `alpha`. The fit holds still until the motion has died down. */
  relayout(alpha) {
    this._refit = true;
    this._sim.alpha(alpha).restart();
  }

  /** Draws the layout as it is, and fits the view to it: at once, or eased. */
  settled(ease) {
    this._refit = false;
    this.tick();
    if (!this._bounded) this.fitTo(this.fitFor(), ease && !reducedMotion());
  }

  tick() {
    if (this._bounded) {
      const w = this._width;
      const h = this._height;
      for (const n of this._nodes) {
        const r = radiusOf(n.spec) + GRAPH_PAD;
        n.x = Math.max(r, Math.min(w - r, n.x));
        n.y = Math.max(r, Math.min(h - r - GRAPH_LABEL, n.y));
      }
    } else if (this._refit && !this._dragging && this._sim.alpha() < 0.05) {
      // Refitting on every tick would shake the whole view as the layout wobbles. Fit once,
      // when most of the motion is over.
      this._refit = false;
      this.fitTo(this.fitFor(), !reducedMotion());
    }
    const directed = this._data.directed;
    for (const g of this._edgeLayer.children) {
      const { source: s, target: t } = g.__data__;
      if (s === t) {
        g.firstChild.setAttribute("d", "");
        g.lastChild.setAttribute("d", "");
        continue;
      }
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const rs = radiusOf(s.spec) + 2;
      const rt = radiusOf(t.spec) + 2;
      const x0 = s.x + ux * rs;
      const y0 = s.y + uy * rs;
      const tipX = t.x - ux * rt;
      const tipY = t.y - uy * rt;
      const back = directed ? GRAPH_HEAD : 0;
      g.firstChild.setAttribute("d", `M${x0},${y0}L${tipX - ux * back},${tipY - uy * back}`);
      if (directed) {
        const bx = tipX - ux * GRAPH_HEAD;
        const by = tipY - uy * GRAPH_HEAD;
        const px = -uy * GRAPH_HEAD_HALF;
        const py = ux * GRAPH_HEAD_HALF;
        g.lastChild.setAttribute("d", `M${tipX},${tipY}L${bx + px},${by + py}L${bx - px},${by - py}Z`);
      }
    }
    for (const text of this._labelLayer.children) {
      const { source: s, target: t } = text.__data__;
      text.setAttribute("x", (s.x + t.x) / 2);
      text.setAttribute("y", (s.y + t.y) / 2 - 4);
    }
    for (const g of this._nodeLayer.children) {
      const d = g.__data__;
      g.setAttribute("transform", `translate(${d.x},${d.y})`);
    }
  }

  /**
   * The transform that scales the layout down until all of it fits in the box, and centers
   * it. A graph that already fits keeps its size. Strokes keep their width (non-scaling-stroke).
   */
  fitFor() {
    if (!this._nodes.length) return { k: 1, x: 0, y: 0 };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of this._nodes) {
      const r = radiusOf(n.spec);
      x0 = Math.min(x0, n.x - r);
      x1 = Math.max(x1, n.x + r);
      y0 = Math.min(y0, n.y - r);
      y1 = Math.max(y1, n.y + r + GRAPH_LABEL);
    }
    const w = this._width - 2 * GRAPH_PAD - 24; // labels stick out sideways
    const h = this._height - 2 * GRAPH_PAD;
    const k = Math.min(1, w / Math.max(1, x1 - x0), h / Math.max(1, y1 - y0));
    return { k, x: this._width / 2 - (k * (x0 + x1)) / 2, y: this._height / 2 - (k * (y0 + y1)) / 2 };
  }

  /** Moves the view to a fit, easing over 400 ms or at once. */
  fitTo(to, ease) {
    cancelAnimationFrame(this._fitFrame);
    const set = ({ k, x, y }) => {
      this._fitNow = { k, x, y };
      this._fit.setAttribute("transform", `translate(${x},${y}) scale(${k})`);
    };
    const from = this._fitNow;
    if (!ease || !from) return set(to);
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 400);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; // cubic in-out
      set({ k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
      if (t < 1) this._fitFrame = requestAnimationFrame(step);
    };
    this._fitFrame = requestAnimationFrame(step);
  }

  /** A tooltip with the node's or edge's data, if it has any. */
  showTip(event, spec) {
    if (!isObject(spec.data)) return;
    const title = document.createElement("strong");
    title.textContent = spec.name ?? spec.id;
    const rows = Object.entries(spec.data).map(([key, value]) => {
      const row = document.createElement("div");
      const k = Object.assign(document.createElement("span"), { className: "key", textContent: `${key} ` });
      row.append(k, typeof value === "object" ? JSON.stringify(value) : String(value));
      return row;
    });
    this._tip.replaceChildren(title, ...rows);
    const box = this._box.getBoundingClientRect();
    this._tip.style.left = `${event.clientX - box.left + 12}px`;
    this._tip.style.top = `${event.clientY - box.top + 12}px`;
    this._tip.hidden = false;
  }

  hideTip() {
    this._tip.hidden = true;
  }

  showError(error) {
    this._box.remove();
    this._error ??= Object.assign(document.createElement("div"), { className: "tangle-graph-error" });
    this._error.textContent = `t-graph: ${error.message}`;
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
  listen();

  // <t-sketch> first: it keeps its children's HTML for Export, so it has to see them
  // before the elements inside them are defined and render.
  const elements = {
    "t-sketch": TSketch,
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
    "t-codecell": TCodeCell,
    "t-debug": TDebug,
    "t-tag": TTag,
    "t-math": TMath,
    "t-formula-dag": TFormulaDag,
    "t-flow": TFlow,
    "t-vega": TVega,
    "t-obsplot": TObsplot,
    "t-jsxgraph": TJsxgraph,
    "t-graph": TGraph,
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
