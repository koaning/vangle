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

## Show every change

The user has to be able to inspect what you changed, so a change isn't done until it's running
and you've given them a link they can click on their own machine. After `make build` and
`make test`:

1. Start the dev server in the background on a free port between 3000 and 9999:
   `make dev PORT=<port>`. It rebuilds and reloads the page when files change, so leave it
   running. If your tools stop background commands after a time limit, give it the longest
   one, and if it gets stopped anyway, tell the user that the link no longer works.
2. Link to the page that shows the change, such as `/docs/t-num.html` or
   `/docs/gallery-amdahl.html`, not just the site root. If the change is in `src/`, link a
   page that uses what changed.

The link depends on where you're running:

- **On an exe.dev VM**, for example under Paseo, `localhost` means the VM, so a localhost
  link won't open on the user's machine. exe.dev forwards ports 3000–9999 to
  `https://<vm>.exe.xyz:<port>/`, and only people with access to the VM can open it. You're
  on a VM if `getent hosts "$(hostname).exe.xyz"` prints an address. If it does, the link is
  `https://$(hostname).exe.xyz:<port>/docs/<page>.html`. Don't give Paseo's `serve` script
  URL (`http://serve--….localhost:6767`), or its port, which is outside 3000–9999. Neither
  can be reached from outside the VM.
- **Otherwise** you're on the user's machine, and the link is
  `http://localhost:<port>/docs/<page>.html`.

## Talking about vangle

Explain vangle terms when you use them with the user, especially `name`. Don't just say "with
`name`, …". Say what it does: `name="x"` puts the element's value in a page variable `x` that other
elements read, and that can be set from code. Show a two-line example the first time it comes up.
