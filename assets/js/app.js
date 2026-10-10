/*!
 * 页面交互：编辑代码 → 实时静态检查 → 真实运行 → 与期望输出逐行对比。
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var analyzer = window.PTAAnalyzer;
  var runner = window.PTARunner;
  var problems = window.PTAProblems || [];

  var state = { findings: [], timer: null, currentProblem: null, lastRun: null, aiRun: null, aiTarget: "answer", aiCheckMode: false, aiCheckStale: false, runForced: false };

  var HINT_WEB = "下面这段就是发给 AI 的内容。想直接在这里出结果就点「在本站生成」；想用你自己的 AI 网页，就点「复制提示词」再粘贴过去。";

  var SEV = {
    error: { label: "错误", cls: "sev-error", mark: "✖", hint: "这样写编译器一定会报错" },
    warning: { label: "很可能有问题", cls: "sev-warn", mark: "!", hint: "代码能编译，但行为多半不是你要的" },
    info: { label: "建议", cls: "sev-info", mark: "·", hint: "不影响对错，属于写法层面的建议" }
  };

  /* 每种语言的入门样例：初始化、载入示例、切换语言时用 */
  var STARTERS = {
    c: '#include <stdio.h>\n' +
       '\n' +
       'int main() {\n' +
       '    int a, b;\n' +
       '    scanf("%d %d", &a, &b);\n' +
       '    printf("%d\\n", a + b);\n' +
       '    return 0;\n' +
       '}\n',
    python: '# 读入一行里的两个整数，输出它们的和\na, b = map(int, input().split())\nprint(a + b)\n',
    cpp: '#include <iostream>\n' +
         'using namespace std;\n' +
         '\n' +
         'int main() {\n' +
         '    int a, b;\n' +
         '    cin >> a >> b;\n' +
         '    cout << a + b << endl;\n' +
         '    return 0;\n' +
         '}\n',
    java: 'import java.util.Scanner;\n' +
          '\n' +
          'public class Main {\n' +
          '    public static void main(String[] args) {\n' +
          '        Scanner sc = new Scanner(System.in);\n' +
          '        int a = sc.nextInt(), b = sc.nextInt();\n' +
          '        System.out.println(a + b);\n' +
          '    }\n' +
          '}\n'
  };

  var PLACEHOLDERS = {
    c: "把你的 C 代码粘贴到这里……",
    python: "把你的 Python 代码粘贴到这里……",
    cpp: "把你的 C++ 代码粘贴到这里……",
    java: "把你的 Java 代码粘贴到这里……"
  };

  var LANG_LABEL = { c: "C 语言", python: "Python", cpp: "C++", java: "Java" };
  var LEVEL_LABEL = { easy: "简单", normal: "中等", hard: "困难" };
  var LANG_KEY = "pta-code-lang";
  var LEVEL_KEY = "pta-answer-level";

  function init() {
    loadLangAndLevel();
    $("code").value = starterFor(curLang());
    applyLangAndLevel();
    snapshotCode(); /* 记下起始状态，撤销可以退到这里 */
    fillProblemSelect();
    bindEvents();
    initWelcome();
    initHints();
    devGreet();
    closeFloat(); /* 小黑框默认收起 */
    setCodeFull(false); /* 默认不是全屏：终端只应该出现在全屏里 */
    dropLegacyAccountData();
    loadAiConfig();
    refreshGutter();
    analyzeNow();
  }

  function bindEvents() {
    var code = $("code");

    code.addEventListener("input", function () {
      state.runForced = false;
      refreshGutter();
      scheduleSnapshot();
      if (state.aiCheckMode) { markRecheckStale(); return; }
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
        flushSnapshot();
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      var k = String(e.key || "").toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); goHistory(-1); return; }
      if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); goHistory(1); }
    });

    $("btn-check").addEventListener("click", checkNow);
    $("btn-run").addEventListener("click", runNow);
    $("btn-check-run").addEventListener("click", function () { analyzeNow(true); runNow(); });
    $("btn-undo").addEventListener("click", function () { goHistory(-1); });
    $("btn-redo").addEventListener("click", function () { goHistory(1); });
    $("btn-clear").addEventListener("click", function () {
      $("code").value = "";
      refreshGutter();
      analyzeNow();
      flushSnapshot();
      $("code").focus();
    });
    $("btn-sample").addEventListener("click", function () {
      $("code").value = starterFor(curLang());
      refreshGutter();
      analyzeNow();
      flushSnapshot();
    });
    $("btn-clear-problem").addEventListener("click", function () {
      var box = $("problem-text");
      if (!box) return;
      box.value = "";
      if (typeof box.focus === "function") box.focus();
    });
    $("code-lang").addEventListener("change", onLangChange);
    $("answer-level").addEventListener("change", onLevelChange);
    $("btn-hints").addEventListener("click", toggleHints);
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
    $("btn-ask").addEventListener("click", function () { showPrompt("ask"); });
    $("btn-ask-clear").addEventListener("click", function () {
      var box = $("ask-question");
      if (!box) return;
      box.value = "";
      if (typeof box.focus === "function") box.focus();
    });
    $("btn-copy-ask").addEventListener("click", function () { copyResult($("ask-answer"), "回答"); });
    $("btn-translate").addEventListener("click", function () { showPrompt("translate"); });
    $("btn-practice").addEventListener("click", function () { showPrompt("practice"); });
    $("btn-recheck").addEventListener("click", runRecheck);
    $("btn-copy-answer").addEventListener("click", function () {
      copyResult($("answer-body"), "答案");
    });
    $("btn-copy-practice").addEventListener("click", function () {
      copyResult($("practice-body"), "练习题");
    });
    $("btn-answer-full").addEventListener("click", toggleAnswerFull);
    $("btn-code-full").addEventListener("click", toggleCodeFull);
    $("btn-dev-check").addEventListener("click", devCheck);
    $("btn-dev-run").addEventListener("click", devRun);
    $("btn-dev-clear").addEventListener("click", clearDevLog);
    $("btn-float-close").addEventListener("click", closeFloat);
    $("btn-dev-send").addEventListener("click", addDevInput);
    $("dev-input").addEventListener("keydown", onDevInputKey);
    $("btn-copy-part1").addEventListener("click", function () { copyResult($("part-plain"), "第 ① 段（纯答案代码）", true); });
    $("btn-copy-part2").addEventListener("click", function () { copyResult($("part-annotated"), "第 ② 段（带注释的代码）", true); });
    $("btn-copy-part3").addEventListener("click", function () { copyResult($("part-pitfalls"), "第 ③ 段（容易出错的地方）", true); });
    $("answer-body").addEventListener("input", function () {
      renderAnswerParts($("answer-body").value);
    });
    document.addEventListener("keydown", function (e) {
      if (!e || e.key !== "Escape") return;
      if (floatOpen()) { closeFloat(); return; }
      if (codeFullOn()) { toggleCodeFull(); return; }
      if ($("panel-answer").classList.contains("fullscreen")) toggleAnswerFull();
    });
    $("btn-copy-prompt").addEventListener("click", function () {
      var box = $("prompt-out");
      if (!box.value) return;
      copyText(box.value, function (ok) {
        setAiStatus(ok ? "已复制到剪贴板。" : "复制失败：请手动全选下面的提示词。");
      });
    });

    /* 自带 API Key：设置与直接生成 */
    $("ai-preset").addEventListener("change", applyPreset);
    $("btn-ai-models").addEventListener("click", pullModels);
    $("btn-ai-save").addEventListener("click", saveAiConfig);
    $("btn-ai-forget").addEventListener("click", forgetAiConfig);
    $("btn-ai-run").addEventListener("click", runAi);
    $("btn-ai-stop").addEventListener("click", stopAi);
  }

  /* ---------- 进站提示弹窗：勾了「不再提示」就记在本机，下次直接不弹 ---------- */
  var WELCOME_KEY = "pta-welcome-mute";

  function welcomeMuted() {
    try {
      return !!(window.localStorage && window.localStorage.getItem(WELCOME_KEY) === "1");
    } catch (err) {
      return false;
    }
  }

  function muteWelcome() {
    try {
      if (window.localStorage) window.localStorage.setItem(WELCOME_KEY, "1");
    } catch (err) { /* 浏览器不让存就算了，大不了下次再弹一次 */ }
  }

  function initWelcome() {
    var box = $("welcome");
    if (!box) return;

    function onKey(e) {
      if (e && e.key === "Escape") close();
    }
    function close() {
      if ($("chk-welcome-mute").checked) muteWelcome();
      box.classList.add("hidden");
      if (typeof document.removeEventListener === "function") document.removeEventListener("keydown", onKey);
    }

    $("btn-welcome-x").addEventListener("click", close);
    $("btn-welcome-ok").addEventListener("click", close);
    box.addEventListener("click", function (e) { if (e.target === box) close(); });
    if (typeof document.addEventListener === "function") document.addEventListener("keydown", onKey);

    if (welcomeMuted()) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
  }

  /* ---------- 网站使用提示：一键把各模块的说明文字收起来，界面更清爽 ---------- */
  var HINTS_KEY = "pta-hints-off";

  function hintsOff() {
    return !!(document.body && document.body.classList && document.body.classList.contains("hints-off"));
  }

  function setHints(off) {
    var body = document.body;
    if (body && body.classList) body.classList[off ? "add" : "remove"]("hints-off");
    var btn = $("btn-hints");
    if (!btn) return;
    btn.textContent = off ? "网站使用提示（已收起）" : "网站使用提示";
    if (btn.classList) btn.classList[off ? "add" : "remove"]("on");
    if (typeof btn.setAttribute === "function") btn.setAttribute("aria-pressed", off ? "true" : "false");
  }

  function toggleHints() {
    var off = !hintsOff();
    setHints(off);
    if (off) lsSet(HINTS_KEY, "1"); else lsDel(HINTS_KEY);
  }

  /* 上次收起过就接着收起，不用每次重新点 */
  function initHints() {
    setHints(lsGet(HINTS_KEY) === "1");
  }

  /* ---------- 语言 / 难度：整个页面的检查、答案、练习、翻译都按这两个选择来 ---------- */
  /* 下拉框没选、或者值不认识时，一律退回 C 语言 / 简单，不然后面会当成「非 C」把功能全关掉 */
  function curLang() {
    var v = $("code-lang") ? $("code-lang").value : "";
    return STARTERS[v] ? v : "c";
  }
  function curLevel() {
    var v = $("answer-level") ? $("answer-level").value : "";
    return LEVEL_LABEL[v] ? v : "easy";
  }
  function starterFor(lang) { return STARTERS[lang] || STARTERS.c; }

  function loadLangAndLevel() {
    var lang = lsGet(LANG_KEY);
    var level = lsGet(LEVEL_KEY);
    if (lang && STARTERS[lang] && $("code-lang")) $("code-lang").value = lang;
    if (level && LEVEL_LABEL[level] && $("answer-level")) $("answer-level").value = level;
  }

  /* C 语言：本机的检查规则和解释器都能用。其他语言：本机没有对应的解释器，
     把「检查 / 运行」关掉，别拿 C 的规则去判 Python / C++ / Java 的代码。 */
  function applyLangAndLevel() {
    var lang = curLang();
    var level = curLevel();
    var isC = lang === "c";
    var noLocal = "本机只装了 C 语言的检查规则和解释器：换回 C 语言才能用，或者用右边「答案与解析」交给你自己的 AI。";
    ["btn-check", "btn-run", "btn-check-run", "btn-fill-reference", "btn-dev-check", "btn-dev-run"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.disabled = !isC;
      el.title = isC ? "" : noLocal;
    });
    ["problem-select", "chk-strict"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.disabled = !isC;
      el.title = isC ? "" : "示例数据和参考实现都是 C 语言的。";
    });
    var warn = $("lang-warn");
    if (warn) warn.classList[isC ? "add" : "remove"]("hidden");
    var warnName = $("lang-warn-name");
    if (warnName) warnName.textContent = (LANG_LABEL[lang] || "这门") + "语言";
    var status = $("lang-status");
    if (status) {
      status.textContent = "当前：" + (LANG_LABEL[lang] || lang) + " · " + (LEVEL_LABEL[level] || level) + "答案"
        + (isC ? "" : "（本机不跑代码，交给你的 AI）");
    }
    var box = $("code");
    if (box && PLACEHOLDERS[lang]) box.placeholder = PLACEHOLDERS[lang];
  }

  /* 框里还是上一门语言的示例（或者是空的）就换成新语言的示例，免得对着 C 代码写 Python */
  function isStarterText(text) {
    var t = String(text == null ? "" : text);
    if (!t.trim()) return true;
    for (var k in STARTERS) { if (STARTERS[k] === t) return true; }
    return false;
  }

  function onLangChange() {
    var box = $("code");
    if (box && isStarterText(box.value)) box.value = starterFor(curLang());
    lsSet(LANG_KEY, curLang());
    applyLangAndLevel();
    refreshGutter();
    analyzeNow();
    flushSnapshot();
    if (box && typeof box.focus === "function") box.focus();
  }

  function onLevelChange() {
    lsSet(LEVEL_KEY, curLevel());
    applyLangAndLevel();
  }

  /* ---------- 代码编辑的上一步 / 下一步：手误也能退回去 ---------- */
  var history = { stack: [], index: -1, timer: null, limit: 60 };

  function syncHistoryButtons() {
    var undo = $("btn-undo");
    var redo = $("btn-redo");
    if (undo) undo.disabled = history.index <= 0;
    if (redo) redo.disabled = history.index >= history.stack.length - 1;
  }

  function snapshotCode() {
    var box = $("code");
    if (!box) return;
    var value = box.value;
    if (history.index >= 0 && history.stack[history.index].value === value) return;
    if (history.index < history.stack.length - 1) history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push({ value: value, start: box.selectionStart || 0, end: box.selectionEnd || 0 });
    if (history.stack.length > history.limit) history.stack.shift();
    history.index = history.stack.length - 1;
    syncHistoryButtons();
  }

  /* 打字时不要每敲一下都记一条，停手一下再记 */
  function scheduleSnapshot() {
    if (history.timer) clearTimeout(history.timer);
    history.timer = setTimeout(function () { history.timer = null; snapshotCode(); }, 350);
  }

  function flushSnapshot() {
    if (history.timer) { clearTimeout(history.timer); history.timer = null; }
    snapshotCode();
  }

  function goHistory(step) {
    var box = $("code");
    if (!box) return;
    flushSnapshot(); /* 先把当前内容记下来，免得刚打的字丢了 */
    var next = history.index + step;
    if (next < 0 || next >= history.stack.length) return;
    history.index = next;
    var snap = history.stack[history.index];
    box.value = snap.value;
    if (typeof box.setSelectionRange === "function") {
      try { box.setSelectionRange(snap.start, snap.end); } catch (err) { /* 无所谓 */ }
    }
    state.runForced = false;
    refreshGutter();
    analyzeNow();
    syncHistoryButtons();
    if (typeof box.focus === "function") box.focus();
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

  function needFeedback() {
    var box = $("pta-feedback");
    if (!box.value.trim()) {
      alert("请先把 PTA 提交后给出的批改提示（「应用修改」那段原文）粘贴到框里，再点「翻译成中文」。");
      box.focus();
      return false;
    }
    return true;
  }

  function needQuestion() {
    var box = $("ask-question");
    if (box.value.trim()) return true;
    alert("先在「提问」框里写清你哪里不懂——最好写上第几行，例如：第 6 行的 printf 为什么用 %d 会出错？");
    box.focus();
    return false;
  }

  function setAiStatus(text) {
    $("ai-status").textContent = text;
  }

  function showPrompt(kind) {
    if (!window.PTAPrompt) return;
    if (kind === "translate") {
      if (!needFeedback()) return;
    } else if (kind === "ask") {
      if (!needProblem()) return;
      if (!needQuestion()) return;
    } else if (!needProblem()) {
      return;
    }
    var ctx = {
      problem: $("problem-text").value,
      code: $("code").value,
      feedback: $("pta-feedback").value,
      findings: state.findings,
      lang: curLang(),
      level: curLevel()
    };
    var text;
    if (kind === "answer") {
      text = window.PTAPrompt.buildAnswer(ctx);
    } else if (kind === "ask") {
      ctx.question = $("ask-question").value;
      text = window.PTAPrompt.buildAsk(ctx);
    } else if (kind === "translate") {
      text = window.PTAPrompt.buildTranslate(ctx);
    } else {
      ctx.count = parseInt($("practice-count").value, 10) || 3;
      ctx.withAnswer = $("chk-practice-answer").checked;
      text = window.PTAPrompt.buildPractice(ctx);
    }

    $("prompt-out").value = text;
    state.aiTarget = kind;
    if (kind === "practice") {
      setOutNote("practice-note", "还没有生成。");
      $("panel-practice-out").classList.remove("hidden");
    } else if (kind === "ask") {
      setOutNote("ask-note", "还没有生成。");
    } else {
      $("answer-title").textContent = kind === "translate"
        ? "报错翻译（" + LANG_LABEL[curLang()] + "）"
        : "答案与解析（" + LANG_LABEL[curLang()] + " · " + LEVEL_LABEL[curLevel()] + "）";
      setOutNote("answer-note", "还没有生成。");
      $("panel-answer").classList.remove("hidden");
      showAnswerMode(kind === "translate" ? "raw" : "parts");
    }
    $("panel-ai").classList.remove("hidden");
    $("ai-hint").textContent = HINT_WEB;
    copyText(text, function (ok) {
      setAiStatus(ok
        ? "提示词已复制。想在这里直接出结果就点「在本站生成」；想去网站上问，直接粘过去就行。"
        : "复制失败：请手动全选下面的提示词复制。");
    });
    updateRunNote();
    $("panel-ai").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ---------- 生成结果的展示区：答案在右栏、练习题在左栏、二次检查覆盖检查结果 ---------- */
  function setOutNote(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  function copyResult(box, name, isText) {
    var text = !box ? "" : (isText ? box.textContent : box.value);
    if (!text) { setAiStatus("还没有可复制的" + name + "。"); return; }
    copyText(text, function (ok) {
      setAiStatus(ok ? name + "已复制到剪贴板。" : "复制失败：请手动选中上面的" + name + "再复制。");
    });
  }

  function outputFor(kind) {
    if (kind === "practice") return { panel: $("panel-practice-out"), body: $("practice-body"), note: "practice-note", parts: false };
    if (kind === "ask") return { panel: $("panel-ask"), body: $("ask-answer"), note: "ask-note", parts: false };
    return { panel: $("panel-answer"), body: $("answer-body"), note: "answer-note", parts: kind !== "translate" };
  }

  /* ---------- 「答案与解析」三段式：把 AI 的回答按 ① ② ③ 拆开显示 ---------- */
  var PART_RE = /第\s*([123１２３一二三])\s*部分/;

  function partNumber(ch) {
    if (ch === "1" || ch === "１" || ch === "一") return 1;
    if (ch === "2" || ch === "２" || ch === "二") return 2;
    if (ch === "3" || ch === "３" || ch === "三") return 3;
    return 0;
  }

  function stripFence(s) {
    return String(s == null ? "" : s)
      .replace(/^[\s]*```[a-zA-Z0-9+#-]*[\s]*\n?/, "")
      .replace(/\n?[\s]*```[\s]*$/, "")
      .trim();
  }

  /* 按 AI 输出的三段标题切分；切不出来就返回 ok:false，交给回退逻辑 */
  function splitAnswer(text) {
    var out = { ok: false, p1: "", p2: "", p3: "" };
    var t = String(text == null ? "" : text).replace(/\r\n/g, "\n");
    if (!t.trim()) return out;
    var lines = t.split("\n");
    var marks = [];
    for (var i = 0; i < lines.length; i++) {
      var m = PART_RE.exec(lines[i]);
      if (!m || lines[i].trim().length > 60) continue;
      var n = partNumber(m[1]);
      if (!n) continue;
      var dup = false;
      for (var k = 0; k < marks.length; k++) if (marks[k].part === n) dup = true;
      if (!dup) marks.push({ part: n, i: i });
    }
    if (!marks.length) return out;
    out.ok = true;
    for (var j = 0; j < marks.length; j++) {
      var end = j + 1 < marks.length ? marks[j + 1].i : lines.length;
      var body = stripFence(lines.slice(marks[j].i + 1, end).join("\n"));
      if (marks[j].part === 1) out.p1 = body;
      else if (marks[j].part === 2) out.p2 = body;
      else out.p3 = body;
    }
    return out;
  }

  function renderAnswerParts(text, quiet) {
    var r = splitAnswer(text);
    if (quiet && !r.ok) return;
    $("part-plain").textContent = r.p1;
    $("part-annotated").textContent = r.p2;
    $("part-pitfalls").textContent = r.p3;
    var hint = $("answer-parse-hint");
    if (!hint) return;
    if (!r.ok && String(text || "").trim()) {
      hint.textContent = "这次 AI 没有按 ① ② ③ 三段输出，所以三段没分开；完整内容在下面「原始回答」里，展开就能看、也能直接复制。";
      hint.classList.remove("hidden");
      if ($("answer-raw-wrap")) $("answer-raw-wrap").open = true;
    } else {
      hint.classList.add("hidden");
    }
  }

  /* 答案用三段显示；「报错翻译」内容不是三段，就用原始回答那一块 */
  function showAnswerMode(mode) {
    var parts = $("answer-parts");
    var raw = $("answer-raw-wrap");
    if (!parts || !raw) return;
    if (mode === "raw") {
      parts.classList.add("hidden");
      raw.open = true;
    } else {
      parts.classList.remove("hidden");
      raw.open = false;
    }
  }

  function toggleAnswerFull() {
    var panel = $("panel-answer");
    if (!panel) return;
    var on = panel.classList.toggle("fullscreen");
    if (document.body && document.body.classList) {
      document.body.classList[on ? "add" : "remove"]("answer-full-open");
    }
    var btn = $("btn-answer-full");
    if (btn) btn.textContent = on ? "退出全屏" : "放大到全屏";
    if (on) panel.scrollTop = 0;
  }

  /* ---------- 「你的代码」放大到全屏：编辑器铺满整屏，下面变成一个能跑的终端 ---------- */
  var devLog = [];
  var DEV_LOG_LIMIT = 20000;

  function codeFullOn() {
    var panel = $("panel-code");
    return !!(panel && panel.classList && panel.classList.contains("fullscreen"));
  }

  function renderDevLog() {
    var box = $("dev-out");
    if (!box) return;
    box.textContent = devLog.join("\n");
    box.scrollTop = box.scrollHeight;
  }

  /* 终端日志：同时写进 <pre>（复制/降级用）和 xterm 终端（如果加载成功）。
     opts.skipTerm：这一条只是给 <pre> 记个echo，终端里用户已经自己打出来了，别再写一遍。 */
  function devWrite(text, opts) {
    devLog.push(String(text));
    var all = devLog.join("\n");
    if (all.length > DEV_LOG_LIMIT) devLog = [all.slice(all.length - DEV_LOG_LIMIT)];
    renderDevLog();
    if (term && !(opts && opts.skipTerm)) term.write(String(text).replace(/\n/g, "\r\n") + "\r\n");
  }

  /* 清空终端：日志、<pre> 和 xterm 三处一起清，别再出现「点了没反应」 */
  function clearDevLog() {
    devLog = [];
    termLine = "";
    termInput = "";
    renderDevLog();
    if (term) {
      try { term.reset(); } catch (err) { /* 清不了就算了 */ }
      term.write("终端已清空。\r\n> ");
    }
  }

  /* 运行前的把关：先静态检查；有「错误」级问题就先别跑，把问题说清楚，再点一次才强行运行 */
  function runGate() {
    analyzeNow(true);
    var errs = (state.findings || []).filter(function (f) { return f.severity === "error"; });
    if (!errs.length) { state.runForced = false; return { run: true, errors: [], forced: false }; }
    if (state.runForced) { state.runForced = false; return { run: true, errors: errs, forced: true }; }
    state.runForced = true;
    return { run: false, errors: errs, forced: false };
  }

  /* 把「先别跑」的理由写成几行文字，终端和右侧都用它 */
  function gateLines(errors) {
    var lines = [];
    for (var i = 0; i < errors.length && i < 5; i++) {
      var x = errors[i];
      lines.push("  第 " + x.line + " 行：" + x.title + (x.fix ? "　改法：" + x.fix : ""));
    }
    if (errors.length > 5) lines.push("  ……还有 " + (errors.length - 5) + " 个，看右边的「检查结果」。");
    lines.push("改完再点「运行」；确认要强行运行（可能直接崩），就再点一次「运行」。");
    return lines;
  }

  /* ---------- 运行时弹出的「小黑框」终端：同一个终端，进全屏时收进代码面板，平时浮在右下角 ---------- */
  function floatOpen() {
    var box = $("dev-float");
    return !!(box && box.classList && !box.classList.contains("hidden"));
  }

  /* 终端窗口：终端和「用样例数据实测」互相独立，只在点「运行」/「检查」时弹出来 */
  function openFloat() {
    var box = $("dev-float");
    if (!box) return;
    box.classList.remove("hidden");
    loadTerminal();
    scheduleFit();
    focusTerminal();
  }

  function closeFloat() {
    var box = $("dev-float");
    if (box) box.classList.add("hidden");
  }

  /* 第一次给终端一句说明，让新手知道下一步点什么 */
  function devGreet() {
    if (devLog.length) return;
    devLog.push("终端就绪：点「检查」先看有没有错误，没问题再点「运行」；要输入数据就在下面一行行敲，回车加一行，空行回车就运行。");
    renderDevLog();
  }

  /* 跑完一次之后：把终端窗口拉到眼前 */
  function afterRun() {
    openFloat();
    focusTerminal();
  }

  function setCodeFull(on) {
    var panel = $("panel-code");
    if (!panel) return;
    if (on) closeFloat();
    panel.classList[on ? "add" : "remove"]("fullscreen");
    if (document.body && document.body.classList) {
      document.body.classList[on ? "add" : "remove"]("code-full-open");
    }
    var btn = $("btn-code-full");
    if (btn) btn.textContent = on ? "退出全屏" : "放大到全屏";
    scheduleFit();
    if (on) $("code").focus();
  }

  function toggleCodeFull() { setCodeFull(!codeFullOn()); }

  /* ---------- 终端：加载 xterm.js（开源库，MIT，见 THIRD-PARTY-NOTICES.md）----------
     按需加载：只有进全屏才去取这个文件，首屏不受影响。加载失败就退回上面那个简易终端。 */
  var term = null;
  var termState = "idle"; /* idle | loading | ready | failed */
  var termLine = "";
  var termInput = ""; /* 终端窗口自己的输入缓冲，不去改「用样例数据实测」里的「程序输入」 */
  var fitAddon = null;
  var fitTimer = null;

  /* 让终端的行列数跟着盒子大小走（用 xterm 官方的 fit 插件） */
  function fitTerminal() {
    if (!fitAddon || !term) return;
    var dev = $("dev");
    if (dev && dev.classList && dev.classList.contains("hidden")) return;
    try { fitAddon.fit(); } catch (err) { /* 量不出尺寸就算了 */ }
  }

  function scheduleFit() {
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(fitTerminal, 60);
  }

  if (typeof window !== "undefined" && window && typeof window.addEventListener === "function") {
    window.addEventListener("resize", scheduleFit);
  }

  function loadTerminal() {
    if (termState !== "idle") return;
    if (!document.head || typeof document.head.appendChild !== "function") { termState = "failed"; return; }
    termState = "loading";
    var s = document.createElement("script");
    s.src = "assets/vendor/xterm.js?v=20261011a";
    s.onload = function () { termState = "idle"; initTerminal(); };
    s.onerror = function () { termState = "failed"; };
    document.head.appendChild(s);
  }

  function initTerminal() {
    var host = $("dev-term");
    if (!window.Xterm || !window.Xterm.Terminal || !host || typeof host.appendChild !== "function") {
      termState = "failed";
      return;
    }
    try {
      term = new window.Xterm.Terminal({
        convertEol: true, cursorBlink: true, scrollback: 2000, fontSize: 13,
        fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace',
        theme: { background: "#3a2630", foreground: "#f6e9ef", cursor: "#f6e9ef", selectionBackground: "#6b4257" }
      });
      term.open(host);
      term.onData(onTermData);
      if (window.Xterm.FitAddon && typeof term.loadAddon === "function") {
        fitAddon = new window.Xterm.FitAddon();
        term.loadAddon(fitAddon);
      }
      termState = "ready";
      var dev = $("dev");
      if (dev) dev.classList.add("term-on");
      if (devLog.length) term.write(devLog.join("\r\n") + "\r\n");
      term.write("> ");
      fitTerminal();
      focusTerminal();
    } catch (err) {
      term = null;
      termState = "failed";
    }
  }

  function focusTerminal() {
    if (!term) return;
    if (typeof term.focus === "function") { try { term.focus(); } catch (err) { /* 无所谓 */ } }
  }

  /* 终端里直接打字：回车＝加一行输入；空行回车＝运行；退格删字；Ctrl+C 清掉当前行 */
  function onTermData(data) {
    var s = String(data == null ? "" : data);
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === "\r" || ch === "\n") {
        term.write("\r\n");
        var line = termLine;
        termLine = "";
        if (line.trim()) appendStdin(line);
        else devRun();
        term.write("> ");
      } else if (ch === "\u007f" || ch === "\b") {
        if (termLine.length) { termLine = termLine.slice(0, -1); term.write("\b \b"); }
      } else if (ch === "\u0003") {
        termLine = "";
        term.write("^C\r\n> ");
      } else if (ch >= " ") {
        termLine += ch;
        term.write(ch);
      }
    }
  }

  /* 终端里加一行输入：只加进终端自己的缓冲，不动「用样例数据实测」里的那个框 */
  function appendStdin(line) {
    if (!line) return;
    termInput += line + "\n";
    devWrite("> " + line, { skipTerm: true });
  }

  function addDevInput() {
    var box = $("dev-input");
    if (!box) return;
    var line = String(box.value).replace(/\s+$/, "");
    box.value = "";
    appendStdin(line);
  }

  function onDevInputKey(e) {
    if (!e || e.key !== "Enter") return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) { devRun(); return; }
    if (String($("dev-input").value).trim()) addDevInput();
    else devRun();
  }

  /* 终端里的「检查」：复用本地静态检查，把结果打一份到终端里 */
  function devCheck() {
    if (curLang() !== "c") {
      devWrite("$ 检查\n本机只装了 C 语言的检查规则：把语言换回 C 才能在这里检查，或者用右边的「答案与解析」交给你自己的 AI。");
      return;
    }
    analyzeNow(true);
    var f = state.findings || [];
    if (!f.length) {
      devWrite("$ 检查\n检查通过：没有发现常见写法错误，可以运行了——先按题目样例输入数据，再点「运行」。");
      return;
    }
    var lines = ["$ 检查", "静态检查：发现 " + f.length + " 个问题"];
    for (var i = 0; i < f.length; i++) {
      var x = f[i];
      var sev = SEV[x.severity] ? SEV[x.severity].label : "";
      lines.push("  第 " + x.line + " 行 " + sev + "：" + x.title + (x.fix ? "　改法：" + x.fix : ""));
    }
    devWrite(lines.join("\n"));
  }

  /* 工具栏上的「立即检查」：平时把结果写到右侧「检查结果」；全屏时右侧看不到，就把终端窗口弹出来写进去 */
  function checkNow() {
    if (codeFullOn()) { openFloat(); devCheck(); return; }
    analyzeNow(true);
  }

  function devRun() {
    if (curLang() !== "c") {
      devWrite("$ 运行\n本机只装了 C 语言的解释器：把语言换回 C 才能运行，或者用右边的「答案与解析」交给你自己的 AI。");
      return;
    }
    if (String($("dev-input").value).trim()) addDevInput();
    var code = $("code").value;
    if (!code.trim()) { devWrite("$ 运行\n还没有代码：先把代码粘到上面的编辑框里。"); return; }
    var gate = runGate();
    if (!gate.run) {
      devWrite("$ 运行\n先别跑：静态检查发现 " + gate.errors.length + " 个错误，先改掉。\n" + gateLines(gate.errors).join("\n"));
      return;
    }
    /* 终端里输入过就用终端自己的数据；没输入才用「用样例数据实测」里的样例数据（只读不改） */
    var fromTerm = termInput.trim() !== "";
    var stdin = fromTerm ? termInput : $("stdin").value;
    var started = Date.now();
    var result;
    try {
      result = runner.run(code, stdin, { timeoutMs: 4000 });
    } catch (err) {
      result = { ok: false, stdout: "", error: { title: "运行器内部错误", detail: String((err && err.message) || err), hint: "" } };
    }
    result.elapsed = Date.now() - started;

    devLogRun(result, stdin, gate, fromTerm);

    /* 顺手把「用样例数据实测」那边的结果也刷新，退出全屏后看到的是同一份结果 */
    state.lastRun = { result: result, expected: $("expected").value };
    renderRunResult(state.lastRun);
    afterRun();
  }

  /* 把一次运行的结果写成终端里的一块记录（终端里的「运行」和工具栏的「运行并对比」共用） */
  function devLogRun(result, stdin, gate, fromTerm) {
    var lines = ["$ 运行"
      + (gate && gate.forced ? "（忽略 " + gate.errors.length + " 个错误强行运行）" : "")
      + (stdin.trim() ? "（输入：" + stdin.replace(/\s+$/, "").replace(/\n/g, " / ") + "）" : "（没有输入）")
      + (!fromTerm && stdin.trim() ? "（用的是「用样例数据实测」里填的样例数据）" : "")];
    if (result.stdout) lines.push(result.stdout.replace(/\n+$/, ""));
    if (result.ok) {
      lines.push("[结束] 程序正常跑完，用时 " + result.elapsed + " 毫秒" + (result.stdout ? "" : "（程序没有输出）"));
    } else {
      var e = result.error || { title: "运行失败", detail: "", hint: "" };
      lines.push("[出错] " + e.title + (e.line ? "（第 " + e.line + " 行）" : "") + (e.detail ? "：" + e.detail : ""));
      if (e.hint) lines.push("[建议] " + e.hint);
    }
    devWrite(lines.join("\n"));
  }

  function aiKindLabel(kind) {
    if (kind === "practice") return "练习题";
    if (kind === "ask") return "提问回答";
    if (kind === "translate") return "翻译";
    if (kind === "recheck") return "二次检查";
    return "答案";
  }

  /* 二次检查：拿生成的答案当标准，让 AI 重新检查代码，结果覆盖「检查结果」面板 */
  function runRecheck() {
    var problem = $("problem-text").value.trim();
    if (!problem) {
      alert("「二次检查」要用你题目生成的那份答案来对照，所以先把 PTA 上的题目整段粘到右边「题目」框里，再生成一次答案。");
      $("problem-text").focus();
      return;
    }
    var answer = $("answer-body").value.trim();
    if (!answer) {
      alert("还没有可对照的答案。先点「生成答案与解析」并按提示生成答案（或把你自己 AI 给的答案粘进右边的「答案与解析」框），再点「二次检查」。");
      $("panel-answer").classList.remove("hidden");
      $("panel-answer").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!window.PTAPrompt) return;
    var text = window.PTAPrompt.buildRecheck({
      problem: $("problem-text").value,
      code: $("code").value,
      feedback: $("pta-feedback").value,
      answer: $("answer-body").value,
      findings: state.findings,
      lang: curLang(),
      level: curLevel()
    });
    $("prompt-out").value = text;
    state.aiTarget = "recheck";
    $("panel-ai").classList.remove("hidden");
    $("ai-hint").textContent = HINT_WEB;
    setAiStatus("准备用你生成的答案重新检查代码：配好 API 就点「在本站生成」。");
    updateRunNote();
    if (hasAiConfig()) {
      runAi();
    } else {
      $("panel-ai").scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function beginRecheck() {
    state.aiCheckMode = true;
    state.aiCheckStale = false;
    $("summary").className = "summary note";
    $("summary").innerHTML = "正在用 AI 对照「答案与解析」重新检查你的代码…";
    $("findings").innerHTML = "";
    $("recheck-out").textContent = "";
    $("recheck-out").classList.remove("hidden");
  }

  function markRecheckStale() {
    state.aiCheckStale = true;
    $("summary").className = "summary warn";
    $("summary").innerHTML = "代码已经改动，下面的 AI 检查结果是改动前的。再点一次「二次检查」用新代码重查；想回到本地静态检查就点「立即检查」。";
  }

  function exitRecheck() {
    state.aiCheckMode = false;
    state.aiCheckStale = false;
    $("recheck-out").classList.add("hidden");
  }

  /* ---------- 自带 API Key：配置与在本站直接生成 ---------- */
  var AI_CFG_KEY = "pta-ai-config";
  var AI_KEY_KEY = "pta-ai-key";
  var aiKeyMemory = "";

  function lsGet(key) {
    try { return window.localStorage ? window.localStorage.getItem(key) : null; } catch (err) { return null; }
  }
  function lsSet(key, val) {
    try { if (window.localStorage) window.localStorage.setItem(key, val); } catch (err) { /* 存不了就算 */ }
  }
  function lsDel(key) {
    try { if (window.localStorage) window.localStorage.removeItem(key); } catch (err) { /* 无所谓 */ }
  }

  /* 早先版本用过「本机账号」登录，后来删掉了登录系统；顺手清掉可能残留的数据。 */
  function dropLegacyAccountData() {
    ["pta-accounts", "pta-session", "pta-pending-code"].forEach(lsDel);
  }

  function aiConfig() {
    var cfg = null;
    try { cfg = JSON.parse(lsGet(AI_CFG_KEY) || "null"); } catch (err) { cfg = null; }
    if (!cfg || typeof cfg !== "object") cfg = {};
    return {
      preset: cfg.preset || "deepseek",
      base: cfg.base || "",
      model: cfg.model || "",
      remember: !!cfg.remember
    };
  }

  function aiKey() {
    if (aiKeyMemory) return aiKeyMemory;
    return aiConfig().remember ? (lsGet(AI_KEY_KEY) || "") : "";
  }

  function hasAiConfig() {
    var c = aiConfig();
    return !!(c.base && c.model && aiKey());
  }

  function loadAiConfig() {
    if (!$("ai-preset")) return;
    var c = aiConfig();
    var presets = (window.PTAAI && window.PTAAI.PRESETS) || {};
    $("ai-preset").value = presets[c.preset] ? c.preset : "custom";
    $("ai-base").value = c.base || (presets[c.preset] ? presets[c.preset].base : "");
    $("ai-model").value = c.model;
    $("chk-ai-remember").checked = c.remember;
    if (c.remember) $("ai-key").value = lsGet(AI_KEY_KEY) || "";
    updateRunNote();
  }

  function applyPreset() {
    var name = $("ai-preset").value;
    var p = (window.PTAAI && window.PTAAI.PRESETS) ? window.PTAAI.PRESETS[name] : null;
    if (!p || name === "custom") { updateRunNote(); return; }
    $("ai-base").value = p.base;
    $("ai-model").value = p.model;
    updateRunNote();
  }

  function saveAiConfig() {
    var p = {
      preset: $("ai-preset").value,
      base: $("ai-base").value.trim(),
      model: $("ai-model").value.trim(),
      remember: $("chk-ai-remember").checked
    };
    if (!p.base) { setAiStatus("先填 API 地址，例如 https://api.deepseek.com/v1"); return; }
    if (!p.model) { setAiStatus("先填模型名，例如 deepseek-chat；不知道模型名就点「拉取模型」。"); return; }
    var key = $("ai-key").value.trim();
    if (!key) { setAiStatus("先填 API Key（在你所用服务的后台申请）。"); return; }

    lsSet(AI_CFG_KEY, JSON.stringify(p));
    if (p.remember) lsSet(AI_KEY_KEY, key); else lsDel(AI_KEY_KEY);
    aiKeyMemory = p.remember ? "" : key;
    setAiStatus("已保存。将要请求：" + window.PTAAI.chatEndpoint(p.base));
    updateRunNote();
  }

  /* 一键忘掉本机存的 API 信息：地址、密钥、模型全清掉，输入框也清空。 */
  function forgetAiConfig() {
    lsDel(AI_CFG_KEY);
    lsDel(AI_KEY_KEY);
    aiKeyMemory = "";
    $("ai-key").value = "";
    $("ai-base").value = "";
    $("ai-model").value = "";
    $("chk-ai-remember").checked = false;
    setAiStatus("已清除本机保存的 API 地址、密钥和模型。");
    updateRunNote();
  }

  function pullModels() {
    var base = $("ai-base").value.trim();
    var key = $("ai-key").value.trim() || aiKey();
    if (!base) { setAiStatus("先填 API 地址。"); return; }
    setAiStatus("正在拉取模型列表…");
    window.PTAAI.listModels({ base: base, key: key }).then(function (list) {
      $("ai-model-list").innerHTML = list.map(function (m) {
        return '<option value="' + esc(m) + '"></option>';
      }).join("");
      if (!list.length) { setAiStatus("这个服务没返回模型列表，手动填模型名吧。"); return; }
      if (!$("ai-model").value) $("ai-model").value = list[0];
      setAiStatus("拉到 " + list.length + " 个模型，点「模型」输入框就能挑。");
    }, function (err) {
      setAiStatus(window.PTAAI.explain(err));
    });
  }

  function updateRunNote() {
    var note = $("ai-run-note");
    if (!note) return;
    note.textContent = hasAiConfig()
      ? "将发往：" + window.PTAAI.chatEndpoint(aiConfig().base)
      : "先在上面填好 API 地址、密钥和模型。";
  }

  function finishAiRun() {
    state.aiRun = null;
    $("btn-ai-run").classList.remove("hidden");
    $("btn-ai-stop").classList.add("hidden");
  }

  function runAi() {
    var text = $("prompt-out").value;
    if (!text) { setAiStatus("先点上面的「生成答案与解析」或「生成相似练习题」，把要问的内容准备好。"); return; }
    var c = aiConfig();
    var key = aiKey();
    if (!c.base || !c.model || !key) {
      setAiStatus("还没配好：先去上面的「API」模块填好 API 地址、API Key 和模型名，点「保存并检测」。");
      $("panel-api").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (state.aiRun) state.aiRun.cancel();

    var kind = state.aiTarget || "answer";
    var label = aiKindLabel(kind);
    var target;
    if (kind === "recheck") {
      beginRecheck();
      target = { panel: null, body: $("recheck-out"), note: null, mode: "text" };
    } else {
      target = outputFor(kind);
      target.mode = "value";
      target.panel.classList.remove("hidden");
      target.body.value = "";
      if (target.parts) renderAnswerParts("");
      setOutNote(target.note, "正在生成…");
    }
    $("btn-ai-run").classList.add("hidden");
    $("btn-ai-stop").classList.remove("hidden");
    setAiStatus("正在请求 " + c.model + "（" + label + "）…");

    state.aiRun = window.PTAAI.chat({
      base: c.base,
      key: key,
      model: c.model,
      prompt: text,
      onDelta: function (d, all) {
        if (target.mode === "text") {
          target.body.textContent = all;
        } else {
          target.body.value = all;
          target.body.scrollTop = target.body.scrollHeight;
        }
        if (target.parts) renderAnswerParts(all, true);
      },
      onDone: function () {
        finishAiRun();
        if (target.note) setOutNote(target.note, "已生成（模型：" + c.model + "）");
        if (target.parts) renderAnswerParts(target.body.value);
        if (kind === "recheck") {
          $("summary").className = "summary note";
          $("summary").innerHTML = "以下是用你生成的答案对照后，AI 给出的重新检查结果（模型：" + esc(c.model) + "）。";
        }
        setAiStatus("生成完毕（" + label + "，模型：" + c.model + "）。");
      },
      onError: function (err) {
        finishAiRun();
        if (target.note) setOutNote(target.note, "生成失败");
        if (kind === "recheck") {
          $("summary").className = "summary warn";
          $("summary").innerHTML = "二次检查没能完成，下面是已经收到的内容。可以再点一次「二次检查」，或点「立即检查」回到本地静态检查。";
        }
        setAiStatus(window.PTAAI.explain(err));
      }
    });
  }

  function stopAi() {
    if (state.aiRun) { state.aiRun.cancel(); state.aiRun = null; }
    $("btn-ai-run").classList.remove("hidden");
    $("btn-ai-stop").classList.add("hidden");
    if (state.aiTarget === "recheck") {
      $("summary").className = "summary warn";
      $("summary").innerHTML = "二次检查已停止，下面是已经收到的内容。再点一次「二次检查」可以重查，或点「立即检查」回到本地静态检查。";
    }
    setAiStatus("已停止。");
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
  function analyzeNow(deep) {
    exitRecheck();
    if (curLang() !== "c") {
      state.findings = [];
      refreshGutter();
      renderNoLocalCheck();
      return;
    }
    var code = $("code").value;
    var result = { findings: [] };
    try {
      result = analyzer.analyze(code);
    } catch (err) {
      console.error(err);
    }
    var list = result.findings || [];
    /* 再叠两层「真」检查，这样代码不完整也照样能报出真错误：
       ① 语法层（真解析，边打字就能跑）——少分号、括号不配对、语句写在函数外面……
       ② 试运行层（点「立即检查」/「运行」时跑一遍）——变量没声明、漏 &、数组越界、缺少 main…… */
    list = mergeEngineFindings(list, safeEngineCheck("syntax", code));
    if (deep) list = mergeEngineFindings(list, safeEngineCheck("run", code));
    state.findings = sortFindings(list);
    state.lastCheckDeep = !!deep;
    refreshGutter();
    renderFindings();
  }

  function safeEngineCheck(kind, code) {
    try {
      if (kind === "syntax") return runner.checkSyntax ? runner.checkSyntax(code) : null;
      return runner.checkByRun ? runner.checkByRun(code, $("stdin").value) : null;
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  /* 把解释器查出来的问题并进检查结果：同一行已经静态查出问题了就不重复报 */
  function mergeEngineFindings(base, extra) {
    if (!extra || !extra.length) return base;
    var out = (base || []).slice();
    for (var i = 0; i < extra.length; i++) {
      var e = extra[i];
      var dup = false;
      for (var j = 0; j < out.length; j++) {
        if (out[j].line === e.line) { dup = true; break; }
      }
      if (!dup) out.push(e);
    }
    return out;
  }

  /* 报错发生在「整段代码里根本没有函数」的情况下，补一句更直白的提示 */
  function refineFragmentFinding(f) {
    if (!f || !/语法错误/.test(String(f.title))) return f;
    var masked = (analyzer && analyzer.maskCode) ? analyzer.maskCode(String($("code").value)) : "";
    if (!masked || /\w+\s*\([^)]*\)\s*\{/.test(masked)) return f;
    return {
      severity: f.severity, line: f.line, column: f.column, title: f.title,
      detail: f.detail + "\n另外：这段代码里没有看到函数定义——PTA 上的题一般要把语句写在 int main() { ... } 里面，现在可能只是贴了一小段。",
      fix: f.fix, snippet: f.snippet, fromEngine: f.fromEngine
    };
  }

  /* 错误排前面，然后按行号从小到大 */
  function sortFindings(list) {
    var rank = { error: 0, warning: 1, info: 2 };
    return (list || []).map(refineFragmentFinding).sort(function (a, b) {
      var ra = rank[a.severity] == null ? 3 : rank[a.severity];
      var rb = rank[b.severity] == null ? 3 : rank[b.severity];
      if (ra !== rb) return ra - rb;
      return (a.line || 0) - (b.line || 0);
    });
  }

  /* 选了非 C 语言：本地没有对应的检查规则，直接说清楚，别拿 C 的规则乱报 */
  function renderNoLocalCheck() {
    var lang = LANG_LABEL[curLang()] || "这门语言";
    var summary = $("summary");
    summary.className = "summary note";
    summary.innerHTML = "当前语言是 <b>" + esc(lang) + "</b>：本机只装了 C 语言的检查规则，所以这里不做本地检查（免得拿 C 的规则去误报）。";
    $("findings").innerHTML = '<div class="empty">想看「哪里写错了」，用右边的「答案与解析」或「二次检查」：把题目粘到右边，页面会拼好一段提问，用你自己的 AI 检查。提示词里已经写明语言和难度。</div>';
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
      summary.innerHTML = (state.lastCheckDeep
        ? "本地检查（语法 + 常见写法 + 内置解释器试跑）没有发现问题。"
        : "没有发现问题：语法能解析，常见写法也没毛病。") + "可以点“运行并对比”用样例数据实测一下。";
    } else {
      summary.className = "summary " + (errors ? "bad" : (warns ? "warn" : "note"));
      var parts = [];
      if (errors) parts.push("<b>" + errors + "</b> 个错误");
      if (warns) parts.push("<b>" + warns + "</b> 个很可能有问题的地方");
      if (infos) parts.push("<b>" + infos + "</b> 条建议");
      summary.innerHTML = "共发现 " + parts.join("、") + "。按严重程度从上到下排列。";
    }

    if (list.length === 0) {
      box.innerHTML = '<div class="empty">没查出问题：语法能解析、常见写法也没毛病'
        + (state.lastCheckDeep ? "，并且已经用内置解释器试跑过一次" : "（点「立即检查」还会真的试跑一遍）")
        + '。注意：逻辑对不对最终要靠题目样例实测——点「运行并对比」。</div>';
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
    if (curLang() !== "c") {
      $("run-status").textContent = "本机只装了 C 语言的解释器：把语言换回 C 才能运行，或者用右边的「答案与解析」交给你自己的 AI。";
      $("run-body").innerHTML = "";
      return;
    }
    var code = $("code").value;
    var stdin = $("stdin").value;
    var expected = $("expected").value;
    var gate = runGate();
    if (!gate.run) {
      devWrite("$ 运行\n先别跑：静态检查发现 " + gate.errors.length + " 个错误，先改掉。\n" + gateLines(gate.errors).join("\n"));
      $("run-status").className = "run-status bad";
      $("run-status").textContent = "先别跑：静态检查发现 " + gate.errors.length + " 个错误（终端里和右侧「检查结果」都写了）。改完再运行；确认要强行运行就再点一次「运行并对比」。";
      $("run-body").innerHTML = '<div class="run-error"><div class="re-title">先修好这些错误再运行</div>'
        + '<div class="re-detail">' + esc(gateLines(gate.errors).join("\n")) + "</div></div>";
      afterRun();
      return;
    }
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
      devLogRun(result, stdin, gate, false); /* 终端窗口里也留一份，和 Dev-C++ 一样 */
      if (gate.forced) $("run-status").textContent += "（忽略 " + gate.errors.length + " 个错误强行运行）";
      afterRun();
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

