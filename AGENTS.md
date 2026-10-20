# vangle

The source is in `src/`. `tangle.js` and `tangle.css` are generated from it: don't read or
edit them. Change `src/`, then run `make build`, then `make test`. The tests fail when the
bundles are stale.

- `src/index.js`: the entry. It holds the public exports, registers the elements and handles `?tangle-debug`.
- `src/core/`: `signals.js` (signals, stale tracking), `scope.js` (scopes, expressions,
  `evalWith`), `format.js` (formats, numeric snapping), `options.js`, `tex.js`, `params.js`,
  `load.js` (lazy KaTeX/Vega/Plot/JSXGraph), `interaction.js` (dragging, the editor, the
  `<t-select>` menu), `element.js` (`TangleElement`), and the shared bases `choice.js` and `code.js`.
- `src/elements/t-*.js`: one file per element, named like its page in `docs/t-*.md`.
- `src/css/*.css`: the styles. `src/index.css` lists them in bundle order.
- `site/bundle.js` is the bundler. It concatenates modules and has rules about imports and
  exports, which are listed at the top of the file. `site/build.js` turns `docs/*.md` into HTML.

Modules import each other with relative named imports only. Each top-level name is declared
in exactly one module.
