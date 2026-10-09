/* 自带 API Key 的对话客户端（assets/js/aiclient.js）的协议层测试：
 * 起一个假的 OpenAI 兼容服务，校验请求形状、流式解析、错误翻译都对得上。 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let ok = 0, bad = 0;
function check(label, cond, extra) {
  if (cond) { ok++; console.log("通过 " + label); }
  else { bad++; console.log("失败 " + label + (extra ? "  -> " + extra : "")); }
}
function isErr(e) { return Object.prototype.toString.call(e) === "[object Error]"; }

/* ---- 假 OpenAI 兼容服务 ---- */
let lastReq = null;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    lastReq = { method: req.method, url: req.url, headers: req.headers, body };

    if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "demo-chat" }, { id: "demo-reasoner" }] }));
      return;
    }
    if (req.url === "/v1/unauth/chat/completions") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid API key" } }));
      return;
    }
    if (req.url === "/v1/chat/completions") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunks = ["你", "好", "，世界"];
      chunks.forEach((c) => {
        res.write("data: " + JSON.stringify({ choices: [{ delta: { content: c } }] }) + "\n\n");
      });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const BASE = "http://127.0.0.1:" + server.address().port;

const sandbox = {
  console, fetch, AbortController, TextDecoder, Promise, JSON, setTimeout, clearTimeout
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(path.join(root, "assets/js/aiclient.js"), "utf8"), sandbox, { filename: "aiclient.js" });
const ai = sandbox.PTAAI;

console.log("=== 地址拼装 ===");
check("只填到 /v1 会自动补 /chat/completions", ai.chatEndpoint("https://x.com/v1") === "https://x.com/v1/chat/completions");
check("末尾斜杠会被去掉", ai.chatEndpoint("https://x.com/v1/") === "https://x.com/v1/chat/completions");
check("已经是完整地址就不重复拼", ai.chatEndpoint("https://x.com/v1/chat/completions") === "https://x.com/v1/chat/completions");
check("模型列表地址从对话地址反推", ai.modelsEndpoint("https://x.com/v1/chat/completions") === "https://x.com/v1/models");
check("预设里的地址都能拼出对话地址", Object.keys(ai.PRESETS).every((k) => {
  const base = ai.PRESETS[k].base;
  return base === "" || /\/chat\/completions$/.test(ai.chatEndpoint(base));
}));

console.log("=== 流式对话 ===");
const deltas = [];
const full = await new Promise((resolve, reject) => {
  ai.chat({
    base: BASE + "/v1",
    key: "sk-demo",
    model: "demo-chat",
    prompt: "打个招呼",
    onDelta: (d, all) => deltas.push(d),
    onDone: resolve,
    onError: reject
  });
});
check("流式片段被逐段回调", deltas.join("") === "你好，世界", deltas.join(""));
check("onDone 拿到完整回答", full === "你好，世界", full);
check("请求发到 /v1/chat/completions", lastReq.url === "/v1/chat/completions", lastReq.url);
check("带上 Bearer 密钥", lastReq.headers.authorization === "Bearer sk-demo", lastReq.headers.authorization);
const sent = JSON.parse(lastReq.body);
check("请求体带 model", sent.model === "demo-chat", lastReq.body);
check("请求体带 messages", Array.isArray(sent.messages) && sent.messages[0].content === "打个招呼", lastReq.body);
check("请求体要求流式", sent.stream === true, lastReq.body);

console.log("=== 密钥错误 ===");
const authErr = await new Promise((resolve) => {
  ai.chat({ base: BASE + "/v1/unauth", key: "bad", model: "demo-chat", prompt: "x", onDone: () => resolve(null), onError: resolve });
});
check("401 会走 onError", isErr(authErr), String(authErr));
check("错误里带状态码", authErr && authErr.status === 401, authErr && authErr.status);
check("401 翻译成「密钥被拒绝」", /密钥被拒绝/.test(ai.explain(authErr)), ai.explain(authErr));

console.log("=== 拉取模型 ===");
const models = await ai.listModels({ base: BASE + "/v1", key: "sk-demo" });
check("能列出模型 id", models.join(",") === "demo-chat,demo-reasoner", models.join(","));

console.log("=== 常见错误的中文翻译 ===");
check("地址填错能提示检查 /v1", /\/v1/.test(ai.explain({ status: 404, message: "HTTP 404" })), ai.explain({ status: 404 }));
check("额度用完能提示看余额", /余额/.test(ai.explain({ status: 429, message: "HTTP 429" })), ai.explain({ status: 429 }));
check("连不上时提示可能是 CORS 并给替代方案", /CORS/.test(ai.explain(new Error("Failed to fetch"))) && /复制提示词/.test(ai.explain(new Error("Failed to fetch"))), ai.explain(new Error("Failed to fetch")));
check("超时/取消有独立提示", /取消或超时/.test(ai.explain(new Error("The operation was aborted"))), ai.explain(new Error("aborted")));

console.log("=== 缺参数与旧浏览器 ===");
const noBase = await new Promise((resolve) => {
  ai.chat({ base: "", model: "m", prompt: "x", onDone: () => resolve(null), onError: resolve });
});
check("没填地址时明确报错", isErr(noBase) && /还没填 API 地址/.test(noBase.message), noBase && noBase.message);

const bare = { console, Promise, JSON, setTimeout, clearTimeout };
bare.window = bare;
vm.createContext(bare);
vm.runInContext(readFileSync(path.join(root, "assets/js/aiclient.js"), "utf8"), bare, { filename: "aiclient.js" });
const noFetch = await new Promise((resolve) => {
  bare.PTAAI.chat({ base: "https://x.com/v1", model: "m", prompt: "x", onDone: () => resolve(null), onError: resolve });
});
check("没有 fetch 的环境给出清楚提示", isErr(noFetch) && /fetch/.test(noFetch.message), noFetch && noFetch.message);

console.log("=== 可以中途停止 ===");
const stops = [];
const run = ai.chat({
  base: BASE + "/v1", key: "k", model: "m", prompt: "x",
  onDelta: (d) => stops.push(d),
  onDone: () => stops.push("DONE"),
  onError: () => stops.push("ERR")
});
run.cancel();
await new Promise((r) => setTimeout(r, 120));
check("取消后不再回调 onDone / onError", stops.indexOf("DONE") < 0 && stops.indexOf("ERR") < 0, stops.join(","));

server.close();
console.log("\nAI 客户端测试：" + ok + " 通过 / " + (ok + bad) + " 项");
if (bad) process.exitCode = 1;