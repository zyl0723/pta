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
      var detail = "解析器在第 " + (pl == null ? "?" : pl) + " 行读不通了。";
      if (pl != null) {
        var src = lineOf(source, pl).replace(/\t/g, "    ");
        var trimmed = src.replace(/\s+$/, "");
        var last = trimmed.slice(-1);
        if (trimmed.length > 0 && last !== ";" && last !== "{" && last !== "}" && last !== ":" && last !== ")" && last !== ",") {
          detail += "这一行结尾看起来少了分号。";
        } else {
          detail += "常见原因是这一行或上一行少了分号、括号没配对，或者符号写错了。";
        }
        if (expected) detail += " 解析到 " + (expected[2] || "该位置") + " 时卡住了。";
      }
      return {
        kind: "parse", line: pl, column: pc, title: "语法错误：代码读不通",
        detail: detail,
        hint: "重点检查第 " + (pl == null ? "?" : pl) + " 行结尾的分号，以及 ( ) { } 有没有成对出现。"
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

  global.PTARunner = {
    run: run,
    translate: translate,
    compareOutput: compareOutput,
    normalizeOut: normalizeOut
  };
})(typeof window !== "undefined" ? window : globalThis);