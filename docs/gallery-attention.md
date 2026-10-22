# Attention

A self-attention layer lets every token in a sentence look at the others and take a blend of
what it finds. As a formula it fits on one line, O = softmax(QKᵀ/√d)·V, but the line reads
inside out. Here it is in the order it runs, for the four tokens *the cat sat down*. Each token
is two numbers, so every matrix stays small enough to read.

<div class="example attention-demo" data-show-source>
  <t-var name="x0" value="-1.6" min="-3" max="3" step="0.1"></t-var>
  <t-var name="y0" value="0.6" min="-3" max="3" step="0.1"></t-var>
  <t-var name="x1" value="1.2" min="-3" max="3" step="0.1"></t-var>
  <t-var name="y1" value="1.4" min="-3" max="3" step="0.1"></t-var>
  <t-var name="x2" value="0.6" min="-3" max="3" step="0.1"></t-var>
  <t-var name="y2" value="-1.2" min="-3" max="3" step="0.1"></t-var>
  <t-var name="x3" value="-0.8" min="-3" max="3" step="0.1"></t-var>
  <t-var name="y3" value="-1.4" min="-3" max="3" step="0.1"></t-var>
  <t-var name="q11" value="0.4" min="-3" max="3" step="0.1" color="#246bce #75a7ff"></t-var>
  <t-var name="q12" value="1.4" min="-3" max="3" step="0.1" color="#246bce #75a7ff"></t-var>
  <t-var name="q21" value="-1.2" min="-3" max="3" step="0.1" color="#246bce #75a7ff"></t-var>
  <t-var name="q22" value="0.6" min="-3" max="3" step="0.1" color="#246bce #75a7ff"></t-var>
  <t-var name="k11" value="1.1" min="-3" max="3" step="0.1" color="#b45b1b #ffad66"></t-var>
  <t-var name="k12" value="0.2" min="-3" max="3" step="0.1" color="#b45b1b #ffad66"></t-var>
  <t-var name="k21" value="-0.3" min="-3" max="3" step="0.1" color="#b45b1b #ffad66"></t-var>
  <t-var name="k22" value="0.9" min="-3" max="3" step="0.1" color="#b45b1b #ffad66"></t-var>
  <t-var name="v11" value="0.9" min="-3" max="3" step="0.1" color="#2e7d32 #81c784"></t-var>
  <t-var name="v12" value="-0.5" min="-3" max="3" step="0.1" color="#2e7d32 #81c784"></t-var>
  <t-var name="v21" value="0.4" min="-3" max="3" step="0.1" color="#2e7d32 #81c784"></t-var>
  <t-var name="v22" value="1" min="-3" max="3" step="0.1" color="#2e7d32 #81c784"></t-var>
  <t-math display>
    W_Q = \begin{pmatrix} \tangle{q11} &amp; \tangle{q12} \\ \tangle{q21} &amp; \tangle{q22} \end{pmatrix}
    \quad W_K = \begin{pmatrix} \tangle{k11} &amp; \tangle{k12} \\ \tangle{k21} &amp; \tangle{k22} \end{pmatrix}
    \quad W_V = \begin{pmatrix} \tangle{v11} &amp; \tangle{v12} \\ \tangle{v21} &amp; \tangle{v22} \end{pmatrix}
  </t-math>
  <div class="flow-layout">
    <svg class="flow" viewBox="0 0 400 610" role="img" aria-label="The layer as a flow diagram, from the tokens to the output"></svg>
    <div class="panel">
      <p class="step-head">Step <t-num name="step" min="1" max="7">1</t-num> of 7: <strong class="step-title"></strong></p>
      <div class="buttons">
        <button type="button" data-go="-1">◀ Back</button>
        <button type="button" data-go="1">Next ▶</button>
        <button type="button" class="play">Play</button>
      </div>
      <svg class="grids" viewBox="0 0 300 156" role="img" aria-label="What this step computes"></svg>
      <p class="step-text"></p>
      <p class="mask-line">Mask <t-choice name="mask" options="off, causal">off</t-choice></p>
    </div>
  </div>
  <svg class="defs" width="0" height="0" aria-hidden="true">
    <pattern id="attention-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6"></line>
    </pattern>
  </svg>
</div>

## In the plane

The same layer, drawn as points. Pick whose output to follow: the query of
<t-choice name="query" options="the, cat, sat, down">sat</t-choice>.

<div class="example attention-demo">
  <div class="planes">
    <figure>
      <svg class="plane keys" viewBox="-150 -150 300 300" role="img" aria-label="The tokens, the query and the keys">
        <g class="paper"></g><g class="layer"></g><g class="tokens"></g>
      </svg>
      <figcaption>The <span class="att-q">query</span> and the <span class="att-k">keys</span>.
        Keys on the shaded side score above zero.</figcaption>
    </figure>
    <figure>
      <svg class="plane values" viewBox="-150 -150 300 300" role="img" aria-label="The tokens, the values and the output">
        <g class="paper"></g><g class="layer"></g><g class="tokens"></g>
      </svg>
      <figcaption>The <span class="att-v">values</span> and the <span class="att-o">output</span>,
        pulled toward each value by its weight.</figcaption>
    </figure>
  </div>
</div>

<script type="module" data-show-source>
  import { scopeOf } from "../tangle.js";

  const TOKENS = ["the", "cat", "sat", "down"];
  const sub = (s) => `<tspan class="sub" dy="4">${s}</tspan>`;

  // The layer itself: plain arrays in, plain arrays out. Each row is a token, so a token's
  // query is its embedding (a row vector) times W_Q. It keeps every intermediate result,
  // so the diagram can show each step.
  const matmul = (A, B) => A.map((row) => B[0].map((_, c) => row.reduce((sum, a, k) => sum + a * B[k][c], 0)));
  const transpose = (M) => M[0].map((_, c) => M.map((row) => row[c]));
  const softmax = (row) => {
    const top = Math.max(...row);
    const e = row.map((s) => Math.exp(s - top)); // a masked score is -Infinity, so its weight is 0
    const total = e.reduce((a, b) => a + b);
    return e.map((x) => x / total);
  };
  function attention({ X, Wq, Wk, Wv, causal }) {
    const [Q, K, V] = [Wq, Wk, Wv].map((W) => matmul(X, W));
    const S = matmul(Q, transpose(K));
    const scaled = S.map((row) => row.map((s) => s / Math.sqrt(Q[0].length)));
    const masked = scaled.map((row, i) => row.map((s, j) => (causal && j > i ? -Infinity : s)));
    const A = masked.map(softmax);
    return { X, Q, K, V, S, scaled, masked, A, O: matmul(A, V) };
  }

  // The steps, in order: the nodes of the diagram that run in each one, what the panel
  // shows, and a sentence about it.
  const STEPS = [
    { title: "Embed", grids: (r) => [["X", r.X]],
      text: () => "Each token starts as a row of X: its embedding, two numbers per token." },
    { title: "Project", grids: (r) => [["Q", r.Q, "q"], ["K", r.K, "k"], ["V", r.V, "v"]],
      text: () => "Three matrices turn every token into a query, a key and a value, all at once. Each token is still on its own: none has looked at another yet." },
    { title: "Compare", grids: (r) => [["S = QKᵀ", r.S, "a"]],
      text: () => "Every query is multiplied with every key, which gives a score for each pair of tokens: row i, column j is how well token i's query matches token j's key. This is the first time the tokens meet." },
    { title: "Scale", grids: (r) => [["S / √2", r.scaled, "a"]],
      text: () => "The scores are divided by √d, here √2, so that they don't grow with the length of the vectors." },
    { title: "Mask", grids: (r) => [["masked", r.masked, "a"]],
      text: (causal) => causal
        ? "Each token may only look back, so every score for a later token becomes −∞. A model that writes text one token at a time needs this."
        : "The mask is off, so every token may look at every other one and the scores pass through unchanged." },
    { title: "Softmax", grids: (r) => [["A = softmax", r.A, "a", 1]],
      text: () => "A softmax turns each row of scores into weights between 0 and 1 that add up to 1. The values still haven't been used." },
    { title: "Mix", grids: (r) => [["O = AV", r.O, "o"]],
      text: () => "Only now do the values come in. Each output row is a weighted average of the value rows, with the weights from its row of A." },
  ];

  // The diagram: operations as nodes, arrows labelled with the matrix they carry.
  const NODES = {
    x: { step: 0, x: 200, y: 30, w: 64, label: "X", note: "4×2", tensor: true },
    wq: { step: 1, x: 80, y: 110, w: 70, label: `× W${sub("Q")}`, color: "q" },
    wk: { step: 1, x: 200, y: 110, w: 70, label: `× W${sub("K")}`, color: "k" },
    wv: { step: 1, x: 320, y: 110, w: 70, label: `× W${sub("V")}`, color: "v" },
    qk: { step: 2, x: 140, y: 210, w: 100, label: "Q Kᵀ", color: "a" },
    scale: { step: 3, x: 140, y: 280, w: 100, label: "÷ √2", color: "a" },
    mask: { step: 4, x: 140, y: 350, w: 100, label: "mask", color: "a" },
    softmax: { step: 5, x: 140, y: 420, w: 100, label: "softmax", color: "a" },
    av: { step: 6, x: 230, y: 510, w: 100, label: "A V", color: "o" },
    out: { step: 6, x: 230, y: 580, w: 64, label: "O", note: "4×2", tensor: true, color: "o" },
  };
  const EDGES = [
    { from: "x", to: "wq" }, { from: "x", to: "wk" }, { from: "x", to: "wv" },
    { from: "wq", to: "qk", dx: -16, label: "Q", note: "4×2", at: [72, 150], anchor: "end", color: "q" },
    { from: "wk", to: "qk", dx: 16, label: "K", note: "4×2", at: [208, 150], color: "k" },
    { from: "wv", to: "av", dx: 16, label: "V", note: "4×2", at: [328, 320], color: "v" },
    { from: "qk", to: "scale", label: "S", note: "4×4", at: [148, 243], color: "a" },
    { from: "scale", to: "mask", note: "4×4", at: [148, 313], color: "a" },
    { from: "mask", to: "softmax", note: "4×4", at: [148, 383], color: "a" },
    { from: "softmax", to: "av", dx: -16, label: "A", note: "4×4", at: [132, 458], anchor: "end", color: "a" },
    { from: "av", to: "out", color: "o" },
  ];
  const H = 28; // the height of a node

  // Draws the diagram for the current step: earlier nodes are done, the current ones are
  // active, with the matrices flowing into them, and later ones are still to come.
  function drawFlow(step, causal) {
    const state = (s) => (s < step ? "is-done" : s === step ? "is-active" : "is-pending");
    const color = (c) => (c ? `style="--c: var(--${c})"` : "");
    const out = [];
    for (const e of EDGES) {
      const [a, b] = [NODES[e.from], NODES[e.to]];
      const [sx, sy, tx, ty] = [a.x, a.y + H / 2, b.x + (e.dx ?? 0), b.y - H / 2 - 5];
      const bend = Math.max(sy, ty - 44);
      const cls = a.step > step ? "is-pending" : b.step === step ? "is-active" : "";
      out.push(`<g class="edge ${cls}" ${color(e.color)}>`,
        `<path d="M${sx},${sy} L${sx},${bend} C${sx},${ty - 14} ${tx},${ty - 26} ${tx},${ty}"/>`,
        `<polygon points="${tx - 4.5},${ty} ${tx + 4.5},${ty} ${tx},${ty + 6}"/>`);
      if (e.at) out.push(`<text x="${e.at[0]}" y="${e.at[1]}" style="text-anchor: ${e.anchor ?? "start"}">${e.label ? `<tspan class="name">${e.label}</tspan> ` : ""}${e.note}</text>`);
      out.push(`</g>`);
    }
    for (const [id, n] of Object.entries(NODES)) {
      const off = id === "mask" && !causal ? " is-off" : "";
      out.push(`<g class="node ${n.tensor ? "tensor" : "op"} ${state(n.step)}${off}" data-step="${n.step}" ${color(n.color)}>`,
        `<rect x="${n.x - n.w / 2}" y="${n.y - H / 2}" width="${n.w}" height="${H}" rx="${n.tensor ? 4 : H / 2}"/>`,
        `<text x="${n.x}" y="${n.y}">${id === "mask" ? (causal ? "causal mask" : "no mask") : n.label}</text>`);
      if (n.note) out.push(`<text class="note" x="${n.x + n.w / 2 + 8}" y="${n.y}">${n.note}</text>`);
      out.push(`</g>`);
    }
    return out.join("");
  }

  // A matrix as a grid of shaded cells, as an SVG string. Positive numbers take the color,
  // negative ones are gray, and masked cells are hatched.
  function heatmap(M, { x, y, title, color, w = 44, h = 26, scale, rows = false, cols = false }) {
    scale ??= Math.max(1, ...M.flat().filter(Number.isFinite).map(Math.abs));
    const out = [`<text class="title" x="${x + (w * M[0].length) / 2}" y="${y - 30}">${title}</text>`];
    if (cols) TOKENS.forEach((t, j) => out.push(`<text class="label" x="${x + w * j + w / 2}" y="${y - 10}">${t}</text>`));
    M.forEach((row, i) => {
      if (rows) out.push(`<text class="label row" x="${x - 6}" y="${y + h * i + h / 2}">${TOKENS[i]}</text>`);
      row.forEach((v, j) => {
        const [cx, cy] = [x + w * j, y + h * i];
        if (!Number.isFinite(v)) {
          out.push(`<rect class="cell masked" x="${cx}" y="${cy}" width="${w}" height="${h}"/>`);
          return;
        }
        const fill = v >= 0 ? color : "currentColor";
        const opacity = (0.65 * Math.min(1, Math.abs(v) / scale)).toFixed(3);
        out.push(`<rect class="cell" x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${fill}" fill-opacity="${opacity}"/>`,
          `<text class="value" x="${cx + w / 2}" y="${cy + h / 2}">${(Math.abs(v) < 0.005 ? 0 : v).toFixed(2)}</text>`);
      });
    });
    return out.join("");
  }

  // The panel: the matrices one step makes, side by side and centered.
  function drawGrids(items) {
    const w = items.length > 1 ? 34 : 44;
    const gap = 16;
    const total = items.reduce((sum, [, M]) => sum + M[0].length * w, 0) + gap * (items.length - 1);
    let x = 36 + (256 - total) / 2;
    return items.map(([title, M, color, scale], k) => {
      const svg = heatmap(M, { x, y: 44, w, title, color: color ? `var(--${color})` : "currentColor",
        scale, rows: k === 0, cols: M.length === M[0].length });
      x += M[0].length * w + gap;
      return svg;
    }).join("");
  }

  // Pieces of the planes, also as SVG strings. Points are in plane units, with y pointing up.
  const unit = 34;
  const px = ([x, y]) => [x * unit, -y * unit];
  const line = (a, b, cls, extra = "") => {
    const [[x1, y1], [x2, y2]] = [px(a), px(b)];
    return `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${extra}/>`;
  };
  const dot = (p, cls, r = 5) => `<circle class="${cls}" cx="${px(p)[0]}" cy="${px(p)[1]}" r="${r}"/>`;
  const label = (p, text, cls, dx = 9, dy = -9) => `<text class="${cls}" x="${px(p)[0] + dx}" y="${px(p)[1] + dy}">${text}</text>`;
  function arrow(to, cls) {
    const [x, y] = px(to);
    const length = Math.hypot(x, y);
    if (length < 1) return "";
    const [ux, uy] = [x / length, y / length];
    const size = Math.min(12, length);
    const [bx, by] = [x - ux * size, y - uy * size];
    return `<g class="${cls}"><line x1="0" y1="0" x2="${bx}" y2="${by}"/>` +
      `<polygon points="${x},${y} ${bx - uy * size * 0.45},${by + ux * size * 0.45} ${bx + uy * size * 0.45},${by - ux * size * 0.45}"/></g>`;
  }
  // The convex hull of some points (Andrew's monotone chain), for the shape the values span.
  function hull(points) {
    const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const half = (list) => list.reduce((h, q) => {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      return [...h, q];
    }, []);
    return [...half(p).slice(0, -1), ...half(p.reverse()).slice(0, -1)];
  }

  // The left plane: the query of token i, the zero-score line across it, and every key,
  // linked by a dotted line to the token it came from.
  function drawKeys({ X, Q, K, A }, i) {
    const q = Q[i];
    const out = [];
    const n = Math.hypot(...q);
    if (n > 0) {
      const [ux, uy] = [q[0] / n, q[1] / n];
      const far = 20;
      const side = [[-uy * far, ux * far], [-uy * far + ux * far, ux * far + uy * far], [uy * far + ux * far, -ux * far + uy * far], [uy * far, -ux * far]];
      out.push(`<polygon class="positive" points="${side.map(px).join(" ")}"/>`, line(side[0], side[3], "zero"));
    }
    K.forEach((k, j) => {
      const faded = A[i][j] === 0 ? " is-masked" : "";
      out.push(line(X[j], k, `link${faded}`), dot(k, `key${faded}`));
    });
    out.push(line(X[i], q, "link"), arrow(q, "query"), label(q, "q", "name query-name"));
    return out.join("");
  }

  // The right plane: the values, the shape they span, and the output of token i, joined to
  // each value by a line as thick as its weight.
  function drawValues({ X, V, A, O }, i) {
    const o = O[i];
    const out = [`<polygon class="span" points="${hull(V).map(px).join(" ")}"/>`];
    V.forEach((v, j) => out.push(line(X[j], v, "link")));
    V.forEach((v, j) => {
      if (A[i][j] > 0.005) out.push(line(o, v, "pull", `stroke-width="${(0.5 + 8 * A[i][j]).toFixed(2)}"`));
    });
    V.forEach((v) => out.push(dot(v, "val")));
    out.push(dot(o, "output", 6), label(o, "out", "name output-name"));
    return out.join("");
  }

  // Everything on this page shares the page-wide variables.
  const scope = scopeOf(document);
  const flow = document.querySelector(".attention-demo .flow");
  const grids = document.querySelector(".attention-demo .grids");
  const title = document.querySelector(".attention-demo .step-title");
  const text = document.querySelector(".attention-demo .step-text");
  const planes = [...document.querySelectorAll(".attention-demo .plane")];

  // The paper and the draggable tokens never change shape, so they're drawn once.
  for (const svg of planes) {
    const paper = [];
    for (let k = -4; k <= 4; k++) {
      paper.push(`<line class="${k ? "" : "axis"}" x1="${k * unit}" x2="${k * unit}" y1="-150" y2="150"/>`,
        `<line class="${k ? "" : "axis"}" x1="-150" x2="150" y1="${k * unit}" y2="${k * unit}"/>`);
    }
    svg.querySelector(".paper").innerHTML = paper.join("");
    svg.querySelector(".tokens").innerHTML = TOKENS.map((t) =>
      `<g class="token"><circle class="embedding" r="4.5"/><text x="8" y="-8">${t}</text><circle class="handle" r="16"/></g>`).join("");
  }

  scope.effect((s) => {
    const X = TOKENS.map((_, j) => [s.get(`x${j}`), s.get(`y${j}`)]);
    const W = (m) => [[s.get(`${m}11`), s.get(`${m}12`)], [s.get(`${m}21`), s.get(`${m}22`)]];
    const causal = s.get("mask") === "causal";
    const r = attention({ X, Wq: W("q"), Wk: W("k"), Wv: W("v"), causal });
    const step = Math.round(s.get("step")) - 1;
    const i = TOKENS.indexOf(s.get("query"));

    flow.innerHTML = drawFlow(step, causal);
    grids.innerHTML = drawGrids(STEPS[step].grids(r));
    title.textContent = STEPS[step].title;
    text.textContent = STEPS[step].text(causal);

    planes[0].querySelector(".layer").innerHTML = drawKeys(r, i);
    planes[1].querySelector(".layer").innerHTML = drawValues(r, i);
    for (const svg of planes) {
      svg.querySelectorAll(".token").forEach((g, j) => {
        g.setAttribute("transform", `translate(${px(X[j])})`);
        g.classList.toggle("is-query", j === i);
      });
    }
  });

  // Stepping: Back and Next, a click on a node, or Play, which walks through every step.
  const go = (step) => scope.set("step", Math.min(STEPS.length, Math.max(1, step)));
  const play = document.querySelector(".attention-demo .play");
  let timer = null;
  const stop = () => {
    clearInterval(timer);
    timer = null;
    play.textContent = "Play";
  };
  for (const button of document.querySelectorAll(".attention-demo [data-go]")) {
    button.addEventListener("click", () => {
      stop();
      go(scope.peek("step") + Number(button.dataset.go));
    });
  }
  flow.addEventListener("click", (event) => {
    const node = event.target.closest("[data-step]");
    if (!node) return;
    stop();
    go(Number(node.dataset.step) + 1);
  });
  play.addEventListener("click", () => {
    if (timer) return stop();
    if (scope.peek("step") >= STEPS.length) go(1);
    play.textContent = "Pause";
    timer = setInterval(() => {
      if (scope.peek("step") >= STEPS.length) return stop();
      go(scope.peek("step") + 1);
    }, 1800);
  });
  document.querySelector(".attention-demo .step-head t-num").addEventListener("pointerdown", stop);

  // Dragging a token in either plane sets its embedding. set() doesn't apply min, max or
  // step, so the values are rounded and clamped here.
  const fit = (v) => Math.min(3, Math.max(-3, Math.round(v * 10) / 10));
  for (const svg of planes) {
    svg.querySelectorAll(".token").forEach((g, j) => {
      const handle = g.querySelector(".handle");
      handle.addEventListener("pointerdown", (event) => {
        handle.setPointerCapture(event.pointerId);
        g.classList.add("is-dragging");
        const move = (event) => {
          const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
          scope.setValues({ [`x${j}`]: fit(p.x / unit), [`y${j}`]: fit(-p.y / unit) });
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("lostpointercapture", () => {
          handle.removeEventListener("pointermove", move);
          g.classList.remove("is-dragging");
        }, { once: true });
      });
    });
  }
</script>

<style data-show-source>
  .attention-demo {
    --q: light-dark(#246bce, #75a7ff); --k: light-dark(#b45b1b, #ffad66); --v: light-dark(#2e7d32, #81c784);
    --a: light-dark(#7b3fb5, #c39bf0); --o: light-dark(#c2185b, #f06292);
  }
  .att-q { color: light-dark(#246bce, #75a7ff); }
  .att-k { color: light-dark(#b45b1b, #ffad66); }
  .att-v { color: light-dark(#2e7d32, #81c784); }
  .att-o { color: light-dark(#c2185b, #f06292); }
  .attention-demo svg { display: block; width: 100%; height: auto; }
  .attention-demo .defs { position: absolute; width: 0; height: 0; }

  /* The diagram and the panel beside it. */
  .attention-demo .flow-layout { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-start; }
  .attention-demo .flow { flex: 1 1 320px; max-width: 400px; }
  .attention-demo .panel { flex: 1 1 260px; position: sticky; top: 1rem; }
  .attention-demo .panel p { margin: 0.5rem 0; }
  .attention-demo .step-text { min-height: 6.5em; }
  .attention-demo .buttons { display: flex; gap: 0.4rem; }
  .attention-demo .buttons button { margin: 0; }

  .attention-demo .flow text { fill: currentColor; text-anchor: middle; dominant-baseline: middle; }
  .attention-demo .flow .sub { font-size: 10px; }
  .attention-demo .node { cursor: pointer; transition: opacity 200ms; }
  .attention-demo .node rect { fill: var(--tangle-surface, white); stroke: var(--c, currentColor); stroke-width: 1.5; transition: fill 200ms; }
  .attention-demo .node text { font: italic 600 15px Georgia, serif; }
  .attention-demo .node .note { font: 11px ui-monospace, monospace; text-anchor: start; fill-opacity: 0.6; }
  .attention-demo .node.is-active rect { stroke-width: 3; fill: color-mix(in srgb, var(--c, currentColor) 16%, var(--tangle-surface, white)); }
  .attention-demo .node.is-pending { opacity: 0.25; }
  .attention-demo .node.is-off rect { stroke-dasharray: 4 3; }
  .attention-demo .edge { color: var(--c, currentColor); transition: opacity 200ms; }
  .attention-demo .edge path { fill: none; stroke: currentColor; stroke-width: 1.75; stroke-opacity: 0.7; }
  .attention-demo .edge polygon { fill: currentColor; }
  .attention-demo .edge text { font: 11px ui-monospace, monospace; fill: currentColor; }
  .attention-demo .edge .name { font: italic 600 14px Georgia, serif; }
  .attention-demo .edge.is-pending { opacity: 0.2; }
  .attention-demo .edge.is-active path { stroke-width: 2.75; stroke-opacity: 1; stroke-dasharray: 6 4; animation: attention-flow 0.5s linear infinite; }
  @keyframes attention-flow { to { stroke-dashoffset: -10; } }
  @media (prefers-reduced-motion: reduce) { .attention-demo .edge.is-active path { animation: none; } }

  /* The matrices in the panel. */
  .attention-demo .grids text { fill: currentColor; text-anchor: middle; dominant-baseline: middle; }
  .attention-demo .grids .title { font: italic 600 15px Georgia, serif; }
  .attention-demo .grids .label { font-size: 11px; fill-opacity: 0.7; }
  .attention-demo .grids .label.row { text-anchor: end; }
  .attention-demo .grids .value { font: 10.5px ui-monospace, monospace; }
  .attention-demo .grids .cell { stroke: currentColor; stroke-opacity: 0.15; }
  .attention-demo .grids .masked { fill: url(#attention-hatch); }
  .attention-demo pattern line { stroke: currentColor; stroke-opacity: 0.25; stroke-width: 2; }

  /* The planes. */
  .attention-demo .planes { display: flex; flex-wrap: wrap; gap: 1rem; }
  .attention-demo figure { flex: 1 1 260px; margin: 0; }
  .attention-demo figcaption { font-size: 0.9em; text-align: center; margin-top: 0.25rem; }
  .attention-demo .plane { border: 1px solid var(--line); border-radius: 6px; }
  .attention-demo .paper line { stroke: currentColor; stroke-opacity: 0.07; }
  .attention-demo .paper .axis { stroke-opacity: 0.25; }
  .attention-demo .positive { fill: var(--q); fill-opacity: 0.07; }
  .attention-demo .zero { stroke: var(--q); stroke-opacity: 0.5; stroke-dasharray: 4 4; }
  .attention-demo .link { stroke: currentColor; stroke-opacity: 0.3; stroke-dasharray: 1 3; }
  .attention-demo .key { fill: var(--k); }
  .attention-demo .is-masked { opacity: 0.25; }
  .attention-demo .query { stroke: var(--q); fill: var(--q); }
  .attention-demo .query line { stroke-width: 3; stroke-linecap: round; }
  .attention-demo .span { fill: var(--v); fill-opacity: 0.1; stroke: var(--v); stroke-opacity: 0.4; stroke-linejoin: round; }
  .attention-demo .pull { stroke: var(--o); stroke-opacity: 0.45; stroke-linecap: round; }
  .attention-demo .val { fill: var(--v); }
  .attention-demo .output { fill: var(--o); stroke: var(--tangle-surface, white); stroke-width: 1.5; }
  .attention-demo .name { font: italic 600 15px Georgia, serif; }
  .attention-demo .query-name { fill: var(--q); }
  .attention-demo .output-name { fill: var(--o); }
  .attention-demo .token text { fill: currentColor; font-size: 12px; pointer-events: none; }
  .attention-demo .token .embedding { fill: var(--tangle-surface, white); stroke: currentColor; stroke-width: 1.5; }
  .attention-demo .token.is-query text { font-weight: 700; }
  .attention-demo .handle { fill: currentColor; fill-opacity: 0; cursor: grab; touch-action: none; transition: fill-opacity 120ms; }
  .attention-demo .handle:hover, .attention-demo .is-dragging .handle { fill-opacity: 0.12; }
  .attention-demo .is-dragging .handle { cursor: grabbing; }
</style>

## Things to try

- **Follow V.** Its arrow leaves at step 2 and isn't used until step 7. The whole middle of the
  layer only decides *how much* of each value to take, never *what* the values are.
- **Turn on the causal mask, then step to Mask.** The top-right triangle of the scores becomes −∞,
  and after the softmax those weights are exactly 0. *the*, with nothing before it, gives all its
  weight to itself.
- **Set W<sub>Q</sub> to zero and step to Softmax.** Every query is zero, so every score is
  zero and every weight is ¼. Each output is the plain average of the values.
- **Scale W<sub>Q</sub> up.** Doubling the queries doubles every score, and the softmax sharpens:
  each row puts nearly all its weight on its best key.

## Things to notice

- **The tokens don't meet until step 3.** Up to there, each row is computed from its own token
  alone. QKᵀ is the only place where one token's numbers touch another's.
- **The output never leaves the green shape.** Its weights are positive and add up to 1, so it's
  a blend of the values, and it stays between them.
- **The layer doesn't know the word order.** Without the mask, swapping two tokens' embeddings only
  swaps their rows in every matrix. Real models add the position to each embedding for this
  reason.
- **Why √2?** With *d* numbers per vector, a dot product adds up *d* products, so the scores
  grow with *d*. Dividing by √*d* keeps the softmax from becoming too sharp in big models, where
  *d* is in the hundreds.

## How it's built

- **The variables.** Each embedding coordinate and each matrix entry is a
  [`<t-var>`](t-var.md). They're page-wide, with no [`<t-scope>`](t-scope.md), so the diagram and the
  planes further down share them. The step is a [`<t-num>`](t-num.md), and the mask and the query
  are [`<t-choice>`](t-choice.md)s.
- **The math knows nothing about the page.** `attention()` takes plain arrays and returns every
  intermediate matrix. The diagram itself is data: a list of nodes, each with the step it runs in,
  and a list of edges. `drawFlow()` marks each node as done, active or pending for the current step.
- **One effect draws it all.** The effect reads every variable, runs the layer and redraws the
  diagram, the panel and both planes. See [Updating a chart](charts.md).
- **The buttons set the step.** Back, Next, Play and a click on a node all call `scope.set("step", …)`,
  like dragging the step number does. Dragging a token in a plane calls `scope.setValues`.

Open the source panels above for the full markup, script and styles.
