import { test } from "node:test";
import assert from "node:assert/strict";
// The drag controller and declare(), straight from the source (they aren't public).
import { Scope } from "../src/core/scope.js";
import { declare } from "../src/core/element.js";
import { startDrag, dragBy, endDrag, readerSet, active } from "../src/core/interaction.js";

// Enough of an element for declare(): its tag name and attributes.
const fake = (localName, attrs) => ({
  localName,
  hasAttribute: (a) => a in attrs,
  getAttribute: (a) => attrs[a] ?? null,
});

function cookies(attrs = {}) {
  const scope = new Scope();
  declare(fake("t-num", { name: "n", prev: "old", min: "0", max: "20", format: "%d", ...attrs }), scope, "n", 5);
  return scope;
}

test('prev="old" starts equal to the value, with its format and step', () => {
  const scope = cookies({ step: "1" });
  assert.equal(scope.peek("old"), 5);
  assert.equal(scope.meta("old").format, "%d");
  assert.equal(scope.meta("old").step, 1);
});

test("a drag keeps the value from before it in prev, the whole way", () => {
  const scope = cookies();
  startDrag(scope, "n");
  assert.equal(dragBy(2), false, "under 3px is still a click");
  assert.equal(scope.peek("old"), 5);
  dragBy(15); // 3 steps at 5px a step
  assert.equal(scope.peek("n"), 8);
  assert.equal(scope.peek("old"), 5);
  dragBy(-10);
  assert.equal(scope.peek("n"), 3);
  assert.equal(scope.peek("old"), 5);
  endDrag();
  assert.equal(scope.peek("n"), 3);
  assert.equal(scope.peek("old"), 5);
  // The next drag starts from 3.
  startDrag(scope, "n");
  dragBy(5);
  endDrag();
  assert.equal(scope.peek("n"), 4);
  assert.equal(scope.peek("old"), 3);
});

test("Escape during a drag puts back the value and prev", () => {
  const scope = cookies();
  readerSet(scope, "n", 7); // an earlier change: old = 5
  assert.equal(scope.peek("old"), 5);
  startDrag(scope, "n");
  dragBy(25);
  assert.equal(scope.peek("n"), 12);
  assert.equal(scope.peek("old"), 7);
  endDrag(true);
  assert.equal(scope.peek("n"), 7);
  assert.equal(scope.peek("old"), 5);
  assert.equal(active.peek(), null);
});

test("Escape restores the value without prev too", () => {
  const scope = new Scope();
  declare(fake("t-num", { name: "x" }), scope, "x", 2);
  startDrag(scope, "x");
  dragBy(50);
  assert.equal(scope.peek("x"), 12);
  endDrag(true);
  assert.equal(scope.peek("x"), 2);
});

test("typed values and arrow keys move the old value into prev, but not a no-op", () => {
  const scope = cookies();
  readerSet(scope, "n", 9);
  assert.equal(scope.peek("old"), 5);
  readerSet(scope, "n", 9);
  assert.equal(scope.peek("old"), 5);
  readerSet(scope, "n", 10);
  assert.equal(scope.peek("old"), 9);
});

test("setting the value from code leaves prev alone", () => {
  const scope = cookies();
  scope.set("n", 11);
  assert.equal(scope.peek("old"), 5);
});

test("a prev that isn't a valid name, or is the name itself, is ignored", () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    for (const prev of ["n", "1bad"]) {
      const scope = new Scope();
      declare(fake("t-num", { name: "n", prev }), scope, "n", 5);
      startDrag(scope, "n");
      dragBy(10);
      endDrag();
      assert.equal(scope.peek("n"), 7);
      assert.equal(scope.slots.has("1bad"), false);
    }
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 2);
});
