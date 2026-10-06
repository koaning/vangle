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
| `--tangle-color` | | Set per element from a variable's `color` attribute. |
| `--tangle-chart-stroke`, `--tangle-chart-area`, `--tangle-chart-grid`, `--tangle-chart-text`, `--tangle-chart-font` | | Chart lines, fills, gridlines and labels. See [Restyling charts](t-chart.md#restyling). |

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
| `t-num`, `t-choice`, `t-out` | The elements themselves. |
| `t-math [data-tangle-param]` | A `\tangle{}` inside a formula. |
| `t-math .tangle-val` | A `\val{}` inside a formula. Unstyled by default. |
| `.is-hot` | Every number bound to the variable under the pointer. |
| `.is-active` | Every number bound to the variable being dragged or edited. |
| `t-num::after` | The "drag" hint shown on hover. |
| `html.tangle-dragging` | The page, during a drag. |
| `.tangle-editor` | The typing field. `.is-invalid` while it holds something unparseable. |
| `t-out.is-error` | An output whose expression threw. |
| `.tangle-math-error` | The message shown in place of a formula that doesn't parse. |
| `.tangle-chart`, `.tangle-line`, `.tangle-area`, `.tangle-bar`, `.tangle-legend` | A chart's `<svg>`, its shapes and its legend. See [`<t-chart>`](t-chart.md#restyling). |

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
