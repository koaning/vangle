import { test } from "node:test";
import assert from "node:assert/strict";
// The pure helpers behind <t-flow>, straight from the source (they aren't public).
import { flowSpec, flowInfer, flowReduce, flowEdges, flowGraph, flowPlace, flowSlots, flowOrthoRoute, flowPortPoint } from "../src/core/flow.js";

const ids = ["L", "g", "T", "f"];
const real = (rows) => rows.map((row) => row.filter((c) => !c.lane).map((c) => c.id));

test("flowSpec fills in the defaults", () => {
  const m = flowSpec(undefined, ids);
  assert.equal(m.direction, "down");
  assert.equal(m.align, "center");
  assert.equal(m.infer, true);
  assert.equal(m.edgeLabels, false);
  assert.deepEqual(m.nodes.get("T"), { label: null, note: null, fold: null, row: null, beside: null, width: null });
  assert.deepEqual(m.edges, []);
  assert.deepEqual(m.groups, []);
});

test("flowSpec reads nodes, edges and groups", () => {
  const m = flowSpec({
    nodes: { T: "period", f: { fold: "closed", width: 200, beside: ["T", "before"] }, g: { row: 2, fold: true } },
    edges: [["L", "f"], ["T", "f", "1/T"], ["g", "T", false], ["L", "T", { exit: ["right", 0.25], enter: "left", dashed: true }]],
    groups: [{ label: "out", nodes: ["f", "T"], collapsed: true }],
  }, ids);
  assert.equal(m.nodes.get("T").label, "period");
  assert.deepEqual(m.nodes.get("f"), { label: null, note: null, fold: "closed", row: null, beside: { anchor: "T", before: true }, width: "200px" });
  assert.equal(m.nodes.get("g").fold, "open");
  assert.deepEqual(m.edges.map((e) => [e.src, e.dst, e.drop]), [["L", "f", false], ["T", "f", false], ["g", "T", true], ["L", "T", false]]);
  assert.deepEqual(m.edges[1].opts, { label: "1/T" });
  assert.deepEqual(m.edges[3].opts, { exit: { side: "right", at: 0.25 }, enter: { side: "left", at: null }, dashed: true });
  assert.deepEqual(m.groups, [{ id: "!g0", label: "out", members: ["T", "f"], collapsed: true }]); // in node order
});

test("flowSpec says what's wrong", () => {
  const bad = (spec, pattern) => assert.throws(() => flowSpec(spec, ids), pattern);
  bad({ colour: 1 }, /unknown key "colour"/);
  bad({ direction: "up" }, /direction must be "down" or "right"/);
  bad({ direction: "right", align: "left" }, /align must be one of "center", "top", "bottom"/);
  bad({ nodes: { x: {} } }, /names "x", which isn't a node. The nodes are "L", "g", "T", "f"/);
  bad({ nodes: { T: { lable: "p" } } }, /nodes.T has unknown key "lable"/);
  bad({ nodes: { T: { row: -1 } } }, /row must be a whole number/);
  bad({ nodes: { T: { beside: "T" } } }, /can't sit beside itself/);
  bad({ nodes: { T: { beside: "f" }, f: { beside: "g" } } }, /itself sits beside another node/);
  bad({ nodes: { T: { beside: "f", row: 1 } } }, /give the row to "f" instead/);
  bad({ edges: [["L", "L"]] }, /from a node to itself/);
  bad({ edges: [["L", "T"], ["L", "T", "x"]] }, /is given twice/);
  bad({ edges: [["L", "T", { enter: "middle" }]] }, /enter must be one of/);
  bad({ edges: [["L", "T", { exit: ["top", 2] }]] }, /position must be a number from 0 to 1/);
  bad({ groups: [{ label: "a", nodes: ["T"] }, { label: "b", nodes: ["T"] }] }, /"T" is in both the group "a" and the group "b"/);
  bad({ groups: [{ label: "a", nodes: [] }] }, /needs a list of nodes/);
});

test("flowInfer draws an arrow from what a node defines to what reads it, through outside formulas", () => {
  const nodes = [
    { id: "L", defines: ["L"], reads: new Set(["L"]) }, // a <t-num> reads its own variable
    { id: "g", defines: ["g"], reads: new Set(["g"]) },
    { id: "T", defines: ["T"], reads: new Set(["T"]) }, // T is a <t-let> in the node: its formula reads L and g
    { id: "out", defines: [], reads: new Set(["f"]) }, // f is a formula outside every node
  ];
  const formulas = new Map([["T", ["L", "g"]], ["f", ["T"]]]);
  const edges = flowInfer(nodes, formulas);
  assert.deepEqual([...edges].map(([k, v]) => [k, [...v]]), [["L T", ["L"]], ["g T", ["g"]], ["T out", ["T"]]]);
});

test("flowReduce drops arrows a longer path implies", () => {
  const edges = new Map([["a b", 1], ["b c", 2], ["a c", 3], ["c d", 4]]);
  assert.deepEqual([...flowReduce(edges).keys()], ["a b", "b c", "c d"]);
});

test("flowEdges lays the spec's edges over the inferred ones", () => {
  const inferred = new Map([["L T", new Set(["L"])], ["g T", new Set(["g"])], ["T f", new Set(["T"])]]);
  const spec = { edgeLabels: true, edges: [["T", "f", { color: "red" }], ["g", "T", false], ["L", "f"]] };
  const edges = flowEdges(inferred, flowSpec(spec, ids), ids);
  assert.deepEqual(edges.map((e) => [e.src, e.dst, e.label, e.color ?? null, e.inferred]), [
    ["L", "T", "L", null, true],
    ["L", "f", null, null, false],
    ["T", "f", "T", "red", true],
  ]);
  const only = flowEdges(inferred, flowSpec({ infer: false, edges: [["L", "f"]] }, ids), ids);
  assert.deepEqual(only.map((e) => [e.src, e.dst]), [["L", "f"]]);
});

const chain = (...pairs) => pairs.map(([src, dst, more]) => ({ src, dst, label: null, ...more }));

test("flowGraph layers the nodes, threading long arrows through lanes", () => {
  const edges = chain(["L", "T"], ["g", "T"], ["T", "f"], ["L", "f"]);
  const g = flowGraph(ids, edges, flowSpec({}, ids));
  assert.deepEqual(real(g.rows), [["L", "g"], ["T"], ["f"]]);
  const long = g.routes.find((r) => r.src === "L" && r.dst === "f");
  assert.equal(long.chain.length, 3); // one lane, in T's row
  assert.ok(g.rows[1].some((c) => c.lane && c.id === long.chain[1]));
  assert.equal(g.rowOf.get("f"), 2);
});

test("flowGraph: row pins, beside and ports", () => {
  const edges = chain(["L", "T"], ["g", "T"], ["T", "f"], ["L", "f", { exit: { side: "right", at: null } }]);
  const spec = flowSpec({ nodes: { g: { row: 1 }, f: { beside: "T" } } }, ids);
  const g = flowGraph(ids, edges, spec);
  assert.deepEqual(real(g.rows), [["L"], ["g"], ["T"]]); // g pinned to row 1 pushes T down
  assert.deepEqual(g.rows[2][0].after, ["f"]);
  const tf = g.routes.find((r) => r.src === "T" && r.dst === "f");
  assert.equal(tf.ported, true); // beside: the facing sides
  assert.deepEqual([tf.exit.side, tf.enter.side], ["right", "left"]);
  const lf = g.routes.find((r) => r.src === "L" && r.dst === "f");
  assert.deepEqual(lf.chain, ["L", "f"]); // ported arrows get no lanes
  // A node beside one it feeds through another can't share its row.
  assert.throws(() => flowGraph(ids, edges, flowSpec({ nodes: { f: { beside: "L" } } }, ids)), /arrows then run in a circle/);
});

test("flowGraph: a folded group is one pill, and the arrows land on it", () => {
  const edges = chain(["L", "T"], ["g", "T"], ["T", "f"]);
  const spec = flowSpec({ groups: [{ label: "out", nodes: ["T", "f"] }] }, ids);
  const g = flowGraph(ids, edges, spec, new Set(["!g0"]));
  assert.deepEqual(real(g.rows), [["L", "g"], ["!g0"]]);
  assert.deepEqual(g.routes.map((r) => `${r.src} ${r.dst}`), ["L !g0", "g !g0"]);
  assert.deepEqual([...g.hidden], ["T", "f"]);
  // A group that skips a node on a path between its own can't fold.
  assert.throws(() => flowGraph(ids, edges, flowSpec({ groups: [{ label: "x", nodes: ["L", "f"] }] }, ids)), /must include "T"/);
  assert.throws(() => flowGraph(ids, chain(["L", "T"], ["T", "L"]), spec), /round in a circle: "L" → "T" → "L"/);
});

test("flowPlace centers rows, or lines them up in columns", () => {
  const rows = [[{ id: "a", before: [], after: [] }, { id: "b", before: [], after: [] }], [{ id: "c", before: [], after: ["d"] }]];
  const sizes = { a: { w: 100, h: 20 }, b: { w: 60, h: 40 }, c: { w: 80, h: 30 }, d: { w: 50, h: 10 } };
  const size = (id) => sizes[id];
  const centered = flowPlace(rows, size, { nodeGap: 10, layerGap: 50 });
  assert.equal(centered.width, 170);
  assert.equal(centered.height, 40 + 50 + 30);
  assert.deepEqual(centered.pos.get("a"), { left: 0, right: 100, top: 10, bottom: 30 }); // centered in its row
  assert.deepEqual(centered.pos.get("c"), { left: 15, right: 95, top: 90, bottom: 120 });
  assert.equal(centered.pos.get("d").left, 105);
  const left = flowPlace(rows, size, { align: "left", nodeGap: 10, layerGap: 50 });
  // Column 0 holds a and c (with d beside it): c's center lines up with a's.
  const mid = (b) => (b.left + b.right) / 2;
  assert.equal(mid(left.pos.get("a")), mid(left.pos.get("c")));
});

test("flowSlots spreads landings, letting an arrow from straight above drop straight", () => {
  assert.deepEqual(flowSlots([50], 0, 100), [50]);
  const xs = flowSlots([10, 90], 0, 100);
  assert.ok(xs[0] < 50 && xs[1] > 50);
  assert.deepEqual(flowSlots([20, 80], 0, 200).length, 2);
});

test("flowOrthoRoute goes around what's in the way", () => {
  const a = flowPortPoint({ left: 0, right: 40, top: 0, bottom: 20 }, "bottom", 0.5);
  const b = flowPortPoint({ left: 0, right: 40, top: 200, bottom: 220 }, "top", 0.5, 3);
  assert.deepEqual(flowOrthoRoute(a, b).map((p) => [p.x, p.y]), [[20, 20], [20, 197]]);
  const wall = { left: -50, right: 90, top: 90, bottom: 110 };
  const around = flowOrthoRoute(a, b, [wall]);
  assert.ok(around.every((p, i) => !i || !(p.y > wall.top && around[i - 1].y < wall.top && p.x > wall.left && p.x < wall.right)));
  assert.ok(around.length > 2);
});
