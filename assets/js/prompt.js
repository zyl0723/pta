/*!
 * 提示词拼装：把「题目 + 我的代码 + PTA 批改提示 + 自动检查出的错误点」
 * 组织成一段可以直接发给任意 AI 对话工具的提问文本。
 *
 * 说明：这个文件只负责拼字符串，不会联网、不会调用任何 AI、不会搜索答案。
 * 页面把拼好的文本复制到剪贴板，再由使用者自己粘贴到 AI 里发送。
 */
(function () {
  "use strict";

  var SEV_LABEL = { error: "错误", warning: "很可能有问题", info: "建议" };

  function block(title, body) {
    var t = (body == null ? "" : String(body)).trim();
    return "【" + title + "】\n" + (t ? t : "（无）");
  }

  function findingsToText(findings) {
    if (!findings || !findings.length) return "";
    return findings.map(function (f) {
      var s = "- 第 " + f.line + " 行 " + (SEV_LABEL[f.severity] || "") + "：" + f.title;
      if (f.detail) s += "（" + f.detail + "）";
      if (f.fix) s += "　改法：" + f.fix;
      return s;
    }).join("\n");
  }

  function mistakeBlocks(feedback, findings) {
    var out = [block("PTA 提交后的批改提示", feedback)];
    var f = findingsToText(findings);
    if (f) out.push(block("我在这道题上犯过的错误（工具自动检查出来的）", f));
    return out.join("\n\n");
  }

  /* 答案与解析：要逐行注释 + 易错点 */
  function buildAnswer(ctx) {
    var c = ctx || {};
    return [
      "你是一位耐心、严谨的 C 语言老师。下面是一道 PTA（拼题A）上的题，请给出这道题的正确答案和详细解析。",
      "",
      "（如果题目文字不完整或有歧义，请先说明你按什么理解来做，再给结论。）",
      "",
      block("题目", c.problem),
      "",
      block("我写的代码", c.code),
      "",
      mistakeBlocks(c.feedback, c.findings),
      "",
      "【输出要求，请严格遵守】",
      "1. 先给出完整、能直接编译运行的 C 语言代码，不要省略，不要写「略」「此处省略」。",
      "2. 代码的每一行末尾都用 // 加一句注释，说明这一行为什么要这样写、目的是什么。",
      "3. 代码之后另起一段，列出「容易出错的地方」：逐条写明这道题最容易踩的坑、为什么会踩、怎么避免，至少 3 条。",
      "4. 最后再用一小段点评我上面写的代码：错在第几行、为什么错、应该怎么改；如果我写对了，也直接说对。",
      "5. 全文用中文，代码用 C 语言。"
    ].join("\n");
  }

  /* 练习：按题目和错误点出相似题 */
  function buildPractice(ctx) {
    var c = ctx || {};
    var n = parseInt(c.count, 10) || 3;
    if (n < 1) n = 1;
    if (n > 3) n = 3;
    var answerRule = c.withAnswer
      ? "每道题后面直接附上参考答案（C 代码 + 一句解题提示）。"
      : "先只给题目和样例，不要给答案；等我把代码发给你，你再逐题批改。";
    return [
      "你是一位 C 语言出题老师。请根据下面这道题，仿照出 " + n + " 道「题型相同、难度相当、数据不同」的新题，帮我练熟这一类题。",
      "",
      "（如果我给的题目文字不完整，请先说明你按什么理解出题。）",
      "",
      block("原题", c.problem),
      "",
      mistakeBlocks(c.feedback, c.findings),
      "",
      "【出题要求】",
      "1. 新题必须和我这道题考同一个知识点、同一种写法，但题目背景、数据范围、样例都要换掉，不要原样照抄。",
      "2. 每道题都要有：题号、题干、输入格式、输出格式，以及至少 1 组输入样例和对应的输出样例。",
      "3. " + answerRule,
      "4. 适当针对我在上面犯过的错误设置「陷阱」，让我有机会再遇到同一类问题。",
      "5. 题目风格尽量贴近 PTA 的基础题，全文用中文。"
    ].join("\n");
  }

  /* 翻译报错：把 PTA 的批改提示翻成大白话，直接点出哪里错了 */
  function buildTranslate(ctx) {
    var c = ctx || {};
    return [
      "你是一位特别会讲人话的 C 语言老师，正在帮一个刚学编程的新手。下面是我在 PTA（拼题 A）上提交作业后系统给我的批改提示原文，我基本看不懂。",
      "",
      "请把这段提示翻译成简单、直白的中文，直接告诉我到底哪里错了。",
      "",
      block("PTA 给我的批改提示原文", c.feedback),
      "",
      block("我写的代码", c.code),
      "",
      block("题目（可能为空）", c.problem),
      "",
      block("工具自动检查出来的问题", findingsToText(c.findings)),
      "",
      "【输出要求，请严格遵守】",
      "1. 先用一句话说清「这道题到底错在哪」；不要直接甩术语，像「段错误」「运行超时」这种词要顺手解释成大白话。",
      "2. 再逐条翻译 PTA 的提示：每条写清「它说的是什么意思」「对应我哪里出的问题」「我该怎么改」。",
      "3. 提示里出现测试点、行号、错误类型，就逐条对应说明；没有就跳过，不要编。",
      "4. 如果能直接改好，就指出要改我代码的第几行、改成什么样子。",
      "5. 全文用中文，语气像学长带学弟，短句、直白，不要长篇大论。"
    ].join("\n");
  }

  window.PTAPrompt = {
    buildAnswer: buildAnswer,
    buildPractice: buildPractice,
    buildTranslate: buildTranslate,
    findingsToText: findingsToText
  };
})();
