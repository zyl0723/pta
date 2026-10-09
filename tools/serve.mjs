/*!
 * 零依赖静态服务器，用于本地预览这个纯前端工具。
 * 用法：node tools/serve.mjs [端口]，默认 http://localhost:5173
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2]) || 5173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8"
};

function safeJoin(base, target) {
  const resolved = path.resolve(base, "." + path.sep + target);
  return resolved.startsWith(base + path.sep) || resolved === base ? resolved : null;
}

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (urlPath.endsWith("/")) urlPath += "index.html";
    const filePath = safeJoin(root, urlPath);
    if (!filePath) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const info = await stat(filePath);
    const finalPath = info.isDirectory() ? path.join(filePath, "index.html") : filePath;
    const body = await readFile(finalPath);
    res.writeHead(200, { "Content-Type": MIME[path.extname(finalPath).toLowerCase()] || "application/octet-stream" });
    res.end(body);
  } catch (err) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 Not Found");
  }
});

server.listen(port, () => {
  console.log("静态服务器已启动：http://localhost:" + port);
  console.log("按 Ctrl+C 停止。");
});
