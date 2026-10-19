<nav class="topbar">
  <a href="docs/index.html">Docs</a>
  <a href="https://github.com/koaning/vangle">GitHub</a>
  <button class="theme-toggle" type="button" data-theme-toggle aria-label="Dark mode"></button>
</nav>

# vangle: reactive documents with formulas

A modern take on Bret Victor's [Tangle](https://worrydream.com/Tangle/). You write HTML with a
few custom elements, readers drag the numbers in it, and everything that depends on them
updates, KaTeX formulas included. One ES module, no dependencies, no build step.

This project is *reactive*. In short, that means that a change doesn't redraw the whole page. Each variable remembers which variables it read, and
only the ones that read a changed variable run again. Here, `count` adds one to a counter every
time a variable runs. See [What recomputes](docs/gallery-recompute.md) for how it's built.

<t-scope id="recompute" data-show-source>
  <t-let name="sum" expr="count('sum', a + b)"></t-let>
  <t-let name="product" expr="count('product', sum * c)"></t-let>
  <p><t-num name="a" min="0" max="10">1</t-num> + <t-num name="b" min="0" max="10">2</t-num>
    = <t-out expr="sum"></t-out>, ran <t-out expr="sumRuns" format="%d×"></t-out>.</p>
  <p><t-out expr="sum"></t-out> × <t-num name="c" min="0" max="10">3</t-num>
    = <t-out expr="product"></t-out>, ran <t-out expr="productRuns" format="%d×"></t-out>.</p>
</t-scope>

<script type="module" data-show-source>
  import { registerFunction, scopeOf } from "./tangle.js";

  // count("sum", value) returns value, and adds one to the variable sumRuns.
  const scope = scopeOf(document.querySelector("#recompute"));
  registerFunction("count", (name, value) => {
    scope.set(`${name}Runs`, (scope.peek(`${name}Runs`) ?? 0) + 1);
    return value;
  });
</script>

This is plenty useful, especially when you combine it with widgets like the maths formula. 

<section data-show-source>
  <t-var name="P" value="1000" min="0" max="10000" step="100" format="%,d"></t-var>
  <t-var name="r" value="5" min="0" max="15" step="0.5" color="#b45b1b #ffad66"></t-var>
  <t-var name="t" value="10" min="1" max="40" color="#147a68 #5ed5bd"></t-var>
  <t-math display>
    \tangle{P} \cdot \left(1 + \frac{\tangle{r}}{100}\right)^{\tangle{t}} = \val[%,.2f]{P * (1 + r / 100) ** t}
  </t-math>
</section>

You can combine widgets with other widgets. And everything just reacts! 

A 2×2 matrix moves every point of the plane, and its two columns say where the arrows
<span class="i-hat">î</span> and <span class="j-hat">ĵ</span> end up. See
[Matrix transformations](docs/gallery-matrix.md) for how it's built.

<div class="example matrix-demo" data-show-source>
  <t-scope id="matrix">
    <t-var name="a" value="1" min="-2" max="2" step="0.1" color="#246bce #75a7ff"></t-var>
    <t-var name="c" value="0.5" min="-2" max="2" step="0.1" color="#246bce #75a7ff"></t-var>
    <t-var name="b" value="-0.5" min="-2" max="2" step="0.1" color="#b45b1b #ffad66"></t-var>
    <t-var name="d" value="1" min="-2" max="2" step="0.1" color="#b45b1b #ffad66"></t-var>
    <t-let name="det" expr="a * d - b * c"></t-let>
    <t-math display>
      \begin{pmatrix} \tangle{a} &amp; \tangle{b} \\ \tangle{c} &amp; \tangle{d} \end{pmatrix}
      \qquad \det = \val[%.2f]{det} \qquad \text{area} = \val[%.2f]{Math.abs(det)}
    </t-math>
    <div class="presets">
      <button type="button" data-matrix="1 0 0 1">Identity</button>
      <button type="button" data-matrix="0 -1 1 0">Rotate 90°</button>
      <button type="button" data-matrix="1 1 0 1">Shear</button>
      <button type="button" data-matrix="1.5 0 0 0.5">Stretch</button>
      <button type="button" data-matrix="-1 0 0 1">Mirror</button>
      <button type="button" data-matrix="1 2 0.5 1">Flatten</button>
    </div>
    <svg viewBox="-300 -170 600 340" role="img" aria-label="The plane, warped by the matrix">
      <defs>
        <radialGradient id="matrix-fade"><stop offset="0.55" stop-color="white"></stop><stop offset="1" stop-color="black"></stop></radialGradient>
        <mask id="matrix-edges"><rect x="-300" y="-170" width="600" height="340" fill="url(#matrix-fade)"></rect></mask>
      </defs>
      <g mask="url(#matrix-edges)">
        <g class="paper"></g>
        <path class="warp i"></path>
        <path class="warp j"></path>
      </g>
      <rect class="unit" x="0" y="-56" width="56" height="56"></rect>
      <polygon class="image"></polygon>
      <g class="arrow i"><line></line><polygon></polygon><text>î</text><circle class="handle" r="18"></circle></g>
      <g class="arrow j"><line></line><polygon></polygon><text>ĵ</text><circle class="handle" r="18"></circle></g>
    </svg>
  </t-scope>
</div>

<script type="module" data-show-source>
  import { scopeOf } from "./tangle.js";

  const root = document.querySelector("#matrix");
  const scope = scopeOf(root);
  const svg = root.querySelector("svg");
  const unit = 56; // pixels per unit, with y pointing up
  const px = (x, y) => [x * unit, -y * unit]; // an [x, y] pair prints as "x,y" in SVG attributes

  // The paper grid never changes, so draw it once. The axes are a little darker.
  const lines = [];
  for (let x = -5; x <= 5; x++) lines.push(`<line class="${x ? "" : "axis"}" x1="${x * unit}" x2="${x * unit}" y1="-170" y2="170"/>`);
  for (let y = -3; y <= 3; y++) lines.push(`<line class="${y ? "" : "axis"}" x1="-300" x2="300" y1="${y * unit}" y2="${y * unit}"/>`);
  svg.querySelector(".paper").innerHTML = lines.join("");

  const [warpI, warpJ] = svg.querySelectorAll(".warp");
  const image = svg.querySelector(".image");
  const arrows = [...svg.querySelectorAll(".arrow")].map((g, i) => ({
    g, x: ["a", "b"][i], y: ["c", "d"][i],
    line: g.querySelector("line"), head: g.querySelector("polygon"),
    label: g.querySelector("text"), handle: g.querySelector(".handle"),
  }));

  // Draws an arrow from the origin to (x, y), in pixels: a line, a head and a label past the tip.
  function drawArrow({ line, head, label, handle }, x, y) {
    const length = Math.hypot(x, y);
    const [ux, uy] = length ? [x / length, y / length] : [1, 0];
    const size = Math.min(14, length); // a short arrow gets a smaller head
    const [bx, by] = [x - ux * size, y - uy * size];
    line.setAttribute("x2", bx);
    line.setAttribute("y2", by);
    head.setAttribute("points", `${x},${y} ${bx - uy * size * 0.45},${by + ux * size * 0.45} ${bx + uy * size * 0.45},${by - ux * size * 0.45}`);
    label.setAttribute("x", x + ux * 20);
    label.setAttribute("y", y + uy * 20);
    handle.setAttribute("cx", x);
    handle.setAttribute("cy", y);
  }

  // Redraws the plane whenever a, b, c or d changes (and so det, which is computed from them).
  scope.effect((s) => {
    const [a, b, c, d] = ["a", "b", "c", "d"].map((name) => s.get(name));
    const map = (x, y) => px(a * x + b * y, c * x + d * y);

    // The image of every grid line. Lines that were vertical now run along ĵ, the others along î.
    const along = (from, to) => `M${from}L${to}`;
    const n = 12;
    const vertical = [], horizontal = [];
    for (let k = -n; k <= n; k++) {
      vertical.push(along(map(k, -n), map(k, n)));
      horizontal.push(along(map(-n, k), map(n, k)));
    }
    warpJ.setAttribute("d", vertical.join(""));
    warpI.setAttribute("d", horizontal.join(""));

    image.setAttribute("points", [map(0, 0), map(1, 0), map(1, 1), map(0, 1)].join(" "));
    svg.classList.toggle("is-flipped", s.get("det") < 0);

    drawArrow(arrows[0], ...map(1, 0));
    drawArrow(arrows[1], ...map(0, 1));
  });

  // Dragging an arrow's tip sets its column of the matrix. set() doesn't apply min, max or
  // step, so the values are rounded and clamped here.
  const fit = (v) => Math.min(2, Math.max(-2, Math.round(v * 10) / 10));
  for (const { g, x, y, handle } of arrows) {
    handle.addEventListener("pointerdown", (event) => {
      stopTween();
      handle.setPointerCapture(event.pointerId);
      g.classList.add("is-dragging");
      const move = (event) => {
        const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
        scope.setValues({ [x]: fit(p.x / unit), [y]: fit(-p.y / unit) });
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("lostpointercapture", () => {
        handle.removeEventListener("pointermove", move);
        g.classList.remove("is-dragging");
      }, { once: true });
    });
  }

  // A preset glides to its matrix: every frame sets the four variables a little further along.
  let frame = null;
  const stopTween = () => cancelAnimationFrame(frame);
  for (const button of root.querySelectorAll("[data-matrix]")) {
    button.addEventListener("click", () => {
      stopTween();
      const names = ["a", "b", "c", "d"];
      const from = names.map((name) => scope.peek(name));
      const to = button.dataset.matrix.split(" ").map(Number);
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / 600);
        const ease = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
        scope.setValues(Object.fromEntries(names.map((name, i) => [name, from[i] + (to[i] - from[i]) * ease])));
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    });
  }
  // Dragging a number in the formula takes over from a running preset.
  root.querySelector("t-math").addEventListener("pointerdown", stopTween);
</script>

<style data-show-source>
  .matrix-demo { --i: light-dark(#246bce, #75a7ff); --j: light-dark(#b45b1b, #ffad66); }
  .i-hat { color: light-dark(#246bce, #75a7ff); font-style: italic; }
  .j-hat { color: light-dark(#b45b1b, #ffad66); font-style: italic; }

  .matrix-demo .presets { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.4rem; margin: 0.25rem 0 1rem; }
  .matrix-demo .presets button { margin: 0; }
  .matrix-demo svg { display: block; width: 100%; height: auto; }

  .matrix-demo .paper line { stroke: currentColor; stroke-opacity: 0.07; }
  .matrix-demo .paper .axis { stroke-opacity: 0.25; }
  .matrix-demo .warp { fill: none; stroke-width: 1.25; stroke-opacity: 0.35; }
  .matrix-demo .warp.i { stroke: var(--i); }
  .matrix-demo .warp.j { stroke: var(--j); }

  .matrix-demo .unit { fill: none; stroke: currentColor; stroke-opacity: 0.45; stroke-dasharray: 3 4; }
  .matrix-demo .image { fill: var(--i); fill-opacity: 0.16; stroke: currentColor; stroke-opacity: 0.5; stroke-linejoin: round; }
  .matrix-demo .is-flipped .image { fill: var(--tangle-error); }

  .matrix-demo .arrow line { stroke-width: 3.5; stroke-linecap: round; }
  .matrix-demo .arrow.i { stroke: var(--i); fill: var(--i); }
  .matrix-demo .arrow.j { stroke: var(--j); fill: var(--j); }
  .matrix-demo .arrow text { stroke: none; font: italic 600 20px Georgia, serif; text-anchor: middle; dominant-baseline: middle; pointer-events: none; }
  .matrix-demo .handle { stroke: none; fill-opacity: 0; cursor: grab; touch-action: none; transition: fill-opacity 120ms; }
  .matrix-demo .handle:hover, .matrix-demo .is-dragging .handle { fill-opacity: 0.18; }
  .matrix-demo .is-dragging .handle { cursor: grabbing; }
</style>

The nice thing about these widgets is that agents are also really good at working with them. They click together like HTML legos but can still be made custom with javascripts. 

<section data-show-source>
  <t-var name="a" value="1" min="-3" max="3" step="0.1" color="#246bce #75a7ff"></t-var>
  <t-var name="b" value="-1" min="-6" max="6" step="0.2" color="#b45b1b #ffad66"></t-var>
  <t-var name="c" value="-2" min="-6" max="6" step="0.2" color="#147a68 #5ed5bd"></t-var>
  <t-let name="disc" expr="b * b - 4 * a * c"></t-let>
  <t-math display>f(x) = \tangle[a]{a}\,x^2 + \tangle[b]{b}\,x + \tangle[c]{c}</t-math>
  <p>With <t-num name="a"></t-num>, <t-num name="b"></t-num> and <t-num name="c"></t-num>
    the parabola opens <t-out expr="a > 0 ? 'upward' : a < 0 ? 'downward' : 'not at all (it is a line)'"></t-out>
    and has <t-out expr="disc > 0 ? 'two real roots' : disc === 0 ? 'one real root' : 'no real roots'"></t-out>:</p>
  <t-math display>
    x = \frac{-(\tangle{b}) \pm \sqrt{\val[%.2f]{disc}}}{2 \cdot \tangle{a}}
    \quad\Rightarrow\quad
    x_1 = \val[%.2f]{(-b - Math.sqrt(disc)) / (2 * a)}, \;
    x_2 = \val[%.2f]{(-b + Math.sqrt(disc)) / (2 * a)}
  </t-math>
  <canvas id="plot" class="plot" aria-label="Plot of f(x)"></canvas>
</section>
<details>
  <summary>plot script (the JS escape hatch)</summary>
  <script type="text/plain" data-lang="js">
    import { scopeOf } from "./tangle.js";
    const scope = scopeOf(document);
    scope.effect((s) => draw(s.get("a"), s.get("b"), s.get("c")));
  </script>
</details>

<script type="module">
  import { scopeOf } from "./tangle.js";

  const canvas = document.getElementById("plot");
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function draw(a, b, c) {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const g = canvas.getContext("2d");
    g.scale(dpr, dpr);
    const xs = [-5, 5], ys = [-8, 8];
    const X = (x) => ((x - xs[0]) / (xs[1] - xs[0])) * width;
    const Y = (y) => height - ((y - ys[0]) / (ys[1] - ys[0])) * height;

    g.strokeStyle = css("--line");
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, Y(0)); g.lineTo(width, Y(0));
    g.moveTo(X(0), 0); g.lineTo(X(0), height);
    g.stroke();

    g.strokeStyle = css("--tangle-accent");
    g.lineWidth = 2.5;
    g.beginPath();
    for (let px = 0; px <= width; px += 2) {
      const x = xs[0] + (px / width) * (xs[1] - xs[0]);
      g.lineTo(px, Y(a * x * x + b * x + c));
    }
    g.stroke();

    const disc = b * b - 4 * a * c;
    if (a !== 0 && disc >= 0) {
      g.fillStyle = css("--ink");
      for (const r of new Set([(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)])) {
        g.beginPath();
        g.arc(X(r), Y(0), 4.5, 0, 2 * Math.PI);
        g.fill();
      }
    }
  }

  const scope = scopeOf(document);
  scope.effect((s) => draw(s.get("a"), s.get("b"), s.get("c")));
  const redraw = () => draw(scope.peek("a"), scope.peek("b"), scope.peek("c"));
  new ResizeObserver(redraw).observe(canvas);
  new MutationObserver(redraw).observe(document.documentElement, { attributeFilter: ["data-theme"] });
</script>

There are even some fancy features like scopes!

<section data-show-source>
  <t-scope>
    <p>Alice runs <t-num name="km" min="0" max="42" step="0.5">5</t-num> km at
      <t-num name="pace" min="3" max="9" step="0.1">5.5</t-num> min/km, which takes
      <t-out expr="km * pace" format="%d"></t-out> minutes.</p>
  </t-scope>
  <t-scope>
    <p>Bob runs <t-num name="km" min="0" max="42" step="0.5">10</t-num> km at
      <t-num name="pace" min="3" max="9" step="0.1">6</t-num> min/km, which takes
      <t-out expr="km * pace" format="%d"></t-out> minutes.</p>
  </t-scope>
</section>

<footer>
  Original Tangle © Bret Victor, MIT license.
</footer>

There is plenty to learn and play with, so feel free to explore all the demos! 

