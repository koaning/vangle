import { Signal, graphVersion, untracked } from "../core/signals.js";
import { createRunner, cellInputs, enginesVersion } from "../core/engines.js";
import { loadCodemirror } from "../core/load.js";
import { TangleElement, validName } from "../core/element.js";
import { preview } from "./t-debug.js";

// ---------------------------------------------------------------------------
// Code cells: <t-codecell> is code the reader edits, run in a sandbox, with its
// result in a variable.
// ---------------------------------------------------------------------------

/** `text` without the indentation its lines share, and without blank lines at either end. */
export function dedent(text) {
  const lines = text.replace(/^\s*\n/, "").trimEnd().split("\n");
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].length));
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join("\n");
}

const sameInputs = (a, b) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
};

// <t-codecell name="total"><script type="text/plain">return prices.reduce((a, b) => a + b, 0)</script></t-codecell>
// Code the reader can edit. It runs in a Web Worker whenever it, or a page
// variable it mentions, changes, and its result goes into the variable `name`.
// While it runs, the old result stays and elements that show it dim. Below the
// editor are anything it logged and errors, and with `output` the result too.
// With `copy`, a button puts the code on the clipboard.
export class TCodeCell extends TangleElement {
  connectedCallback() {
    this._name = this.hasAttribute("name") ? validName(this) : null;
    if (this.hasAttribute("name") && !this._name) return;
    if (!this._editor) this.build();
    if (this._name) this.scope.slot(this._name).kind = "codecell";
    this._last = null;
    this.watch((scope) => {
      this._force.value;
      const engines = this._runner ? null : enginesVersion.value; // waiting on its engine
      graphVersion.value; // so a variable declared after the cell is still found
      const code = this._code.value;
      const names = cellInputs(code, [...scope.slots.keys()].filter((n) => n !== this._name));
      const inputs = {};
      for (const name of names) {
        try {
          const value = scope.get(name);
          if (value !== undefined) inputs[name] = value;
        } catch {} // a formula that fails is left out, so the code sees it as not defined
      }
      // graphVersion also changes when nothing this cell reads did: skip those.
      const run = { code, inputs, engines, force: this._force.peek() };
      const last = this._last;
      const same = last && last.code === code && (engines === null || last.engines === engines) && last.force === run.force;
      if (same && sameInputs(last.inputs, inputs)) return;
      this._last = run;
      untracked(() => this.run(code, inputs));
    });
  }

  disconnectedCallback() {
    this.stop();
    this._runner?.dispose?.();
    this._runner = null;
    super.disconnectedCallback();
  }

  build() {
    const script = this.querySelector('script[type="text/plain"]');
    if (!script) {
      // Code written straight into the element: take it out, to show it in the editor instead.
      this._text = this.textContent;
      this.replaceChildren();
    }
    this._initial = dedent(script ? script.textContent : this._text);
    this._code = new Signal(this._initial);
    this._force = new Signal(0);

    this._editor = document.createElement("div");
    this._editor.className = "t-codecell-editor";
    const pre = document.createElement("pre");
    pre.className = "t-codecell-pre";
    pre.textContent = this._initial;
    this._editor.append(pre);

    const bar = (this._bar = document.createElement("div"));
    bar.hidden = true;
    bar.className = "t-codecell-bar";
    this._status = document.createElement("span");
    this._status.className = "t-codecell-status";
    this._reset = document.createElement("button");
    this._reset.type = "button";
    this._reset.className = "t-codecell-reset";
    this._reset.textContent = "Reset";
    this._reset.hidden = true;
    this._reset.addEventListener("click", () => this.setText(this._initial));
    this._copy = document.createElement("button");
    this._copy.type = "button";
    this._copy.className = "t-codecell-copy";
    this._copy.textContent = "Copy";
    this._copy.addEventListener("click", () => this.copy());
    bar.append(this._status, this._reset, this._copy);

    this._output = document.createElement("div");
    this._output.className = "t-codecell-output";
    this._output.setAttribute("aria-live", "polite");
    this.append(this._editor, bar, this._output);
    this.syncBar();

    // Mod-Enter runs now, without waiting for the pause after typing. Capture it
    // before CodeMirror, which would insert a blank line.
    this.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
        event.preventDefault();
        event.stopPropagation();
        clearTimeout(this._typing);
        this._code.value = this.text();
        this._force.value++;
      },
      true,
    );

    loadCodemirror().then(
      (cm) => this.mount(cm),
      (error) => {
        console.error("tangle: <t-codecell> could not load CodeMirror, using a plain text area", error);
        this.mountTextarea();
      },
    );
  }

  /** The editor: CodeMirror, with the theme's colors. */
  mount({ EditorView, basicSetup, javascript, syntaxHighlighting, classHighlighter }) {
    const lang = this.getAttribute("lang") ?? "js";
    this._view = new EditorView({
      doc: this._code.peek(),
      extensions: [
        basicSetup,
        lang === "js" ? javascript() : [],
        syntaxHighlighting(classHighlighter),
        EditorView.contentAttributes.of({ "aria-label": this.getAttribute("label") ?? `${this._name ?? "code"} (${lang})` }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) this.edited();
        }),
        EditorView.theme({
          "&": { color: "inherit", backgroundColor: "transparent" },
          "&.cm-focused": { outline: "none" },
          ".cm-content": { caretColor: "var(--tangle-accent)" },
          ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--tangle-accent)" },
          "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
            { backgroundColor: "color-mix(in srgb, var(--tangle-accent) 25%, transparent)" },
          ".cm-gutters": { backgroundColor: "transparent", color: "inherit", border: "none", opacity: "0.45" },
          ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--tangle-accent) 6%, transparent)" },
          ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
            backgroundColor: "color-mix(in srgb, var(--tangle-accent) 20%, transparent)",
            outline: "none",
          },
          ".cm-tooltip": { backgroundColor: "var(--tangle-surface)", color: "inherit" },
        }),
      ],
    });
    this._editor.replaceChildren(this._view.dom);
  }

  /** Without CodeMirror (offline, say), a plain text area does the job. */
  mountTextarea() {
    const area = (this._area = document.createElement("textarea"));
    area.className = "t-codecell-textarea";
    area.spellcheck = false;
    area.value = this._code.peek();
    area.rows = Math.max(3, area.value.split("\n").length);
    area.setAttribute("aria-label", this.getAttribute("label") ?? this._name ?? "code");
    area.addEventListener("input", () => this.edited());
    this._editor.replaceChildren(area);
  }

  text() {
    return this._view ? this._view.state.doc.toString() : this._area ? this._area.value : this._code.peek();
  }

  setText(text) {
    if (this._view) this._view.dispatch({ changes: { from: 0, to: this._view.state.doc.length, insert: text } });
    else if (this._area) {
      this._area.value = text;
      this.edited();
    }
  }

  /** After a pause in typing, the new code runs. */
  edited() {
    const text = this.text();
    this._reset.hidden = text === this._initial;
    this.syncBar();
    clearTimeout(this._typing);
    const wait = Number(this.getAttribute("debounce") ?? 400);
    this._typing = setTimeout(() => (this._code.value = text), Number.isFinite(wait) ? Math.max(0, wait) : 400);
  }

  run(code, inputs) {
    this.stop();
    const lang = this.getAttribute("lang") ?? "js";
    this._runner ??= createRunner(lang);
    if (!this._runner) return this.settle({ error: new Error(`No engine for lang="${lang}". See registerEngine.`) });
    const token = (this._token = {});
    this.setPending(true);
    const timeout = Number(this.getAttribute("timeout") ?? 2000);
    const started = performance.now();
    const runner = this._runner;
    // In a promise, so an engine that throws instead of rejecting is handled the same way.
    new Promise((resolve) => resolve(runner.run(code, inputs, { timeout: Number.isFinite(timeout) ? timeout : 2000 }))).then(
      ({ value, logs }) => {
        if (this._token !== token) return;
        if (this._name) this.scope.set(this._name, value);
        this.settle({ value, logs, ms: performance.now() - started });
      },
      (error) => {
        if (this._token !== token || error?.name === "AbortError") return;
        this.settle({ error, logs: error?.logs });
      },
    );
  }

  stop() {
    this._token = null;
    this.setPending(false);
  }

  /** Show how the run went: what it logged, then its value or its error. */
  settle({ value, error, logs = [], ms }) {
    this._token = null;
    this.setPending(false);
    this.classList.toggle("is-error", Boolean(error));
    const lines = logs.map(({ level, text }) => {
      const line = document.createElement("div");
      line.className = `t-codecell-log is-${level}`;
      line.textContent = text;
      return line;
    });
    // The value shows with `output`, or when it has nowhere else to go. Errors and logs always show.
    const showValue = this.hasAttribute("output") || !this._name;
    let result = document.createElement("div");
    if (error) {
      result.className = "t-codecell-error";
      result.textContent = error.line ? `Line ${error.line}: ${error.message}` : error.message;
      console.error(`tangle: <t-codecell${this._name ? ` name="${this._name}"` : ""}>`, result.textContent);
    } else if (showValue) {
      result.className = "t-codecell-value";
      result.textContent = preview(value, 400);
    } else result = null;
    this._output.replaceChildren(...lines, ...(result ? [result] : []));
    this._status.textContent = showValue && !error && ms != null ? `ran in ${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms` : "";
    this.syncBar();
    const name = this.getAttribute("error");
    if (name) this.scope.set(name, error ? result.textContent : null);
  }

  /** The bar under the editor only takes up room when it has something in it. */
  syncBar() {
    this._copy.hidden = !this.hasAttribute("copy");
    this._bar.hidden = this._reset.hidden && this._copy.hidden && !this._status.textContent;
  }

  static observedAttributes = ["copy"];
  attributeChangedCallback() {
    if (this._bar) this.syncBar();
  }

  /** Puts the code, as edited, on the clipboard, and says so on the button for a moment. */
  async copy() {
    let done = false;
    try {
      await navigator.clipboard.writeText(this.text());
      done = true;
    } catch (error) {
      console.error("tangle: <t-codecell> could not copy", error);
    }
    this._copy.textContent = done ? "Copied" : "Copy failed";
    clearTimeout(this._copied);
    this._copied = setTimeout(() => (this._copy.textContent = "Copy"), 1500);
  }

  setPending(on) {
    this.classList.toggle("is-running", on);
    if (this._name) this.scope.setPending(this._name, on);
  }
}
