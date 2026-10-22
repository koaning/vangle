import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundleCss, bundleJs } from "../site/bundle.js";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("tangle.js and tangle.css are built from the current src/", () => {
  assert.ok(bundleJs() === read("tangle.js"), "tangle.js is out of date: run `make build`");
  assert.ok(bundleCss() === read("tangle.css"), "tangle.css is out of date: run `make build`");
});

test("src/index.js loads as ES modules, with the same exports as the bundle", async () => {
  const [src, bundle] = await Promise.all([import("../src/index.js"), import("../tangle.js")]);
  assert.deepEqual(Object.keys(src).sort(), Object.keys(bundle).sort());
});
