import { Base } from "../core/element.js";

const PANEL_CSS = `
  :host {
    position: fixed;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: max-content; /* not squeezed by the viewport edge it's dragged towards */
    min-width: min(240px, calc(100vw - 32px));
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
    border-radius: 10px;
    background: var(--tangle-surface);
    box-shadow: 0 8px 28px rgb(0 0 0 / 0.16);
    --fold: 240ms cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  [part="header"] {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 14px;
    border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
    cursor: grab;
    touch-action: none;
    user-select: none;
    font: 13px ui-sans-serif, system-ui, sans-serif;
    transition: border-color var(--fold);
  }
  :host([collapsed]) [part="header"] { border-bottom-color: transparent; }
  :host(.is-dragging) [part="header"] { cursor: grabbing; }
  .grip { opacity: 0.4; letter-spacing: -2px; }
  [part="label"] {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-weight: 600;
    opacity: 0.75;
  }
  [part="toggle"] {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: none;
    color: inherit;
    cursor: pointer;
    opacity: 0.6;
  }
  [part="toggle"]:hover { opacity: 1; background: color-mix(in srgb, currentColor 10%, transparent); }
  [part="toggle"]:focus-visible { opacity: 1; outline: 2px solid var(--tangle-accent); }
  /* A minus whose vertical bar grows in to make a plus. */
  .icon { position: relative; width: 11px; height: 11px; }
  .icon::before, .icon::after {
    content: "";
    position: absolute;
    inset: 4.75px 0;
    border-radius: 1px;
    background: currentColor;
    transition: transform var(--fold);
  }
  .icon::after { transform: rotate(90deg) scaleX(0); }
  :host([collapsed]) .icon::after { transform: rotate(90deg); }
  /* The body folds by animating its grid row between 1fr and 0fr. */
  .fold {
    display: grid;
    grid-template-rows: 1fr;
    min-height: 0;
    transition: grid-template-rows var(--fold), opacity var(--fold), visibility 0s;
  }
  :host([collapsed]) .fold {
    grid-template-rows: 0fr;
    opacity: 0;
    visibility: hidden;
    transition: grid-template-rows var(--fold), opacity 160ms ease, visibility 0s 240ms;
  }
  .clip { min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
  [part="body"] { min-height: 0; padding: 14px 18px 16px; overflow: auto; }
  [part="body"] ::slotted(:first-child) { margin-top: 0; }
  [part="body"] ::slotted(:last-child) { margin-bottom: 0; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition: none !important; }
  }
`;
const PANEL_CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];
const PANEL_INSET = 16;

// <t-panel corner="top-right" label="Controls" width="280" collapsed>…</t-panel>
// Floats its contents in a fixed panel that stays in view while the page scrolls.
// Drag it by its header; the −/+ button minimizes it to just the header. The
// children stay where they are in the DOM (they're slotted into a shadow root),
// so they keep their scope.
export class TPanel extends Base {
  static observedAttributes = ["corner", "width", "label", "collapsed"];

  connectedCallback() {
    if (!this.shadowRoot) this.build();
    // Keep a dragged panel on screen as the window or the panel changes size,
    // including while it unfolds.
    this._onResize ??= () => this._pos && this.moveTo(this._pos.x, this._pos.y);
    this._resizeObserver ??= new ResizeObserver(this._onResize);
    window.addEventListener("resize", this._onResize);
    this._resizeObserver.observe(this);
    this.render();
  }

  disconnectedCallback() {
    window.removeEventListener("resize", this._onResize);
    this._resizeObserver.disconnect();
  }

  attributeChangedCallback() {
    if (this.shadowRoot) this.render();
  }

  get collapsed() {
    return this.hasAttribute("collapsed");
  }
  set collapsed(value) {
    // Keep the expanded width so the minimized header stays a readable bar.
    if (value && !this.collapsed && !this.hasAttribute("width")) this.style.width = `${this.getBoundingClientRect().width}px`;
    this.toggleAttribute("collapsed", Boolean(value));
  }

  build() {
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${PANEL_CSS}</style>
      <div part="header"><span class="grip" aria-hidden="true">⋮⋮</span><span part="label"></span>
        <button part="toggle" type="button"><span class="icon"></span></button></div>
      <div class="fold"><div class="clip"><div part="body"><slot></slot></div></div></div>`;
    const header = root.querySelector('[part="header"]');
    this._label = root.querySelector('[part="label"]');
    this._toggle = root.querySelector('[part="toggle"]');
    this.setAttribute("role", "region");

    this._toggle.addEventListener("click", () => (this.collapsed = !this.collapsed));

    let grab = null;
    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.composedPath().includes(this._toggle)) return;
      const rect = this.getBoundingClientRect();
      grab = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      header.setPointerCapture(event.pointerId);
      this.classList.add("is-dragging");
      event.preventDefault();
    });
    header.addEventListener("pointermove", (event) => {
      if (grab) this.moveTo(event.clientX - grab.x, event.clientY - grab.y);
    });
    const drop = () => {
      grab = null;
      this.classList.remove("is-dragging");
    };
    header.addEventListener("pointerup", drop);
    header.addEventListener("pointercancel", drop);
  }

  /** Places the panel at a viewport position, kept fully on screen. */
  moveTo(x, y) {
    const maxX = Math.max(0, window.innerWidth - this.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - this.offsetHeight);
    this._pos = { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
    Object.assign(this.style, { left: `${this._pos.x}px`, top: `${this._pos.y}px`, right: "", bottom: "" });
  }

  render() {
    const label = this.getAttribute("label") ?? "";
    this._label.textContent = label;
    if (label) this.setAttribute("aria-label", label);
    else this.removeAttribute("aria-label");

    const width = Number(this.getAttribute("width"));
    if (width > 0) this.style.width = `${width}px`;
    else if (!this.collapsed) this.style.width = ""; // shrink-wrap the content

    const collapsed = this.collapsed;
    this._toggle.setAttribute("aria-label", collapsed ? "Expand" : "Minimize");
    this._toggle.setAttribute("aria-expanded", String(!collapsed));

    if (this._pos) return this.moveTo(this._pos.x, this._pos.y); // dragged: stay put
    let corner = this.getAttribute("corner") ?? "bottom-right";
    if (!PANEL_CORNERS.includes(corner)) {
      console.error(`tangle: <t-panel> corner must be one of ${PANEL_CORNERS.join(", ")}`, this);
      corner = "bottom-right";
    }
    const [v, h] = corner.split("-");
    const at = (side) => (side === v || side === h ? `${PANEL_INSET}px` : "");
    Object.assign(this.style, { top: at("top"), bottom: at("bottom"), left: at("left"), right: at("right") });
  }
}
