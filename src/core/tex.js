import { NAME_RE, compile } from "./scope.js";
import { formatValue } from "./format.js";
import { active, keyOf } from "./interaction.js";

// ---------------------------------------------------------------------------
// TeX markers: \tangle[symbol]{name} and \val[format]{expression}
// ---------------------------------------------------------------------------

/** The index of the bracket that closes the one at `start` (skipping backslash escapes). */
export function matchClose(src, start, open, close) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i;
  }
  throw new Error(`Unbalanced "${open}" at position ${start}`);
}

export function skipSpace(src, i) {
  while (i < src.length && /\s/.test(src[i])) i++;
  return i;
}

/** Split TeX source into literal strings and marker objects. */
export function parseTex(src) {
  const parts = [];
  const re = /\\(tangle|val)(?![A-Za-z])/g;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    let i = skipSpace(src, m.index + m[0].length);
    let option = null;
    if (src[i] === "[") {
      const end = matchClose(src, i, "[", "]");
      option = src.slice(i + 1, end).trim();
      i = skipSpace(src, end + 1);
    }
    if (src[i] !== "{") throw new Error(`\\${m[1]} must be followed by {…}`);
    const end = matchClose(src, i, "{", "}");
    const body = src.slice(i + 1, end).trim();
    if (src.slice(last, m.index)) parts.push(src.slice(last, m.index));
    if (m[1] === "tangle") {
      if (!NAME_RE.test(body)) throw new Error(`\\tangle{${body}}: not a valid variable name`);
      parts.push({ type: "param", name: body, symbol: option || null });
    } else {
      compile(body); // surface syntax errors early
      parts.push({ type: "val", expr: body, format: option || null });
    }
    last = end + 1;
    re.lastIndex = last;
  }
  if (src.slice(last)) parts.push(src.slice(last));
  return parts;
}

const TEXT_ESCAPES = {
  "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", $: "\\$", "%": "\\%",
  "#": "\\#", "&": "\\&", _: "\\_", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}",
};

/** Turn a value into TeX: numbers stay math, anything wordy becomes \text{…}. */
export function toTex(value, fmt, step) {
  const s = formatValue(value, fmt, step);
  if (typeof value !== "number" || /[A-Za-z\s]/.test(s)) {
    return `\\text{${s.replace(/[\\{}$%#&_~^]/g, (c) => TEXT_ESCAPES[c])}}`;
  }
  return s
    .replace(/[\\{}$%#&_~^]/g, (c) => (c === "~" || c === "^" ? "" : `\\${c}`))
    .replace(/,/g, "{,}")
    .replace(/∞/g, "\\infty ");
}

/**
 * The TeX for parsed parts (from parseTex) right now: \tangle markers show
 * their variable's value (or their symbol, unless being dragged or edited) and
 * \val markers their result. `text` maps the literal strings in between.
 * Reactive: inside an effect, re-runs when a value it showed changes.
 */
export function partsTex(parts, scope, text = (s) => s) {
  let tex = "";
  for (const part of parts) {
    if (typeof part === "string") {
      tex += text(part);
    } else if (part.type === "param") {
      const meta = scope.meta(part.name);
      const value = scope.get(part.name);
      const shown =
        !part.symbol || active.value === keyOf(scope, part.name)
          ? toTex(value, meta.format, meta.step)
          : part.symbol;
      tex += `\\htmlData{tangle-param=${part.name}}{${shown}}`;
    } else {
      let shown;
      try {
        shown = toTex(scope.eval(part.expr), part.format);
      } catch {
        shown = "\\text{?}";
      }
      tex += `\\htmlClass{tangle-val}{${shown}}`;
    }
  }
  return tex;
}
