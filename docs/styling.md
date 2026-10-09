# Styling

`tangle.css` is small and built on custom properties and plain selectors,
so it's easy to fit to your blog's look.

## Custom properties

| Property | Default | Used for |
|---|---|---|
| `--tangle-accent` | `#246bce` (dark: `#75a7ff`) | Color of numbers, choices and formula parameters without their own `color`. |
| `--tangle-soft` | `14%` | Strength of the hover and drag highlight. |
| `--tangle-surface` | `#fff` (dark: `#22201d`) | Background of the typing field and text of the "drag" hint. |
| `--tangle-error` | `#c9382b` | Broken outputs and formula errors. |
| `--tangle-muted` | `55%` | Strength of the punctuation in a [`<t-call>`](t-call.md) or [`<t-tag>`](t-tag.md). |
| `--tangle-code-tag`, `--tangle-code-attr`, `--tangle-code-string` | `#6f5cbd`, `#b45b1b`, `#147a68` (dark: `#b9a8ff`, `#ffad66`, `#5ed5bd`) | Syntax highlighting in `<t-call>` and `<t-tag>`: tag names, attribute and argument names, and strings. Values the reader can change use the accent color. |
| `--tangle-color` | | Set per element from a variable's `color` attribute. |
| `--tangle-chart-grid`, `--tangle-chart-text`, `--tangle-chart-font` | `12%`, `60%`, `12px` system font | Strength of chart gridlines and labels, and their font. See [`<t-vega>`](t-vega.md#theme) and [`<t-obsplot>`](t-obsplot.md#theme). |

Set them on `:root` to restyle the whole site, or on any container to restyle part of a page:

<div class="example warm" data-show-source="open">
  <p>Brew <t-num name="cups" min="1" max="12">2</t-num> cups with
    <t-out expr="cups * 15"></t-out> g of coffee.</p>
</div>

The stylesheet behind that example:

<style data-show-source="open">
  .warm {
    --tangle-accent: #c2410c;
    --tangle-soft: 22%;
  }
  .warm t-num {
    border-bottom-style: solid;
    font-weight: 600;
  }
  .warm t-num::after {
    content: "↔";
  }
</style>

## Selectors and states

| Selector | Matches |
|---|---|
| `t-num`, `t-choice`, `t-text`, `t-out`, `t-call`, `t-tag` | The elements themselves. |
| `.t-call-key`, `.t-call-sep`, `.t-call-open`, `.t-call-close` | The parts a `<t-call>` adds: `name=`, the commas, `fn(` and `)`. `t-call.is-multiline` while it wraps one argument per line. `<t-tag>` has the same parts as `.t-tag-*`. |
| `.t-code-punct`, `.t-code-tag`, `.t-code-attr`, `.t-code-string`, `.t-code-fn` | The syntax-highlighting tokens inside those parts. |
| `.t-tag-flag` | A boolean attribute in a `<t-tag>`, which toggles it. `.is-off` while the attribute is off. |
| `.t-tag-preview` | The live element below a `<t-tag>`'s code. |
| `t-math [data-tangle-param]` | A `\tangle{}` inside a formula. |
| `[data-tangle-param]` | Anything draggable: a `<t-num>`, a `\tangle{}`, or [your own element](custom-elements.md#draggable). |
| `t-math .tangle-val` | A `\val{}` inside a formula. Unstyled by default. |
| `.is-hot` | Every number bound to the variable under the pointer. |
| `.is-active` | Every number bound to the variable being dragged or edited. |
| `t-num::after` | The "drag" hint shown on hover. |
| `html.tangle-dragging` | The page, during a drag. |
| `.tangle-editor` | The typing field. `.is-invalid` while it holds something unparseable. |
| `t-out.is-error` | An output whose expression threw. |
| `.tangle-math-error` | The message shown in place of a formula that doesn't parse. |
| `t-panel::part(header)`, `::part(label)`, `::part(toggle)`, `::part(body)` | The pieces of a floating panel. `t-panel[collapsed]` while it's minimized. See [`<t-panel>`](t-panel.md#styling). |
| `t-paint::part(toolbar)`, `::part(button)`, `::part(paper)`, `::part(canvas)` | The pieces of a drawing canvas. See [`<t-paint>`](t-paint.md#styling). |
| `.tangle-vega` | A Vega chart. `.is-loading` until Vega has loaded; `.tangle-vega-error` replaces it on failure. See [`<t-vega>`](t-vega.md#how-vega-loads). |
| `.tangle-obsplot` | An Observable Plot chart. `.is-loading` until Plot has loaded; `.tangle-obsplot-error` replaces it when loading fails or the expression throws. See [`<t-obsplot>`](t-obsplot.md). |

### Recipes

```css
/* No "drag" hint */
t-num::after { display: none; }

/* Make computed results in formulas stand out */
t-math .tangle-val { color: var(--tangle-accent); }

/* A dotted underline instead of dashed */
t-num { border-bottom-style: dotted; }

/* Style a scope as a card (scopes have display: contents by default) */
t-scope.card { display: block; padding: 1rem; border: 1px solid #ddd; border-radius: 8px; }
```

## Dark mode

The defaults follow `prefers-color-scheme`. If your site switches themes with a class or
attribute, the dark values also apply under `html.dark` and `html[data-theme="dark"]`,
and `html[data-theme="light"]` forces the light ones.

Variables can have a color per theme: `color="#246bce #75a7ff"` means blue on light
backgrounds and light blue on dark ones. This uses CSS `light-dark()`, which only picks the
dark color when the page declares support for it:

```css
:root { color-scheme: light dark; }
```
