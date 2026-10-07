# `<t-math>`

A KaTeX formula wired into the document. Readers drag parameters inside the formula,
and computed results update as they do.

<t-scope class="example" data-show-source="open">
  <t-var name="P" value="1000" min="0" max="10000" step="100" format="%,d"></t-var>
  <t-var name="r" value="5" min="0" max="15" step="0.5" color="#b45b1b #ffad66"></t-var>
  <t-var name="t" value="10" min="1" max="40" color="#147a68 #5ed5bd"></t-var>
  <t-math display>
    \tangle{P} \cdot \left(1 + \frac{\tangle{r}}{100}\right)^{\tangle{t}} = \val[%,.2f]{P * (1 + r / 100) ** t}
  </t-math>
</t-scope>

## Markers

The content is ordinary KaTeX source, plus two markers:

| Marker | Shows |
|---|---|
| `\tangle{a}` | The value of variable `a`, draggable like a `<t-num>`. |
| `\tangle[\alpha]{a}` | The TeX `\alpha` while idle, and the number while being dragged or edited. |
| `\val{expr}` | The live result of a JavaScript [expression](expressions.md). |
| `\val[fmt]{expr}` | The same, with a [format](expressions.md#formats), such as `\val[%.2f]{x / 3}`. |

A `\tangle{}` takes its range, step, color and format from the variable's declaration,
usually a [`<t-var>`](t-var.md) or [`<t-num>`](t-num.md)
elsewhere in the same scope. Keyboard and click-to-type work exactly as they do for
`<t-num>`.

## Symbols until touched

Formulas often read best symbolically. With `\tangle[symbol]{name}`, the reader sees the
symbol, and the number appears only while they drag or edit it:

<t-scope class="example" data-show-source="open">
  <t-var name="a" value="1" min="-3" max="3" step="0.1" color="#246bce #75a7ff"></t-var>
  <t-var name="b" value="-2" min="-6" max="6" step="0.2" color="#b45b1b #ffad66"></t-var>
  <t-math display>
    f(x) = \tangle[a]{a}\,x^2 + \tangle[b]{b}\,x
    \qquad \text{vertex at } x = \val[%.2f]{-b / (2 * a)}
  </t-math>
</t-scope>

## Inline math

Without `display`, the formula sits in the line of text:

<t-scope class="example" data-show-source="open">
  <p>A pendulum of length <t-num name="L" min="0.1" max="5" step="0.1" format="%.1f m">1</t-num> swings with period
    <t-math>T = 2\pi\sqrt{L/g} = \val[%.2f]{2 * Math.PI * Math.sqrt(L / 9.81)}\,\text{s}</t-math>.</p>
</t-scope>

## Matrices {#matrices}

A matrix is ordinary TeX with a marker in each cell. Declare one variable per entry, and the
reader can drag any of them:

<t-scope class="example" data-show-source="open">
  <t-var name="a" value="2" min="-5" max="5"></t-var>
  <t-var name="b" value="1" min="-5" max="5"></t-var>
  <t-var name="c" value="-1" min="-5" max="5"></t-var>
  <t-var name="d" value="3" min="-5" max="5"></t-var>
  <t-var name="x" value="1" min="-5" max="5" color="#b45b1b #ffad66"></t-var>
  <t-var name="y" value="2" min="-5" max="5" color="#b45b1b #ffad66"></t-var>
  <t-math display>
    \begin{pmatrix} \tangle{a} &amp; \tangle{b} \\ \tangle{c} &amp; \tangle{d} \end{pmatrix}
    \begin{pmatrix} \tangle{x} \\ \tangle{y} \end{pmatrix}
    = \begin{pmatrix} \val{a * x + b * y} \\ \val{c * x + d * y} \end{pmatrix}
    \qquad
    \begin{vmatrix} \tangle{a} &amp; \tangle{b} \\ \tangle{c} &amp; \tangle{d} \end{vmatrix}
    = \val{a * d - b * c}
  </t-math>
</t-scope>

- Columns are separated by `&amp;` (the `&` written for HTML), and rows by `\\`.
- `pmatrix` uses round brackets, `bmatrix` square ones and `vmatrix` bars, for a determinant.
- A variable can appear in more than one cell. Put the same name in both off-diagonal cells
  and the matrix stays symmetric while the reader drags:
  `\begin{pmatrix} 1 &amp; \tangle{r} \\ \tangle{r} &amp; 1 \end{pmatrix}`.
- To work with the whole matrix in expressions or a [chart script](charts.md), collect the
  entries with a [`<t-let>`](t-let.md): `<t-let name="A" expr="[[a, b], [c, d]]"></t-let>`
  makes `A[0][1]` the same as `b`.

The [matrix transformations](gallery-matrix.md) page in the gallery builds on this, and draws
what a matrix does to the plane.

## Attributes

| Attribute | Description |
|---|---|
| `display` | Renders the formula as a centered block (KaTeX display mode), instead of inline. |
| `tex` | The TeX source, as an alternative to the element's text. Useful inside Markdown (see [Using it on a blog](blogging.md#markdown)). |

## Writing TeX inside HTML

- In the element text, write `<` as `&lt;` and `&` as
  `&amp;`, including inside `\val{}` expressions. Inside the `tex`
  attribute, both can be written as-is.
- A marker inserts just the number. With negative values, write `-(\tangle{b})` rather
  than `-\tangle{b}`, which would render as `--2`.
- Text results, such as from `\val{x > 0 ? 'yes' : 'no'}`, are set with `\text{…}`.
  So are formatted numbers with letters in them, such as `\val[%d km]{d}`.
- If the TeX doesn't parse, the KaTeX error is shown in place of the formula. Hover over it for the source.

## Loading KaTeX

KaTeX is fetched from jsDelivr the first time a `<t-math>` appears, together with
its stylesheet. If the page already has `window.katex`, that copy is used instead. To
self-host it, see [KaTeX setup](blogging.md#katex).
