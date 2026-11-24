import { untracked } from "../core/signals.js";
import { scopeOf } from "../core/scope.js";
import { formatValue } from "../core/format.js";
import { CodeElement } from "../core/code.js";

// Attributes whose live element the reader can change, and that are read back.
const LIVE = new Set(["value", "checked"]);

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);

// <t-tag tag='input type="range"'><t-num name="max">10</t-num>…</t-tag>
// Shows an HTML tag whose attributes the reader can change, with the live element
// below it. `tag` is the tag name plus any fixed attributes. Each named child is an
// attribute (`attr` overrides the name shown); a child marked `content`, or loose
// text, is what goes between the tags. A true/false value is a boolean attribute.
// It works both ways for `value` and `checked`: moving the slider or typing in the
// field below sets the variable behind that attribute.
export class TTag extends CodeElement {
  connectedCallback() {
    if (!this._tag) {
      const template = document.createElement("template");
      template.innerHTML = `<${this.getAttribute("tag") || "div"}>`;
      const el = template.content.firstElementChild;
      this._tag = {
        name: el?.localName ?? "div",
        attrs: el ? [...el.attributes].map((a) => [a.name, a.value]) : [],
      };
    }
    super.connectedCallback();
    const scope = scopeOf(this);
    if (!this._preview) {
      this._flags = this._els.map((el, i) => (el.localName === "t-choice" ? this.flag(el, i, scope) : null));
      this._preview = document.createElement("div");
      this._preview.className = "t-tag-preview";
      this._preview.addEventListener("input", () => this.sync(scope));
      this.append(this._preview);
    }
    this.watch(() => this.render(scope));
  }

  attrName(i) {
    return this._els[i].getAttribute("attr") ?? this._args[i];
  }

  // A boolean attribute shows as its bare name, which toggles it.
  flag(el, i, scope) {
    const flag = document.createElement("span");
    flag.className = "t-tag-flag";
    flag.hidden = true;
    flag.tabIndex = 0;
    flag.setAttribute("role", "switch");
    const toggle = () => scope.set(this._args[i], !scope.peek(this._args[i]));
    flag.addEventListener("click", toggle);
    flag.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    });
    el.before(flag);
    return flag;
  }

  // The reader changed the live element: copy its `value` and `checked` back into
  // the variables behind those attributes.
  sync(scope) {
    const el = this._preview.firstElementChild;
    if (!el || el.localName.includes("-")) return;
    this._els.forEach((_, i) => {
      const prop = this.attrName(i);
      if (i === this._content || !LIVE.has(prop) || !(prop in el)) return;
      const old = scope.peek(this._args[i]);
      let next = el[prop];
      if (typeof old === "number") next = Number(next);
      else if (typeof old === "boolean") next = Boolean(next);
      if (typeof next === "number" && !Number.isFinite(next)) return;
      scope.set(this._args[i], next);
    });
  }

  render(scope) {
    const { name, attrs } = this._tag;
    const want = new Map(attrs);
    const live = new Map();
    let text = this._text;
    let relayout = false;
    this._els.forEach((arg, i) => {
      const value = scope.get(this._args[i]);
      const meta = scope.meta(this._args[i]);
      const shown =
        typeof value === "number"
          ? formatValue(value, arg.getAttribute("format") ?? meta.format, meta.step)
          : value == null ? "" : String(value);
      const isBool = typeof value === "boolean" && i !== this._content && this._flags[i] !== null;
      relayout ||= isBool !== this._bool[i];
      this._bool[i] = isBool;
      const flag = this._flags[i];
      if (flag) untracked(() => {
        arg.hidden = isBool;
        flag.hidden = !isBool;
        flag.textContent = this.attrName(i);
        flag.classList.toggle("is-off", value === false);
        flag.setAttribute("aria-checked", String(value === true));
      });
      const attr = this.attrName(i);
      if (i === this._content) text = shown;
      else if (isBool) value ? want.set(attr, "") : want.delete(attr);
      else if (value !== undefined) want.set(attr, shown);
      if (i !== this._content && LIVE.has(attr) && value !== undefined) live.set(attr, isBool ? value : shown);
    });
    untracked(() => {
      // A plain element is updated in place, so a slider keeps being dragged and a
      // field keeps its focus. vangle's own elements are made anew, to read their attributes.
      const plain = !name.includes("-");
      let el = this._preview.firstElementChild;
      const reuse = plain && el?.localName === name;
      if (!reuse) el = document.createElement(name);
      for (const { name: key } of [...el.attributes]) if (!want.has(key)) el.removeAttribute(key);
      for (const [key, value] of want) if (el.getAttribute(key) !== value) el.setAttribute(key, value);
      if (!VOID_TAGS.has(name) && el.textContent !== text) el.textContent = text;
      if (plain) for (const [key, value] of live) if (key in el && el[key] !== value) el[key] = value;
      if (!reuse) this._preview.replaceChildren(el);
      if (relayout) this.layout();
    });
  }

  syntax(multiline) {
    const { name, attrs } = this._tag;
    const space = multiline ? "\n    " : " ";
    const attr = (key, value) =>
      value === "" ? [["attr", key]] : [["attr", key], ["punct", "="], ["string", `"${value}"`]];
    const end = [multiline ? "\n" : "", ["punct", ">"]];
    const close = VOID_TAGS.has(name) ? [] : [["punct", "</"], ["tag", name], ["punct", ">"]];
    this._content ??= this._els.findIndex((el) => el.hasAttribute("content"));
    this._bool ??= this._els.map(() => false);
    return {
      open: [["punct", "<"], ["tag", name], ...attrs.flatMap(([key, value]) => [space, ...attr(key, value)])],
      key: (i) =>
        i === this._content ? end
        : this._bool[i] ? [space]
        : [space, ["attr", this.attrName(i)], ["punct", "="], ["string", '"']],
      sep: (i) => (i === this._content || this._bool[i] ? [] : [["string", '"']]),
      close: this._content >= 0 ? close : [...end, this._text, ...close],
    };
  }
}
