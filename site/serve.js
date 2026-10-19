// Serves the repo for development with live reload. Run it with `make dev`.
//
// - A change to a Markdown page (or to site/build.js) rebuilds the HTML.
// - Any change reloads the open pages: each served HTML page gets a script
//   that listens on /__reload (server-sent events).
// The generated HTML is ignored by the watcher, since this server writes it.
import { execFileSync } from "node:child_process";
import { readFile, watch } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT ?? 8000);
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".md": "text/markdown", ".txt": "text/plain", ".json": "application/json", ".png": "image/png",
};
const RELOAD = `<script>new EventSource("/__reload").onmessage = () => location.reload();</script>`;
const IGNORED = /^(\.git|_site|node_modules|\.context)\/|^(docs\/[^/]+\.html|index\.html)$/;
const SOURCE = /\.md$|^site\/build\.js$/;

const clients = new Set();

function rebuild() {
  try {
    execFileSync(process.execPath, [join(ROOT, "site/build.js")], { stdio: ["ignore", "ignore", "pipe"] });
    return true;
  } catch (err) {
    console.error(`Build failed:\n${err.stderr ?? err.message}`);
    return false;
  }
}

let timer;
let dirty = false;
watch(ROOT, { recursive: true }, (_, file) => {
  file = file?.split(sep).join("/");
  if (!file || IGNORED.test(file)) return;
  dirty ||= SOURCE.test(file);
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (dirty && !rebuild()) return;
    dirty = false;
    console.log(`Changed ${file}, reloading ${clients.size} page(s)`);
    for (const res of clients) res.write("data: reload\n\n");
  }, 50);
});

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/__reload") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!path.startsWith(ROOT)) return res.writeHead(403).end();
  if (path.endsWith(sep)) path += "index.html";
  readFile(path, (err, data) => {
    if (err) return res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    const type = TYPES[extname(path)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(type === "text/html" ? data.toString().replace("</body>", `${RELOAD}\n</body>`) : data);
  });
}).listen(PORT, () => {
  rebuild();
  console.log(`Serving http://localhost:${PORT}, reloading on changes`);
});
