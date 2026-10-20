import { Signal, untracked } from "./signals.js";
import { scopeOf } from "./scope.js";
import { limits, nudge, formatValue, snap } from "./format.js";
import { filterOptions } from "./options.js";
import { config } from "./load.js";

// ---------------------------------------------------------------------------
// Interaction: one document-level controller for every draggable number,
// whether it is a <t-num> in prose or a \tangle{} inside a formula.
// Drags are keyed by variable name (not element) so they survive KaTeX
// re-rendering the DOM underneath the pointer.
// ---------------------------------------------------------------------------

export const PARAM = "[data-tangle-param]";
export const hover = new Signal(null); // "scopeId:name" under the pointer
export const active = new Signal(null); // "scopeId:name" being dragged or edited
export const keyOf = (scope, name) => `${scope.id}:${name}`;

let drag = null;
let editor = null;

function paramOf(el) {
  return { scope: scopeOf(el), name: el.dataset.tangleParam };
}

export function occurrence(el) {
  const host = el.closest("t-math");
  if (!host) return { el, host: null, index: -1 };
  const all = [...host.querySelectorAll(`.katex-html [data-tangle-param="${el.dataset.tangleParam}"]`)];
  return { el, host, index: all.indexOf(el) };
}

/** Find the element again: the original one, or its re-rendered twin. */
export function relocate({ el, host, index }, name) {
  if (el.isConnected || !host) return el;
  return host.querySelectorAll(`.katex-html [data-tangle-param="${name}"]`)[index] ?? null;
}

export function decorate(el, scope, name) {
  const meta = scope.slot(name).meta.peek();
  const value = scope.peek(name);
  el.tabIndex = 0;
  el.setAttribute("role", "slider");
  el.setAttribute("aria-label", meta.label ?? name);
  if (typeof value === "number") el.setAttribute("aria-valuenow", value);
  if (meta.min != null) el.setAttribute("aria-valuemin", meta.min);
  if (meta.max != null) el.setAttribute("aria-valuemax", meta.max);
  if (meta.color) el.style.setProperty("--tangle-color", meta.color);
  else el.style.removeProperty("--tangle-color");
}

function onPointerDown(event) {
  const el = event.target.closest?.(PARAM);
  if (!el || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  closeEditor(true);
  const { scope, name } = paramOf(el);
  drag = {
    scope,
    name,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    startX: event.clientX,
    startValue: Number(scope.peek(name)) || 0,
    moved: false,
    where: occurrence(el),
  };
  try {
    document.documentElement.setPointerCapture(event.pointerId);
  } catch {}
  document.documentElement.classList.add("tangle-dragging");
  active.value = keyOf(scope, name);
  hover.value = keyOf(scope, name);
}

function onPointerMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dx = event.clientX - drag.startX;
  if (!drag.moved && Math.abs(dx) < 3) return;
  drag.moved = true;
  event.preventDefault();
  const meta = drag.scope.slot(drag.name).meta.peek();
  const { step } = limits(meta);
  const pps = meta.pixelsPerStep ?? config.pixelsPerStep;
  drag.scope.set(drag.name, nudge(drag.startValue, Math.trunc(dx / pps) * step, meta));
}

function onPointerUp(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const finished = drag;
  drag = null;
  document.documentElement.classList.remove("tangle-dragging");
  if (finished.pointerType !== "mouse") hover.value = null;
  if (event.type === "pointercancel" || finished.moved) {
    active.value = null;
    return;
  }
  const el = relocate(finished.where, finished.name);
  if (el) openEditor(el);
  else active.value = null;
}

function onPointerOver(event) {
  if (drag) return;
  // A <t-debug> row names its variable's key itself: it isn't in that variable's scope.
  const el = event.target.closest?.(`${PARAM}, [data-tangle-hover]`);
  hover.value = !el ? null : (el.dataset.tangleHover ?? keyOf(scopeOf(el), el.dataset.tangleParam));
}

function onKeyDown(event) {
  const el = event.target.closest?.(PARAM);
  if (!el || event.altKey || event.metaKey || event.ctrlKey) return;
  const { scope, name } = paramOf(el);
  const meta = scope.slot(name).meta.peek();
  const { min, max, step } = limits(meta);
  const value = Number(scope.peek(name)) || 0;
  const big = event.shiftKey ? 10 : 1;
  let next;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowUp":
      next = nudge(value, step * big, meta);
      break;
    case "ArrowLeft":
    case "ArrowDown":
      next = nudge(value, -step * big, meta);
      break;
    case "Home":
      if (Number.isFinite(min)) next = min;
      break;
    case "End":
      if (Number.isFinite(max)) next = max;
      break;
    case "Enter":
    case " ":
      event.preventDefault();
      openEditor(el);
      return;
    default:
      return;
  }
  event.preventDefault();
  if (next !== undefined) scope.set(name, next);
}

// Click without dragging (or press Enter) to type a value. Accepts numbers
// ("1,250") or expressions over the scope ("2 * Math.PI", "cookies + 1").
// A <t-text> opens it in text mode, which keeps whatever is typed.
export function openEditor(el, { text = false } = {}) {
  closeEditor(false);
  const scope = scopeOf(el);
  const name = text ? el.getAttribute("name") : el.dataset.tangleParam;
  const meta = scope.slot(name).meta.peek();
  const value = scope.peek(name);
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = text ? "text" : "decimal";
  input.className = text ? "tangle-editor is-text" : "tangle-editor";
  input.setAttribute("aria-label", `Set ${meta.label ?? name}`);
  if (text) input.value = value == null ? "" : String(value);
  else input.value = typeof value === "number" ? formatValue(value, null, meta.step) : "";
  if (meta.color) input.style.setProperty("--tangle-color", meta.color);
  document.body.append(input);
  placeBelow(input, el);
  editor = { input, scope, name, meta, text, where: occurrence(el) };
  active.value = keyOf(scope, name);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      closeEditor(true, { strict: true });
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeEditor(false);
    }
  });
  input.addEventListener("blur", () => closeEditor(true));
  input.focus();
  input.select();
}

function closeEditor(commit, { strict = false } = {}) {
  if (!editor) return;
  const ed = editor;
  if (commit && ed.text) {
    ed.scope.set(ed.name, ed.input.value);
  } else if (commit) {
    const text = ed.input.value.trim();
    let next = Number(text.replace(/,/g, ""));
    if (text === "" || !Number.isFinite(next)) {
      try {
        next = Number(untracked(() => ed.scope.eval(text)));
      } catch {
        next = NaN;
      }
    }
    if (Number.isFinite(next)) {
      ed.scope.set(ed.name, snap(next, ed.meta));
    } else if (strict) {
      ed.input.classList.add("is-invalid");
      ed.input.setAttribute("aria-invalid", "true");
      ed.input.select();
      return;
    }
  }
  editor = null;
  const refocus = document.activeElement === ed.input;
  ed.input.remove();
  active.value = null;
  if (refocus) {
    // After the value lands (and any formula re-renders), return focus.
    queueMicrotask(() => relocate(ed.where, ed.name)?.focus({ preventScroll: true }));
  }
}

/** Centers a popup (already on the page) just under `el`, keeping it inside the window. */
function placeBelow(popup, el) {
  const rect = el.getBoundingClientRect();
  const half = popup.offsetWidth / 2;
  const right = document.documentElement.clientWidth - half - 8;
  const center = Math.max(half + 8, Math.min(rect.left + rect.width / 2, right));
  popup.style.left = `${center + window.scrollX}px`;
  popup.style.top = `${rect.bottom + window.scrollY + 6}px`;
}

// A <t-select> opens a menu: a search field over its options. Typing filters
// them, the arrow keys move the highlight, and Enter or a click picks one.
export let menu = null;
let menuCount = 0;

export function openMenu(el, options, query = "") {
  closeMenu();
  const scope = scopeOf(el);
  const name = el.getAttribute("name");
  const meta = scope.slot(name).meta.peek();
  const box = document.createElement("div");
  box.className = "tangle-menu";
  if (meta.color) box.style.setProperty("--tangle-color", meta.color);
  const input = document.createElement("input");
  Object.assign(input, { type: "text", value: query, placeholder: "Search…", autocomplete: "off", spellcheck: false });
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-label", `Search ${meta.label ?? name}`);
  const list = document.createElement("ul");
  list.id = `tangle-menu-${++menuCount}`;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", meta.label ?? name);
  input.setAttribute("aria-controls", list.id);
  box.append(input, list);
  document.body.append(box);
  menu = { el, box, input, list, options, scope, name, shown: [], index: -1 };
  el.setAttribute("aria-expanded", "true");
  renderMenu();
  placeBelow(box, el);
  input.addEventListener("input", () => renderMenu());
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") highlight(menu.index + 1);
    else if (event.key === "ArrowUp") highlight(menu.index - 1);
    else if (event.key === "Enter") closeMenu(true);
    else if (event.key === "Escape" || event.key === "Tab") closeMenu();
    else return;
    event.preventDefault();
  });
  input.addEventListener("blur", () => closeMenu());
  // Keep the focus in the search field while the pointer picks.
  list.addEventListener("pointerdown", (event) => event.preventDefault());
  list.addEventListener("pointermove", (event) => {
    const row = event.target.closest("[role=option]");
    if (row) highlight([...list.children].indexOf(row), false);
  });
  list.addEventListener("click", (event) => {
    if (event.target.closest("[role=option]")) closeMenu(true);
  });
  input.focus();
}

/** Shows the options that match the search, highlighting the first, or else the current one. */
function renderMenu() {
  const { input, list, options, scope, name } = menu;
  const query = input.value;
  const current = scope.peek(name);
  menu.shown = filterOptions(options, query);
  list.replaceChildren(
    ...menu.shown.map((option, i) => {
      const row = document.createElement("li");
      row.id = `${list.id}-${i}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(Object.is(option.value, current)));
      row.textContent = option.label;
      return row;
    }),
  );
  if (!menu.shown.length) {
    const empty = document.createElement("li");
    empty.className = "tangle-menu-empty";
    empty.textContent = "No matches";
    list.append(empty);
  }
  highlight(query.trim() ? 0 : menu.shown.findIndex((o) => Object.is(o.value, current)));
}

function highlight(index, scroll = true) {
  const { input, list, shown } = menu;
  menu.index = shown.length ? Math.max(0, Math.min(index, shown.length - 1)) : -1;
  const rows = shown.length ? [...list.children] : [];
  rows.forEach((row, i) => row.classList.toggle("is-highlighted", i === menu.index));
  const row = rows[menu.index];
  if (row) input.setAttribute("aria-activedescendant", row.id);
  else input.removeAttribute("aria-activedescendant");
  // Scroll the list, not the page (scrollIntoView would scroll both).
  if (row && scroll) {
    const bottom = row.offsetTop + row.offsetHeight;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }
}

export function closeMenu(pick = false) {
  if (!menu) return;
  const m = menu;
  menu = null;
  const option = pick ? m.shown[m.index] : undefined;
  if (option) m.scope.set(m.name, option.value);
  const refocus = document.activeElement === m.input;
  m.box.remove();
  m.el.setAttribute("aria-expanded", "false");
  if (refocus) m.el.focus({ preventScroll: true });
}

export function syncClasses(el, scope, name) {
  const key = keyOf(scope, name);
  el.classList.toggle("is-hot", hover.peek() === key);
  el.classList.toggle("is-active", active.peek() === key);
}

// The document-level listeners behind all of the above. Called once, in a browser.
export function listen() {
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerUp);
  document.addEventListener("pointerover", onPointerOver);
  document.documentElement.addEventListener("pointerleave", () => {
    if (!drag) hover.value = null;
  });
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("dragstart", (event) => {
    if (event.target.closest?.(PARAM)) event.preventDefault();
  });
}
