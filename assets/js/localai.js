/*!
 * 本地 AI 客户端：与「Ollama」(https://github.com/ollama/ollama, MIT 许可) 的
 * 本地 HTTP 接口通信，把提示词发过去、把回答流式收回来。
 *
 * 注意：本文件不包含 Ollama 的任何代码，也不分发 Ollama；它只是自己写的一个
 * HTTP 客户端，调用使用者本机上运行的 Ollama 服务（默认 http://127.0.0.1:11434）。
 * 使用者不安装 Ollama 时，这里会安静地报错，页面其余功能不受影响。
 */
(function () {
  "use strict";

  var DEFAULT_ENDPOINT = "http://127.0.0.1:11434";
  var DEFAULT_MODEL = "qwen2.5:7b";

  function base(endpoint) {
    return String(endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, "");
  }

  function hasFetch() {
    return typeof fetch === "function";
  }

  /* 列出本机已有的模型名 */
  function listModels(endpoint, timeoutMs) {
    if (!hasFetch()) return Promise.reject(new Error("这个浏览器不支持 fetch"));
    var ctrl = (typeof AbortController === "function") ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 4000) : null;
    return fetch(base(endpoint) + "/api/tags", { method: "GET", signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        return ((data && data.models) || []).map(function (m) { return m.name; }).filter(Boolean);
      });
  }

  function pick(item) {
    return item && item.message && typeof item.message.content === "string" ? item.message.content : "";
  }

  /* 流式对话：onDelta(片段) / onDone(全文) / onError(err) */
  function chat(opts) {
    var o = opts || {};
    if (!hasFetch()) { if (o.onError) o.onError(new Error("这个浏览器不支持 fetch")); return { cancel: function () {} }; }
    var ctrl = (typeof AbortController === "function") ? new AbortController() : null;
    var text = "";
    var finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      if (o.onDone) o.onDone(text);
    }

    function handleLine(line) {
      var t = line.trim();
      if (!t) return;
      var item;
      try { item = JSON.parse(t); } catch (err) { return; }
      var piece = pick(item);
      if (piece) { text += piece; if (o.onDelta) o.onDelta(piece, text); }
      if (item.error) { finished = true; if (o.onError) o.onError(new Error(String(item.error))); return; }
      if (item.done) finish();
    }

    fetch(base(o.endpoint) + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: o.model || DEFAULT_MODEL,
        stream: true,
        messages: [{ role: "user", content: String(o.prompt || "") }]
      }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error("HTTP " + res.status + (t ? "：" + t.slice(0, 200) : ""));
        });
      }
      if (!res.body || typeof res.body.getReader !== "function") {
        return res.text().then(function (t) {
          t.split("\n").forEach(handleLine);
          finish();
        });
      }
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = "";
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            if (buf) handleLine(buf);
            finish();
            return;
          }
          buf += dec.decode(r.value, { stream: true });
          var lines = buf.split("\n");
          buf = lines.pop();
          lines.forEach(handleLine);
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      if (finished) return;
      finished = true;
      if (o.onError) o.onError(err);
    });

    return {
      cancel: function () { finished = true; if (ctrl) ctrl.abort(); }
    };
  }

  /* 常见的失败原因，翻译成能照着做的提示 */
  function explain(err) {
    var msg = (err && err.message) ? err.message : String(err);
    if (/不支持 fetch/.test(msg)) {
      return "这个浏览器太旧，用不了本机 AI。请改用较新版 Chrome / Edge，或者把上面的 AI 网站换成别家、用复制提示词的方式。";
    }
    if (/Failed to fetch|fetch failed|NetworkError|拒绝访问|abort/i.test(msg)) {
      return "连不上本机 AI。请依次确认：① 已安装并启动 Ollama（ollama serve）；② 已下载模型，例如 ollama pull qwen2.5:7b；③ 浏览器被 CORS 拦住时，先设置环境变量 OLLAMA_ORIGINS=* 再重启 Ollama。";
    }
    if (/404/.test(msg)) return "模型名不对：Ollama 里没有这个模型，先用 ollama pull 下载，或把模型名改成已下载的那个。";
    if (/403/.test(msg)) return "被 Ollama 拒绝了：通常是来源限制，设置环境变量 OLLAMA_ORIGINS=* 后重启 Ollama。";
    return "本地 AI 出错了：" + msg;
  }

  window.PTALocalAI = {
    DEFAULT_ENDPOINT: DEFAULT_ENDPOINT,
    DEFAULT_MODEL: DEFAULT_MODEL,
    listModels: listModels,
    chat: chat,
    explain: explain
  };
})();
