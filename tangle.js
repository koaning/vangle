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
// likewise Vega, only if it has a <t-vega>.
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

/** Compile `expr` as a function of `param` over a scope: compileFn("a * x", "x")(proxy)(2). */
export function compileFn(expr, param) {
  const key = `${param}\0${expr}`;
  let fn = compiled.get(key);
  if (!fn) {
    // The arrow's parameter shadows the scope proxy, so `param` is never a scope variable.
    fn = new Function("$scope", `with ($scope) { return (${param}) => (${expr}\n); }`);
    compiled.set(key, fn);
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
// Lazy loading: KaTeX for <t-math>, Vega for <t-vega>. Each loads only if the
// page has such an element, and a copy the page already loaded is reused.
// ---------------------------------------------------------------------------

const KATEX_VERSION = "0.19.0";
const VEGA_URL = "https://cdn.jsdelivr.net/npm/";
const config = {
  katexUrl: `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.mjs`,
  katexCssUrl: `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`,
  vegaUrl: `${VEGA_URL}vega@6.4.0/build/vega.min.js`,
  vegaLiteUrl: `${VEGA_URL}vega-lite@6.4.3/build/vega-lite.min.js`,
  vegaEmbedUrl: `${VEGA_URL}vega-embed@7.3.0/build/vega-embed.min.js`,
  pixelsPerStep: 5,
};

/**
 * Override defaults: { katexUrl, katexCssUrl, vegaUrl, vegaLiteUrl, vegaEmbedUrl, pixelsPerStep }.
 * Call before KaTeX or Vega loads.
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
function openEditor(el) {
  closeEditor(false);
  const { scope, name } = paramOf(el);
  const meta = scope.slot(name).meta.peek();
  const value = scope.peek(name);
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.className = "tangle-editor";
  input.setAttribute("aria-label", `Set ${meta.label ?? name}`);
  input.value = typeof value === "number" ? formatValue(value, null, meta.step) : "";
  if (meta.color) input.style.setProperty("--tangle-color", meta.color);
  const rect = el.getBoundingClientRect();
  input.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;
  input.style.top = `${rect.bottom + window.scrollY + 6}px`;
  document.body.append(input);
  editor = { input, scope, name, meta, where: occurrence(el) };
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
  if (commit) {
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

/** A `color` attribute as CSS: one color, or two ("light dark") as light-dark(). */
function cssColor(attr) {
  const colors = attr.trim().split(/\s+/);
  return colors.length === 2 ? `light-dark(${colors[0]}, ${colors[1]})` : attr;
}

/** Read declaration attributes into the variable's metadata and set its initial value. */
function declare(el, scope, name, initial) {
  const patch = {};
  for (const [attr, key] of Object.entries(NUMERIC_META)) {
    if (el.hasAttribute(attr)) patch[key] = Number(el.getAttribute(attr));
  }
  for (const attr of ["color", "label", "format"]) {
    if (el.hasAttribute(attr)) patch[attr] = el.getAttribute(attr);
  }
  if (patch.color) patch.color = cssColor(patch.color);
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

class TangleElement extends Base {
  disconnectedCallback() {
    for (const dispose of this._disposers ?? []) dispose();
    this._disposers = [];
  }
  watch(fn) {
    (this._disposers ??= []).push(effect(fn));
  }
}

class TScope extends Base {
  get scope() {
    return scopeOf(this);
  }
}

// <t-var name="a" value="2" min="-5" max="5" step="0.1" color="#246bce">
// Declares a variable without showing it (e.g. for formulas).
class TVar extends TangleElement {
  connectedCallback() {
    const name = validName(this);
    if (!name) return;
    const raw = this.getAttribute("value");
    declare(this, scopeOf(this), name, raw == null ? undefined : parseNumber(raw));
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
    const scope = scopeOf(this);
    declare(this, scope, name, this._initial);
    this.dataset.tangleParam = name;
    this.watch(() => {
      const meta = scope.meta(name);
      const value = scope.get(name);
      this.textContent = formatValue(value, this.getAttribute("format") ?? meta.format, meta.step);
      this.setAttribute("aria-valuetext", this.textContent);
      untracked(() => decorate(this, scope, name));
    });
    this.watch(() => {
      hover.value, active.value;
      syncClasses(this, scope, name);
    });
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
// Click to cycle. Options are "label" or "label:value"; numeric values become numbers.
class TChoice extends TangleElement {
  connectedCallback() {
    const name = validName(this);
    if (!name) return;
    const scope = scopeOf(this);
    const options = (this.getAttribute("options") ?? "").split(",").map((raw) => {
      const [label, value = label] = raw.split(":").map((s) => s.trim());
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
    declare(this, scope, name, start.value);
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
      const option = options[indexOf(scope.get(name))];
      this.textContent = option ? option.label : formatValue(scope.get(name));
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
// Charts: <t-chart> draws an SVG once, then each mark owns one effect that
// rewrites only its own shape, and only when something it reads changes.
// ---------------------------------------------------------------------------

/** About `count` round tick values (multiples of 1, 2 or 5 × 10^k) covering [min, max]. */
export function niceTicks(min, max, count = 5) {
  if (!(max > min) || !Number.isFinite(max - min)) return Number.isFinite(min) ? [min] : [];
  const raw = (max - min) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const error = raw / power; // in [1, 10): round it to 1, 2, 5 or 10, as d3 does
  const step = power * (error >= Math.sqrt(50) ? 10 : error >= Math.sqrt(10) ? 5 : error >= Math.SQRT2 ? 2 : 1);
  const digits = Math.max(0, -Math.floor(Math.log10(step)));
  const ticks = [];
  for (let i = Math.ceil(min / step - 1e-9); i * step <= max + step * 1e-9; i++) {
    ticks.push(Number((i * step).toFixed(digits)));
  }
  return ticks;
}

/** Data as [x, y] pairs: numbers become [index, value]; [x, y] and {x, y} pass through. */
export function toPoints(data) {
  if (!Array.isArray(data)) return [];
  return data.map((d, i) =>
    Array.isArray(d) ? [Number(d[0]), Number(d[1])]
    : d !== null && typeof d === "object" ? [Number(d.x), Number(d.y)]
    : [i, Number(d)],
  );
}

// Round to 0.1px for short path strings, and keep huge values from breaking the SVG.
const px = (v) => Math.round(Math.max(-1e5, Math.min(1e5, v)) * 10) / 10;

/** Runs of consecutive finite points, mapped to pixels; a NaN or ±∞ starts a new run. */
function runs(points, sx, sy) {
  const out = [];
  let run = null;
  for (const [x, y] of points) {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      if (!run) out.push((run = []));
      run.push(`${px(sx(x))},${px(sy(y))}`);
    } else run = null;
  }
  return out;
}

/** An SVG path through the points. */
export function linePath(points, sx, sy) {
  return runs(points, sx, sy).map((run) => `M${run.join("L")}`).join("");
}

/** A closed SVG path between the points and the horizontal line y = y0. */
export function areaPath(points, sx, sy, y0 = 0) {
  const base = px(sy(y0));
  return runs(points, sx, sy)
    .map((run) => `M${run[0].split(",")[0]},${base}L${run.join("L")}L${run.at(-1).split(",")[0]},${base}Z`)
    .join("");
}

const SVG_NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
};
const escapeXml = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
let chartCount = 0;

// <t-chart xmin="0" xmax="10" ymin="0" ymax="100"> <t-line y="x ** 2"></t-line> </t-chart>
// The domain attributes are expressions, so they may use variables; with plain
// numbers the axes are drawn once and never again.
class TChart extends TangleElement {
  connectedCallback() {
    this.layer(); // build the SVG before the marks ask for it
    // A signal ignores writes of the same value, so new bar data only
    // invalidates the scales when the number of bars changes.
    this.watch(() => (this.bands.value = this.bandCount(scopeOf(this))));
    this.watch(() => this.drawAxes(this.scale.value));
  }

  attr(name, fallback) {
    return this.hasAttribute(name) ? this.getAttribute(name) : fallback;
  }

  labels() {
    const raw = this.getAttribute("labels");
    return raw ? raw.split(",").map((s) => s.trim()) : [];
  }

  /** The <g> marks draw into. Builds the SVG skeleton on first use. */
  layer() {
    if (this._marks?.isConnected) return this._marks;
    const width = Number(this.attr("width", 600));
    const height = Number(this.attr("height", 300));
    const box = {
      left: 48,
      right: width - 14,
      top: 10,
      bottom: height - 26 - (this.hasAttribute("x-label") ? 18 : 0),
      width,
      height,
    };
    const id = `tangle-clip-${++chartCount}`;
    this.svg = svgEl("svg", {
      class: "tangle-chart",
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": this.getAttribute("label") ?? "Chart",
    });
    const clip = svgEl("clipPath", { id });
    clip.append(svgEl("rect", { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top }));
    this._grid = svgEl("g", { class: "tangle-grid" });
    this._axis = svgEl("g", { class: "tangle-axis" });
    this._marks = svgEl("g", { class: "tangle-marks", "clip-path": `url(#${id})` });
    this.svg.append(svgEl("defs"), this._grid, this._axis, this._marks);
    this.svg.firstChild.append(clip);
    this.prepend(this.svg);
    this.box = box;
    this.bands = new Signal(0);

    // The scales only depend on the domain. Marks read this, so they redraw for
    // a domain change only when the domain uses a variable that changed.
    this.scale = new Computed(() => {
      const scope = scopeOf(this);
      const num = (name, fallback) => (this.hasAttribute(name) ? Number(scope.eval(this.getAttribute(name))) : fallback);
      const n = this.bands.value;
      const xmin = num("xmin", n ? -0.5 : 0);
      const xmax = num("xmax", n ? n - 0.5 : 1);
      const ymin = num("ymin", 0);
      const ymax = num("ymax", 1);
      return {
        xmin, xmax, ymin, ymax,
        x: (v) => box.left + ((v - xmin) / (xmax - xmin)) * (box.right - box.left),
        y: (v) => box.bottom - ((v - ymin) / (ymax - ymin)) * (box.bottom - box.top),
      };
    });
    return this._marks;
  }

  // Bars without xmin/xmax get one band per label, or per value of the longest <t-bars>.
  bandCount(scope) {
    const labels = this.labels();
    if (labels.length) return labels.length;
    if (this.hasAttribute("xmin") && this.hasAttribute("xmax")) return 0;
    let n = 0;
    for (const bars of this.querySelectorAll("t-bars")) {
      try {
        n = Math.max(n, toPoints(scope.eval(bars.getAttribute("data") ?? "[]")).length);
      } catch {}
    }
    return n;
  }

  drawAxes(s) {
    const { box } = this;
    const labels = this.labels();
    const fmtX = this.getAttribute("x-format");
    const fmtY = this.getAttribute("y-format");
    const banded = labels.length > 0 || this.querySelector("t-bars");
    const grid = [];
    const text = [];
    for (const v of niceTicks(s.ymin, s.ymax, Number(this.attr("y-ticks", 5)))) {
      const y = px(s.y(v));
      grid.push(`<line x1="${box.left}" x2="${box.right}" y1="${y}" y2="${y}"/>`);
      text.push(`<text class="y" x="${box.left - 8}" y="${y}" dy="0.32em">${escapeXml(formatValue(v, fmtY))}</text>`);
    }
    const xs = labels.length
      ? labels.map((label, i) => [i, label])
      : niceTicks(s.xmin, s.xmax, Number(this.attr("x-ticks", banded ? 10 : 5)))
          .filter((v) => !banded || Number.isInteger(v))
          .map((v) => [v, formatValue(v, fmtX)]);
    for (const [v, label] of xs) {
      const x = px(s.x(v));
      if (x < box.left - 0.5 || x > box.right + 0.5) continue;
      if (!banded) grid.push(`<line x1="${x}" x2="${x}" y1="${box.top}" y2="${box.bottom}"/>`);
      text.push(`<text class="x" x="${x}" y="${box.bottom + 18}">${escapeXml(label)}</text>`);
    }
    if (this.hasAttribute("x-label")) {
      text.push(`<text class="label x" x="${(box.left + box.right) / 2}" y="${box.height - 4}">${escapeXml(this.getAttribute("x-label"))}</text>`);
    }
    // Skip identical rewrites, e.g. when new bar data didn't change the band count.
    const gridHtml = grid.join("");
    const textHtml = text.join("");
    if (gridHtml !== this._gridHtml) this._grid.innerHTML = this._gridHtml = gridHtml;
    if (textHtml !== this._textHtml) {
      this._axis.innerHTML = this._textHtml = textHtml;
      this.fitLeft();
    }
  }

  // Wide y labels ("$600,000") can stick out to the left of the plot. Measure
  // them, put the y-label beside them, and widen the drawing to fit both.
  fitLeft() {
    const { box } = this;
    let left = box.left - 8;
    try {
      for (const el of this._axis.querySelectorAll("text.y")) left = Math.min(left, el.getBBox().x);
    } catch {} // not rendered (e.g. inside display: none): keep the defaults
    if (this.hasAttribute("y-label")) {
      const x = px(left - 6);
      const y = (box.top + box.bottom) / 2;
      const label = svgEl("text", { class: "label y", x, y, transform: `rotate(-90 ${x} ${y})` });
      label.textContent = this.getAttribute("y-label");
      this._axis.append(label);
      left -= 22;
    }
    const x0 = Math.min(0, Math.floor(left) - 2);
    this.svg.setAttribute("viewBox", `${x0} 0 ${box.width - x0} ${box.height}`);
  }

  /** Add a legend entry for a mark with a label. Legends are HTML, so they wrap. */
  addLegend(text, shape) {
    if (!this._legend?.isConnected) {
      this._legend = document.createElement("div");
      this._legend.className = "tangle-legend";
      if (this.getAttribute("legend") === "bottom") this.svg.after(this._legend);
      else this.svg.before(this._legend);
    }
    const item = document.createElement("span");
    item.className = "tangle-legend-item";
    const swatch = svgEl("svg", { class: "tangle-swatch", viewBox: "0 0 16 12", "aria-hidden": "true" });
    swatch.append(shape);
    item.append(swatch, text);
    this._legend.append(item);
    return item;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.svg?.remove();
    this._legend?.remove();
    this._marks = null;
  }
}

// Shared by the marks: find the chart, create the SVG node, remove it again.
class ChartMark extends TangleElement {
  connectedCallback() {
    const chart = this.closest("t-chart");
    if (!chart?.layer) {
      console.error(`tangle: <${this.localName}> must be inside a <t-chart>`, this);
      return;
    }
    this.node = this.styled(this.createNode());
    chart.layer().append(this.node);
    if (this.hasAttribute("label")) {
      this.legendItem = chart.addLegend(this.getAttribute("label"), this.styled(this.createSwatch()));
    }
    this.draw(chart, scopeOf(this));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.node?.remove();
    this.node = null;
    const legend = this.legendItem?.parentNode;
    this.legendItem?.remove();
    this.legendItem = null;
    if (legend && !legend.children.length) legend.remove();
  }

  // The shape and its legend swatch get the same classes and color, so CSS
  // written for one series (`t-chart .forecast`) styles both.
  styled(el) {
    el.setAttribute("class", `${this.markClass} ${this.getAttribute("class") ?? ""}`.trim());
    if (this.hasAttribute("color")) el.style.setProperty("--tangle-color", cssColor(this.getAttribute("color")));
    return el;
  }

  /** The points to draw: `data` evaluated as an array, or `y` sampled across the x domain. */
  points(chart, scope, s) {
    if (this.hasAttribute("data")) return toPoints(scope.eval(this.getAttribute("data")));
    const fn = compileFn(this.getAttribute("y") ?? "NaN", chart.getAttribute("var") ?? "x")(scope.proxy);
    const n = Math.max(1, Number(this.getAttribute("samples") ?? Math.round((chart.box.right - chart.box.left) / 4)));
    const points = [];
    for (let i = 0; i <= n; i++) {
      const x = s.xmin + ((s.xmax - s.xmin) * i) / n;
      points.push([x, Number(fn(x))]);
    }
    return points;
  }
}

// <t-line y="a * x ** 2"></t-line> or <t-line data="values"></t-line>
class TLine extends ChartMark {
  get markClass() {
    return "tangle-line";
  }
  createNode() {
    return svgEl("path");
  }
  createSwatch() {
    return svgEl("path", { d: "M1,6H15" });
  }
  shape(points, s) {
    return linePath(points, s.x, s.y);
  }
  draw(chart, scope) {
    let last = null;
    this.watch(() => {
      const s = chart.scale.value;
      let d = "";
      try {
        d = this.shape(this.points(chart, scope, s), s, scope);
      } catch (error) {
        console.error(`tangle: <${this.localName}>`, error);
      }
      if (d !== last) this.node.setAttribute("d", (last = d));
    });
  }
}

// <t-area y="..." y0="0"></t-area>: the region between the line and y = y0.
class TArea extends TLine {
  get markClass() {
    return "tangle-area";
  }
  createSwatch() {
    return svgEl("path", { d: "M1,1H15V11H1Z" });
  }
  shape(points, s, scope) {
    return areaPath(points, s.x, s.y, Number(scope.eval(this.getAttribute("y0") ?? "0")));
  }
}

// <t-bars data="[3, 5, 2]" width="0.8"></t-bars>: one bar per value, at x = 0, 1, 2…
// Bars are <rect>s that are reused; only attributes that changed are written.
class TBars extends ChartMark {
  get markClass() {
    return "tangle-bars";
  }
  createNode() {
    return svgEl("g");
  }
  createSwatch() {
    const g = svgEl("g");
    g.append(svgEl("rect", { class: "tangle-bar", x: 2, y: 0, width: 12, height: 12 }));
    return g;
  }
  draw(chart, scope) {
    const rects = [];
    const half = Number(this.getAttribute("width") ?? 0.8) / 2;
    this.watch(() => {
      const s = chart.scale.value;
      let points = [];
      let y0 = 0;
      try {
        points = this.points(chart, scope, s);
        y0 = Number(scope.eval(this.getAttribute("y0") ?? "0"));
      } catch (error) {
        console.error("tangle: <t-bars>", error);
      }
      while (rects.length < points.length) {
        const el = svgEl("rect", { class: "tangle-bar" });
        this.node.append(el);
        rects.push({ el, attrs: {} });
      }
      while (rects.length > points.length) rects.pop().el.remove();
      points.forEach(([x, y], i) => {
        const ok = Number.isFinite(x) && Number.isFinite(y);
        const x1 = px(s.x(x - half));
        const top = px(s.y(Math.max(y, y0)));
        const next = ok
          ? { x: x1, y: top, width: px(s.x(x + half)) - x1, height: Math.abs(px(s.y(Math.min(y, y0))) - top) }
          : { x: 0, y: 0, width: 0, height: 0 };
        const { el, attrs } = rects[i];
        for (const name in next) {
          if (attrs[name] !== next[name]) el.setAttribute(name, (attrs[name] = next[name]));
        }
      });
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
    "t-math": TMath,
    "t-chart": TChart,
    "t-line": TLine,
    "t-area": TArea,
    "t-bars": TBars,
    "t-vega": TVega,
  };
  for (const [tag, cls] of Object.entries(elements)) {
    if (!customElements.get(tag)) customElements.define(tag, cls);
  }
}
