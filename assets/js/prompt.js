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
      "全文用中文、代码用 C 语言。请严格按下面三段输出，每段的标题行必须原样照抄（网页靠它自动分段显示）：",
      "",
      "===== 第 1 部分：纯答案代码（不加注释） =====",
      "只给一份完整、能直接编译运行的 C 语言代码。不要任何注释、不要任何解释文字、不要写「略」「此处省略」。",
      "",
      "===== 第 2 部分：带注释的代码（注释单独占一行） =====",
      "再给一份和上面完全一样的代码，但每一行代码的下面另起一行写注释，说明这一行为什么要这样写、目的是什么。格式示范：",
      "    scanf(\"%d %d\", &a, &b);",
      "    // 读入两个整数，scanf 里必须写 & 取地址",
      "    printf(\"%d\\n\", a + b);",
      "    // 输出两数之和；\\n 表示换行",
      "注意：注释一律写在代码的「下一行」，不要把 // 注释跟在代码同一行末尾。",
      "",
      "===== 第 3 部分：容易出错的地方 =====",
      "逐条列出这道题最容易踩的坑（至少 3 条），每条写清「错在哪、为什么会错、怎么避免、写代码时怎么自查」；最后再点评我上面写的代码错在第几行、为什么错、应该怎么改；如果我写对了就直接说对。"
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

  /* 二次检查：拿已经生成好的答案当标准，让 AI 重新逐行检查我的代码 */
  function buildRecheck(ctx) {
    var c = ctx || {};
    return [
      "你是一位严格的 C 语言老师。下面这道题我已经有一份正确答案和解析了，请你把这份答案当作「标准」，把我写的代码重新逐行检查一遍。",
      "",
      block("题目", c.problem),
      "",
      block("标准答案与解析（用来对照）", c.answer),
      "",
      block("要被检查的代码（我写的）", c.code),
      "",
      block("PTA 提交后的批改提示（可能为空）", c.feedback),
      "",
      "【检查要求，请严格遵守】",
      "1. 只针对我这份代码逐条列问题，每条写清「第几行」+「哪里不对」+「为什么错」+「应该改成什么」。",
      "2. 重点比对标准答案的思路：我的写法在逻辑、边界情况、输入输出格式上，和它有没有不一致。",
      "3. 如果我这段代码是对的，就直接说「代码正确」，再指出相比标准答案多余或可以简化的地方。",
      "4. 不要把标准答案整份重复一遍，把它当参照，专注检查我的代码。",
      "5. 全文用中文，条理清楚，别绕弯子。"
    ].join("\n");
  }

  window.PTAPrompt = {
    buildAnswer: buildAnswer,
    buildPractice: buildPractice,
    buildTranslate: buildTranslate,
    buildRecheck: buildRecheck,
    findingsToText: findingsToText
  };
})();
