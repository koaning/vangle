# `<t-fetch>`

A variable whose value comes from a server. It sends a request built from other variables,
sends it again whenever they change, and puts the answer in a variable.

<t-scope class="example" data-show-source="open">
  <p>On <t-choice name="planet" options="Mercury:mercury, Venus:venus, Earth:earth, Mars:mars, Jupiter:jupiter, Saturn:saturn, Uranus:uranus, Neptune:neptune">Mars</t-choice>,
    someone who weighs <t-num name="weight" min="20" max="150">70</t-num> kg at home would weigh
    <t-out expr="p && weight * p.gravity / 9.81" format="%d"></t-out> kg. A day lasts
    <t-out expr="p?.day_hours" format="%,.1f"></t-out> hours, and sunlight is
    <t-out expr="p && 1 / p.distance_au ** 2" format="percent"></t-out> as strong as on Earth.</p>
  <t-fetch name="p" url="data/planets/${planet}.json"></t-fetch>
</t-scope>

Each planet is a JSON file next to this page, such as
[`data/planets/mars.json`](data/planets/mars.json). Changing the planet fetches another file.
Changing the weight doesn't, because the URL doesn't use it. The page shows `…` until the
first answer arrives.

The element isn't rendered. Any server that answers HTTP works: static files, as here, or a
backend of your own that computes the answer (see [A backend](#backend)).

## Attributes

| Attribute | Default | Description |
|---|---|---|
| `name` | *required* | The variable that holds the answer. It keeps its last value while a new one loads, and when a request fails. |
| `url` | *required* | The address. `${…}` parts are [expressions](expressions.md), as in a JavaScript template string: `data/${planet}.json`. A relative URL is relative to the page. |
| `params` | | An expression that gives an object, sent as the query string: `params="{ year, limit: 100 }"` adds `?year=2024&limit=100`. `null` and `undefined` values are left out. |
| `body` | | An expression whose value is sent as JSON, with `Content-Type: application/json`. With a body, the method is `POST`. |
| `method` | `GET` | The HTTP method, or `POST` if there's a `body`. |
| `as` | `json` | How to read the answer: `json` or `text`. |
| `debounce` | `100` | How long to wait, in milliseconds, after the last change before sending. While the reader drags, only the value they stop on is requested. |
| `cache` | `page` | `page` keeps the answers for as long as the page is open, so coming back to a value is instant. `local` also keeps them in `localStorage` (see [Caching](#caching)). `none` always asks the server. |
| `loading` | | A variable that is `true` while a request is on its way. |
| `error` | | A variable that holds the message when a request fails, and `null` after one succeeds. |

Only the newest answer counts. A request that a newer one replaces is cancelled, and an
answer that arrives late is ignored, so a slow server can't overwrite a newer value with an
older one.

## Loading and errors {#errors}

<t-scope class="example" data-show-source="open">
  <p>Gravity on <t-text name="which">Saturn</t-text>:
    <t-out expr="err ?? (busy ? 'loading…' : `${info?.gravity} m/s²`)"></t-out></p>
  <t-fetch name="info" url="data/planets/${which.toLowerCase()}.json" loading="busy" error="err"></t-fetch>
</t-scope>

`loading` and `error` name ordinary variables, so outputs, `<t-let>`s and your own code can
use them. A planet without a file, such as Pluto, gives a 404, and `err` holds the message.
The error is also logged in the console, and the `<t-fetch>` gets the class `is-error`.

## Old values dim while they reload {#stale}

While an answer is on its way, the elements that show the old one have the class `is-stale`,
which `tangle.css` dims. This includes elements that use the variable through others, such as
a `<t-out>` of a [`<t-let>`](t-let.md) that reads it, a formula or a chart. Elements that don't
depend on it stay as they are.

<t-scope class="example" data-show-source="open">
  <p>On <t-choice name="planet" options="Mercury:mercury, Venus:venus, Earth:earth, Mars:mars, Jupiter:jupiter, Saturn:saturn, Uranus:uranus, Neptune:neptune">Jupiter</t-choice>
    a year of <t-num name="days" min="1" max="365">30</t-num> days has
    <t-out expr="p && days * 24 / p.day_hours" format="%d"></t-out> sunrises.</p>
  <t-fetch name="p" url="data/planets/${planet}.json" debounce="800"></t-fetch>
</t-scope>

This one waits 800 ms before each request, which makes the dimming easy to see. A planet that
was already fetched comes from the cache, without waiting. Quick answers don't dim at all:
the dimming starts after 150 ms. To change how dim, set `--tangle-stale` (an opacity, `0.45` by
default); to turn it off, set it to `1`. Your own [elements](custom-elements.md) get the class too,
from the variables their `watch` effects read, and
[`scope.setPending(name)`](javascript.md#scopes) marks a variable as reloading from JavaScript.

## Caching {#caching}

By default, answers are kept while the page is open. Every `<t-fetch>` on the page shares
them, keyed by the method, URL and body, and the oldest are dropped after 200.

With `cache="local"`, answers are also kept in the browser's `localStorage`, so they survive
a reload. A stored answer shows immediately, and the request is still sent: if the server's
answer has changed, it replaces the stored one. If `localStorage` is full or unavailable,
the element works without it. Keep large answers out of it: browsers allow about 5 MB per site.

## A backend {#backend}

A server that computes the answer receives the variables as the query string (`params`) or
as a JSON body (`body`):

```html
<t-fetch name="quote" url="http://localhost:8001/price" body="{ size, rooms }"></t-fetch>
```

Here is a complete one in Python, without dependencies:

```python
# server.py: run `python server.py`
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        args = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        answer = {"price": 50_000 + 2_100 * args["size"] + 8_000 * args["rooms"]}
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(answer).encode())

    def do_OPTIONS(self):  # the browser asks this before a JSON POST to another origin
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

HTTPServer(("localhost", 8001), Handler).serve_forever()
```

The `Access-Control-Allow-*` headers are needed because the page and the server have different
origins (another port counts). If the same server also serves the page, leave them out.
