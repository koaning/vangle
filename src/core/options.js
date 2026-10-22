// ---------------------------------------------------------------------------
// Options, for <t-choice> and <t-select>
// ---------------------------------------------------------------------------

/**
 * Parse options="yearly:1, monthly:12" into `[{ label, value }]`. Without a
 * `:value` the label is the value; numeric values become numbers, and true
 * and false become booleans.
 */
export function parseOptions(text) {
  return text.split(",").map((raw) => {
    const [label, value = label] = raw.split(":").map((s) => s.trim());
    if (value === "true" || value === "false") return { label, value: value === "true" };
    return { label, value: value !== "" && Number.isFinite(Number(value)) ? Number(value) : value };
  });
}

/**
 * The options whose label contains `query`, ignoring case: labels that start
 * with it first, then labels with a word that starts with it, then the rest.
 */
export function filterOptions(options, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [...options];
  const rank = (label) => {
    let at = label.indexOf(q);
    if (at <= 0) return at;
    for (; at > 0; at = label.indexOf(q, at + 1)) if (!/[\p{L}\p{N}]/u.test(label[at - 1])) return 1;
    return 2;
  };
  const groups = [[], [], []];
  for (const option of options) {
    const r = rank(String(option.label).toLowerCase());
    if (r >= 0) groups[r].push(option);
  }
  return groups.flat();
}
