# `<t-panel>`

Floats its contents in a panel that stays in view while the page scrolls. Put a post's
controls in one, and they follow the reader through the prose and formulas they drive.

The panel in the bottom-right corner of this page comes from the example below. Drag it by its
header, minimize it with <kbd>−</kbd>, and scroll: the numbers in it keep updating the text.

<t-scope class="example" data-show-source="open">
  <t-panel label="Savings" corner="bottom-right">
    <p>Save <t-num name="monthly" min="0" max="2000" step="25" format="$%d">300</t-num> a month<br>
      at <t-num name="rate" min="0" max="12" step="0.1" format="%.1f%%">5</t-num> a year<br>
      for <t-num name="years" min="1" max="40">20</t-num> years.</p>
  </t-panel>
  <t-let name="r" expr="rate / 100 / 12"></t-let>
  <t-let name="n" expr="years * 12"></t-let>
  <t-let name="total" expr="r ? monthly * ((1 + r) ** n - 1) / r : monthly * n"></t-let>
  <p>After <t-out expr="years"></t-out> years you'll have <t-out expr="total" format="$%,d"></t-out>,
    of which <t-out expr="monthly * n" format="$%,d"></t-out> is what you put in and
    <t-out expr="total - monthly * n" format="$%,d"></t-out> is interest.</p>
</t-scope>

## Attributes

| Attribute | Default | Description |
|---|---|---|
| `corner` | `bottom-right` | Where the panel starts: `top-left`, `top-right`, `bottom-left` or `bottom-right`. It sits 16px from the edges of the viewport. |
| `label` | | A caption on the header, which stays visible when the panel is minimized. Also the panel's accessible name. Long labels are cut off with an ellipsis. |
| `width` | fits the content | The width in pixels. Set it to reflow long text. |
| `collapsed` | | Start minimized, showing only the header. |

The panel is never dismissed, only minimized, so its contents are always one click away.
Minimizing keeps the panel's width, so the header stays a readable bar.

## Behavior

- **Drag the header** to move the panel. It's kept fully on screen, also when the window is resized.
- **The button on the header** minimizes and expands the panel, with a short folding animation
  (none if the reader prefers reduced motion). From JavaScript, set the `collapsed` property or
  attribute.
- **The contents keep their scope.** The panel doesn't move its children anywhere, so a
  `<t-panel>` inside a `<t-scope>` uses that scope's variables, like the example above.
- **Without JavaScript**, the contents show in place, as ordinary content.
- **It's `position: fixed`.** An ancestor with a `transform`, `filter` or `contain` creates a new
  containing block, which pins the panel to that ancestor instead of the viewport. Put the
  `<t-panel>` outside such elements.
- The panel is at `z-index: 1000`. Override it with `t-panel { z-index: … }`.

## Styling {#styling}

The panel uses `--tangle-surface` for its background, so it follows the theme. Its pieces are
exposed as [CSS shadow parts](https://developer.mozilla.org/en-US/docs/Web/CSS/::part):

| Selector | Matches |
|---|---|
| `t-panel` | The panel itself: border, background, shadow, `z-index`. |
| `t-panel::part(header)` | The draggable header bar. |
| `t-panel::part(label)` | The caption on the header. |
| `t-panel::part(toggle)` | The minimize button. |
| `t-panel::part(body)` | The box around the contents, with its padding. |
| `t-panel[collapsed]` | A minimized panel. |

```css
t-panel {
  border-radius: 0;
  box-shadow: none;
}
t-panel::part(header) {
  background: var(--tangle-accent);
  color: white;
}
```
