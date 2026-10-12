/*!
 * 运行引擎：把学生代码真的跑起来，并把解释器/编译器的原始报错翻译成直白的中文。
 * 只有真的跑过，才敢说「输出不对」——这是不误导学生的关键。
 */
(function (global) {
  "use strict";

  var MAX_OUTPUT = 200000;

  function lineOf(src, n) {
    var lines = String(src || "").split(/\r?\n/);
    return lines[n - 1] == null ? "" : lines[n - 1];
  }

  function stripTrailing(s) {
    return String(s == null ? "" : s).replace(/[ \t]+$/gm, "");
  }

  function normalizeOut(s, opts) {
    var t = String(s == null ? "" : s).replace(/\r\n/g, "\n");
    if (!opts || !opts.keepLineTrailing) t = stripTrailing(t);
    if (!opts || !opts.keepTrailingBlank) t = t.replace(/\n+$/, "").replace(/^\n+/, "");
    return t;
  }

  function splitLines(s) {
    if (s === "") return [];
    return String(s).split("\n");
  }

  /* 找出第一个没有关上的括号（跳过字符串、字符、注释），用来把「括号不配对」直接指到那个字符 */
  function findUnclosedBracket(src) {
    var t = String(src == null ? "" : src);
    var stack = [];
    var line = 1, col = 1, i = 0;
    while (i < t.length) {
      var ch = t.charAt(i), next = t.charAt(i + 1);
      if (ch === "\n") { line++; col = 1; i++; continue; }
      if (ch === "/" && next === "/") { while (i < t.length && t.charAt(i) !== "\n") i++; continue; }
      if (ch === "/" && next === "*") {
        i += 2; col += 2;
        while (i < t.length && !(t.charAt(i) === "*" && t.charAt(i + 1) === "/")) {
          if (t.charAt(i) === "\n") { line++; col = 1; } else col++;
          i++;
        }
        i += 2; col += 2;
        continue;
      }
      if (ch === '"' || ch === "'") {
        var quote = ch;
        i++; col++;
        while (i < t.length && t.charAt(i) !== quote) {
          if (t.charAt(i) === "\\") { i += 2; col += 2; continue; }
          if (t.charAt(i) === "\n") { line++; col = 1; } else col++;
          i++;
        }
        i++; col++;
        continue;
      }
      if (ch === "(" || ch === "{" || ch === "[") {
        stack.push({ ch: ch, line: line, column: col });
      } else if (ch === ")" || ch === "}" || ch === "]") {
        var want = ch === ")" ? "(" : (ch === "}" ? "{" : "[");
        if (stack.length && stack[stack.length - 1].ch === want) stack.pop();
        else if (stack.length) return { ch: stack[stack.length - 1].ch, line: stack[stack.length - 1].line, column: stack[stack.length - 1].column, kind: "open" };
        else return { ch: ch, line: line, column: col, kind: "close" };
      }
      i++; col++;
    }
    if (!stack.length) return null;
    return { ch: stack[stack.length - 1].ch, line: stack[stack.length - 1].line, column: stack[stack.length - 1].column, kind: "open" };
  }

  function pairOf(ch) {
    if (ch === "(") return ")";
    if (ch === "{") return "}";
    if (ch === "[") return "]";
    if (ch === ")") return "(";
    if (ch === "}") return "{";
    return "[";
  }

  function translate(rawMessage, source) {
    var text = String(rawMessage == null ? "" : rawMessage);
    var m = /^(\d+):(\d+)\s+/.exec(text);
    var line = m ? parseInt(m[1], 10) : null;
    var column = m ? parseInt(m[2], 10) : null;
    var body = m ? text.slice(m[0].length) : text;

    if (/Parsing Failure/i.test(text)) {
      var pm = /line (\d+) \(column (\d+)\)/.exec(text);
      var pl = pm ? parseInt(pm[1], 10) : null;
      var pc = pm ? parseInt(pm[2], 10) : null;
      var expected = /Expected ([^\n]*) but ("[^"]*") found/.exec(text);
      var srcLines = String(source == null ? "" : source).split(/\r?\n/);

      /* ① 最常见的一类：上一行结尾少了分号。编译器会把报错位置放到下一行，这里替学生找回去，
            直接指到「真正缺分号的那一行 + 行尾那一列」。 */
      if (pl != null && pl >= 2) {
        var prev = String(srcLines[pl - 2] == null ? "" : srcLines[pl - 2]);
        var prevTrim = prev.replace(/[ \t]+$/, "");
        var prevLast = prevTrim.slice(-1);
        var tails = ";{},:()\\=+-*/&|<>%!?\"'";
        var prevCode = prevTrim.replace(/\s/g, "");
        var looksLikeStatement = prevTrim.length > 0 && prevCode.indexOf("//") !== 0 && prevLast !== "" && tails.indexOf(prevLast) < 0;
        if (looksLikeStatement) {
          return {
            kind: "parse", line: pl - 1, column: prevTrim.length + 1,
            title: "这一行结尾少了分号 ;",
            detail: "编译器在第 " + (pl - 1) + " 行末尾没看到分号，就把这一行和下一行连起来读了——所以它把报错位置指到了第 " + pl + " 行。",
            hint: "在第 " + (pl - 1) + " 行末尾补一个英文分号 ; 就行（也就是「" + prevTrim.slice(-14) + "」的后面）。"
          };
        }
      }

      /* ② 括号没配对：直接指到那个没关上的括号（或者那个多出来的括号） */
      var br = findUnclosedBracket(source);
      if (br) {
        if (br.kind === "close") {
          return {
            kind: "parse", line: br.line, column: br.column,
            title: "这个 " + br.ch + " 前面没有对应的 " + pairOf(br.ch),
            detail: "括号必须成对出现：这个 " + br.ch + " 之前没有找到配对的 " + pairOf(br.ch) + "，编译器读到这里就断了。",
            hint: "把这一行的 " + br.ch + " 删掉，或者在前面把 " + pairOf(br.ch) + " 补上。"
          };
        }
        return {
          kind: "parse", line: br.line, column: br.column,
          title: "这个 " + br.ch + " 没有配对的 " + pairOf(br.ch),
          detail: "括号必须成对出现：这里打开的 " + br.ch + " 一直到文件结束都没有关掉。",
          hint: "在这个 " + br.ch + " 对应的位置补一个 " + pairOf(br.ch) + "；也可以往下找找，是不是漏写或写错了 " + pairOf(br.ch) + "。"
        };
      }

      /* ③ 其他情况：至少说清「读到第几行第几列、卡在哪个字符上」 */
      var found = expected && expected[2] ? String(expected[2]).replace(/^"|"$/g, "") : "";
      var where = pl == null ? "" : "第 " + pl + " 行" + (pc ? "第 " + pc + " 列" : "");
      var detail2 = pl == null ? "编译器读不下去了。" : "编译器读到 " + where + " 就读不下去了。";
      detail2 += found ? "这里出现了不该出现的「" + found + "」。" : "这一行写得还不完整，或者符号写错了。";
      return {
        kind: "parse", line: pl, column: pc, title: "这里写不通：" + (found ? "多了或少了「" + found + "」" : "语句没写完整"),
        detail: detail2,
        hint: "对照 " + (where || "这一行") + "，检查括号、引号是否成对，语句是否写完（分号别忘）。"
      };
    }

    var table = [
      [/Time limit exceeded/i, {
        kind: "timeout", title: "运行超时（很可能死循环）",
        detail: "程序运行时间超过了限制还没有结束。最常见的原因是循环条件永远成立，或者读入语句一直等不到数据。",
        hint: "检查 while / for 的循环条件是否可能永远为真；多组输入要写 while (scanf(...) != EOF)。"
      }],
      [/^variable (\w+) does not exist/, function (x) {
        return {
          kind: "name", line: line, column: column, title: "变量 " + x[1] + " 没有声明",
          detail: "C 语言要求「先声明再使用」。这里用到的 " + x[1] + " 在之前没有声明过。",
          hint: "在使用之前加上声明（例如 int " + x[1] + ";），并检查是否有大小写拼写不一致。"
        };
      }],
      [/^overflow of (\S+)\((\w+)\)/, function (x) {
        return {
          kind: "overflow", line: line, column: column, title: "整数溢出",
          detail: "计算结果 " + x[1] + " 超过了 " + x[2] + " 能表示的范围（int 最大约 21 亿）。",
          hint: "把参与运算的变量改成 long long，并把 printf 的占位符改成 %lld（无符号用 %llu）。"
        };
      }],
      [/^overflow when casting (\S+)\((\w+)\) to (\w+)/, function (x) {
        return {
          kind: "overflow", line: line, column: column, title: "数值超出 " + x[3] + " 的范围",
          detail: "把 " + x[2] + " 类型的值 " + x[1] + " 赋给 " + x[3] + " 类型时放不下。",
          hint: "换用能装下这个数的类型（long long 或 double），或检查是不是哪个变量类型选小了。"
        };
      }],
      [/cannot cast (\S+) to (\S+)/, function (x) {
        return {
          kind: "type", line: line, column: column, title: "类型不匹配",
          detail: "不能把 " + x[1] + " 直接当作 " + x[2] + " 使用。",
          hint: "检查赋值号两边的类型，或者补上强制类型转换 (类型)变量。"
        };
      }],
      [/Memory overflow/i, {
        kind: "memory", line: line, column: column, title: "内存访问出错",
        detail: "写入内存时出了问题。最常见的原因是 scanf 的变量前漏写了 &，或者数组下标越界。",
        hint: "检查这一行的 scanf 是否漏了 &，以及数组下标是否超出了声明的长度。"
      }],
      [/^index out of bound (\d+) >= (\d+)/, function (x) {
        return {
          kind: "index", line: line, column: column, title: "数组越界",
          detail: "访问了下标 " + x[1] + "，但数组长度只有 " + x[2] + "，合法下标是 0 ~ " + (parseInt(x[2], 10) - 1) + "。",
          hint: "把下标限制在 0 ~ " + (parseInt(x[2], 10) - 1) + " 之间，或者把数组声明得更大。"
        };
      }],
      [/^negative index/, {
        kind: "index", line: line, column: column, title: "数组下标变成负数",
        detail: "用负数作为数组下标会访问到数组之外的内存。",
        hint: "检查下标的计算过程（例如 i-1 在 i=0 时会得到 -1）。"
      }],
      [/divided by zero/i, {
        kind: "runtime", line: line, column: column, title: "除以零",
        detail: "除数是 0，程序无法继续。",
        hint: "在除法前判断除数是否为 0，或者检查循环/输入是否让除数变成了 0。"
      }],
      [/uninitialized value/i, {
        kind: "runtime", line: line, column: column, title: "用到了没有赋值的变量",
        detail: "变量还没有被赋值就被拿去使用，它的值是随机的。",
        hint: "确认每个变量在使用前都赋过值或被 scanf 读入过。"
      }],
      [/is not a left value/i, {
        kind: "runtime", line: line, column: column, title: "赋值号左边不是变量",
        detail: "赋值号 = 左边必须是可以存放数据的东西（变量、数组元素等）。",
        hint: "检查这一行的赋值语句，例如是不是把 = 写成了 ==，或者等号左边写了常量/表达式。"
      }],
      [/scanf 的参数必须是变量地址/, {
        kind: "runtime", line: line, column: column, title: "scanf 的参数要写变量地址",
        detail: "scanf 必须传变量地址才能把读到的值写回变量，直接写变量名会让程序崩溃。",
        hint: "在变量名前加上 &，例如 scanf(\"%d\", &n)。"
      }],
      [/输入的内容太长/, {
        kind: "runtime", line: line, column: column, title: "读入的内容比数组长",
        detail: body,
        hint: "把字符数组声明得更大，或者给 %s 限定宽度（例如 %19s）。"
      }],
      [/scanf: 暂不支持的格式/, {
        kind: "runtime", line: line, column: column, title: "读入格式暂不支持",
        detail: body,
        hint: "基础题常用的是 %d %f %lf %c %s，换成这些写法即可。"
      }],
      [/is not defined|unknown function '?(\w+)/, function (x) {
        return {
          kind: "name", line: line, column: column, title: "用到了不存在的函数或变量",
          detail: "运行器不认识这个名字：" + (x[1] || body) + "。",
          hint: "检查拼写；如果用了 strlen / sqrt 等函数，确认已经 #include 对应的头文件。"
        };
      }]
    ];

    for (var i = 0; i < table.length; i++) {
      var pattern = table[i][0];
      var mm = pattern.exec(body) || pattern.exec(text);
      if (mm) {
        var value = table[i][1];
        return typeof value === "function" ? value(mm) : value;
      }
    }

    return {
      kind: "runtime", line: line, column: column, title: "程序运行出错",
      detail: body || text,
      hint: "根据报错的位置检查这一行的写法。如果看不懂，可以先看左侧静态检查给出的提示。"
    };
  }

  function run(code, stdin, options) {
    var opts = options || {};
    var engine = global.JSCPP;
    if (!engine) {
      return { ok: false, phase: "engine", error: { title: "运行器未加载", detail: "页面上的 C 解释器没有加载成功。", hint: "请刷新页面重试。" }, stdout: "", stderr: "" };
    }
    var out = "";
    var truncated = false;
    var result = { ok: false, phase: "run", stdout: "", stderr: "", exitCode: null, error: null, truncated: false };

    try {
      var exitCode = engine.run(String(code == null ? "" : code), String(stdin == null ? "" : stdin), {
        maxTimeout: opts.timeoutMs || 4000,
        unsigned_overflow: "error",
        stdio: {
          write: function (s) {
            if (out.length > MAX_OUTPUT) {
              truncated = true;
              throw new Error("output too large");
            }
            out += s;
          }
        }
      });
      result.ok = true;
      result.phase = "ok";
      result.exitCode = exitCode;
    } catch (err) {
      var message = err && err.message ? err.message : String(err);
      if (message === "output too large") {
        result.error = {
          kind: "output", title: "输出内容太多",
          detail: "程序打印的内容超过了 20 万个字符，通常是循环里不停输出导致的。",
          hint: "检查输出语句是否在循环里，循环次数是否过大。"
        };
      } else {
        result.error = translate(message, code);
        result.phase = result.error.kind === "parse" ? "parse" : (result.error.kind === "timeout" ? "timeout" : "runtime");
      }
    }
    result.stdout = out;
    result.truncated = truncated;
    return result;
  }

  function compareOutput(actual, expected, options) {
    var opts = options || {};
    var a = String(actual == null ? "" : actual);
    var e = String(expected == null ? "" : expected);
    var an = normalizeOut(a, opts);
    var en = normalizeOut(e, opts);
    if (an === en) {
      return { match: true, whitespaceOnly: a !== e, rows: [], firstDiff: -1 };
    }
    var al = splitLines(an), el = splitLines(en);
    var max = Math.max(al.length, el.length);
    var rows = [], firstDiff = -1;
    for (var i = 0; i < max; i++) {
      var av = al[i], ev = el[i];
      var kind = av === ev ? "same" : (ev === undefined ? "extra" : (av === undefined ? "missing" : "diff"));
      if (kind !== "same" && firstDiff < 0) firstDiff = i;
      rows.push({ index: i + 1, expected: ev, actual: av, kind: kind });
    }
    return { match: false, whitespaceOnly: false, rows: rows, firstDiff: firstDiff };
  }

  /* 把解释器给出的错误（translate 的结果）变成检查结果里的条目 */
  function engineFinding(e, code) {
    var lines = String(code == null ? "" : code).split("\n");
    var line = parseInt(e && e.line, 10) || 0;
    return {
      severity: "error",
      line: line || 1,
      column: (e && e.column) || null,
      title: (e && e.title) || "检查出问题",
      detail: (e && e.detail) || "",
      fix: (e && e.hint) || "",
      snippet: line > 0 ? String(lines[line - 1] || "").replace(/\t/g, "    ") : "",
      fromEngine: true
    };
  }

  /* 只做「预处理 + 语法解析」，不执行 main：像编译器那样先把语法错误报出来。
     代码不完整（少分号、括号没配对、语句写在函数外面）也会照实报，
     不会因为「没写完整」就一律说没问题。 */
  function checkSyntax(code) {
    var engine = global.JSCPP;
    if (!engine || typeof engine.parse !== "function") return null; /* 没有解析接口就跳过这一层 */
    var text = String(code == null ? "" : code);
    if (!text.trim()) return [];
    var res;
    try {
      res = engine.parse(text);
    } catch (err) {
      res = { ok: false, message: (err && err.message) || String(err) };
    }
    if (res && res.ok) return [];
    /* 预处理阶段就失败：多半是头文件名拼错（例如 studio.h） */
    var raw = String((res && res.message) || "");
    var lib = /cannot find library:\s*(\S+)/i.exec(raw);
    if (lib) {
      var lm = /^(\d+):(\d+)\s+/.exec(raw);
      var lno = lm ? parseInt(lm[1], 10) : 1;
      var srcLines = text.split("\n");
      return [{
        severity: "error", line: lno, column: lm ? parseInt(lm[2], 10) : null,
        title: "找不到头文件：" + lib[1],
        detail: "第 " + lno + " 行的 #include 里写的是 " + lib[1] + "，但内置解释器里没有这个头文件——十有八九是名字拼错了。PTA 基础题常用的只有 stdio.h、stdlib.h、string.h、math.h 这几个。",
        fix: "检查这一行的头文件名：把 studio.h 改成 stdio.h，或者补齐 .h。",
        snippet: String(srcLines[lno - 1] || "").replace(/\t/g, "    "),
        fromEngine: true
      }];
    }
    var e = translate("ERROR: Parsing Failure:\n" + ((res && res.message) || ""), text);
    return [engineFinding(e, text)];
  }

  /* 试运行一次（给了样例数据就用样例数据）：变量没声明、漏 &、数组越界、缺少 main 这些真错误都能抓到。
     两类不报：
       - 「变量还没赋值」：多半只是因为这次没给输入，报出来是误报（静态规则里有专门的「声明了却从未赋值」）；
       - 跑不完（超时）：可能是死循环，也可能只是在等输入，降级成提醒。 */
  function checkByRun(code, stdin) {
    var text = String(code == null ? "" : code);
    if (!text.trim()) return [];
    var input = stdin == null ? "" : String(stdin);
    var res = run(text, input, { timeoutMs: 1500 });
    if (res.ok) return [];
    var e = res.error || {};
    if (/method main is not defined|main is not defined/i.test(String(e.detail) + " " + String(e.title))) {
      return [{
        severity: "error", line: 1, column: null,
        title: "缺少 main 函数（程序没有入口）",
        detail: "解释器从头到尾没找到 main 函数，所以没办法开始运行。PTA 上的题一般要把代码放在 int main() { ... } 里面。",
        fix: "补上 int main() { ... }，把要执行的语句放进去，最后写 return 0;",
        snippet: (text.split("\n")[0] || "").replace(/\t/g, "    "),
        fromEngine: true
      }];
    }
    if (e.kind === "timeout") {
      return [{
        severity: "warning", line: 1, column: null,
        title: "程序跑不完（超过 1.5 秒）",
        detail: (e.detail || "") + " 如果只是想等输入，可以忽略这一条；如果确实写了死循环，就要改。",
        fix: e.hint || "",
        snippet: "",
        fromEngine: true
      }];
    }
    /* 读入类程序有个通病：没给输入（或给少了）时读到的是 EOF，变量就是随机值，
       后面报出来的「变量没赋值 / 整数溢出」都是没输入造成的，属于误报，这里一律不报。
       漏 &、数组越界、除以零这些是真错误，照报。 */
    var readsInput = /\b(scanf|getchar|gets|fgets|getline)\s*\(/.test(text) || /\bcin\s*>>/.test(text);
    if (input.trim() === "" && readsInput) return [];
    if (readsInput && /没有赋值|整数溢出|超出|overflow/i.test(String(e.detail) + " " + String(e.title))) return [];
    if (/没有赋值/.test(String(e.detail))) return [];
    return [engineFinding(e, text)];
  }

  global.PTARunner = {
    run: run,
    translate: translate,
    compareOutput: compareOutput,
    normalizeOut: normalizeOut,
    checkSyntax: checkSyntax,
    checkByRun: checkByRun
  };
})(typeof window !== "undefined" ? window : globalThis);
