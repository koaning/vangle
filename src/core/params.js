// ---------------------------------------------------------------------------
// Function signatures: what tangleCall() reads from a JavaScript function.
// ---------------------------------------------------------------------------

/** Split a parameter list on top-level commas, from the "(" at `open` to its ")". */
function splitParams(src, open) {
  const parts = [];
  let depth = 0;
  let last = open + 1;
  for (let i = open + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === "\\") i++;
    } else if (ch === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      if (i < 0) break;
    } else if (ch === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i) + 1;
      if (i <= 0) break;
    } else if ("([{".includes(ch)) {
      depth++;
    } else if (")]}".includes(ch) && depth-- === 0) {
      parts.push(src.slice(last, i));
      return parts.map((p) => p.trim()).filter(Boolean);
    } else if (ch === "," && depth === 0) {
      parts.push(src.slice(last, i));
      last = i + 1;
    }
  }
  throw new Error("Unbalanced parameter list");
}

/**
 * Read a function's parameters and evaluate their defaults:
 * `function f(a = 1, b = "x", c)` gives `[{ name: "a", value: 1, hasDefault: true }, …]`.
 * Defaults must evaluate to a number, string or boolean on their own.
 */
export function parseParams(fn) {
  const src = Function.prototype.toString.call(fn);
  const bare = /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(src);
  const open = src.indexOf("(");
  if (!bare && open < 0) throw new Error("Can't find the parameter list");
  const parts = bare ? [bare[1]] : splitParams(src, open);
  return parts.map((part) => {
    if (part.startsWith("...")) throw new Error(`Rest parameter "${part}" isn't supported`);
    if (/^[[{]/.test(part)) throw new Error(`Destructured parameter "${part}" isn't supported`);
    const m = /^([A-Za-z_$][\w$]*)\s*(?:=([\s\S]*))?$/.exec(part);
    if (!m) throw new Error(`Can't read parameter "${part}"`);
    const [, name, expr] = m;
    if (expr === undefined) return { name, value: undefined, hasDefault: false };
    let value;
    try {
      value = new Function(`return (${expr}\n);`)();
    } catch (error) {
      throw new Error(`Can't evaluate the default of "${name}": ${error.message}`);
    }
    if (!["number", "string", "boolean"].includes(typeof value)) {
      throw new Error(`The default of "${name}" must be a number, string or boolean`);
    }
    return { name, value, hasDefault: true };
  });
}
