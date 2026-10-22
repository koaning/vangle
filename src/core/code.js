import { TangleElement } from "./element.js";

// Code is a list of tokens: plain strings, or [kind, text] pairs that become
// <span class="t-code-{kind}"> for syntax highlighting.
function fillCode(el, tokens) {
  el.replaceChildren(
    ...tokens.map((token) => {
      if (typeof token === "string") return token;
      const span = document.createElement("span");
      span.className = `t-code-${token[0]}`;
      span.textContent = token[1];
      return span;
    }),
  );
}

// Shared by <t-call> and <t-tag>: shows the named children as code, adding the
// punctuation around them without moving them. The code stays on one line if it
// fits, and otherwise puts one argument per line, the way Black formats Python.
// Subclasses describe the punctuation, as tokens, in syntax(multiline).
export class CodeElement extends TangleElement {
  connectedCallback() {
    if (!this._args) this.build();
    if (typeof ResizeObserver !== "undefined") {
      // Watch the container too: a wrapped call doesn't grow when there's room again.
      let box = this.parentElement;
      while (box && getComputedStyle(box).display === "contents") box = box.parentElement;
      this._resize ??= new ResizeObserver(() => this.layout());
      this._resize.observe(this);
      if (box) this._resize.observe(box);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._resize?.disconnect();
  }

  build() {
    this._els = [...this.children].filter((el) => el.hasAttribute("name"));
    this._args = this._els.map((el) => el.getAttribute("name"));
    this._text = "";
    for (const node of [...this.childNodes]) {
      if (node.nodeType !== 3) continue;
      this._text += node.textContent;
      node.remove();
    }
    this._text = this._text.trim();
    const span = (part) => {
      const el = document.createElement("span");
      el.className = `${this.localName}-${part}`;
      return el;
    };
    this._open = span("open");
    this._close = span("close");
    this._keys = this._els.map((el) => {
      const key = span("key");
      el.before(key);
      return key;
    });
    this._seps = this._els.map((el) => {
      const sep = span("sep");
      el.after(sep);
      return sep;
    });
    this.prepend(this._open);
    this.append(this._close);
    this.layout();
  }

  layout() {
    if (!this._open) return;
    const set = (multiline) => {
      const syntax = this.syntax(multiline);
      this.classList.toggle("is-multiline", multiline);
      fillCode(this._open, syntax.open);
      fillCode(this._close, syntax.close);
      this._els.forEach((_, i) => {
        fillCode(this._keys[i], syntax.key(i));
        fillCode(this._seps[i], syntax.sep(i));
      });
    };
    set(false);
    if (this._els.length && this.clientWidth > 0 && this.scrollWidth > this.clientWidth + 1) set(true);
  }
}
