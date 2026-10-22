import { untracked } from "../core/signals.js";
import { TangleElement, validName } from "../core/element.js";

// ---------------------------------------------------------------------------
// Requests: <t-fetch> puts a backend's answer in a variable.
// ---------------------------------------------------------------------------

/**
 * The request a <t-fetch> sends, from its attributes: `url` is a template whose
 * ${…} parts are expressions, `params` an expression giving the query string,
 * `body` one giving the JSON body. Returns { url, init, key }, where `key` is
 * the same for the same request.
 */
export function buildRequest(scope, { url, params, body, method }) {
  let href = String(scope.eval(`\`${url.replace(/`/g, "\\`")}\``));
  if (params) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(scope.eval(params) ?? {})) {
      if (value != null) query.append(key, String(value));
    }
    const qs = query.toString();
    if (qs) href += (href.includes("?") ? "&" : "?") + qs;
  }
  const init = { method: (method || (body ? "POST" : "GET")).toUpperCase() };
  if (body) {
    init.body = JSON.stringify(scope.eval(body));
    init.headers = { "Content-Type": "application/json" };
  }
  return { url: href, init, key: `${init.method} ${href} ${init.body ?? ""}` };
}

// Answers seen on this page, shared by every <t-fetch>, newest last.
const fetchCache = new Map();
const FETCH_CACHE_SIZE = 200;
const STORAGE_PREFIX = "tangle-fetch:";

function remember(key, data) {
  fetchCache.delete(key);
  fetchCache.set(key, data);
  if (fetchCache.size > FETCH_CACHE_SIZE) fetchCache.delete(fetchCache.keys().next().value);
}

// localStorage can be missing, full or blocked; the cache is then just skipped.
function stored(key) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function store(key, data) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data));
  } catch {}
}

// <t-fetch name="info" url="data/${planet}.json"></t-fetch>
// or <t-fetch name="pred" url="/api/predict" body="{ age, income }" loading="busy">.
// Sends a request built from variables, again whenever they change, and puts the
// answer in a variable. Only the newest answer lands. While it waits, the variable
// keeps its old value and the elements showing it dim. Answers are cached for the
// page; cache="local" also keeps them in localStorage, and cache="none" turns it off.
export class TFetch extends TangleElement {
  connectedCallback() {
    this._name = validName(this);
    if (!this._name) return;
    if (!this.hasAttribute("url")) return console.error('tangle: <t-fetch> needs a url="…"', this);
    this.scope.slot(this._name).kind = "fetch";
    this._last = null;
    this.watch((scope) => {
      let request;
      try {
        request = buildRequest(scope, {
          url: this.getAttribute("url"),
          params: this.getAttribute("params"),
          body: this.getAttribute("body"),
          method: this.getAttribute("method"),
        });
      } catch (error) {
        this._last = null;
        untracked(() => this.stop(error));
        return;
      }
      if (request.key === this._last) return; // e.g. a rounded variable that didn't change the URL
      this._last = request.key;
      untracked(() => this.request(request));
    });
  }

  disconnectedCallback() {
    this.stop();
    super.disconnectedCallback();
  }

  request(request) {
    const cache = this.getAttribute("cache") ?? "page";
    const key = `${this.getAttribute("as") ?? "json"} ${request.key}`;
    let hit = cache === "none" ? undefined : fetchCache.get(key);
    if (hit === undefined && cache === "local") hit = stored(key);
    if (hit !== undefined) {
      this.stop();
      this.scope.set(this._name, hit);
      // An answer kept from an earlier visit may be out of date: ask again, quietly.
      if (cache === "local" && !fetchCache.has(key)) this.send(request, key, { quiet: true });
      else this.settle(null);
      return;
    }
    this.send(request, key, { quiet: false });
  }

  send({ url, init }, key, { quiet }) {
    this.stop();
    const token = (this._token = {});
    if (!quiet) this.setLoading(true);
    const wait = Number(this.getAttribute("debounce") ?? 100);
    this._timer = setTimeout(async () => {
      const controller = (this._controller = new AbortController());
      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`.trim());
        const data = this.getAttribute("as") === "text" ? await response.text() : await response.json();
        if (this._token !== token) return;
        const cache = this.getAttribute("cache") ?? "page";
        if (cache !== "none") remember(key, data);
        if (cache === "local") store(key, data);
        this.scope.set(this._name, data);
        this.settle(null);
      } catch (error) {
        if (this._token === token && error.name !== "AbortError") this.settle(error);
      }
    }, Number.isFinite(wait) ? Math.max(0, wait) : 100);
  }

  /** Drops the request on its way, if any. With an error, reports it. */
  stop(error) {
    clearTimeout(this._timer);
    this._controller?.abort();
    this._token = null;
    if (error) this.settle(error);
    else this.setLoading(false);
  }

  settle(error) {
    this.setLoading(false);
    this.classList.toggle("is-error", Boolean(error));
    if (error) {
      this.title = error.message;
      console.error(`tangle: <t-fetch name="${this._name}">`, error.message);
    } else {
      this.removeAttribute("title");
    }
    const name = this.getAttribute("error");
    if (name) this.scope.set(name, error ? error.message : null);
  }

  setLoading(on) {
    if (!this._name) return;
    this.scope.setPending(this._name, on);
    const name = this.getAttribute("loading");
    if (name) this.scope.set(name, on);
  }
}
