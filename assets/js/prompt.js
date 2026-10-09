/*!
 * 把题目、代码、样例、PTA 提交反馈和本地检查结果，整理成一段可以直接粘贴给 AI 的提示词。
 *
 * 重要说明：本工具自身不联网、不调用任何 AI 模型，也没有「AI 检查」能力——
 * 检查结果是浏览器里的规则匹配和内置 C 解释器算出来的。这个文件只是帮你把上下文写成文字，
 * 你可以自己决定把它粘到哪里（比如你常用的 AI 助手），由那个工具去分析。
 */
(function () {
  "use strict";

  var SEV_LABEL = { error: "错误", warning: "很可能有问题", info: "建议" };

  function str(v) {
    return String(v == null ? "" : v);
  }

  function build(ctx) {
    var c = ctx || {};
    var code = str(c.code);
    var problem = str(c.problem).trim();
    var feedback = str(c.feedback).trim();
    var stdin = str(c.stdin).trim();
    var expected = str(c.expected).trim();
    var findings = c.findings || [];
    var run = c.run || null;

    var out = [];
    out.push("下面是一道 C 语言基础题（来自 PTA），请帮我找出代码里的问题、说明原因，并给出修改后的完整代码。");
    out.push("");
    out.push("【题目】");
    out.push(problem || "（未填写。方便的话把题面补上，这样能对照题意判断，而不只是看语法。）");
    out.push("");
    out.push("【我的代码】");
    out.push("```c");
    out.push(code.replace(/\s+$/, ""));
    out.push("```");

    if (stdin || expected) {
      out.push("");
      out.push("【样例输入】");
      out.push(stdin || "（未填写）");
      out.push("");
      out.push("【题目要求的输出】");
      out.push(expected || "（未填写）");
    }

    if (run && run.summary) {
      out.push("");
      out.push("【我用样例跑过一次】");
      out.push(run.summary);
      if (run.stdout) {
        out.push("");
        out.push("实际输出：");
        out.push("```");
        out.push(str(run.stdout).replace(/\s+$/, ""));
        out.push("```");
      }
    }

    if (feedback) {
      out.push("");
      out.push("【PTA 提交后的批改提示（原文，它只说明问题是什么，不一定说明原因）】");
      out.push(feedback);
    }

    if (findings.length) {
      out.push("");
      out.push("【本机静态检查工具列出的可疑点（规则匹配结果，不一定对，仅供参考）】");
      findings.forEach(function (f) {
        var label = SEV_LABEL[f.severity] || "提示";
        out.push("- " + (f.line ? "第 " + f.line + " 行 · " : "") + label + "：" + str(f.title));
        if (f.detail) out.push("  说明：" + str(f.detail));
        if (f.fix) out.push("  工具建议：" + str(f.fix));
      });
    }

    out.push("");
    out.push("请指出具体是第几行、为什么错、怎么改；如果我对题意的理解有偏差，也请直接指出。");
    return out.join("\n");
  }

  window.PTAPrompt = { build: build };
})();
