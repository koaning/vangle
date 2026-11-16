// ---------------------------------------------------------------------------
// Engines run the code of a <t-codecell>. A language's engine is a factory that
// gives each cell its own runner: { run(code, inputs, { timeout }), dispose() }.
// run resolves to { value, logs } or rejects with an Error that may carry a
// `line` and `logs`. The built-in "js" engine runs code in a Web Worker, away
// from the page: no DOM, no page variables, and it's stopped if it runs too long.
// ---------------------------------------------------------------------------

import { Signal } from "./signals.js";

const engines = new Map();
// Bumped by registerEngine, so a cell waiting on its engine runs once it's there.
export const enginesVersion = new Signal(0);

/**
 * Teach <t-codecell lang="…"> a language. `factory()` is called once per cell and
 * returns { run(code, inputs, { timeout }) → Promise<{ value, logs }>, dispose?() }.
 * `inputs` maps the page variables the code mentions to their values.
 */
export function registerEngine(lang, factory) {
  engines.set(lang, factory);
  enginesVersion.value = enginesVersion.peek() + 1;
}

/** A runner for one cell, or null if no engine knows `lang`. */
export function createRunner(lang) {
  const factory = engines.get(lang);
  return factory ? factory() : null;
}

/**
 * The body of the async function a JS cell runs: the code itself if it's a
 * function body (with `return`), or `return (code)` if it's one expression.
 * Runs inside the worker too, so it's written to stand alone.
 */
export function wrapCode(code) {
  const AsyncFunction = (async () => {}).constructor;
  const expression = `return (${code}\n);`;
  try {
    new AsyncFunction(expression);
    return expression;
  } catch {
    return code;
  }
}

/**
 * `code` with its comments, strings and the text of template literals blanked
 * out (the ${…} parts stay), so what's left are names and punctuation.
 */
export function stripCode(code) {
  let out = "";
  let i = 0;
  const templates = []; // for each open ${…}, how many { deep it is
  const skipText = (end) => {
    while (i < code.length && !end()) i += code[i] === "\\" ? 2 : 1;
  };
  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];
    if (c === "/" && next === "/") {
      skipText(() => code[i] === "\n");
      out += " ";
    } else if (c === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end < 0 ? code.length : end + 2;
      out += " ";
    } else if (c === '"' || c === "'") {
      i++;
      skipText(() => code[i] === c || code[i] === "\n");
      i++;
      out += " ";
    } else if (c === "`" || (c === "}" && templates.at(-1) === 0)) {
      if (c === "}") templates.pop();
      i++;
      skipText(() => code[i] === "`" || (code[i] === "$" && code[i + 1] === "{"));
      if (code[i] === "$") {
        templates.push(0);
        i += 2;
      } else i++;
      out += " ";
    } else {
      if (templates.length && c === "{") templates[templates.length - 1]++;
      if (templates.length && c === "}") templates[templates.length - 1]--;
      out += c;
      i++;
    }
  }
  return out;
}

/** The names in `names` that `code` mentions, outside strings, comments and property access. */
export function cellInputs(code, names) {
  const known = new Set(names);
  const found = new Set();
  for (const [, dot, name] of stripCode(code).matchAll(/(\.\s*)?(?<![\w$])([A-Za-z_$][\w$]*)/g)) {
    if (!dot && known.has(name)) found.add(name);
  }
  return [...found];
}

// The worker's side. Code runs as an async function inside `with (inputs)`, so
// page variables read like globals, and the code's own `let x` can shadow them.
// The sourceURL comment names the code in stack traces, which gives error lines.
export const WORKER_SOURCE = `
const AsyncFunction = (async () => {}).constructor;
${wrapCode}
const CELL = "tangle-cell";
const lineOf = (error) => Number(String(error?.stack).match(new RegExp(CELL + ":(\\\\d+)"))?.[1]);
let offset = 0; // how many lines the engine puts before the body
try {
  new Function("throw new Error()\\n//# sourceURL=" + CELL)();
} catch (error) {
  offset = (lineOf(error) || 1) - 1;
}
const show = (value) => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};
let logs = [];
for (const level of ["log", "info", "warn", "error", "debug"]) {
  console[level] = (...args) => logs.push({ level, text: args.map(show).join(" ") });
}
onmessage = async ({ data: { id, code, inputs } }) => {
  logs = [];
  try {
    const run = new AsyncFunction("$inputs", "with ($inputs) {" + wrapCode(code) + "\\n}\\n//# sourceURL=" + CELL);
    const value = await run(inputs);
    try {
      postMessage({ id, value, logs });
    } catch (error) {
      postMessage({ id, logs, error: { message: "The result can't leave the sandbox: " + error.message } });
    }
  } catch (error) {
    const line = lineOf(error) - offset;
    postMessage({ id, logs, error: { message: String(error?.name ? error.name + ": " + error.message : error), line: line > 0 ? line : null } });
  }
};
`;

let workerUrl = null;

/** The built-in "js" engine: one worker per cell, replaced when a run is cut short. */
function jsEngine() {
  let worker = null;
  let current = null; // { id, timer, reject } of the run in progress
  let ids = 0;
  const kill = () => {
    worker?.terminate();
    worker = null;
  };
  const finish = () => {
    clearTimeout(current?.timer);
    current = null;
  };
  return {
    run(code, inputs, { timeout = 2000 } = {}) {
      // A newer run replaces one still going: stop it rather than queue behind it.
      if (current) {
        current.reject(Object.assign(new Error("replaced by a newer run"), { name: "AbortError" }));
        finish();
        kill();
      }
      workerUrl ??= URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
      worker ??= new Worker(workerUrl);
      const id = ++ids;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          finish();
          kill();
          reject(new Error(`Stopped after ${timeout} ms. Is there an endless loop?`));
        }, timeout);
        current = { id, timer, reject };
        // Errors outside the run (a worker that fails to start, say) end the run in progress.
        worker.onerror = (event) => {
          event.preventDefault();
          if (current?.id !== id) return;
          finish();
          reject(new Error(event.message || "The sandbox failed."));
        };
        worker.onmessage = ({ data }) => {
          if (data.id !== current?.id) return;
          finish();
          if (data.error) reject(Object.assign(new Error(data.error.message), { line: data.error.line, logs: data.logs }));
          else resolve({ value: data.value, logs: data.logs });
        };
        try {
          worker.postMessage({ id, code, inputs });
        } catch (error) {
          finish();
          const name = Object.keys(inputs).find((key) => {
            try {
              structuredClone(inputs[key]);
              return false;
            } catch {
              return true;
            }
          });
          reject(new Error(name ? `${name} can't be sent to the sandbox: ${error.message}` : error.message));
        }
      });
    },
    dispose() {
      finish();
      kill();
    },
  };
}

registerEngine("js", jsEngine);
