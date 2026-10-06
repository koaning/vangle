# Using it on a blog

vangle is made for static sites. Here's how it fits with layouts, Markdown, KaTeX and
content security policies.

## Add it to your layout

Copy `tangle.js` and `tangle.css` into your static assets folder and include them in
the base template, so every post can use the elements:

```html
<link rel="stylesheet" href="/assets/tangle.css">
<script type="module" src="/assets/tangle.js"></script>
```

Pages without any `t-*` elements pay only for downloading the file, about 30 KB unminified.
Nothing else is loaded or run. Formulas fetch KaTeX only when they appear.

## Markdown {#markdown}

Most Markdown processors pass HTML through, so the elements work in a Markdown post as-is. Some need
a setting to allow raw HTML:

| Generator | Setting |
|---|---|
| Hugo (Goldmark) | `markup.goldmark.renderer.unsafe = true` |
| markdown-it (Eleventy, VitePress, …) | `html: true`. Eleventy turns it on by default. |
| Jekyll (kramdown), Python-Markdown | Raw HTML is allowed by default. |

### Inline elements in a paragraph

Inside a paragraph, Markdown still processes the text *between* tags. That's harmless for
`<t-num>3</t-num>`, but TeX suffers: `_` and `*` may become
emphasis, and backslash escapes like `\,` lose their backslash. For formulas inside a
paragraph, put the TeX in the `tex` attribute, which Markdown leaves alone:

```html
A circle of radius <t-num name="r">2</t-num> has area <t-math tex="\pi r^2 = \val[%.2f]{Math.PI * r ** 2}"></t-math>.
```

### Display formulas

A `<t-math display>` tag on its own line, after a blank line, starts an HTML block
in CommonMark. Its content is left untouched as long as it contains no blank lines:

```html
Some text before.

<t-math display>
  x_{1,2} = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
</t-math>

Some text after.
```

## KaTeX setup {#katex}

By default the first `<t-math>` on a page imports KaTeX 0.19.0 from jsDelivr and adds
its stylesheet. You have three other options:

- **Your blog already loads KaTeX.** If `window.katex` exists (from a regular
  `<script>` tag before `tangle.js`), vangle uses it, and adds no second stylesheet
  if one with "katex" in its URL is already on the page. KaTeX's auto-render extension only touches
  `$…$` delimiters, so it doesn't conflict with `<t-math>`.
- **Self-host KaTeX** by pointing vangle at your copy before any formula loads:
  ```html
  <script>
    window.TangleConfig = {
      katexUrl: "/assets/katex/katex.mjs",
      katexCssUrl: "/assets/katex/katex.min.css",
    };
  </script>
  ```
- **From a module**, call `configure({ katexUrl, katexCssUrl })`
  (see the [JavaScript API](javascript.md#configuration)).

## Content Security Policy

Expressions are compiled with `new Function`, so a site that sends a CSP header needs
`'unsafe-eval'` in `script-src`. If you load KaTeX from jsDelivr, also allow
`https://cdn.jsdelivr.net` in `script-src`, `style-src` and `font-src`.
Most static hosts send no CSP, so there's usually nothing to do.

## Several posts on one page

All elements on a page share variables unless you scope them. If your index page renders full posts,
wrap each one in a [`<t-scope>`](t-scope.md) in the template, so two posts
that both use `x` don't interfere with each other.

## Feeds and readers without JavaScript

RSS readers and reading modes don't run scripts. What they show:

- `<t-num>` and `<t-choice>` show their text: the starting value or option.
- `<t-out>` shows whatever fallback text you put inside it. Writing the starting result there
  keeps sentences readable.
- `<t-math>` shows its raw TeX source.
