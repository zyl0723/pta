/* 本地 AI 客户端（assets/js/localai.js）的协议层测试：
 * 起一个假的 Ollama 服务，验证请求形状、流式解析、错误处理都对得上。 */
import { readFileSync } from "node:fs";
import http from "node:http";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let ok = 0, bad = 0;
function check(label, cond, extra) {
  if (cond) { ok++; console.log("通过 " + label); }
  else { bad++; console.log("失败 " + label + (extra ? "  -> " + extra : "")); }
}
/* vm 沙箱里 new 出来的 Error 与宿主 realm 的 Error 不是同一个构造函数，这里跨 realm 判断 */
function isErr(e) {
  return !!e && Object.prototype.toString.call(e) === "[object Error]";
}

/* ---- 假 Ollama 服务 ---- */
const seen = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    seen.push({ url: req.url, method: req.method, body });
    if (req.url === "/api/tags" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "qwen2.5:7b" }, { name: "llama3:8b" }] }));
      return;
    }
    if (req.url === "/api/chat" && req.method === "POST") {
      const payload = JSON.parse(body || "{}");
      if (payload.model === "missing") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "model 'missing' not found" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      const chunks = [
        { message: { role: "assistant", content: "答案" }, done: false },
        { message: { role: "assistant", content: "如下" }, done: false },
        { message: { role: "assistant", content: "。" }, done: true }
      ];
      let i = 0;
      const tick = setInterval(() => {
        if (i < chunks.length) { res.write(JSON.stringify(chunks[i++]) + "\n"); }
        else { clearInterval(tick); res.end(); }
      }, 5);
      return;
    }
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("boom");
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const endpoint = "http://127.0.0.1:" + port;

/* ---- 在 vm 里加载被测文件 ---- */
const sandbox = { console, fetch, AbortController, TextDecoder, setTimeout, clearTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(path.join(root, "assets/js/localai.js"), "utf8"), sandbox, { filename: "localai.js" });
const ai = sandbox.PTALocalAI;

check("导出接口齐全", typeof ai.listModels === "function" && typeof ai.chat === "function" && typeof ai.explain === "function");

console.log("=== 列出本机模型 ===");
const models = await ai.listModels(endpoint, 3000);
check("能读到模型列表", Array.isArray(models) && models.length === 2, JSON.stringify(models));
check("模型名正确", models.includes("qwen2.5:7b") && models.includes("llama3:8b"));

console.log("=== 流式对话 ===");
const deltas = [];
const finalText = await new Promise((resolve, reject) => {
  ai.chat({
    endpoint: endpoint,
    model: "qwen2.5:7b",
    prompt: "请给出答案",
    onDelta: (d) => deltas.push(d),
    onDone: (t) => resolve(t),
    onError: (e) => reject(e)
  });
});
check("逐段收到 3 个片段", deltas.length === 3, JSON.stringify(deltas));
check("拼起来等于完整回答", finalText === "答案如下。", JSON.stringify(finalText));
const chatCall = seen.filter((s) => s.url === "/api/chat")[0];
const sentBody = JSON.parse(chatCall.body);
check("请求体含模型名", sentBody.model === "qwen2.5:7b");
check("请求体含提示词", sentBody.messages && sentBody.messages[0].role === "user" && sentBody.messages[0].content === "请给出答案");
check("请求开启了流式", sentBody.stream === true);
check("请求指向 /api/chat", chatCall.method === "POST");

console.log("=== 错误处理 ===");
const err1 = await new Promise((resolve) => {
  ai.chat({ endpoint: endpoint, model: "missing", prompt: "x", onDone: () => resolve(null), onError: resolve });
});
check("模型不存在时报错而不是崩掉", isErr(err1) && /404/.test(err1.message), err1 && err1.message);
check("404 会被翻译成「模型名不对」", /模型名不对/.test(ai.explain(err1)), ai.explain(err1));

const err2 = await new Promise((resolve) => {
  ai.chat({ endpoint: "http://127.0.0.1:1", model: "m", prompt: "x", onDone: () => resolve(null), onError: resolve });
});
check("服务没启动时走 onError", isErr(err2));
check("连不上时给出安装/启动指引", /Ollama|ollama/.test(ai.explain(err2)), ai.explain(err2));

console.log("=== 没有 fetch 的环境（老浏览器）===");
const bare = { console };
bare.window = bare;
vm.createContext(bare);
vm.runInContext(readFileSync(path.join(root, "assets/js/localai.js"), "utf8"), bare, { filename: "localai.js" });
let bareErr = null;
bare.PTALocalAI.chat({ prompt: "x", onError: (e) => { bareErr = e; } });
check("缺少 fetch 时优雅报错", isErr(bareErr) && /fetch/.test(bareErr.message));

server.close();
console.log("\n本地 AI 客户端测试：" + ok + " 通过 / " + (ok + bad) + " 项");
if (bad) process.exitCode = 1;
