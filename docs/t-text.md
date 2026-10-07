# `<t-text>`

A piece of text the reader clicks to rewrite. Its variable holds a string.

<t-scope class="example" data-show-source="open">
  <p>Dear <t-text name="who">reader</t-text>, this page has been waiting for you.
    In capitals: <t-out expr="who.toUpperCase()"></t-out>, which is
    <t-out expr="who.length"></t-out> letters long.</p>
</t-scope>

The element's text is the starting value, and also what readers see without JavaScript.

## Attributes

| Attribute | Default | Description |
|---|---|---|
| `name` | *required* | The variable that holds the text. |
| `value` | text content | The starting value. |
| `format` | | How the text is displayed, for example `"“%s”"`. See [formats](expressions.md#formats). |
| `color` | accent color | One CSS color, or two for light and dark mode. |
| `label` | the name | The accessible name. |

## Interaction

| Input | Effect |
|---|---|
| Click, <kbd>Enter</kbd> or <kbd>Space</kbd> | Opens a field to type new text. |

In the field, <kbd>Enter</kbd> confirms and <kbd>Esc</kbd> cancels; clicking away also confirms.
Unlike [`<t-num>`](t-num.md), the field keeps exactly what's typed: it doesn't evaluate expressions.

Inside a [`<t-call>`](t-call.md), a `<t-text>` is a string argument and gets quotes.
