import { compile } from "./scope.js";
import { parseTex, matchClose, skipSpace } from "./tex.js";
import { dagCycle, dagLayers, dagOrder } from "./dag.js";

// ---------------------------------------------------------------------------
// The spec of a <t-formula-dag>: formulas that refer to each other's outputs
// with \use{name}, notes, and parameters. Checked and turned into a model the
// element draws, with the layout already worked out. No DOM here.
// ---------------------------------------------------------------------------

// Formula and note names end up inside \htmlData{key=name}, so keep them plain.
const DAG_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const DAG_NOTE_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
// \use{name}, and an exponent right after it (see cardTex).
const DAG_USE_RE = /\\use\s*\{([^}]*)\}(\^(?:\{[^{}]*\}|[^{}\s\\]))?/g;
const DAG_MARKER_RE = /\\(use|tangle|val|note)(?![A-Za-z])/;
const DAG_PALETTE_SIZE = 8; // --tangle-dag-1 … --tangle-dag-8
const DAG_SPEC_KEYS = ["formulas", "notes", "params", "legend", "reset"];
const DAG_FORMULA_KEYS = ["tex", "symbol", "label", "value", "format", "color", "row"];
const DAG_NOTE_KEYS = ["text", "side", "color"];
const DAG_PARAM_KEYS = ["value", "min", "max", "step", "pixelsPerStep", "label", "format", "color", "symbol"];
const DAG_SIDES = ["auto", "top", "bottom"];

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Split `tex` at its first top-level "=" into [lhs, rest]. Top-level means
 * outside any {…} group, so the "=" in \sum_{i=1} doesn't count. Null when
 * there is no such "=" or nothing before it.
 */
export function splitLhs(tex) {
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    const ch = tex[i];
    if (ch === "\\") {
      i++; // \{ \} \= are not groups or splits
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
    } else if (ch === "=" && depth === 0) {
      const lhs = tex.slice(0, i).trim();
      return lhs ? [lhs, tex.slice(i + 1)] : null;
    }
  }
  return null;
}

/** Throw unless every { in `tex` has its } (KaTeX's own message wouldn't say which formula). */
function checkBraces(tex) {
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    if (tex[i] === "\\") i++;
    else if (tex[i] === "{") depth++;
    else if (tex[i] === "}" && --depth < 0) throw new Error('a "}" has no matching "{"');
  }
  if (depth) throw new Error('a "{" is never closed');
}

/** The \note{name}{body} at `start` (where "\note" begins): its name and where its body ends. */
function noteAt(tex, start) {
  const i = skipSpace(tex, start + "\\note".length);
  if (tex[i] !== "{") throw new Error("\\note must be followed by {name}{tex}");
  const nameEnd = matchClose(tex, i, "{", "}");
  const j = skipSpace(tex, nameEnd + 1);
  if (tex[j] !== "{") throw new Error("\\note must be followed by {name}{tex}");
  const bodyEnd = matchClose(tex, j, "{", "}");
  return { name: tex.slice(i + 1, nameEnd).trim(), bodyStart: j + 1, bodyEnd };
}

/** Replace every \note{name}{body} in `tex` with fn(name, body), inner notes first. */
function mapNotes(tex, fn) {
  const re = /\\note(?![A-Za-z])/g;
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(tex))) {
    const { name, bodyStart, bodyEnd } = noteAt(tex, m.index);
    out += tex.slice(last, m.index) + fn(name, mapNotes(tex.slice(bodyStart, bodyEnd), fn));
    last = bodyEnd + 1;
    re.lastIndex = last;
  }
  return out + tex.slice(last);
}

/** `tex` with every \note{name}{body} unwrapped to just its body. */
export function stripNotes(tex) {
  return mapNotes(tex, (_, body) => body);
}

/** The name of the note when `tex` is exactly one \note{name}{…}, else null. */
export function wholeNote(tex) {
  const t = tex.trim();
  if (!/^\\note(?![A-Za-z])/.test(t)) return null;
  const { name, bodyEnd } = noteAt(t, 0);
  return bodyEnd === t.length - 1 ? name : null;
}

/** A name as TeX, for a symbol nobody gave: x stays x, rate becomes \mathrm{rate}. */
function nameTex(name) {
  return /^[A-Za-z]$/.test(name) ? name : `\\mathrm{${name.replace(/_/g, "\\_")}}`;
}

/** A color option: "a b" is a in light mode and b in dark mode. */
function dagColor(color) {
  const pair = color.trim().split(/\s+/);
  return pair.length === 2 ? `light-dark(${pair[0]}, ${pair[1]})` : color.trim();
}

function checkKeys(obj, allowed, what) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw new Error(`${what}: unknown key "${key}" (use ${allowed.join(", ")})`);
  }
}

/**
 * Check a <t-formula-dag> spec and work out its layout. Throws an Error
 * saying what's wrong. Returns { formulas, edges, layers, routes, notes,
 * params, legend, reset }:
 * - formulas: [{ name, tex, lhs, body, symbol, label, value, format, color, outNote, row, uses }]
 *   in spec order. `lhs` is TeX (notes expanded) or null; `body` is the parsed
 *   right-hand side; `color` is a CSS color for formulas others use, else null.
 * - edges: [producer, consumer] pairs, once each, in the order the uses appear.
 * - layers, routes: from dagOrder, top to bottom. A formula sits one row below
 *   the deepest formula it uses, or lower if its `row` says so.
 * - notes: { name: { text, side, color, formula, param } }, `param` set when
 *   the note wraps exactly one \tangle.
 * - params: [{ name, symbol, config }] for every \tangle, the spec's params first.
 */
export function formulaDag(spec) {
  try {
    return buildFormulaDag(spec);
  } catch (error) {
    throw new Error(`t-formula-dag: ${error.message}`);
  }
}

function buildFormulaDag(spec) {
  if (!isPlainObject(spec)) throw new Error("the spec must be an object, like { formulas: { … } }");
  checkKeys(spec, DAG_SPEC_KEYS, "the spec");
  if (!isPlainObject(spec.formulas) || !Object.keys(spec.formulas).length) {
    throw new Error("formulas must be a non-empty object of names to TeX");
  }
  for (const key of ["legend", "reset"]) {
    if (spec[key] !== undefined && typeof spec[key] !== "boolean") throw new Error(`${key} must be true or false`);
  }
  const names = Object.keys(spec.formulas);
  const known = new Set(names);
  const noteHome = new Map(); // note -> the formula it's marked in
  const noteParam = new Map(); // note -> the parameter it wraps
  const paramSymbol = new Map(); // parameter -> its first \tangle[symbol], in order of appearance

  const formulas = names.map((name) => {
    if (!DAG_NAME_RE.test(name)) {
      throw new Error(`formula name "${name}" must start with a letter and use only letters, digits and _`);
    }
    let f = spec.formulas[name];
    if (typeof f === "string") f = { tex: f };
    if (!isPlainObject(f)) throw new Error(`formula "${name}" must be a TeX string or an object with tex`);
    checkKeys(f, DAG_FORMULA_KEYS, `formula "${name}"`);
    if (typeof f.tex !== "string" || !f.tex.trim()) throw new Error(`formula "${name}" needs a non-empty tex string`);
    try {
      return parseFormula(name, f);
    } catch (error) {
      throw new Error(`formula "${name}": ${error.message}`);
    }
  });

  function parseFormula(name, f) {
    checkBraces(f.tex);
    const split = splitLhs(f.tex);
    const [lhsTex, rhsTex] = split ?? [null, f.tex];
    if (lhsTex && /\\(use|tangle|val)(?![A-Za-z])/.test(lhsTex)) {
      throw new Error("the left of its = can't hold \\use, \\tangle or \\val");
    }
    const symbol = f.symbol ?? (lhsTex ? stripNotes(lhsTex) : nameTex(name));
    const label = f.label ?? name;
    for (const [key, v] of [["symbol", symbol], ["label", label]]) {
      if (typeof v !== "string" || !v.trim()) throw new Error(`${key} must be a non-empty string`);
    }
    if (DAG_MARKER_RE.test(symbol)) throw new Error("symbol can't hold \\use, \\tangle, \\val or \\note");
    if (f.value !== undefined && typeof f.value !== "string" && typeof f.value !== "function") {
      throw new Error("value must be an expression string or a function");
    }
    if (typeof f.value === "string") compile(f.value); // surface syntax errors now
    if (f.format !== undefined && typeof f.format !== "string") throw new Error("format must be a string");
    if (f.color !== undefined && (typeof f.color !== "string" || !f.color.trim())) {
      throw new Error("color must be a CSS color, or two: light and dark");
    }
    if (f.row !== undefined && !(Number.isInteger(f.row) && f.row >= 0)) {
      throw new Error("row must be a whole number, 0 or more (0 is the top row)");
    }

    const expand = (tex) =>
      mapNotes(tex, (note, body) => {
        if (!DAG_NOTE_NAME_RE.test(note)) {
          throw new Error(`note name "${note}" must start with a letter and use only letters, digits, _ and -`);
        }
        const home = noteHome.get(note);
        if (home && home !== name) throw new Error(`note "${note}" is marked in more than one formula: ${home}, ${name}`);
        noteHome.set(note, name);
        const inner = parseTex(body.trim());
        if (inner.length === 1 && inner[0].type === "param") noteParam.set(note, inner[0].name);
        return `\\htmlData{note=${note}}{${body}}`;
      });
    const lhs = lhsTex ? expand(lhsTex) : null;
    const body = parseTex(expand(rhsTex));

    const uses = [];
    for (const part of body) {
      if (typeof part !== "string") {
        if (part.type === "param" && !paramSymbol.get(part.name)) paramSymbol.set(part.name, part.symbol);
        continue;
      }
      for (const [, used] of part.matchAll(DAG_USE_RE)) {
        const u = used.trim();
        if (u === name) throw new Error(`it can't \\use{${u}} itself`);
        if (!known.has(u)) throw new Error(`\\use{${u}}: there is no formula "${u}"`);
        if (!uses.includes(u)) uses.push(u);
      }
    }
    return {
      name,
      tex: f.tex,
      lhs,
      body,
      symbol,
      label,
      value: f.value ?? null,
      format: f.format ?? null,
      color: f.color === undefined ? null : dagColor(f.color),
      outNote: lhsTex ? wholeNote(lhsTex) : null,
      row: f.row ?? 0,
      uses,
    };
  }

  const edges = [];
  for (const f of formulas) for (const u of f.uses) edges.push([u, f.name]);
  const cycle = dagCycle(names, edges);
  if (cycle) throw new Error(`formulas must not form a cycle: ${cycle.join(" -> ")}`);

  // Color means "this came from formula X": only producers get one.
  const producers = new Set(edges.map(([src]) => src));
  let next = 0;
  for (const f of formulas) {
    if (!producers.has(f.name)) continue;
    const index = next++;
    f.color ??= `var(--tangle-dag-${(index % DAG_PALETTE_SIZE) + 1})`;
  }

  // Notes: one for every \note marker, and no others.
  const rawNotes = spec.notes ?? {};
  if (!isPlainObject(rawNotes)) throw new Error("notes must be an object of names to text");
  const notes = {};
  for (const [name, raw] of Object.entries(rawNotes)) {
    const n = typeof raw === "string" ? { text: raw } : raw;
    if (!isPlainObject(n)) throw new Error(`note "${name}" must be text or an object with text`);
    checkKeys(n, DAG_NOTE_KEYS, `note "${name}"`);
    if (typeof n.text !== "string" || !n.text.trim()) throw new Error(`note "${name}" needs some text`);
    const side = n.side ?? "auto";
    if (!DAG_SIDES.includes(side)) throw new Error(`note "${name}": side must be ${DAG_SIDES.join(", ")}`);
    if (n.color !== undefined && (typeof n.color !== "string" || !n.color.trim())) {
      throw new Error(`note "${name}": color must be a CSS color, or two: light and dark`);
    }
    if (!noteHome.has(name)) throw new Error(`note "${name}" isn't marked with \\note{${name}}{…} in any formula`);
    notes[name] = {
      text: n.text,
      side,
      color: n.color === undefined ? null : dagColor(n.color),
      formula: noteHome.get(name),
      param: noteParam.get(name) ?? null,
    };
  }
  for (const name of noteHome.keys()) {
    if (!notes[name]) throw new Error(`\\note{${name}} has no text: add notes: { ${name}: "…" }`);
  }

  // Parameters: every \tangle; the spec may configure them.
  const rawParams = spec.params ?? {};
  if (!isPlainObject(rawParams)) throw new Error("params must be an object of names to settings");
  for (const [name, config] of Object.entries(rawParams)) {
    if (!paramSymbol.has(name)) throw new Error(`params.${name}: no formula has \\tangle{${name}}`);
    if (!isPlainObject(config)) throw new Error(`params.${name} must be an object like { value: 1, min: 0 }`);
    checkKeys(config, DAG_PARAM_KEYS, `params.${name}`);
  }
  for (const name of paramSymbol.keys()) {
    if (known.has(name)) throw new Error(`"${name}" is both a formula and a \\tangle parameter: rename one`);
  }
  const order = [...Object.keys(rawParams), ...[...paramSymbol.keys()].filter((p) => !(p in rawParams))];
  const params = order.map((name) => {
    const { symbol, ...config } = rawParams[name] ?? {};
    return { name, symbol: symbol ?? paramSymbol.get(name) ?? nameTex(name), config };
  });

  const minRows = new Map(formulas.map((f) => [f.name, f.row]));
  const { layers, routes } = dagOrder(names, dagLayers(names, edges, minRows), edges);
  return {
    formulas,
    edges,
    layers,
    routes,
    notes,
    params,
    legend: spec.legend ?? true,
    reset: spec.reset ?? true,
  };
}

/**
 * The TeX a formula's card shows right now. `ctx` supplies:
 * - symbol(name): a formula's output symbol;
 * - revealed(name): whether a formula shows its value instead;
 * - valueTex(name): that value as TeX;
 * - markers(parts, text): TeX for parsed parts, mapping literal strings with `text`.
 * Each \use{name} becomes the producer's symbol (or value), wrapped in
 * \htmlData{fdag-use=name}; the output symbol is wrapped in fdag-out.
 */
export function cardTex(f, ctx) {
  // An exponent right after a subscripted symbol (\use{vy}^2 with v_y) moves
  // inside it, so KaTeX stacks v_y^2 instead of raising the 2 over all of v_y.
  const text = (s) =>
    s.replace(DAG_USE_RE, (_, used, sup = "") => {
      const name = used.trim();
      const symbol = ctx.symbol(name);
      const content = ctx.revealed(name) ? ctx.valueTex(name) : symbol;
      const absorb = sup && symbol.includes("_") && !symbol.includes("^");
      return absorb
        ? `\\htmlData{fdag-use=${name}}{${content}${sup}}`
        : `\\htmlData{fdag-use=${name}}{${content}}${sup}`;
    });
  let tex = ctx.markers(f.body, text);
  const live = ctx.revealed(f.name);
  if (f.lhs) {
    // A note wrapping the whole output stays on the value, so it still points at something.
    let out = f.lhs;
    if (live) out = f.outNote ? `\\htmlData{note=${f.outNote}}{${ctx.valueTex(f.name)}}` : ctx.valueTex(f.name);
    tex = `\\htmlData{fdag-out=${f.name}}{${out}} =${tex}`;
  } else if (live) {
    // No output symbol to replace: close the formula with its value.
    tex += ` = \\htmlData{fdag-value=${f.name}}{${ctx.valueTex(f.name)}}`;
  }
  return tex;
}

/** Note text as pieces: { text } plain, { bold } for **bold**, { math } for $tex$. */
export function noteParts(text) {
  const parts = [];
  text.split(/\$([^$]+)\$/).forEach((piece, i) => {
    if (i % 2) return parts.push({ math: piece });
    piece.split(/\*\*(.+?)\*\*/).forEach((t, j) => {
      if (t) parts.push(j % 2 ? { bold: t } : { text: t });
    });
  });
  return parts;
}

/**
 * The variables `name` reads, directly or through the formulas it reads, as
 * a Set. Only what it read the last time it ran: call scope.get(name) first.
 */
export function variablesRead(scope, name) {
  const names = new Map(); // a variable's def signal and cell -> its name
  for (const [n, slot] of scope.slots) {
    names.set(slot.def, n);
    names.set(slot.cell, n);
  }
  const out = new Set();
  const seen = new Set();
  const walk = (node) => {
    for (const dep of node.deps ?? []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      const n = names.get(dep);
      if (n !== undefined && n !== name) out.add(n);
      walk(dep);
    }
  };
  walk(scope.slot(name).cell);
  return out;
}
