import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { wrapCode, stripCode, cellInputs, createRunner, registerEngine, WORKER_SOURCE } from "../src/core/engines.js";
import { dedent } from "../src/elements/t-codecell.js";

test("wrapCode returns one expression's value, and leaves function bodies alone", () => {
  assert.equal(wrapCode("a * 2"), "return (a * 2\n);");
  assert.equal(wrapCode("{ x: 1 }"), "return ({ x: 1 }\n);");
  assert.equal(wrapCode("await fetchIt()"), "return (await fetchIt()\n);");
  const body = "const y = a * 2;\nreturn y;";
  assert.equal(wrapCode(body), body);
  assert.equal(wrapCode("let x = ("), "let x = (");
});

test("stripCode blanks strings, comments and template text, but keeps ${…}", () => {
  const out = stripCode("a + 'b c' // d\n/* e */ `f ${g + `h ${i}`} j` + k");
  assert.deepEqual(out.match(/[a-z]+/g), ["a", "g", "i", "k"]);
  assert.equal(stripCode('"esc\\"aped" + x').trim(), "+ x");
});

test("cellInputs finds the page variables the code mentions", () => {
  const names = ["angle", "v", "k", "unused", "text"];
  const code = "// v is the speed\nconst s = `${angle}`;\nreturn obj.k + 'text' + angle * 2 + v1 + e5 + 1e5";
  assert.deepEqual(cellInputs(code, names), ["angle"]);
  assert.deepEqual(cellInputs("v ** 2 / (2 * k)", names).sort(), ["k", "v"]);
});

test("dedent removes shared indentation and blank edges", () => {
  assert.equal(dedent("\n    const a = 1;\n      return a;\n  "), "const a = 1;\n  return a;");
});

test("createRunner uses registered engines, and knows none for unknown languages", async () => {
  assert.equal(createRunner("cobol"), null);
  registerEngine("upper", () => ({ run: async (code, inputs) => ({ value: code.toUpperCase() + inputs.n, logs: [] }) }));
  assert.deepEqual(await createRunner("upper").run("hi", { n: 1 }), { value: "HI1", logs: [] });
});

// The worker's script, run in a plain V8 context with postMessage collected.
function worker() {
  const posted = [];
  const context = vm.createContext({ postMessage: (m) => posted.push(m), console: {}, Function, Object, Number, String, RegExp, JSON, Math, Promise });
  vm.runInContext(WORKER_SOURCE, context);
  return async (code, inputs = {}) => {
    posted.length = 0;
    await context.onmessage({ data: { id: 1, code, inputs } });
    return JSON.parse(JSON.stringify(posted[0])); // out of the other realm, as postMessage would

  };
}

test("the worker runs code with the inputs, and returns the value and logs", async () => {
  const run = worker();
  assert.equal((await run("x * 2", { x: 21 })).value, 42);
  const answer = await run("console.log('half', x / 2, { a: 1 });\nconst x2 = x;\nreturn [x2]", { x: 3 });
  assert.deepEqual(answer.value, [3]);
  assert.deepEqual(answer.logs, [{ level: "log", text: 'half 1.5 {"a":1}' }]);
  // The code's own declarations may shadow an input.
  assert.equal((await run("let x = 5;\nreturn x", { x: 1 })).value, 5);
  assert.equal((await run("await Promise.resolve(7)")).value, 7);
});

test("the worker reports errors with the line they happened on", async () => {
  const run = worker();
  const answer = await run("const a = 1;\nconst b = 2;\nreturn nope + a", {});
  assert.match(answer.error.message, /ReferenceError: nope is not defined/);
  assert.equal(answer.error.line, 3);
  assert.match((await run("return (", {})).error.message, /SyntaxError/);
});
