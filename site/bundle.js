// Builds tangle.js from src/index.js and tangle.css from src/index.css. Run it
// with `make build`; `node site/bundle.js --check` fails if the committed files
// are out of date.
//
// The source is plain ES modules, so the bundle is a concatenation: each module
// once, after the modules it imports, with its import lines removed. Comments
// stay. The exports of src/index.js are the public API: those declarations keep
// their `export`, and every other `export` is dropped, so modules can share
// names without making them public. The rules this relies on:
// - only relative named imports: import { a, b } from "./x.js"
// - no two modules declare the same top-level name (the bundle won't parse)
// - no module assigns to a variable it imports (ES modules forbid it anyway)
// CSS is simpler: src/index.css @imports the files under src/css/ in order.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// import { a } from "./x.js";  export { a } from "./x.js";  import "./x.js";
const FROM = /^(import|export)\s*(?:\{([^}]*)\}\s*from\s*)?"([^"]+)";[ \t]*\n/gm;
// export { a, b };
const EXPORT_LIST = /^export\s*\{([^}]*)\};[ \t]*\n/gm;
const DECLARATION = /^export (?=(?:async\s+)?(?:function\*?|class|const|let)\s+([\w$]+))/gm;
const names = (list) =>
  list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const where = (file) => relative(ROOT, file);

/** The source files in bundle order: each after the files it imports. */
function collect(entry) {
  const order = [];
  const done = new Set();
  const visiting = [];
  (function visit(file) {
    if (done.has(file)) return;
    if (visiting.includes(file)) {
      throw new Error(`import cycle: ${[...visiting.slice(visiting.indexOf(file)), file].map(where).join(" -> ")}`);
    }
    visiting.push(file);
    const text = readFileSync(file, "utf8");
    for (const [, , , path] of text.matchAll(FROM)) {
      if (!path.startsWith(".")) throw new Error(`${where(file)}: only relative imports, not "${path}"`);
      visit(join(dirname(file), path));
    }
    visiting.pop();
    done.add(file);
    order.push({ file, text });
  })(entry);
  return order;
}

/** The leading // comment block of a file. */
const headerOf = (text) => text.match(/^(?:\/\/.*\n)+/)?.[0] ?? "";

export function bundleJs(entry = join(ROOT, "src/index.js")) {
  const modules = collect(entry);
  const index = modules.at(-1).text;
  const pub = new Set();
  for (const [, kind, list] of index.matchAll(FROM)) if (kind === "export") names(list ?? "").forEach((n) => pub.add(n));
  for (const [, list] of index.matchAll(EXPORT_LIST)) names(list).forEach((n) => pub.add(n));

  const declared = new Set();
  const parts = modules.map(({ file, text }, i) => {
    let body = text.replace(FROM, "").replace(EXPORT_LIST, "");
    // The entry's own comments describe the source; its first one heads the bundle.
    if (i === modules.length - 1) body = body.replace(/^(?:\s*(?:\/\/.*\n)+)+/, "");
    const stray = body.match(/^(?:import\b.*|export\s+default\b.*)$/m);
    if (stray) throw new Error(`${where(file)}: can't bundle \`${stray[0]}\``);
    body = body.replace(DECLARATION, (all, name) => {
      if (!pub.has(name)) return "";
      declared.add(name);
      return all;
    });
    return body.replace(/^\n+/, "").trimEnd();
  });
  for (const name of pub) if (!declared.has(name)) throw new Error(`${name} is exported by src/index.js but not declared with export`);

  const header = headerOf(index).replace(/^\/\/ \S+:/, "// tangle.js:");
  return `${header}//\n// Built by \`make build\` from src/. Edit the files there, not this one.\n\n${parts.join("\n\n")}\n`;
}

export function bundleCss(entry = join(ROOT, "src/index.css")) {
  const text = readFileSync(entry, "utf8");
  const header = text.match(/^\/\*[\s\S]*?\*\/\n/)?.[0] ?? "";
  const parts = [...text.matchAll(/^@import\s+"([^"]+)";/gm)].map(([, path]) =>
    readFileSync(join(dirname(entry), path), "utf8").trimEnd(),
  );
  return `${header}/* Built by \`make build\` from src/. Edit the files there, not this one. */\n\n${parts.join("\n\n")}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputs = { "tangle.js": bundleJs(), "tangle.css": bundleCss() };
  const check = process.argv.includes("--check");
  let stale = false;
  for (const [name, text] of Object.entries(outputs)) {
    const path = join(ROOT, name);
    if (!check) writeFileSync(path, text);
    else if (readFileSync(path, "utf8") !== text) {
      console.error(`${name} is out of date: run \`make build\` and commit it.`);
      stale = true;
    }
  }
  if (stale) process.exit(1);
}
