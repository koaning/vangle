# `<t-tag>`

An HTML tag whose attributes the reader can change, with the live element right below it.
Drag a number, click a word or toggle an attribute, and the element updates.

<t-scope class="example" data-show-source="open">
  <t-tag tag='input type="range"'>
    <t-num name="min" max="100">0</t-num>
    <t-num name="max" min="1" max="200">100</t-num>
    <t-num name="step" min="1" max="50">5</t-num>
    <t-num name="value" min="0" max="200">40</t-num>
    <t-choice name="disabled" options="true, false">false</t-choice>
  </t-tag>
</t-scope>

`<t-tag>` works like [`<t-call>`](t-call.md): its children are ordinary
[`<t-num>`](t-num.md), [`<t-choice>`](t-choice.md) and [`<t-text>`](t-text.md) elements, and each
one is an attribute. Their values are ordinary variables too, so other elements on the page can use them.

## Attributes

| Attribute | Default | Description |
|---|---|---|
| `tag` | `div` | The element to show: its tag name, plus any attributes that don't change, such as `tag='input type="range"'`. |

On the children:

| Attribute | Description |
|---|---|
| `name` | The variable. It's also the attribute's name, unless `attr` is set. |
| `attr` | The attribute's name, when it differs from the variable's. Use it for names that aren't valid variable names, such as `aria-label` or `pixels-per-step`. |
| `content` | Marks the child that goes between the opening and closing tags, instead of being an attribute. Put it last. |

Text inside `<t-tag>` that isn't in a child is fixed content: `<t-tag tag="button">Save</t-tag>`.

## Values

- **Numbers** are written the way the child shows them, using its `step` and `format`.
- **`true` and `false`** make a boolean attribute. The attribute's name is the toggle itself,
  and it's struck through when the attribute is off. A [`<t-choice>`](t-choice.md) with
  `options="true, false"` holds a real boolean.
- **Text and choices** are written as their value. For a choice with `label:value` options, the
  element gets the value, so leave out the labels if the code and the element should match.

<t-scope class="example" data-show-source="open">
  <t-tag tag='button type="button"'>
    <t-choice name="disabled" options="true, false">true</t-choice>
    <t-text name="title">Saves your work</t-text>
    <t-text name="label" content>Save changes</t-text>
  </t-tag>
</t-scope>

## Documenting an element

The element can be one of vangle's own, which makes `<t-tag>` a playground for its
attributes. Change the range or the format, then drag the number in the preview:

<t-scope class="example" data-show-source="open">
  <t-tag tag='t-num name="cookies"'>
    <t-num name="min" max="10">0</t-num>
    <t-num name="max" min="1" max="100">20</t-num>
    <t-num name="pps" attr="pixels-per-step" min="1" max="20">5</t-num>
    <t-choice name="format" options="%d, %d cookies, %d 🍪">%d cookies</t-choice>
    3
  </t-tag>
</t-scope>

## Layout

The tag stays on one line while it fits. When it's too wide, each attribute goes on its own line:

```text
<input
    type="range"
    min="0"
    max="100"
    step="5"
    value="40"
>
```
