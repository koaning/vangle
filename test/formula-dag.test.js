import { test } from "node:test";
import assert from "node:assert/strict";
import { formulaDag, Scope, evalWith, effect } from "../tangle.js";
// The pure helpers behind <t-formula-dag>, straight from the source (they aren't public).
import { splitLhs, stripNotes, wholeNote, cardTex, noteParts, variablesRead } from "../src/core/formulas.js";
import { dagCycle, dagLayers, dagOrder, dagReach, landingSide, trackOrder, packRow } from "../src/core/dag.js";

const tick = () => new Promise((resolve) => setTimeout(resolve));
const raw = String.raw;

test("splitLhs splits at the first top-level =", () => {
  assert.deepEqual(splitLhs(raw`\mu = \frac{1}{n}\sum_{i=1}^n x_i`), [raw`\mu`, raw` \frac{1}{n}\sum_{i=1}^n x_i`]);
  assert.deepEqual(splitLhs(raw`\sum_{i=1}^n x_i`), null); // the = is inside a group
  assert.deepEqual(splitLhs(raw`\{a = b\}`)?.[0], raw`\{a`); // \{ isn't a group
  assert.equal(splitLhs(raw` = 3`), null); // nothing before it
  assert.equal(splitLhs("x + 1"), null);
});

test("stripNotes and wholeNote", () => {
  assert.equal(stripNotes(raw`\note{a}{x} + \note{b}{\note{c}{y}^2}`), "x + y^2");
  assert.equal(wholeNote(raw`\note{why}{d_1}`), "why");
  assert.equal(wholeNote(raw` \note{why}{d_1} `), "why");
  assert.equal(wholeNote(raw`\note{a}{x} + \note{b}{y}`), null);
  assert.equal(wholeNote(raw`\note{a}{x} + 1`), null);
  assert.equal(wholeNote("x"), null);
});

const stats = {
  formulas: {
    mu: raw`\mu = \frac{1}{n}\sum_i x_i`,
    var: raw`\sigma^2 = \frac{1}{n}\sum_i (x_i - \use{mu})^2`,
    sigma: { tex: raw`\sigma = \sqrt{\use{var}}`, label: "spread" },
    z: raw`z_i = \frac{x_i - \use{mu}}{\note{scale}{\use{sigma}}}`,
    band: raw`\use{mu} \pm \tangle[k]{k}\,\use{sigma}`,
  },
  notes: { scale: "in units of $\\sigma$" },
};

test("formulaDag: symbols, labels, edges and layers", () => {
  const m = formulaDag(stats);
  const by = Object.fromEntries(m.formulas.map((f) => [f.name, f]));
  assert.equal(by.mu.symbol, raw`\mu`);
  assert.equal(by.var.symbol, raw`\sigma^2`);
  assert.equal(by.band.symbol, raw`\mathrm{band}`); // no left-hand side
  assert.equal(by.band.lhs, null);
  assert.equal(by.sigma.label, "spread");
  assert.equal(by.mu.label, "mu");
  assert.deepEqual(m.edges, [["mu", "var"], ["var", "sigma"], ["mu", "z"], ["sigma", "z"], ["mu", "band"], ["sigma", "band"]]);
  assert.deepEqual(m.layers.map((l) => l.filter((id) => !id.startsWith("!"))), [["mu"], ["var"], ["sigma"], ["z", "band"]]);
  // mu -> z and mu -> band skip two rows each: two waypoints apiece.
  const long = m.routes.filter((r) => r.length > 2);
  assert.equal(long.length, 2);
  assert.ok(long.every((r) => r.length === 4 && r[0] === "mu"));
  assert.deepEqual(m.notes.scale, { text: "in units of $\\sigma$", side: "auto", color: null, formula: "z", param: null });
  assert.deepEqual(m.params, [{ name: "k", symbol: "k", config: {} }]);
  assert.equal(m.legend, true);
});

test("formulaDag: only formulas that feed others get a color", () => {
  const m = formulaDag(stats);
  const colors = Object.fromEntries(m.formulas.map((f) => [f.name, f.color]));
  assert.deepEqual(colors, {
    mu: "var(--tangle-dag-1)",
    var: "var(--tangle-dag-2)",
    sigma: "var(--tangle-dag-3)",
    z: null,
    band: null,
  });
  const own = formulaDag({ formulas: { a: { tex: "a = 1", color: "red blue" }, b: raw`b = \use{a}` } });
  assert.equal(own.formulas[0].color, "light-dark(red, blue)");
  const many = {};
  for (let i = 0; i < 10; i++) many[`f${i}`] = i ? raw`f_${i} = \use{f${i - 1}}` : "f_0 = 1";
  assert.equal(formulaDag({ formulas: many }).formulas[8].color, "var(--tangle-dag-1)"); // wraps after 8
});

test("formulaDag: notes that wrap a number explain it", () => {
  const m = formulaDag({
    formulas: { f: raw`y = \note{w}{\tangle[\sigma]{s}} x + \note{o}{\tangle{b}}` },
    notes: { w: { text: "the width", side: "top" }, o: "offset" },
    params: { b: { value: 1, min: 0 } },
  });
  assert.equal(m.notes.w.param, "s");
  assert.equal(m.notes.w.side, "top");
  assert.equal(m.notes.o.param, "b");
  // The spec's params come first, then the rest in order of appearance.
  assert.deepEqual(m.params, [
    { name: "b", symbol: "b", config: { value: 1, min: 0 } },
    { name: "s", symbol: raw`\sigma`, config: {} },
  ]);
});

test("formulaDag: says what's wrong", () => {
  const bad = (spec, pattern) => assert.throws(() => formulaDag(spec), pattern);
  bad(null, /t-formula-dag: the spec must be an object/);
  bad({ formula: {} }, /unknown key "formula"/);
  bad({ formulas: {} }, /non-empty object/);
  bad({ formulas: { "2x": "x = 1" } }, /formula name "2x"/);
  bad({ formulas: { a: { tex: "a = 1", lable: "x" } } }, /formula "a": unknown key "lable"/);
  bad({ formulas: { a: { tex: " " } } }, /needs a non-empty tex/);
  bad({ formulas: { a: raw`a = \use{b}` } }, /there is no formula "b"/);
  bad({ formulas: { a: raw`a = \use{a}` } }, /can't \\use\{a\} itself/);
  bad({ formulas: { a: raw`a = \use{b}`, b: raw`b = \use{a}` } }, /cycle: a -> b -> a/);
  bad({ formulas: { a: { tex: "a = 1", value: 3 } } }, /value must be an expression string or a function/);
  bad({ formulas: { a: { tex: "a = 1", value: "1 +" } } }, /formula "a"/);
  bad({ formulas: { a: { tex: "a = 1", symbol: raw`\use{a}` } } }, /symbol can't hold/);
  bad({ formulas: { a: raw`\tangle{k} = 1` } }, /left of its =/);
  bad({ formulas: { a: raw`a = \tangle{a}` } }, /both a formula and a \\tangle parameter/);
  bad({ formulas: { a: raw`a = \note{n}{x}` } }, /\\note\{n\} has no text/);
  bad({ formulas: { a: "a = 1" }, notes: { n: "hi" } }, /note "n" isn't marked/);
  bad({ formulas: { a: raw`a = \note{n}{x}`, b: raw`b = \note{n}{y}` }, notes: { n: "hi" } }, /more than one formula: a, b/);
  bad({ formulas: { a: raw`a = \note{n}{x}` }, notes: { n: { text: "hi", side: "left" } } }, /side must be/);
  bad({ formulas: { a: "a = 1" }, params: { k: { value: 1 } } }, /no formula has \\tangle\{k\}/);
  bad({ formulas: { a: raw`a = \tangle{k}` }, params: { k: { value: 1, minimum: 0 } } }, /unknown key "minimum"/);
  bad({ formulas: { a: raw`a = \frac{1}{2` } }, /a "\{" is never closed/);
  bad({ formulas: { a: raw`a = 1}` } }, /has no matching/);
});

test("dagLayers puts a node one below the deepest it comes from", () => {
  const names = ["a", "b", "c", "d"];
  const edges = [["b", "c"], ["c", "d"], ["a", "d"]];
  // a has no parents, so it shares the top layer, even though only d uses it.
  assert.deepEqual(Object.fromEntries(dagLayers(names, edges)), { a: 0, b: 0, c: 1, d: 2 });
  // A minimum pushes a node down, and what comes from it follows.
  const pushed = dagLayers(names, edges, new Map([["a", 1], ["c", 2]]));
  assert.deepEqual(Object.fromEntries(pushed), { a: 1, b: 0, c: 2, d: 3 });
  assert.deepEqual(dagCycle(names, edges), null);
  assert.deepEqual(dagCycle(["a", "b"], [["a", "b"], ["b", "a"]]), ["a", "b", "a"]);
});

test("formulaDag: row pushes a formula down", () => {
  const spec = (row) => ({
    formulas: {
      vy: "v_y = 3",
      g: { tex: "g = 9.8", row },
      t: String.raw`t = 2\use{vy}/\use{g}`,
    },
  });
  const real = (m) => m.layers.map((l) => l.filter((id) => !id.startsWith("!")));
  assert.deepEqual(real(formulaDag(spec(undefined))), [["vy", "g"], ["t"]]);
  // g one row down: t follows it, and vy's arrow to t skips a row.
  const m = formulaDag(spec(1));
  assert.deepEqual(real(m), [["vy"], ["g"], ["t"]]);
  assert.deepEqual(m.routes.find((r) => r[0] === "vy").length, 3);
  // A row nothing reaches is dropped, rather than drawn as an empty gap.
  const lone = formulaDag({ formulas: { a: "a = 1", b: { tex: "b = 2", row: 3 } } });
  assert.deepEqual(lone.layers, [["a"], ["b"]]);
  assert.throws(() => formulaDag({ formulas: { a: { tex: "a = 1", row: -1 } } }), /row must be a whole number/);
  assert.throws(() => formulaDag({ formulas: { a: { tex: "a = 1", row: 1.5 } } }), /row must be a whole number/);
});

test("dagOrder untangles crossings and threads long edges through waypoints", () => {
  // a -> d and b -> c cross in the seeded order [a, b] / [c, d].
  const names = ["a", "b", "c", "d"];
  const edges = [["a", "d"], ["b", "c"]];
  const { layers } = dagOrder(names, dagLayers(names, edges), edges);
  assert.deepEqual(layers, [["a", "b"], ["d", "c"]]);

  const long = [["x", "y"], ["y", "z"], ["x", "z"]];
  const out = dagOrder(["x", "y", "z"], dagLayers(["x", "y", "z"], long), long);
  assert.deepEqual(out.routes, [["x", "y"], ["y", "z"], ["x", "!wp0", "z"]]);
  assert.deepEqual(out.layers[1].sort(), ["!wp0", "y"]);

  // Wider than the cap: the seeded order stays.
  const wide = ["r", "a1", "a2", "a3"];
  const fan = wide.slice(1).map((n) => ["r", n]);
  const kept = dagOrder(wide, dagLayers(wide, fan), fan, { cap: 2 });
  assert.deepEqual(kept.layers[1], ["a1", "a2", "a3"]);
});

test("dagReach follows edges transitively", () => {
  const next = new Map([["a", ["b"]], ["b", ["c", "d"]]]);
  assert.deepEqual([...dagReach("a", next)].sort(), ["b", "c", "d"]);
  assert.deepEqual([...dagReach("d", next)], []);
});

test("landingSide lands on top unless something covers the symbol", () => {
  const sym = { left: 10, right: 20, top: 30, bottom: 40 };
  assert.equal(landingSide(sym, [{ left: 30, right: 40, top: 30, bottom: 40 }], 0), "top");
  const bar = { left: 0, right: 60, top: 25, bottom: 26 }; // a fraction bar above
  assert.equal(landingSide(sym, [bar], 100), "right"); // coming from the right
  assert.equal(landingSide(sym, [bar], 0), "left"); // coming from the left
  const right = { left: 22, right: 30, top: 30, bottom: 40 };
  assert.equal(landingSide(sym, [bar, right], 100), "left"); // the right is taken
  const left = { left: 0, right: 8, top: 30, bottom: 40 };
  assert.equal(landingSide(sym, [bar, right, left], 100), "top"); // nothing is clear
});

test("trackOrder stacks tracks so their drops don't cross", () => {
  // p jogs from 0 to 60, q from 50 to 100. With p's track on top, p's drop at
  // 60 cuts q's run and q's drop at 50 cuts p's; with q's on top, neither does.
  const bySrc = new Map([
    ["p", [{ from: 0, to: 60 }]],
    ["q", [{ from: 50, to: 100 }]],
  ]);
  assert.deepEqual(trackOrder(["p", "q"], bySrc), ["q", "p"]);
  assert.deepEqual(trackOrder(["p", "q"], bySrc, 1), ["p", "q"]); // over the cap: as seeded
});

test("packRow keeps labels apart and off the blocked spans", () => {
  const items = packRow(
    [
      { cx: 50, w: 20 },
      { cx: 52, w: 20 },
    ],
    [{ left: 70, right: 90 }],
    10,
  );
  assert.equal(items[0].x, 40);
  assert.ok(items[1].x >= items[0].x + 20 + 10);
  assert.ok(items[1].x >= 90 || items[1].x + 20 <= 70); // clear of the block
});

test("cardTex wraps uses and the output, and reveals values", () => {
  const m = formulaDag({
    formulas: {
      vy: { tex: raw`v_y = \tangle{v}\sin\theta`, value: "v" },
      H: { tex: raw`H = \frac{\use{vy}^2}{2g}`, value: "vy * vy" },
      D: { tex: raw`\note{dist}{D} = \use{vy}`, value: "vy" },
    },
    notes: { dist: "how far" },
  });
  const by = Object.fromEntries(m.formulas.map((f) => [f.name, f]));
  const markers = (parts, text) => parts.map((p) => (typeof p === "string" ? text(p) : `[${p.name}]`)).join("");
  const ctx = (revealed = []) => ({
    symbol: (n) => by[n].symbol,
    revealed: (n) => revealed.includes(n),
    valueTex: (n) => `<${n}>`,
    markers,
  });
  // The exponent moves inside the subscripted symbol: v_y^2, not (v_y)^2.
  assert.equal(cardTex(by.H, ctx()), raw`\htmlData{fdag-out=H}{H} = \frac{\htmlData{fdag-use=vy}{v_y^2}}{2g}`);
  assert.equal(cardTex(by.vy, ctx()), raw`\htmlData{fdag-out=vy}{v_y} = [v]\sin\theta`);
  assert.equal(cardTex(by.H, ctx(["vy", "H"])), raw`\htmlData{fdag-out=H}{<H>} = \frac{\htmlData{fdag-use=vy}{<vy>^2}}{2g}`);
  // A note on the whole output stays on the value.
  assert.equal(cardTex(by.D, ctx(["D"])), raw`\htmlData{fdag-out=D}{\htmlData{note=dist}{<D>}} = \htmlData{fdag-use=vy}{v_y}`);
  const sum = formulaDag({ formulas: { a: "a = 1", s: { tex: raw`\use{a} + 1`, value: "a + 1" } } }).formulas[1];
  assert.equal(
    cardTex(sum, { ...ctx(["s"]), symbol: () => "a" }),
    raw`\htmlData{fdag-use=a}{a} + 1 = \htmlData{fdag-value=s}{<s>}`,
  );
});

test("noteParts splits text, **bold** and $math$", () => {
  assert.deepEqual(noteParts("in units of $\\sigma$, **always**"), [
    { text: "in units of " },
    { math: "\\sigma" },
    { text: ", " },
    { bold: "always" },
  ]);
});

test("formula values live in the scope and follow what they read", async () => {
  const scope = new Scope();
  scope.set("v", 10);
  scope.set("g", 9.8);
  // The spec is a JS expression: an arrow value reads scope variables when it runs.
  const spec = evalWith(
    scope,
    `{ formulas: {
      t: { tex: String.raw\`t = 2\\tangle{v}/\\tangle{g}\`, value: () => 2 * v / g },
      H: { tex: String.raw\`H = \\tangle{v} \\use{t} / 4\`, value: "v * t / 4" },
    } }`,
    {},
  );
  const m = formulaDag(spec);
  for (const f of m.formulas) scope.define(f.name, f.value);
  const seen = [];
  effect(() => seen.push(Math.round(scope.get("H") * 100) / 100));
  scope.set("v", 20);
  await tick();
  assert.deepEqual(seen, [5.1, 20.41]);
  assert.deepEqual([...variablesRead(scope, "H")].sort(), ["g", "t", "v"]);
  assert.deepEqual([...variablesRead(scope, "t")].sort(), ["g", "v"]);
});
