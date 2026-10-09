/*!
 * 页面交互：编辑代码 → 实时静态检查 → 真实运行 → 与期望输出逐行对比。
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var analyzer = window.PTAAnalyzer;
  var runner = window.PTARunner;
  var problems = window.PTAProblems || [];

  var state = { findings: [], timer: null, currentProblem: null, lastRun: null };

  /* 会打开的 AI 网站。prefill 为 true 表示该站点支持用网址带上提问内容。 */
  var AI_TARGETS = {
    chatgpt: { label: "ChatGPT", url: "https://chatgpt.com/?q=", prefill: true },
    deepseek: { label: "DeepSeek", url: "https://chat.deepseek.com/" },
    kimi: { label: "Kimi", url: "https://www.kimi.com/" },
    doubao: { label: "豆包", url: "https://www.doubao.com/chat/" },
    tongyi: { label: "通义", url: "https://www.tongyi.com/" },
    local: { label: "本机 AI（Ollama）", local: true }
  };

  var HINT_WEB = "下面这段就是发给 AI 的内容，已经自动复制过。去刚打开的页面按 Ctrl + V 粘贴发送即可；如果没复制成功，就手动全选这段文字复制。";
  var HINT_LOCAL = "下面这段会直接发给你本机运行的 Ollama（开源、免费、不用密钥），回答会流式出现在下方。先去 ollama.com 装好 Ollama，再执行 ollama pull qwen2.5:7b 下载模型。";

  var SEV = {
    error: { label: "错误", cls: "sev-error", mark: "✖", hint: "这样写编译器一定会报错" },
    warning: { label: "很可能有问题", cls: "sev-warn", mark: "!", hint: "代码能编译，但行为多半不是你要的" },
    info: { label: "建议", cls: "sev-info", mark: "·", hint: "不影响对错，属于写法层面的建议" }
  };

  var STARTER =
    '#include <stdio.h>\n' +
    '\n' +
    'int main() {\n' +
    '    int a, b;\n' +
    '    scanf("%d %d", &a, &b);\n' +
    '    printf("%d\\n", a + b);\n' +
    '    return 0;\n' +
    '}\n';

  function init() {
    $("code").value = STARTER;
    fillProblemSelect();
    bindEvents();
    refreshGutter();
    analyzeNow();
  }

  function bindEvents() {
    var code = $("code");

    code.addEventListener("input", function () {
      refreshGutter();
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(analyzeNow, 260);
    });

    code.addEventListener("scroll", function () {
      $("gutter").scrollTop = code.scrollTop;
      $("gutterInner").style.transform = "translateY(" + (-code.scrollTop) + "px)";
    });

    code.addEventListener("keydown", function (e) {
      if (e.key === "Tab") {
        e.preventDefault();
        insertAtCursor(code, "    ");
        refreshGutter();
        analyzeNow();
      }
    });

    $("btn-check").addEventListener("click", analyzeNow);
    $("btn-run").addEventListener("click", runNow);
    $("btn-check-run").addEventListener("click", function () { analyzeNow(); runNow(); });
    $("btn-clear").addEventListener("click", function () {
      $("code").value = "";
      refreshGutter();
      analyzeNow();
      $("code").focus();
    });
    $("btn-sample").addEventListener("click", function () {
      $("code").value = STARTER;
      refreshGutter();
      analyzeNow();
    });
    $("problem-select").addEventListener("change", onProblemChange);
    $("btn-fill-reference").addEventListener("click", fillReference);
    $("btn-toggle-cheatsheet").addEventListener("click", function () {
      var sec = $("cheatsheet");
      var hidden = sec.classList.toggle("hidden");
      $("btn-toggle-cheatsheet").textContent = hidden ? "常见错误速查 ▾" : "常见错误速查 ▴";
      if (!hidden) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("chk-strict").addEventListener("change", function () {
      if (state.lastRun) renderRunResult(state.lastRun);
    });

    $("btn-answer").addEventListener("click", function () { showPrompt("answer"); });
    $("btn-practice").addEventListener("click", function () { showPrompt("practice"); });
    $("ai-target").addEventListener("change", toggleLocalBox);
    $("btn-local-check").addEventListener("click", checkLocalAI);
    $("btn-local-stop").addEventListener("click", function () {
      if (state.localRun) state.localRun.cancel();
      setAiStatus("已停止。");
    });
    $("btn-copy-prompt").addEventListener("click", function () {
      var box = $("prompt-out");
      if (!box.value) return;
      copyText(box.value, function (ok) {
        setAiStatus(ok ? "已复制到剪贴板。" : "复制失败：请手动全选下面的提示词。");
      });
    });
  }

  /* ---------- 提示词：本页面不联网，只把文本拼好交给使用者自己的 AI ---------- */
  function needProblem() {
    var box = $("problem-text");
    if (!box.value.trim()) {
      alert("请先把你 PTA 上的题目整段粘贴到上面的「题目」框里（题干、输入格式、输出格式、样例都要），再点这个按钮。");
      box.focus();
      return false;
    }
    return true;
  }

  function setAiStatus(text) {
    $("ai-status").textContent = text;
  }

  function showPrompt(kind) {
    if (!needProblem() || !window.PTAPrompt) return;
    var ctx = {
      problem: $("problem-text").value,
      code: $("code").value,
      feedback: $("pta-feedback").value,
      findings: state.findings
    };
    var text;
    if (kind === "answer") {
      text = window.PTAPrompt.buildAnswer(ctx);
    } else {
      ctx.count = parseInt($("practice-count").value, 10) || 5;
      ctx.withAnswer = $("chk-practice-answer").checked;
      text = window.PTAPrompt.buildPractice(ctx);
    }

    var target = AI_TARGETS[$("ai-target").value] || AI_TARGETS.chatgpt;
    $("prompt-out").value = text;
    $("panel-ai").classList.remove("hidden");
    if (target.local) {
      showLocal(text);
    } else {
      $("ai-answer-wrap").classList.add("hidden");
      $("ai-hint").textContent = HINT_WEB;
      copyText(text, function (ok) {
        setAiStatus(ok
          ? "提示词已复制，去 " + target.label + " 按 Ctrl + V 粘贴发送"
          : "复制失败：请手动全选下面的提示词复制");
      });
      openTarget(target, text);
    }
    $("panel-ai").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ---------- 本机 AI（Ollama）：把提示词直接发给本机的开源模型 ---------- */
  function isHttpsPage() {
    return (typeof location !== "undefined" && location.protocol === "https:");
  }

  function toggleLocalBox() {
    var target = AI_TARGETS[$("ai-target").value] || AI_TARGETS.chatgpt;
    $("local-ai-box").classList[target.local ? "remove" : "add"]("hidden");
  }

  function checkLocalAI() {
    if (!window.PTALocalAI) { setAiStatus("页面缺少本地 AI 模块。"); return; }
    if (isHttpsPage()) {
      setAiStatus("当前是 https 网页，浏览器禁止它访问本机服务：请把项目下载到本地、双击 index.html 打开，或 npm run serve 后在 http://localhost:5173 使用。");
      return;
    }
    setAiStatus("正在检测本机 AI…");
    window.PTALocalAI.listModels($("ai-endpoint").value, 4000).then(function (models) {
      if (!models.length) { setAiStatus("连上了 Ollama，但一个模型都没有：先执行 ollama pull qwen2.5:7b。"); return; }
      setAiStatus("连接正常，本机已有模型：" + models.join("、"));
      if (models.indexOf($("ai-model").value.trim()) < 0) $("ai-model").value = models[0];
    }, function (err) {
      setAiStatus(window.PTALocalAI.explain(err));
    });
  }

  function showLocal(text) {
    $("local-ai-box").classList.remove("hidden");
    $("ai-answer-wrap").classList.remove("hidden");
    $("ai-hint").textContent = HINT_LOCAL;
    var out = $("ai-answer");
    out.value = "";
    if (!window.PTALocalAI) { setAiStatus("页面缺少本地 AI 模块。"); return; }
    if (isHttpsPage()) {
      setAiStatus("当前是 https 网页，浏览器禁止它访问本机服务：请把项目下载到本地、双击 index.html 打开，或 npm run serve 后在 http://localhost:5173 使用；也可以把上面的 AI 网站换成别家，用复制提示词的方式。");
      return;
    }
    var model = $("ai-model").value.trim() || window.PTALocalAI.DEFAULT_MODEL;
    setAiStatus("正在请求本机 AI（" + model + "）…");
    state.localRun = window.PTALocalAI.chat({
      endpoint: $("ai-endpoint").value,
      model: model,
      prompt: text,
      onDelta: function (d, all) { out.value = all; out.scrollTop = out.scrollHeight; },
      onDone: function () { setAiStatus("本机 AI 已生成完毕（模型：" + model + "）。"); },
      onError: function (err) { setAiStatus(window.PTALocalAI.explain(err)); }
    });
  }

  function openTarget(target, text) {
    if (typeof window.open !== "function") return;
    var url = target.prefill ? target.url + encodeURIComponent(text) : target.url;
    try { window.open(url, "_blank", "noopener"); } catch (err) { /* 被浏览器拦截就只靠剪贴板 */ }
  }

  function fallbackCopy(text) {
    if (!document.body || typeof document.body.appendChild !== "function") return false;
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      var ok = !!(document.execCommand && document.execCommand("copy"));
      document.body.removeChild(ta);
      return ok;
    } catch (err) {
      return false;
    }
  }

  function copyText(text, done) {
    /* 先试同步方案：在用户点击的回调里，execCommand 的成功率高于异步的 Clipboard API。 */
    if (fallbackCopy(text)) { done(true); return; }
    var nav = (typeof navigator !== "undefined") ? navigator : null;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
      try {
        nav.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
        return;
      } catch (err) { /* 继续往下走 */ }
    }
    done(false);
  }

  function insertAtCursor(el, text) {
    var s = el.selectionStart, e = el.selectionEnd;
    el.value = el.value.slice(0, s) + text + el.value.slice(e);
    el.selectionStart = el.selectionEnd = s + text.length;
  }

  /* ---------- 行号与问题标记 ---------- */
  function refreshGutter() {
    var code = $("code");
    var total = code.value.split("\n").length;
    var marks = {};
    state.findings.forEach(function (f) {
      var cur = marks[f.line];
      if (!cur || f.severity === "error" || (f.severity === "warning" && cur === "info")) {
        marks[f.line] = f.severity;
      }
    });
    var html = "";
    for (var i = 1; i <= total; i++) {
      var sev = marks[i];
      html += '<div class="gline' + (sev ? " gline-" + sev : "") + '">'
        + '<span class="gmark">' + (sev ? SEV[sev].mark : "") + "</span>"
        + '<span class="gnum">' + i + "</span></div>";
    }
    $("gutterInner").innerHTML = html;
    $("gutterInner").style.transform = "translateY(" + (-code.scrollTop) + "px)";
  }

  function gotoLine(n) {
    var code = $("code");
    var lines = code.value.split("\n");
    var pos = 0;
    for (var i = 0; i < n - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    var end = pos + (lines[n - 1] ? lines[n - 1].length : 0);
    code.focus();
    code.setSelectionRange(pos, end);
    var lineHeight = parseFloat(getComputedStyle(code).lineHeight) || 20;
    code.scrollTop = Math.max(0, (n - 4) * lineHeight);
    $("gutterInner").style.transform = "translateY(" + (-code.scrollTop) + "px)";
  }

  /* ---------- 静态检查 ---------- */
  function analyzeNow() {
    var code = $("code").value;
    var result = { findings: [] };
    try {
      result = analyzer.analyze(code);
    } catch (err) {
      console.error(err);
    }
    state.findings = result.findings;
    refreshGutter();
    renderFindings();
  }

  function renderFindings() {
    var box = $("findings");
    var summary = $("summary");
    var list = state.findings;
    var errors = list.filter(function (f) { return f.severity === "error"; }).length;
    var warns = list.filter(function (f) { return f.severity === "warning"; }).length;
    var infos = list.filter(function (f) { return f.severity === "info"; }).length;

    if (list.length === 0) {
      summary.className = "summary ok";
      summary.innerHTML = "静态检查没有发现问题。可以点“运行并对比”用样例数据实测一下。";
    } else {
      summary.className = "summary " + (errors ? "bad" : (warns ? "warn" : "note"));
      var parts = [];
      if (errors) parts.push("<b>" + errors + "</b> 个错误");
      if (warns) parts.push("<b>" + warns + "</b> 个很可能有问题的地方");
      if (infos) parts.push("<b>" + infos + "</b> 条建议");
      summary.innerHTML = "共发现 " + parts.join("、") + "。按严重程度从上到下排列。";
    }

    if (list.length === 0) {
      box.innerHTML = '<div class="empty">这个文件里没有发现常见错误。注意：静态检查只能发现典型写法问题，逻辑是否正确还要靠运行样例来验证。</div>';
      return;
    }

    box.innerHTML = list.map(function (f, i) {
      var sev = SEV[f.severity];
      return '<div class="finding ' + sev.cls + '" data-line="' + f.line + '" data-idx="' + i + '">'
        + '<div class="f-head">'
        + '<span class="f-badge">' + sev.label + "</span>"
        + '<span class="f-line">第 ' + f.line + " 行</span>"
        + '<span class="f-title">' + esc(f.title) + "</span>"
        + "</div>"
        + (f.snippet ? '<pre class="f-code">' + esc(f.snippet) + "</pre>" : "")
        + '<div class="f-detail">' + esc(f.detail) + "</div>"
        + (f.fix ? '<div class="f-fix"><span>怎么改：</span>' + esc(f.fix) + "</div>" : "")
        + "</div>";
    }).join("");

    Array.prototype.forEach.call(box.querySelectorAll(".finding"), function (el) {
      el.addEventListener("click", function () { gotoLine(parseInt(el.getAttribute("data-line"), 10)); });
    });
  }

  /* ---------- 运行与对比 ---------- */
  function runNow() {
    var code = $("code").value;
    var stdin = $("stdin").value;
    var expected = $("expected").value;
    var btn = $("btn-run");
    btn.disabled = true;
    $("run-status").textContent = "正在运行…";
    $("run-status").className = "run-status busy";

    setTimeout(function () {
      var started = Date.now();
      var result;
      try {
        result = runner.run(code, stdin, { timeoutMs: 4000 });
      } catch (err) {
        result = { ok: false, stdout: "", error: { title: "运行器内部错误", detail: String(err && err.message || err), hint: "请把出错代码反馈给开发者。" } };
      }
      result.elapsed = Date.now() - started;
      state.lastRun = { result: result, expected: expected };
      renderRunResult(state.lastRun);
      btn.disabled = false;
    }, 20);
  }

  function renderRunResult(payload) {
    var result = payload.result;
    var expected = payload.expected;
    var status = $("run-status");
    var body = $("run-body");

    if (!result.ok) {
      var e = result.error || { title: "运行失败", detail: "", hint: "" };
      status.className = "run-status bad";
      status.textContent = "程序没能跑完：" + e.title;
      var loc = e.line ? "第 " + e.line + " 行" + (e.column ? " 第 " + e.column + " 列" : "") : "";
      body.innerHTML =
        '<div class="run-error">'
        + '<div class="re-title">' + esc(e.title) + (loc ? '<span class="re-loc">' + loc + "</span>" : "") + "</div>"
        + '<div class="re-detail">' + esc(e.detail) + "</div>"
        + (e.hint ? '<div class="re-hint">建议：' + esc(e.hint) + "</div>" : "")
        + "</div>"
        + (result.stdout ? '<div class="block-title">出错前已经打印的内容</div><pre class="stdout">' + esc(result.stdout) + "</pre>" : "");
      return;
    }

    var html = "";
    status.className = "run-status ok";
    status.textContent = "程序正常运行结束（用时 " + result.elapsed + " 毫秒）";

    html += '<div class="block-title">程序输出' + (result.truncated ? "（已截断）" : "") + "</div>";
    html += '<pre class="stdout">' + (result.stdout === "" ? '<span class="dim">（没有任何输出）</span>' : esc(result.stdout)) + "</pre>";

    var strict = $("chk-strict").checked;
    if (expected.replace(/\s+$/, "") === "" ) {
      html += '<div class="compare-note">没有填写期望输出，只显示实际运行结果。把题目要求的输出填到上面，就能自动逐行对比。</div>';
    } else {
      var cmp = runner.compareOutput(result.stdout, expected, { keepLineTrailing: strict, keepTrailingBlank: strict });
      if (cmp.match) {
        html += '<div class="verdict good">输出与期望完全一致'
          + (cmp.whitespaceOnly ? '（仅行尾空白/末尾换行有差异，一般不影响判题）' : "") + "</div>";
      } else {
        html += '<div class="verdict bad">输出与期望不一致，第一个不同的地方在第 ' + (cmp.firstDiff + 1) + " 行</div>";
        html += '<div class="block-title">逐行对比</div><div class="diff">';
        cmp.rows.forEach(function (row) {
          var cls = row.kind === "same" ? "d-same" : (row.kind === "diff" ? "d-diff" : (row.kind === "missing" ? "d-missing" : "d-extra"));
          var label = row.kind === "missing" ? "少输出" : (row.kind === "extra" ? "多输出" : "不一致");
          html += '<div class="d-row ' + cls + '">'
            + '<span class="d-no">' + row.index + "</span>"
            + '<span class="d-tag">' + (row.kind === "same" ? "一致" : label) + "</span>"
            + '<span class="d-cell"><i>期望</i>' + (row.expected === undefined ? '<em>（没有这一行）</em>' : esc(row.expected) || "<em>（空行）</em>") + "</span>"
            + '<span class="d-cell"><i>实际</i>' + (row.actual === undefined ? '<em>（没有这一行）</em>' : esc(row.actual) || "<em>（空行）</em>") + "</span>"
            + "</div>";
        });
        html += "</div>";
        html += '<div class="compare-note">常见原因：输出格式多了/少了空格或换行；题目要求保留几位小数没对上；循环次数不对。</div>';
      }
    }
    body.innerHTML = html;
  }

  /* ---------- 题库 ---------- */
  function fillProblemSelect() {
    var sel = $("problem-select");
    var html = '<option value="">— 选择题目类型自动填入样例数据 —</option>';
    problems.forEach(function (p) {
      html += '<option value="' + p.id + '">' + esc(p.title) + "</option>";
    });
    sel.innerHTML = html;
  }

  function onProblemChange() {
    var id = $("problem-select").value;
    var p = problems.filter(function (x) { return x.id === id; })[0];
    state.currentProblem = p || null;
    var info = $("problem-info");
    if (!p) {
      info.classList.add("hidden");
      $("btn-fill-reference").classList.add("hidden");
      return;
    }
    var first = p.samples[0];
    $("stdin").value = first.input;
    $("expected").value = first.output;
    info.classList.remove("hidden");
    info.innerHTML = "<b>" + esc(p.title) + "</b>　" + esc(p.summary)
      + '<div class="pi-line"><span>输入</span>' + esc(p.inputDesc) + "</div>"
      + '<div class="pi-line"><span>输出</span>' + esc(p.outputDesc) + "</div>"
      + '<div class="pi-line"><span>样例</span>' + p.samples.length + " 组，已填入第 1 组，可手动换成其它组" + "</div>";
    var more = p.samples.slice(1).map(function (s, i) {
      return '<button class="chip" data-in="' + esc(s.input) + '" data-out="' + esc(s.output) + '">第 ' + (i + 2) + " 组样例</button>";
    }).join("");
    info.innerHTML += '<div class="pi-chips">' + more + "</div>";
    Array.prototype.forEach.call(info.querySelectorAll(".chip"), function (b) {
      b.addEventListener("click", function () {
        $("stdin").value = b.getAttribute("data-in");
        $("expected").value = b.getAttribute("data-out");
      });
    });
    $("btn-fill-reference").classList.remove("hidden");
  }

  function fillReference() {
    if (!state.currentProblem) return;
    if (!confirm("填入参考实现会覆盖编辑器里现在的代码，确定吗？（建议先自己调通再看答案）")) return;
    $("code").value = state.currentProblem.reference;
    refreshGutter();
    analyzeNow();
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
