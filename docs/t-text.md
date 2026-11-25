# `<t-text>`

A piece of text the reader clicks to rewrite. Its variable holds a string.

<t-scope class="example" data-show-source="open">
  <p>Dear <t-text name="who" previous="who_prev">reader</t-text>, this page has been waiting for you.
    In capitals: <t-out expr="who.toUpperCase()"></t-out>, which is
    <t-out expr="who.length"></t-out> letters long
    (previously <t-out expr="who_prev"></t-out>).</p>
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
| `previous` | | A variable to hold the text from before the last committed edit. |

## Interaction

| Input | Effect |
|---|---|
| Click, <kbd>Enter</kbd> or <kbd>Space</kbd> | Opens a field to type new text. |

In the field, the variable updates live as you type. <kbd>Enter</kbd> (or clicking away)
commits the change, and <kbd>Esc</kbd> cancels and restores the text from before you opened it.
Unlike [`<t-num>`](t-num.md), the field keeps exactly what's typed: it doesn't evaluate expressions.

Inside a [`<t-call>`](t-call.md), a `<t-text>` is a string argument and gets quotes.
