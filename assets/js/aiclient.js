/*!
 * 自带 API Key 的对话客户端（OpenAI 兼容协议）
 *
 * 纯自写：不包含任何第三方 SDK，只用浏览器自带的 fetch 发 HTTP 请求，直接发往使用者
 * 自己填写的 API 地址（例如 DeepSeek / OpenAI / 通义 / Kimi / 智谱 等 OpenAI 兼容服务）。
 * 密钥只存在使用者自己的浏览器里，本站不做中转、不收集、不代理。
 *
 * 支持流式输出（SSE，data: ... 逐行解析）。
 *
 * 版权：本文件的代码由仓库作者 zyl0723 编写（见 THIRD-PARTY-NOTICES.md 第一节）。
 */
(function () {
  "use strict";

  /* 常见 OpenAI 兼容服务。base 里带上 /v1 这类版本段，按各自文档填。 */
  var PRESETS = {
    deepseek: { label: "DeepSeek", base: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    openai: { label: "OpenAI", base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    tongyi: { label: "通义千问（阿里云）", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
    moonshot: { label: "Kimi（月之暗面）", base: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
    zhipu: { label: "智谱 GLM", base: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
    custom: { label: "自定义（OpenAI 兼容）", base: "", model: "" }
  };

  function trimBase(base) {
    return String(base == null ? "" : base).trim().replace(/\/+$/, "");
  }

  /* 使用者可以直接填完整地址，也可以只填到 /v1 */
  function chatEndpoint(base) {
    var b = trimBase(base);
    if (!b) return "";
    if (/\/chat\/completions$/.test(b)) return b;
    return b + "/chat/completions";
  }

  function modelsEndpoint(base) {
    var b = trimBase(base);
    if (!b) return "";
    if (/\/chat\/completions$/.test(b)) return b.replace(/\/chat\/completions$/, "/models");
    return b + "/models";
  }

  function extractContent(obj) {
    var ch = obj && obj.choices && obj.choices[0];
    if (!ch) return "";
    if (ch.delta && typeof ch.delta.content === "string") return ch.delta.content;
    if (ch.message && typeof ch.message.content === "string") return ch.message.content;
    if (typeof ch.text === "string") return ch.text;
    return "";
  }

  function parseSSELine(line, push) {
    var s = String(line == null ? "" : line).trim();
    if (!s || s.charAt(0) === ":") return;
    if (s.indexOf("data:") !== 0) return;
    var payload = s.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try { push(extractContent(JSON.parse(payload))); } catch (err) { /* 半截 JSON，忽略 */ }
  }

  function parseWholeText(text, push) {
    var t = String(text == null ? "" : text);
    var trimmed = t.trim();
    if (trimmed.charAt(0) === "{") {
      try { push(extractContent(JSON.parse(trimmed))); return; } catch (err) { /* 退回按行解析 */ }
    }
    t.split("\n").forEach(function (line) { parseSSELine(line, push); });
  }

  function httpErrorFrom(res, text) {
    var msg = "HTTP " + res.status;
    var body = String(text == null ? "" : text).trim();
    if (body) {
      var detail = body;
      try {
        var j = JSON.parse(body);
        detail = (j && j.error && (j.error.message || j.error)) || (j && j.message) || body;
      } catch (err) { /* 不是 JSON 就原样用 */ }
      msg += "：" + String(detail).slice(0, 200);
    }
    var e = new Error(msg);
    e.status = res.status;
    return e;
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    if (typeof AbortController !== "function") return fetch(url, options);
    var ctrl = new AbortController();
    var opts = {};
    for (var k in options) if (Object.prototype.hasOwnProperty.call(options, k)) opts[k] = options[k];
    opts.signal = ctrl.signal;
    var timer = null;
    if (timeoutMs) timer = setTimeout(function () { ctrl.abort(); }, timeoutMs);
    var p = fetch(url, opts);
    p.then(function () { if (timer) clearTimeout(timer); }, function () { if (timer) clearTimeout(timer); });
    p.abort = function () { if (timer) clearTimeout(timer); ctrl.abort(); };
    return p;
  }

  /* ---------- 流式对话 ---------- */
  function chat(opts) {
    var o = opts || {};
    var url = chatEndpoint(o.base);
    var cancelled = false;
    var full = "";
    var noop = { cancel: function () { cancelled = true; } };

    function push(text) {
      if (!text || cancelled) return;
      full += text;
      if (o.onDelta) o.onDelta(text, full);
    }

    if (!url) {
      fail(new Error("还没填 API 地址。"));
      return noop;
    }
    if (typeof fetch !== "function") {
      fail(new Error("这个浏览器太旧，不支持 fetch，用不了直连 API。请换用较新版 Chrome / Edge / Firefox。"));
      return noop;
    }

    var headers = { "Content-Type": "application/json" };
    if (o.key) headers.Authorization = "Bearer " + o.key;

    var payload = {
      model: o.model,
      messages: o.messages || [{ role: "user", content: String(o.prompt == null ? "" : o.prompt) }],
      stream: true
    };

    var req = fetchWithTimeout(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload)
    }, o.timeoutMs || 120000);

    req.then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw httpErrorFrom(res, t); });
      if (res.body && typeof res.body.getReader === "function") return pumpReader(res.body.getReader(), push);
      return res.text().then(function (t) { parseWholeText(t, push); });
    }).then(function () {
      if (!cancelled && o.onDone) o.onDone(full);
    }, function (err) {
      if (!cancelled && o.onError) o.onError(err);
    });

    function fail(err) { if (!cancelled && o.onError) o.onError(err); }

    return {
      cancel: function () {
        cancelled = true;
        if (req && typeof req.abort === "function") req.abort();
      }
    };
  }

  function pumpReader(reader, push) {
    var decoder = (typeof TextDecoder === "function") ? new TextDecoder() : null;
    var buf = "";
    function step() {
      return reader.read().then(function (r) {
        if (r && r.done) {
          if (buf.trim()) parseSSELine(buf, push);
          return;
        }
        var chunk = r && r.value;
        buf += decoder ? decoder.decode(chunk, { stream: true }) : String(chunk);
        var idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          parseSSELine(buf.slice(0, idx).replace(/\r$/, ""), push);
          buf = buf.slice(idx + 1);
        }
        return step();
      });
    }
    return step();
  }

  /* ---------- 拉取模型列表 ---------- */
  function listModels(opts) {
    var o = opts || {};
    var url = modelsEndpoint(o.base);
    if (!url) return Promise.reject(new Error("还没填 API 地址。"));
    if (typeof fetch !== "function") return Promise.reject(new Error("这个浏览器太旧，不支持 fetch。"));

    var headers = {};
    if (o.key) headers.Authorization = "Bearer " + o.key;

    return fetchWithTimeout(url, { headers: headers }, o.timeoutMs || 15000)
      .then(function (res) {
        if (!res.ok) return res.text().then(function (t) { throw httpErrorFrom(res, t); });
        return res.json();
      })
      .then(function (j) {
        var arr = (j && j.data) || (j && j.models) || [];
        return arr.map(function (m) { return m && (m.id || m.name); }).filter(Boolean);
      });
  }

  /* ---------- 把错误翻译成能照着做的中文 ---------- */
  function explain(err) {
    var raw = err && err.message != null ? err.message : err;
    var msg = String(raw == null ? "" : raw);
    var status = err && err.status;

    if (/不支持 fetch/.test(msg)) return msg;
    if (/还没填 API 地址/.test(msg)) return msg;
    if (/abort/i.test(msg)) return "请求被取消或超时了。网络慢的话可以重试；也可能是这个地址根本没响应。";
    if (status === 401 || status === 403) {
      return "密钥被拒绝了（HTTP " + status + "）：检查 API Key 有没有填错、多空格，以及这个 Key 有没有开通你选的模型。";
    }
    if (status === 404) {
      return "地址或模型名不对（HTTP 404）：API 地址通常要带 /v1（例如 https://api.deepseek.com/v1），模型名也要是该服务真实存在的。";
    }
    if (status === 429) {
      return "被限流或额度用完了（HTTP 429）：等一会儿再试，或去服务商后台看看余额。";
    }
    if (status === 400) {
      return "请求被拒绝（HTTP 400）：多半是模型名不对，或这个 Key 没开通该模型。";
    }
    if (/Failed to fetch|NetworkError|Load failed|fetch failed|Network request failed|NetworkError when attempting/i.test(msg)) {
      return "连不上这个 API 地址。常见原因：① 地址填错；② 该服务不允许网页直接调用（浏览器 CORS 限制）；③ 本机网络或代理拦住了。可以先改用「复制提示词」，去 AI 官网粘贴。";
    }
    return "请求失败：" + msg;
  }

  window.PTAAI = {
    PRESETS: PRESETS,
    chatEndpoint: chatEndpoint,
    modelsEndpoint: modelsEndpoint,
    chat: chat,
    listModels: listModels,
    explain: explain
  };
})();