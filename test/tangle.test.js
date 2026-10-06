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
  compileFn,
  niceTicks,
  toPoints,
  linePath,
  areaPath,
  vegaBindings,
  diffRows,
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

test("niceTicks picks round steps that cover the domain", () => {
  assert.deepEqual(niceTicks(0, 100), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(0, 1), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.deepEqual(niceTicks(-3, 3, 6), [-3, -2, -1, 0, 1, 2, 3]);
  assert.deepEqual(niceTicks(0.5, 9.5, 4), [2, 4, 6, 8]);
  assert.deepEqual(niceTicks(5, 5), [5]);
  assert.deepEqual(niceTicks(0, Infinity), [0]);
});

test("toPoints accepts numbers, pairs and {x, y} objects", () => {
  assert.deepEqual(toPoints([3, 5]), [[0, 3], [1, 5]]);
  assert.deepEqual(toPoints([[2, 4], { x: 3, y: 9 }]), [[2, 4], [3, 9]]);
  assert.deepEqual(toPoints("nope"), []);
});

test("linePath rounds to 0.1px and splits at gaps", () => {
  const id = (v) => v;
  assert.equal(linePath([[0, 0], [1.234, 2], [2, 4]], id, id), "M0,0L1.2,2L2,4");
  assert.equal(linePath([[0, 0], [1, NaN], [2, 2], [3, 3]], id, id), "M0,0M2,2L3,3");
  assert.equal(linePath([], id, id), "");
  assert.equal(areaPath([[0, 1], [2, 3]], id, id, 0), "M0,0L0,1L2,3L2,0Z");
});

test("compileFn's parameter shadows a scope variable of the same name", async () => {
  const scope = new Scope();
  scope.set("x", 100);
  scope.set("a", 2);
  const seen = [];
  scope.effect(() => {
    const f = compileFn("a * x", "x")(scope.proxy);
    seen.push([f(1), f(3)]);
  });
  scope.set("a", 3);
  await tick();
  assert.deepEqual(seen, [[2, 6], [3, 9]]);
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
