// ---------------------------------------------------------------------------
// Signals: push-dirty / pull-value, effects flushed in a microtask.
// ---------------------------------------------------------------------------

let observer = null;
const queue = new Set();
let flushScheduled = false;

function track(source) {
  if (!observer) return;
  source.subs.add(observer);
  observer.deps.add(source);
}

function unsubscribe(node) {
  for (const dep of node.deps) dep.subs.delete(node);
  node.deps.clear();
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(flush);
}

function flush() {
  flushScheduled = false;
  let guard = 0;
  while (queue.size) {
    const [next] = queue;
    queue.delete(next);
    next.run();
    if (++guard > 10000) {
      console.error("tangle: effects did not settle (cycle?)");
      queue.clear();
    }
  }
  if (pending.size) refreshStale();
}

export class Signal {
  constructor(value) {
    this._value = value;
    this.subs = new Set();
  }
  get value() {
    track(this);
    return this._value;
  }
  set value(next) {
    if (Object.is(next, this._value)) return;
    this._value = next;
    for (const sub of [...this.subs]) sub.mark();
  }
  peek() {
    return this._value;
  }
}

export class Computed {
  constructor(fn) {
    this.fn = fn;
    this.subs = new Set();
    this.deps = new Set();
    this.dirty = true;
    this._value = undefined;
    this.error = null;
    this.runs = 0;
  }
  mark() {
    if (this.dirty) return;
    this.dirty = true;
    for (const sub of [...this.subs]) sub.mark();
  }
  get value() {
    track(this);
    if (this.dirty) this.recompute();
    if (this.error) throw this.error;
    return this._value;
  }
  peek() {
    return untracked(() => this.value);
  }
  recompute() {
    this.runs++;
    unsubscribe(this);
    const previous = observer;
    observer = this;
    try {
      this._value = this.fn();
      this.error = null;
    } catch (error) {
      this.error = error;
    } finally {
      observer = previous;
      this.dirty = false;
    }
  }
}

export class Effect {
  constructor(fn) {
    this.fn = fn;
    this.deps = new Set();
    this.disposed = false;
    this.run();
  }
  mark() {
    if (this.disposed) return;
    queue.add(this);
    scheduleFlush();
  }
  run() {
    if (this.disposed) return;
    unsubscribe(this);
    const previous = observer;
    observer = this;
    try {
      this.fn();
    } catch (error) {
      console.error("tangle:", error);
    } finally {
      observer = previous;
    }
  }
  dispose() {
    this.disposed = true;
    queue.delete(this);
    unsubscribe(this);
  }
}

export const signal = (value) => new Signal(value);
export const computed = (fn) => new Computed(fn);
export function effect(fn) {
  const e = new Effect(fn);
  return () => e.dispose();
}
export function untracked(fn) {
  const previous = observer;
  observer = null;
  try {
    return fn();
  } finally {
    observer = previous;
  }
}

// Variables waiting on an answer (a <t-fetch> reloading, say) are pending.
// An element whose effects read one, directly or through formulas, gets the
// class is-stale until the answer lands, so it shows its old value dimmed.
export const pending = new Set(); // the def signals of pending variables
export const watchers = new Set(); // elements with effects from TangleElement.watch
let staleScheduled = false;

// Bumped when variables, elements or pending requests come and go, for <t-debug>.
export const graphVersion = new Signal(0);
export const bumpGraph = () => (graphVersion.value = graphVersion.peek() + 1);

export function setPending(source, on) {
  if (on === pending.has(source)) return;
  if (on) pending.add(source);
  else pending.delete(source);
  bumpGraph();
  if (staleScheduled) return;
  staleScheduled = true;
  queueMicrotask(refreshStale); // after the effects that the answer re-runs
}

/** Whether `node` reads a pending variable, following its dependencies. */
function readsPending(node, seen = new Set()) {
  for (const dep of node.deps ?? []) {
    if (pending.has(dep)) return true;
    if (seen.has(dep)) continue;
    seen.add(dep);
    if (readsPending(dep, seen)) return true;
  }
  return false;
}

function refreshStale() {
  staleScheduled = false;
  for (const el of watchers) {
    const stale = pending.size > 0 && [...el._effects].some((e) => readsPending(e));
    el.classList?.toggle("is-stale", stale);
  }
}
