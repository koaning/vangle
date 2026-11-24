import { test } from "node:test";
import assert from "node:assert/strict";
import { Scope } from "../src/core/scope.js";
import { TTag } from "../src/elements/t-tag.js";

// Just enough of an <input> for <t-tag>: attributes, plus a `value` property that
// follows the attribute until the reader changes it, like the real one.
class FakeInput {
  constructor() {
    this.localName = "input";
    this._attrs = new Map();
    this._value = null;
    this.textContent = "";
  }
  get attributes() { return [...this._attrs].map(([name, value]) => ({ name, value })); }
  getAttribute(key) { return this._attrs.get(key) ?? null; }
  setAttribute(key, value) { this._attrs.set(key, String(value)); }
  removeAttribute(key) { this._attrs.delete(key); }
  get value() { return this._value ?? this.getAttribute("value") ?? ""; }
  set value(v) { this._value = String(v); }
}

// <t-tag tag='input type="range"'><t-num name="max">100</t-num><t-num name="value">40</t-num></t-tag>
function slider() {
  const scope = new Scope();
  scope.set("max", 100);
  scope.set("value", 40);
  const input = new FakeInput();
  const child = () => ({ getAttribute: () => null });
  const tag = Object.assign(new TTag(), {
    _tag: { name: "input", attrs: [["type", "range"]] },
    _els: [child(), child()],
    _args: ["max", "value"],
    _text: "",
    _content: -1,
    _flags: [null, null],
    _bool: [false, false],
    _preview: { firstElementChild: input, replaceChildren: () => assert.fail("the input was replaced") },
  });
  return { scope, input, tag };
}

test("t-tag: moving the live slider sets the variable behind its value (#34)", () => {
  const { scope, input, tag } = slider();
  tag.render(scope);
  assert.equal(input.getAttribute("value"), "40");
  input.value = "75"; // the reader drags the slider
  tag.sync(scope);
  assert.equal(scope.peek("value"), 75);
  assert.equal(scope.peek("max"), 100);
});

test("t-tag: a changed variable updates the live slider in place", () => {
  const { scope, input, tag } = slider();
  tag.render(scope);
  input.value = "75"; // the slider's value no longer follows its attribute
  scope.set("value", 20);
  scope.set("max", 50);
  tag.render(scope);
  assert.equal(input.getAttribute("value"), "20");
  assert.equal(input.getAttribute("max"), "50");
  assert.equal(input.value, "20");
});
