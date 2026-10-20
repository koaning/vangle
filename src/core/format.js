// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export const formats = {
  percent: (v) => `${fixNegZero(Math.round(v * 100).toString())}%`,
  dollars: (v) => `$${fixNegZero(Math.round(v).toLocaleString("en-US"))}`,
  int: (v) => fixNegZero(Math.round(v).toString()),
};

export function registerFormat(name, fn) {
  formats[name] = fn;
}

function fixNegZero(s) {
  return /^-[0.,]*$/.test(s) ? s.slice(1) : s;
}

export function decimals(step) {
  return (String(step).split(".")[1] || "").length;
}

function printf(fmt, value) {
  return fmt.replace(/%([+,]*)(?:\.(\d+))?([dfs%])/g, (_, flags, precision, conv) => {
    if (conv === "%") return "%";
    if (conv === "s") return String(value);
    const digits = conv === "d" ? 0 : precision != null ? Number(precision) : 6;
    const n = conv === "d" ? Math.round(value) : value;
    let s = flags.includes(",")
      ? n.toLocaleString("en-US", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        })
      : n.toFixed(digits);
    s = fixNegZero(s);
    if (flags.includes("+") && !s.startsWith("-")) s = `+${s}`;
    return s;
  });
}

function defaultNumber(value, digits) {
  if (digits != null) return fixNegZero(value.toFixed(digits));
  if (Number.isInteger(value)) return String(value);
  if (Math.abs(value) >= 1000) return fixNegZero(Math.round(value).toString());
  return fixNegZero(String(Number(value.toPrecision(4))));
}

/**
 * Format a value for display.
 * `fmt` is a named format ("percent") or printf-lite ("%.2f", "$%,d", "%+.1f km").
 * Without a format, numbers are rounded to the precision of `step` (if given).
 */
export function formatValue(value, fmt, step) {
  if (value === undefined || value === null) return "…";
  if (fmt && formats[fmt]) return String(formats[fmt](value));
  if (typeof value !== "number") {
    return fmt && fmt.includes("%s") ? printf(fmt, value) : String(value);
  }
  if (Number.isNaN(value)) return "–";
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "-∞";
  if (fmt) return printf(fmt, value);
  return defaultNumber(value, step != null ? decimals(step) : null);
}

// ---------------------------------------------------------------------------
// Numeric constraints
// ---------------------------------------------------------------------------

export function limits(meta) {
  return {
    min: meta.min ?? -Infinity,
    max: meta.max ?? Infinity,
    step: meta.step ?? 1,
  };
}

function roundForStep(value, step) {
  return Number(value.toFixed(Math.min(20, decimals(step) + 2)));
}

/** Clamp to [min, max] and snap to the step grid (anchored at min when finite). */
export function snap(value, meta) {
  const { min, max, step } = limits(meta);
  const base = Number.isFinite(min) ? min : 0;
  const snapped = base + Math.round((value - base) / step) * step;
  return roundForStep(Math.max(min, Math.min(max, snapped)), step);
}

export function nudge(value, delta, meta) {
  const { min, max, step } = limits(meta);
  return roundForStep(Math.max(min, Math.min(max, value + delta)), step);
}

export function parseNumber(text) {
  const n = parseFloat(String(text).replace(/[^\d.eE+-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}
