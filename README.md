# vangle

Reactive documents for static HTML. This is a modern take on Bret Victor's [Tangle](https://worrydream.com/Tangle/), with many widgets to make it easy to compose more engaging pages easily. 

- One ES module (`tangle.js`) and one stylesheet (`tangle.css`). No build step, no dependencies.
- Declarative: posts are plain HTML, and you don't write an `update()` function. Values recompute automatically through a small signals core.
- Dependencies, like KaTeX, are loaded only when a page contains a related element, like `<t-math>`. If your blog already loads `katex`, that copy is used.

To really appreciate what it is all about, you'll have to go here and see everything for yourself.  

https://koaning.github.io/vangle/

## Install

Load it from jsDelivr:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/koaning/vangle@v0.1.0/tangle.min.css">
<script type="module" src="https://cdn.jsdelivr.net/gh/koaning/vangle@v0.1.0/tangle.min.js"></script>
```

Or copy `tangle.js` and `tangle.css` into your site and point the two tags at them. If you
import from vangle in your own modules, use the same URL as the `<script>` tag, or the page
gets a second copy with its own variables.

## Working on vangle

The source is in `src/`: the core in `src/core/`, one file per element in `src/elements/`,
and the styles in `src/css/`. `make build` bundles it into `tangle.js` and `tangle.css`,
which are committed because they're what pages load, and rebuilds the docs. `make test`
fails if the bundles are out of date. `make dev` serves the docs at http://localhost:8000
and rebuilds and reloads when anything changes.
