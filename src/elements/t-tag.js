import { untracked } from "../core/signals.js";
import { scopeOf } from "../core/scope.js";
import { formatValue } from "../core/format.js";
import { CodeElement } from "../core/code.js";

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);

// <t-tag tag='input type="range"'><t-num name="max">10</t-num>…</t-tag>
// Shows an HTML tag whose attributes the reader can change, with the live element
// below it. `tag` is the tag name plus any fixed attributes. Each named child is an
// attribute (`attr` overrides the name shown); a child marked `content`, or loose
// text, is what goes between the tags. A true/false value is a boolean attribute.
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

  render(scope) {
    const { name, attrs } = this._tag;
    const el = document.createElement(name);
    for (const [key, value] of attrs) el.setAttribute(key, value);
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
      if (i === this._content) text = shown;
      else if (isBool) el.toggleAttribute(this.attrName(i), value);
      else if (value !== undefined) el.setAttribute(this.attrName(i), shown);
    });
    if (text && !VOID_TAGS.has(name)) el.textContent = text;
    untracked(() => {
      this._preview.replaceChildren(el);
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
