import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Scope,
  signal,
  computed,
  effect,
  formatValue,
  registerFormat,
  registerFunction,
  parseTex,
  toTex,
  snap,
  vegaBindings,
  diffRows,
  parseParams,
  evalWith,
  plotOptions,
  TangleElement,
  scopeOf,
} from "../tangle.js";

const tick = () => new Promise((resolve) => setTimeout(resolve));

test("effects re-run once per batch of changes", async () => {
  const a = signal(1);
  const b = signal(2);
  const sum = computed(() => a.value + b.value);
  const seen = [];
  effect(() => seen.push(sum.value));
  a.value = 10;
  b.value = 20;
  await tick();
  assert.deepEqual(seen, [3, 30]);
});

test("effects stop after dispose", async () => {
  const a = signal(1);
  const seen = [];
  const dispose = effect(() => seen.push(a.value));
  dispose();
  a.value = 2;
  await tick();
  assert.deepEqual(seen, [1]);
});

test("scope expressions track variables, Math, and late declarations", async () => {
  const s = new Scope();
  const seen = [];
  // `calories` is used before it is defined, and `y` before it is set.
  effect(() => seen.push(s.eval("Math.round(calories + (y ?? 0))")));
  s.define("calories", "cookies * 50");
  s.set("cookies", 3);
  await tick();
  s.set("y", 0.4);
  await tick();
  assert.deepEqual(seen.slice(-2), [150, 150]);
  s.set("cookies", 4);
  await tick();
  assert.equal(seen.at(-1), 200);
});

test("Math and other standard globals are used explicitly", () => {
  const s = new Scope();
  s.set("r", 2);
  assert.equal(s.eval("Math.round(Math.PI * r ** 2)"), 13);
  assert.equal(s.eval("Number.isInteger(r) && isFinite(r)"), true);
  // Bare Math names are not injected: `sqrt` is just an undeclared variable.
  assert.throws(() => s.eval("sqrt(r)"), TypeError);
});

test("names that exist on globalThis are still scope variables", async () => {
  const s = new Scope();
  const seen = [];
  // `console` and `setTimeout` live on globalThis, but here they are variables,
  // even before anything declares them.
  effect(() => seen.push(s.eval("(console ?? 0) + (setTimeout ?? 0)")));
  s.set("console", 1);
  s.set("setTimeout", 2);
  await tick();
  assert.deepEqual(seen, [0, 3]);
});

test("registered functions are callable, and late registration re-runs", async () => {
  const s = new Scope();
  s.set("x", 9);
  const seen = [];
  effect(() => {
    try {
      seen.push(s.eval("twice(x)"));
    } catch {
      seen.push("error");
    }
  });
  registerFunction("twice", (v) => v * 2);
  await tick();
  assert.deepEqual(seen, ["error", 18]);
  // A scope variable with the same name wins.
  s.set("twice", (v) => v * 3);
  await tick();
  assert.equal(seen.at(-1), 27);
  assert.throws(() => registerFunction("not valid", () => 0), /valid name/);
});

test("define accepts a function", () => {
  const s = new Scope();
  s.set("x", 3);
  s.define("double", (scope) => scope.get("x") * 2);
  assert.equal(s.eval("double"), 6);
});

test("formatValue: defaults, printf-lite and named formats", () => {
  assert.equal(formatValue(3), "3");
  assert.equal(formatValue(1 / 3), "0.3333");
  assert.equal(formatValue(0.30000000000000004, null, 0.1), "0.3");
  assert.equal(formatValue(-0.001, null, 0.1), "0.0");
  assert.equal(formatValue(2.5, "%.2f"), "2.50");
  assert.equal(formatValue(1234567.891, "$%,.2f"), "$1,234,567.89");
  assert.equal(formatValue(4.6, "%d cookies"), "5 cookies");
  assert.equal(formatValue(3, "%+d"), "+3");
  assert.equal(formatValue(0.25, "percent"), "25%");
  assert.equal(formatValue("monthly"), "monthly");
  assert.equal(formatValue(undefined), "…");
  assert.equal(formatValue(NaN), "–");
  registerFormat("hz", (v) => `${v} Hz`);
  assert.equal(formatValue(440, "hz"), "440 Hz");
});

test("snap clamps and rounds to the step grid", () => {
  assert.equal(snap(7.33, { min: 0, max: 10, step: 0.5 }), 7.5);
  assert.equal(snap(42, { min: 0, max: 10 }), 10);
  assert.equal(snap(0.1 + 0.2, { step: 0.1 }), 0.3);
  assert.equal(snap(4, { min: 1, step: 2 }), 5); // anchored at min
});

test("parseTex finds markers, options and nested braces", () => {
  const parts = parseTex(String.raw`f(x) = \tangle{a} x^2 + \tangle[\beta]{b} = \val[%.2f]{({a: a}).a + b}`);
  assert.deepEqual(parts, [
    "f(x) = ",
    { type: "param", name: "a", symbol: null },
    " x^2 + ",
    { type: "param", name: "b", symbol: String.raw`\beta` },
    " = ",
    { type: "val", expr: "({a: a}).a + b", format: "%.2f" },
  ]);
});

test("parseTex leaves similar commands alone and reports errors", () => {
  assert.deepEqual(parseTex(String.raw`\value \tangleish`), [String.raw`\value \tangleish`]);
  assert.throws(() => parseTex(String.raw`\tangle{1x}`), /valid variable name/);
  assert.throws(() => parseTex(String.raw`\val{a + (}`), SyntaxError);
  assert.throws(() => parseTex(String.raw`\tangle{a`), /Unbalanced/);
});

test("toTex escapes formatted values for KaTeX", () => {
  assert.equal(toTex(1647.01, "$%,.2f"), String.raw`\$1{,}647.01`);
  assert.equal(toTex(0.25, "percent"), String.raw`25\%`);
  assert.equal(toTex(-2), "-2");
  assert.equal(toTex("complex"), String.raw`\text{complex}`);
  assert.equal(toTex(5, "%d km"), String.raw`\text{5 km}`);
});

test("parseParams reads names and literal defaults from any function form", () => {
  const simple = (fn) => parseParams(fn).map(({ name, value }) => [name, value]);
  function train(lr = 0.01, epochs = 10, opt = "adam", shuffle = true) {}
  assert.deepEqual(simple(train), [["lr", 0.01], ["epochs", 10], ["opt", "adam"], ["shuffle", true]]);
  assert.deepEqual(simple((a = -1, b = `x`) => a), [["a", -1], ["b", "x"]]);
  assert.deepEqual(simple(async (a = 2) => a), [["a", 2]]);
  assert.deepEqual(simple({ method(a = 3) {} }.method), [["a", 3]]);
  assert.deepEqual(simple((x) => x), [["x", undefined]]);
  assert.deepEqual(simple(function () {}), []);
  assert.deepEqual(parseParams(function (a, b = 1) {})[0], { name: "a", value: undefined, hasDefault: false });
});

test("parseParams handles commas, brackets and comments inside defaults", () => {
  const names = (fn) => parseParams(fn).map((p) => [p.name, p.value]);
  assert.deepEqual(names((s = "a, (b)", t = 'it\'s)', n = Math.max(1, 2)) => s), [["s", "a, (b)"], ["t", "it's)"], ["n", 2]]);
  assert.deepEqual(names((a = 1 /* , */, b = 2,) => a), [["a", 1], ["b", 2]]);
});

test("parseParams rejects what it can't turn into an argument", () => {
  assert.throws(() => parseParams((...rest) => rest), /Rest parameter/);
  assert.throws(() => parseParams(({ a }) => a), /Destructured/);
  assert.throws(() => parseParams((a = [1, 2]) => a), /number, string or boolean/);
  assert.throws(() => parseParams((a = 1, b = a * 2) => b), /default of "b"/);
});

test("vegaBindings finds top-level params and named data anywhere", () => {
  const spec = {
    params: [{ name: "hp", value: 1 }, { name: "brush", select: "interval" }],
    data: { name: "rows" },
    layer: [{ mark: "rule", data: { name: "limits" } }, { data: { url: "x.json" } }],
    transform: [{ lookup: "id", from: { data: { name: "people" }, key: "id" } }],
  };
  assert.deepEqual(vegaBindings(spec), {
    params: [{ name: "hp", selection: false }, { name: "brush", selection: true }],
    data: ["rows", "limits", "people"],
  });
  // A Vega spec: signals, and inline data at the top level (not loaded from a URL).
  const vega = { signals: [{ name: "k" }], data: [{ name: "table", values: [] }, { name: "web", url: "x.json" }] };
  assert.deepEqual(vegaBindings(vega), { params: [{ name: "k", selection: false }], data: ["table"] });
});

test("diffRows modifies rows in place, and only adds or removes the difference", () => {
  // A stand-in for vega.changeset() that records what it was asked to do.
  const vega = {
    changeset() {
      const log = { modify: [], insert: [], remove: [] };
      const cs = {
        log,
        modify: (t, k, v) => (log.modify.push([t, k, v]), cs),
        insert: (rows) => (log.insert.push(...rows), cs),
        remove: (rows) => (log.remove.push(...(typeof rows === "function" ? ["all"] : rows)), cs),
      };
      return cs;
    },
  };
  const first = [{ year: 0, amount: 1 }, { year: 5, amount: 2 }];
  const [initial, tuples] = diffRows(vega, null, first);
  assert.deepEqual(initial.log.remove, ["all"]);
  assert.deepEqual(initial.log.insert, first);
  assert.notEqual(tuples[0], first[0]); // Vega gets copies, never the caller's objects

  const [changes, next] = diffRows(vega, tuples, [{ year: 0, amount: 1 }, { year: 5, amount: 3 }, { year: 10, amount: 4 }]);
  assert.deepEqual(changes.log.modify, [[tuples[1], "amount", 3]]);
  assert.deepEqual(changes.log.insert, [{ year: 10, amount: 4 }]);
  assert.deepEqual(changes.log.remove, []);
  assert.equal(next[0], tuples[0]);

  const [shorter] = diffRows(vega, next, [{ year: 0, amount: 1 }]);
  assert.deepEqual(shorter.log.remove, next.slice(1));

  // Plain values can't be modified in place: replace them all.
  const [plain, none] = diffRows(vega, next, [1, 2]);
  assert.deepEqual(plain.log.remove, ["all"]);
  assert.equal(none, null);
});

test("evalWith puts extra names ahead of scope variables, and still tracks the rest", async () => {
  const scope = new Scope();
  scope.set("k", 2);
  scope.set("Plot", "shadowed");
  const Plot = { dot: (data, options) => ({ data, options }) };
  const seen = [];
  effect(() => seen.push(evalWith(scope, "Plot.dot([k], { r: Math.max(k, 3) })", { Plot })));
  assert.deepEqual(seen[0], { data: [2], options: { r: 3 } });
  scope.set("k", 5);
  await tick();
  assert.deepEqual(seen[1], { data: [5], options: { r: 5 } });
});

test("plotOptions fills in width and font, and the author's options win", () => {
  const font = { fontSize: "12px", fontFamily: "serif" };
  assert.deepEqual(plotOptions(["mark"], { width: 500, font }), {
    marks: ["mark"],
    width: 500,
    style: { overflow: "visible", fontSize: "12px", fontFamily: "serif" },
  });
  const own = { width: 300, height: 200, style: { fontSize: "14px" } };
  assert.deepEqual(plotOptions(own, { width: 500, font }), {
    width: 300,
    height: 200,
    style: { overflow: "visible", fontSize: "14px", fontFamily: "serif" },
  });
  assert.equal(own.style.fontFamily, undefined); // the author's object isn't changed
  assert.equal(plotOptions({ style: "color: red" }, { font }).style, "color: red");
});

test("TangleElement: watch gets the scope and stops on disconnect, declare reads attributes", async () => {
  // Outside a browser the base class is a plain class, so stub the attributes.
  class Widget extends TangleElement {
    attrs = { min: "0", max: "10", color: "red" };
    hasAttribute(name) { return name in this.attrs; }
    getAttribute(name) { return this.attrs[name] ?? null; }
  }
  const el = new Widget();
  assert.equal(el.scope, scopeOf(null)); // no <t-scope> around it: the page-wide scope
  el.declare("widgetValue", 3);
  assert.equal(el.scope.peek("widgetValue"), 3);
  assert.deepEqual(el.scope.meta("widgetValue"), { min: 0, max: 10, color: "red" });
  const seen = [];
  el.watch((s) => seen.push(s.get("widgetValue")));
  el.scope.set("widgetValue", 4);
  await tick();
  el.disconnectedCallback();
  el.scope.set("widgetValue", 5);
  await tick();
  assert.deepEqual(seen, [3, 4]);
});
