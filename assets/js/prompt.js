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

  /* 语言：决定代码用哪种语言写、怎么读入输出、提交时要注意什么。
     key 与页面「语言」下拉框的 value 一致（c / python / cpp / java）。 */
  var LANGS = {
    c: {
      key: "c", name: "C 语言", code: "C",
      env: "PTA 的 C 环境（C99 / C11 都可以）",
      io: "读入用 scanf、输出用 printf，输出的空格和换行必须和题目要求完全一致",
      submit: "提交一份完整的 C 程序：要有 #include <stdio.h>，要有 main 函数，结尾 return 0;",
      traps: "scanf 忘了写 &、printf 的占位符和变量类型不配对（比如 %d 配 double）、数组下标越界、结果超出 int 范围"
    },
    python: {
      key: "python", name: "Python 3", code: "Python 3",
      env: "PTA 的 Python 3 环境",
      io: "读入用 input()（一行多个数用 map(int, input().split())），输出用 print()",
      submit: "提交一份完整的 Python 3 程序，不要用 Python 2 的写法（例如 print 后面不加括号）",
      traps: "input() 拿到的是字符串却忘了转 int、多打印了空格或换行、递归太深没设 setrecursionlimit、数据量大时用太慢的写法"
    },
    cpp: {
      key: "cpp", name: "C++", code: "C++",
      env: "PTA 的 C++ 环境（g++，可以用 #include <bits/stdc++.h> 和 using namespace std;）",
      io: "读入用 cin、输出用 cout（每行结尾要有换行）",
      submit: "提交一份完整的 C++ 程序：要有 #include，要有 int main()",
      traps: "cin/cout 和 scanf/printf 混用忘了同步、数组开太小、int 和 long long 混用溢出、输出少了换行"
    },
    java: {
      key: "java", name: "Java", code: "Java",
      env: "PTA 的 Java 环境（javac / java）",
      io: "读入用 Scanner（数据量大时用 BufferedReader），输出用 System.out.println",
      submit: "提交一份完整的 Java 程序：类名必须是 Main（public class Main），入口是 public static void main(String[] args)",
      traps: "类名不是 Main（PTA 只认 Main）、Scanner 没判 hasNext 就取数、整数相除丢精度、字符串用 == 比较"
    }
  };

  /* 难度：决定这份答案给谁看、允许用到什么写法。key 与「难度」下拉框一致。 */
  var LEVELS = {
    easy: {
      key: "easy", name: "简单",
      who: "刚学编程的新手",
      goal: "最好懂：一眼能看懂、照着写就能过",
      explain: "学生是新手：尽量不用专业术语；实在躲不开的词，第一次出现时就用一句话解释清楚；句子短一点、一步一步来。",
      style: [
        "只用最基础的语法：变量、if / else、for / while、数组、基本的输入输出。",
        "不要用任何技巧和「高级写法」。例如：指针 / 位运算 / 宏 / 递归 / 自增自减混在一行（C）；列表推导式 / lambda / 生成器 / 递归（Python）；模板 / STL 容器与算法 / auto / 引用（C++）；流式写法 / 复杂集合操作（Java）。",
        "变量名用 a、b、n、i、sum 这种一看就懂的，不要用很长的名字。",
        "宁可多写几步，也要让人一眼看懂。"
      ]
    },
    normal: {
      key: "normal", name: "中等",
      who: "学过基础语法的人",
      goal: "简洁一些，但学过基础的人能看懂",
      explain: "学生学过基础语法：可以用常用的词（变量、循环、数组、下标、编译错误这一类），但每个词后面都要跟一句大白话解释。",
      style: [
        "在简单写法的基础上，可以用一点常见技巧：把重复逻辑拆成小函数；用常用的库函数（C 的 string.h / math.h / qsort，Python 的 sorted / enumerate / 字典，C++ 的 sort / vector / string，Java 的 ArrayList / Arrays.sort / String 方法）。",
        "要简洁，但不要把好几件事硬挤在一行。",
        "不要引入复杂算法或数据结构，也不要用冷门写法。"
      ]
    },
    hard: {
      key: "hard", name: "困难",
      who: "只看结果、不在意代码能不能看懂的人",
      goal: "最好用：最短、最省事、能最快跑过所有测试点",
      explain: "学生想往深处学：可以适当使用专业术语（内存、地址、求值顺序、时间复杂度、未定义行为等），但每个术语都要立刻用大白话再解释一遍，不让人只看到名词。",
      style: [
        "用最直接、最高效的写法：合适的算法与数据结构，以及标准库里现成的工具（C 的 qsort / memcpy，Python 的 collections / itertools / bisect / heapq，C++ 的 STL 算法与容器，Java 的集合框架和数组工具类）。",
        "代码要短、要直接：不绕弯子、不写没用的中间步骤、不要多余的注释。",
        "该用 long long / 高精度 / 快速读入就果断用，不要为了「好懂」牺牲效率。",
        "同一道题有几种做法时，直接给最快最稳的那一种，不要给折中方案。"
      ]
    }
  };

  function pick(map, key, fallback) {
    return map[key] || map[fallback];
  }

  /* 语言 + 难度放在最前面，明确告诉 AI 这是最高优先级的约束 */
  function headBlock(lang, level) {
    return [
      "【本次要求（最高优先级，先看这里）】",
      "- 语言：" + lang.name + "（" + lang.env + "）",
      "- 答案难度：" + level.name + "：目标读者是" + level.who + "，目标是" + level.goal + "。",
      "- 下面的代码、答案、练习题，全部必须用 " + lang.code + " 写，并且按这个难度来。"
    ].join("\n");
  }

  function block(title, body) {
    var t = (body == null ? "" : String(body)).trim();
    return "【" + title + "】\n" + (t ? t : "（无）");
  }

  /* 带行号的代码：提问模块里 AI 要按「第几行」回答，标上行号最不容易答偏 */
  function numbered(code) {
    var lines = String(code == null ? "" : code).replace(/\r\n/g, "\n").split("\n");
    return lines.map(function (s, i) { return (i + 1) + " | " + s; }).join("\n");
  }

  /* 提问：用户看不懂哪一行就问哪一行，按语言与难度讲清楚 */
  function buildAsk(ctx) {
    var c = ctx || {};
    var lang = pick(LANGS, c.lang, "c");
    var level = pick(LEVELS, c.level, "easy");
    var q = (c.question == null ? "" : String(c.question)).trim();
    return [
      "你是一位 " + lang.name + " 老师，正在回答一个学生关于代码的提问。",
      "",
      headBlock(lang, level),
      "",
      "【学生的问题】",
      q ? q : "（这次没写清楚问题，请先让学生补充：是第几行、哪里看不懂。）",
      "",
      block("题目", c.problem),
      "",
      block("学生写的代码（" + lang.name + "，每行前面是行号）", numbered(c.code)),
      "",
      mistakeBlocks(c.feedback, c.findings),
      "",
      "【回答要求，请严格遵守】",
      "1. 先回答学生问的那个问题：第一句就给结论，然后说清「为什么会这样」。学生写了第几行，就针对那一行（最多连带紧邻的几行）来讲，不要跑题。",
      "2. 讲解方式按上面的难度来：" + level.explain,
      "3. 解释完以后，再用一句最通俗的大白话把那句结论复述一遍（像给同学讲题那样，不用任何术语）。",
      "4. 如果能用一个日常生活里人人都懂的例子打比方（排队、洗牌、快递分拣、找座位这类），就举一个；这道题确实不好类比时，直接不举，不要硬编一个不相干的比喻。",
      "5. 正确性最重要：凡是你不确定的（编译器/语言版本的差异、没见过的写法、边界情况、题库没说的隐含条件），必须明确写「我不确定」，并说明可能的情况；绝对不要为了显得流畅而编造结论，也不要含糊其辞或模棱两可。宁可说「这我不确定」，也不要给错话。",
      "6. 如果学生这一行确实写错了，指出错在哪并给出改法（用 " + lang.code + " 写，写法风格跟着上面的难度走）；如果没错，就直接说「这行没问题」，并说明它为什么是对的。",
      "7. 全文用中文，条理清楚、别绕弯子；不要再把整份代码重复一遍。"
    ].join("\n");
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

  /* 答案与解析：按「语言 + 难度」出答案，三段式（纯代码 / 逐行注释 / 易错点） */
  function buildAnswer(ctx) {
    var c = ctx || {};
    var lang = pick(LANGS, c.lang, "c");
    var level = pick(LEVELS, c.level, "easy");
    return [
      "你是一位 " + lang.name + " 老师，正在帮一个学生解决一道 PTA（拼题A）上的题。",
      "",
      headBlock(lang, level),
      "",
      "（如果题目文字不完整或有歧义，请先说明你按什么理解来做，再给结论。）",
      "",
      block("题目", c.problem),
      "",
      block("我写的代码（" + lang.name + "）", c.code),
      "",
      mistakeBlocks(c.feedback, c.findings),
      "",
      "【输出要求，请严格遵守】",
      "全文用中文、代码用 " + lang.code + "。" + lang.io + "；" + lang.submit + "。请严格按下面三段输出，每段的标题行必须原样照抄（网页靠它自动分段显示）：",
      "",
      "===== 第 1 部分：纯答案代码（不加注释） =====",
      "只给一份完整、能直接提交的 " + lang.name + " 代码（" + level.name + "难度：" + level.goal + "）：",
      level.style.map(function (s, i) { return (i + 1) + ". " + s; }).join("\n"),
      (level.style.length + 1) + ". 不要注释、不要解释文字、不要写「略」「此处省略」。",
      "",
      "===== 第 2 部分：带注释的代码（注释单独占一行） =====",
      level.key === "hard"
        ? "再给一份同样逻辑、同样写法的代码，只在关键行（读入、输出、循环边界、算法核心）下面另起一行写注释；不重要的行不必注释。"
        : "再给一份和上面完全一样的代码，但每一行代码的下面另起一行写注释，用大白话说清这一行在干什么、为什么这么写。",
      "格式示范（" + lang.name + " 的注释写法按这门语言的规矩来，下面只是示意）：",
      "    读入两个整数",
      "    注释另起一行，写清这一步在干什么",
      "注意：注释一律写在代码的「下一行」，不要把 // 注释跟在代码同一行末尾；注释里不要出现没解释过的英文术语，说人话。",
      "",
      "===== 第 3 部分：容易出错的地方 =====",
      "逐条列出这道题最容易踩的坑（至少 3 条），每条写清「错在哪、为什么会错、怎么避免、写代码时怎么自查」。"
        + (level.key === "easy" ? "用新手能看懂的话，句子要短、直接说结论。" : "说法可以直接一点，说重点。")
        + "特别提醒这些 " + lang.name + " 的常见坑：" + lang.traps + "。"
        + "最后点评我上面写的代码错在第几行、为什么错、应该怎么改；如果我写对了就直接说对。"
    ].join("\n");
  }

  /* 练习：按题目和错误点出相似题 */
  function buildPractice(ctx) {
    var c = ctx || {};
    var lang = pick(LANGS, c.lang, "c");
    var level = pick(LEVELS, c.level, "easy");
    var n = parseInt(c.count, 10) || 3;
    if (n < 1) n = 1;
    if (n > 3) n = 3;
    var answerRule = c.withAnswer
      ? "每道题后面直接附上参考答案（" + lang.name + "，" + level.name + "难度：" + level.goal + "），再跟一句大白话解题提示。"
      : "先只给题目和样例，不要给答案；等我把代码发给你，你再逐题批改。";
    return [
      "你是一位 " + lang.name + " 出题老师。请根据下面这道题，仿照出 " + n + " 道「题型相同、难度相当、数据不同」的新题，帮我练熟这一类题。",
      "",
      headBlock(lang, level),
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
      "5. 题目风格尽量贴近 PTA 的基础题，题干用中文；参考答案一律用 " + lang.code + " 写。",
      "6. 题目难度和原题保持一致，别借机加难度；题干里不要考没学过的知识点。"
    ].join("\n");
  }

  /* 翻译报错：把 PTA 的批改提示翻成大白话，直接点出哪里错了 */
  function buildTranslate(ctx) {
    var c = ctx || {};
    var lang = pick(LANGS, c.lang, "c");
    return [
      "你是一位特别会讲人话的 " + lang.name + " 老师，正在帮一个刚学编程的新手。下面是我在 PTA（拼题 A）上提交作业后系统给我的批改提示原文，我基本看不懂。",
      "",
      "（我提交的代码是 " + lang.name + "，环境是" + lang.env + "。）",
      "",
      "请把这段提示翻译成简单、直白的中文，直接告诉我到底哪里错了。",
      "",
      block("PTA 给我的批改提示原文", c.feedback),
      "",
      block("我写的代码（" + lang.name + "）", c.code),
      "",
      block("题目（可能为空）", c.problem),
      "",
      block("工具自动检查出来的问题", findingsToText(c.findings)),
      "",
      "【输出要求，请严格遵守】",
      "1. 先用一句话说清「这道题到底错在哪」；不要直接甩术语，像「段错误」「运行超时」这种词要顺手解释成大白话。",
      "2. 再逐条翻译 PTA 的提示：每条写清「它说的是什么意思」「对应我哪里出的问题」「我该怎么改」。",
      "3. 提示里出现测试点、行号、错误类型，就逐条对应说明；没有就跳过，不要编。",
      "4. 如果能直接改好，就指出要改我代码的第几行、改成什么样子（用 " + lang.code + " 写）。",
      "5. 全文用中文，语气像学长带学弟，短句、直白，不要长篇大论。"
    ].join("\n");
  }

  /* 二次检查：拿已经生成好的答案当标准，让 AI 重新逐行检查我的代码 */
  function buildRecheck(ctx) {
    var c = ctx || {};
    var lang = pick(LANGS, c.lang, "c");
    var level = pick(LEVELS, c.level, "easy");
    return [
      "你是一位严格的 " + lang.name + " 老师。下面这道题我已经有一份正确答案和解析了，请你把这份答案当作「标准」，把我写的代码重新逐行检查一遍。",
      "",
      "（我提交的代码是 " + lang.name + "，" + lang.submit + "。我之前选择的答案难度是「" + level.name + "」。）",
      "",
      block("题目", c.problem),
      "",
      block("标准答案与解析（用来对照）", c.answer),
      "",
      block("要被检查的代码（我写的，" + lang.name + "）", c.code),
      "",
      block("PTA 提交后的批改提示（可能为空）", c.feedback),
      "",
      "【检查要求，请严格遵守】",
      "1. 只针对我这份代码逐条列问题，每条写清「第几行」+「哪里不对」+「为什么错」+「应该改成什么」。",
      "2. 重点比对标准答案的思路：我的写法在逻辑、边界情况、输入输出格式上，和它有没有不一致。",
      "3. 如果我这段代码是对的，就直接说「代码正确」，再指出相比标准答案多余或可以简化的地方。",
      "4. 不要把标准答案整份重复一遍，把它当参照，专注检查我的代码。",
      "5. 注意 " + lang.name + " 特有的坑：" + lang.traps + "。",
      "6. 全文用中文，条理清楚，别绕弯子。"
    ].join("\n");
  }

  window.PTAPrompt = {
    buildAnswer: buildAnswer,
    buildAsk: buildAsk,
    buildPractice: buildPractice,
    buildTranslate: buildTranslate,
    buildRecheck: buildRecheck,
    findingsToText: findingsToText
  };
})();
