/*!
 * C 语言基础题代码诊断引擎（纯前端、无依赖）
 * 设计原则：
 *   1. 只报告有把握的问题，宁缺毋滥 —— 拿不准的一律不报，避免误导学生。
 *   2. 每条结论都给出「为什么」和「怎么改」。
 *   3. 真正的语法错误交给解析器判定，本引擎负责解析器看不出来的常见错误。
 */
(function (global) {
  "use strict";

  var FULLWIDTH = {
    "；": ";", "，": ",", "（": "(", "）": ")", "｛": "{", "｝": "}",
    "“": "\"", "”": "\"", "‘": "'", "’": "'", "：": ":", "。": ".",
    "！": "!", "？": "?", "、": ",", "＝": "=", "＜": "<", "＞": ">",
    "＋": "+", "－": "-", "＊": "*", "／": "/", "％": "%", "＆": "&",
    "｜": "|", "＃": "#", "［": "[", "］": "]", "　": " "
  };

  var TYPE_WORDS = ["char", "int", "float", "double", "short", "long", "void", "size_t",
    "unsigned", "signed", "const", "static", "volatile", "register", "struct", "union", "enum", "auto"];

  var INT_WORDS = ["char", "int", "short", "long", "unsigned", "size_t", "signed"];

  function lineStartsOf(src) {
    var starts = [0];
    for (var i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
    return starts;
  }

  function posOf(starts, index) {
    var lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid; else hi = mid - 1;
    }
    return { line: lo + 1, column: index - starts[lo] + 1 };
  }

  /* 把注释与字符串内容替换成空格，长度和换行保持不变，便于用正则精确定位。 */
  function maskCode(src) {
    var out = "";
    var i = 0, n = src.length;
    var inLine = false, inBlock = false, inStr = false, inChr = false;
    while (i < n) {
      var c = src[i], d = src[i + 1];
      if (inLine) { if (c === "\n") { inLine = false; out += "\n"; } else out += " "; i++; continue; }
      if (inBlock) {
        if (c === "*" && d === "/") { out += "  "; i += 2; inBlock = false; continue; }
        out += (c === "\n" ? "\n" : " "); i++; continue;
      }
      if (inStr || inChr) {
        if (c === "\\") { out += "  "; i += 2; continue; }
        if (inStr && c === "\"") { inStr = false; out += "\""; i++; continue; }
        if (inChr && c === "'") { inChr = false; out += "'"; i++; continue; }
        out += (c === "\n" ? "\n" : " "); i++; continue;
      }
      if (c === "/" && d === "/") { inLine = true; out += "  "; i += 2; continue; }
      if (c === "/" && d === "*") { inBlock = true; out += "  "; i += 2; continue; }
      if (c === "\"") { inStr = true; out += "\""; i++; continue; }
      if (c === "'") { inChr = true; out += "'"; i++; continue; }
      out += c; i++;
    }
    return out;
  }

  function unescapeC(text) {
    var map = { n: "\n", t: "\t", r: "\r", "0": "\0", "\\": "\\", "\"": "\"", "'": "'", b: "\b", f: "\f", v: "\v", a: "\x07" };
    var out = "";
    for (var i = 0; i < text.length; i++) {
      if (text[i] === "\\" && i + 1 < text.length) {
        var nx = text[i + 1];
        if (Object.prototype.hasOwnProperty.call(map, nx)) { out += map[nx]; i++; continue; }
        if (nx >= "1" && nx <= "7") {
          var oct = "", j = i + 1;
          while (j < text.length && oct.length < 3 && text[j] >= "0" && text[j] <= "7") { oct += text[j]; j++; }
          out += String.fromCharCode(parseInt(oct, 8)); i = j - 1; continue;
        }
        out += nx; i++; continue;
      }
      out += text[i];
    }
    return out;
  }

  function stringLiteralAt(src, offset) {
    if (src[offset] !== "\"") return null;
    var i = offset + 1, raw = "";
    while (i < src.length) {
      if (src[i] === "\\") { raw += src[i] + (src[i + 1] || ""); i += 2; continue; }
      if (src[i] === "\"") return { raw: raw, value: unescapeC(raw), start: offset, end: i + 1 };
      if (src[i] === "\n") return null;
      raw += src[i]; i++;
    }
    return null;
  }

  function splitTopLevel(text, sep) {
    var parts = [], depth = 0, from = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      else if (c === sep && depth === 0) { parts.push({ text: text.slice(from, i), start: from, end: i }); from = i + 1; }
    }
    parts.push({ text: text.slice(from), start: from, end: text.length });
    return parts;
  }

  /* 收集变量 / 函数声明，用于类型相关判断（支持 int a, b, c; 这种逗号声明）。 */
  function collectSymbols(masked) {
    var symbols = {};

    function register(typeName, stars, name, dims, nameIndex, dimsIndex) {
      if (!name || TYPE_WORDS.indexOf(name) >= 0) return;
      var base = typeName.replace(/\b(const|static|volatile|register|auto)\b/g, "").replace(/\s+/g, " ").trim();
      var isFloat = /(^|\s)(float|double)(\s|$)/.test(base);
      var isLongLong = /long\s+long/.test(base);
      if (isLongLong) base = "long long";
      var kind = dims.length > 0 ? "array" : (stars.length > 0 ? "pointer" : "scalar");
      var after = masked.slice(nameIndex + name.length, nameIndex + name.length + 60);
      var isFunc = /^\s*\([^;{)]*\)\s*(\{|;)/.test(after);
      var elemType = base.replace(/\*+$/, "").trim();
      symbols[name] = {
        name: name, typeName: base, base: base, isFloat: isFloat, isLongLong: isLongLong,
        kind: kind, dims: dims, dimsIndex: dims.length > 0 ? dimsIndex : -1,
        isFunc: isFunc, elemType: elemType
      };
    }

    var typeRe = /\b((?:(?:unsigned|signed|long|short|const|static|volatile|register)\s+)*(?:char|int|float|double|short|long|void|size_t))\b/g;
    var m;
    while ((m = typeRe.exec(masked)) !== null) {
      var typeName = m[1].replace(/\s+/g, " ").trim();
      var regionStart = m.index + m[0].length;
      var i = regionStart, depth = 0, end = Math.min(masked.length, regionStart + 400);
      for (; i < masked.length; i++) {
        var c = masked[i];
        if (c === "(" || c === "[") depth++;
        else if (c === ")" || c === "]") { if (depth === 0) { end = i; break; } depth--; }
        else if (c === "{") { if (depth === 0) { end = i; break; } depth++; }
        else if (c === "}") { if (depth === 0) { end = i; break; } depth--; }
        else if (c === ";" && depth === 0) { end = i; break; }
      }
      var region = masked.slice(regionStart, end);
      splitTopLevel(region, ",").forEach(function (chunk) {
        var dm = /^(\s*)(\**)\s*([A-Za-z_]\w*)\s*((?:\[[^\]]*\])*)/.exec(chunk.text);
        if (!dm) return;
        var nameIndex = regionStart + chunk.start + dm[1].length + dm[2].length;
        var dimsIndex = dm[4].length > 0 ? regionStart + chunk.start + dm[0].length - dm[4].length : -1;
        register(typeName, dm[2], dm[3], dm[4], nameIndex, dimsIndex);
      });
    }
    return symbols;
  }

  /* 在屏蔽串上按括号深度切分实参。 */
  function splitArgs(src, masked, start, end) {
    var args = [], depth = 0, from = -1, i = start;
    for (; i < end; i++) {
      var c = masked[i];
      if (c === "(" || c === "[" || c === "{") { depth++; if (from < 0) from = i; continue; }
      if (c === ")" || c === "]" || c === "}") { depth--; continue; }
      if (c === "," && depth === 0) {
        args.push({ start: from < 0 ? i : from, end: i, text: src.slice(from < 0 ? i : from, i).trim() });
        from = -1; continue;
      }
      if (from < 0 && !/\s/.test(c)) from = i;
    }
    var tailStart = from < 0 ? end : from;
    var tail = src.slice(tailStart, end).trim();
    if (tail.length > 0 || args.length > 0) args.push({ start: tailStart, end: end, text: tail });
    return args;
  }

  function findCalls(masked) {
    var re = /\b(printf|scanf|sscanf|sprintf|fprintf|fscanf|gets|puts|putchar|getchar)\s*\(/g;
    var calls = [], m;
    while ((m = re.exec(masked)) !== null) {
      var open = masked.indexOf("(", m.index);
      var depth = 0, i = open;
      for (; i < masked.length; i++) {
        if (masked[i] === "(") depth++;
        else if (masked[i] === ")") { depth--; if (depth === 0) break; }
      }
      calls.push({ name: m[1], nameIndex: m.index, open: open, close: i });
      re.lastIndex = open + 1;
    }
    return calls;
  }

  function baseIdent(expr) {
    var m = /^\s*([A-Za-z_]\w*)\s*(\[[^\]]*\])?\s*$/.exec(expr);
    if (!m) return null;
    return { name: m[1], indexed: !!m[2] };
  }

  /* 允许 &x、&a[i]、&s.member、(int*)&x 这类写法。 */
  function baseIdentLoose(expr) {
    var text = String(expr).trim();
    for (;;) {
      var before = text;
      text = text.replace(/^\([A-Za-z_][\w \t*]*\)\s*/, "");
      text = text.replace(/^&\s*/, "");
      if (text === before) break;
    }
    return baseIdent(text);
  }

  function isFloatLike(t) { return !!t && /(^|\s)(float|double)(\s|$)/.test(t); }
  function isIntLike(t) { return !!t && INT_WORDS.some(function (w) { return t.indexOf(w) >= 0; }); }
  function isIntLiteral(e) { return /^\s*[-+]?\d+\s*$/.test(e); }

  function parseScanConversions(format) {
    var list = [];
    var re = /%(?:\*)?(\d+)?(hh|h|ll|l|L|z|j|t)?([diuoxXfFeEgGaAcspn\[])/g;
    var m;
    while ((m = re.exec(format)) !== null) {
      var conv = m[3];
      if (conv === "[") {
        var k = m.index + m[0].length;
        if (format[k] === "^") k++;
        if (format[k] === "]") k++;
        while (k < format.length && format[k] !== "]") k++;
        re.lastIndex = k + 1;
      }
      list.push({ spec: m[0], conv: conv, length: m[2] || "", width: m[1] || "" });
    }
    return list;
  }

  function parsePrintConversions(format) {
    var list = [];
    var re = /%(?:[-+ #0])?(?:\d+|\*)?(?:\.(?:\d+|\*))?(hh|h|ll|l|L|z|j|t)?([diuoxXfFeEgGaAcspn])/g;
    var m;
    while ((m = re.exec(format)) !== null) list.push({ spec: m[0], conv: m[2], length: m[1] || "" });
    return list;
  }

  function analyze(source) {
    var src = String(source == null ? "" : source);
    var masked = maskCode(src);
    var starts = lineStartsOf(src);
    var lines = src.split(/\r?\n/);
    var symbols = collectSymbols(masked);
    var findings = [];

    function add(sev, index, title, detail, fix) {
      var p = posOf(starts, index);
      findings.push({
        severity: sev, line: p.line, column: p.column, title: title,
        detail: detail, fix: fix || "", snippet: (lines[p.line - 1] || "").replace(/\t/g, "    ")
      });
    }

    /* ---------- 1. 中文全角标点 ---------- */
    for (var i = 0; i < src.length; i++) {
      var ch = src[i];
      if (ch === "\n" || ch === "\r" || ch === "\t") continue;
      if (masked[i] !== ch && ch !== " ") continue;
      if (FULLWIDTH[ch]) {
        add("error", i, "这里用了中文标点「" + ch + "」",
          "C 语言只认识英文半角标点。多半是从 Word、PPT 或网页复制代码时被自动替换了。",
          "改成英文的 " + FULLWIDTH[ch] + "（切到英文输入法重新输入即可）。");
      }
    }

    /* ---------- 2. 数组越界（常量下标） ---------- */
    Object.keys(symbols).forEach(function (name) {
      var sym = symbols[name];
      if (sym.kind !== "array" || !sym.dims) return;
      var sizeMatch = /^\[(\d+)\]/.exec(sym.dims);
      if (!sizeMatch) return;
      var size = parseInt(sizeMatch[1], 10);
      var re = new RegExp("\\b" + name + "\\s*\\[\\s*(\\d+)\\s*\\]", "g");
      var m;
      while ((m = re.exec(masked)) !== null) {
        if (sym.dimsIndex >= 0 && m.index >= sym.dimsIndex - name.length - 2 && m.index <= sym.dimsIndex + sym.dims.length) continue;
        var idx = parseInt(m[1], 10);
        if (idx >= size) {
          add("error", m.index, "数组 " + name + " 越界访问",
            name + " 声明为 " + sym.dims + "，合法下标是 0 ~ " + (size - 1) + "，但这里用了 " + idx + "。",
            "下标改成 0 ~ " + (size - 1) + " 之间；如果确实要 " + (idx + 1) + " 个元素，把声明改成 " + name + "[" + (idx + 1) + "]。");
        }
      }
    });

    /* ---------- 3. if / for / while 后面多写了分号 ---------- */
    var straySemi = /\b(if|for|while)\s*\(/g, sm;
    while ((sm = straySemi.exec(masked)) !== null) {
      var open = masked.indexOf("(", sm.index);
      var d2 = 0, k2 = open;
      for (; k2 < masked.length; k2++) {
        if (masked[k2] === "(") d2++;
        else if (masked[k2] === ")") { d2--; if (d2 === 0) break; }
      }
      var j2 = k2 + 1;
      while (j2 < masked.length && /\s/.test(masked[j2])) j2++;
      if (masked[j2] === ";") {
        var after2 = j2 + 1;
        while (after2 < masked.length && /\s/.test(masked[after2])) after2++;
        if (masked[after2] === "{" || /[A-Za-z_]/.test(masked[after2] || "")) {
          add("warning", sm.index, "「" + sm[1] + "」后面多了一个分号",
            "这个分号让 " + sm[1] + " 的语句体提前结束了，紧跟其后的代码会**无条件执行**，通常不是你想要的效果。",
            "删掉这个分号，或把后面的语句用 { } 括起来。");
        }
      }
    }

    /* ---------- 4. 条件里把 == 写成 = ---------- */
    var condAssign = /\b(if|while)\s*\(([^()]*)\)/g, ca;
    while ((ca = condAssign.exec(masked)) !== null) {
      var condText = ca[2];
      if (/==|!=|<=|>=/.test(condText)) continue;
      var assign = /(^|[^=!<>])=([^=]|$)/.exec(condText);
      if (!assign) continue;
      var pos = ca.index + ca[0].indexOf(condText) + assign.index + assign[0].indexOf("=");
      add("warning", pos, "条件里写成了赋值号「=」",
        "C 语言里 = 是赋值，== 才是比较。这样写会把右边的值赋给左边，而且只要结果不是 0 条件就永远成立。",
        "如果本意是比较，改成 ==；如果确实要赋值，建议加括号并写注释说明。");
    }

    /* ---------- 5. printf / scanf 相关 ---------- */
    findCalls(masked).forEach(function (call) {
      var args = splitArgs(src, masked, call.open + 1, call.close);
      if (args.length === 0) return;
      var firstLiteral = stringLiteralAt(src, args[0].start);
      var fmt = firstLiteral ? firstLiteral.value : null;

      if ((call.name === "printf" || call.name === "sprintf") && fmt) {
        var prints = parsePrintConversions(fmt);
        var valueArgs = call.name === "sprintf" ? args.slice(2) : args.slice(1);
        if (prints.length !== valueArgs.length) {
          add("error", call.nameIndex, call.name + " 的占位符和参数个数对不上",
            "格式串里有 " + prints.length + " 个 % 占位符，后面却给了 " + valueArgs.length + " 个参数，输出的内容会整体错位。",
            "数一数格式串里 % 的个数，让它和后面参数的个数一致。");
        }
        prints.forEach(function (p, idx) { if (valueArgs[idx]) checkPrintfArg(p, valueArgs[idx]); });
        checkSlashEscape(firstLiteral);
      }

      if (call.name === "scanf" && fmt) {
        var scans = parseScanConversions(fmt);
        var targets = args.slice(1);
        if (scans.length !== targets.length) {
          add("error", call.nameIndex, "scanf 的占位符和参数个数对不上",
            "格式串里有 " + scans.length + " 个 % 占位符，后面却给了 " + targets.length + " 个参数。",
            "让两者个数一致，并注意每个普通变量前都要写 &。");
        }
        scans.forEach(function (s, idx) { if (targets[idx]) checkScanTarget(s, targets[idx]); });
        checkStringWidth(targets, fmt);
      }

      if (call.name === "gets") {
        add("warning", call.nameIndex, "gets 函数不安全",
          "gets 不检查缓冲区长度，输入稍长就会写越界，很多教材已经不再推荐。",
          "改用 fgets(s, sizeof(s), stdin) 或 scanf(\"%19s\", s)（数字比数组长度小 1）。");
      }

      if (call.name === "sscanf" && fmt) {
        var scans2 = parseScanConversions(fmt);
        scans2.forEach(function (s, idx) {
          var t = args.slice(2)[idx];
          if (t) checkScanTarget(s, t);
        });
      }

      function checkStringWidth(targets, format) {
        if (format.indexOf("%s") < 0 || /%\d+s/.test(format)) return;
        var idn = targets[0] ? baseIdentLoose(targets[0].text) : null;
        var symn = idn ? symbols[idn.name] : null;
        if (!symn || symn.kind !== "array") return;
        var szn = /^\[(\d+)\]/.exec(symn.dims);
        if (!szn || parseInt(szn[1], 10) >= 64) return;
        add("info", call.nameIndex, "scanf 读字符串没有限制长度",
          "目标数组只有 " + szn[1] + " 个字符，如果输入的字符串更长就会写越界。",
          "给 %s 加上最大宽度，例如 char s[" + szn[1] + "] 用 scanf(\"%" + (parseInt(szn[1], 10) - 1) + "s\", s)。");
      }

      function checkSlashEscape(literal) {
        if (!/(^|[^\\])\/[ntr0]/.test(literal.raw)) return;
        add("warning", literal.start, "转义字符写成了斜杠 /",
          "换行是 \\n（反斜杠 + n），不是 /n（斜杠 + n）。这样写只会原样输出 /n。",
          "把 /n 改成 \\n，/t 改成 \\t。");
      }

      function checkPrintfArg(p, arg) {
        var ident = baseIdent(arg.text);
        var sym = ident ? symbols[ident.name] : null;
        var convIsFloat = "fFeEgGaA".indexOf(p.conv) >= 0;
        var convIsInt = "diuoxX".indexOf(p.conv) >= 0;

        if (sym) {
          var t = ident.indexed && sym.kind === "array" ? sym.elemType : sym.base;
          if (convIsInt && isFloatLike(t)) {
            add("error", arg.start, "用 %" + p.conv + " 输出浮点变量 " + ident.name,
              ident.name + " 是 " + sym.typeName + "，而 %" + p.conv + " 只能输出整数，实际会打印出一个毫无意义的数字。",
              "要整数就用 %d 并把变量改成 int；要保留小数就把格式串改成 %f 或 %.2f。");
          }
          if (convIsFloat && isIntLike(t) && !sym.isFloat) {
            add("error", arg.start, "用 %" + p.conv + " 输出整型变量 " + ident.name,
              ident.name + " 是 " + sym.typeName + "，%f 需要 double 参数，直接这样写输出结果不正确。",
              "把变量改成 double（或 float 配 %f），或者改用 %d 输出整数。");
          }
          if (p.length === "ll" && !sym.isLongLong && isIntLike(t)) {
            add("info", arg.start, "%" + p.spec.slice(1) + " 用在普通 int 上",
              ident.name + " 是 " + sym.typeName + "，long long 的占位符建议配合 long long 变量。",
              "把变量声明改成 long long，或把占位符改成 %d。");
          }
          if (p.length !== "ll" && sym.isLongLong && convIsInt) {
            add("info", arg.start, "long long 变量用了 %" + p.conv,
              ident.name + " 是 long long，但 %" + p.conv + " 只按 32 位整数读取，数值大时会输出错误结果。",
              "把占位符改成 %lld（无符号用 %llu）。");
          }
        } else if (convIsFloat) {
          var divArg = /^\s*([A-Za-z_]\w*)\s*\/\s*([A-Za-z_]\w*)\s*$/.exec(arg.text);
          if (divArg && symbols[divArg[1]] && symbols[divArg[2]]
            && !symbols[divArg[1]].isFloat && !symbols[divArg[2]].isFloat) {
            add("warning", arg.start, "两个整数相除，结果会被截断",
              divArg[1] + " 和 " + divArg[2] + " 都是整数，会先做整数除法再转成小数，小数部分已经丢了（7 / 2 得到 3.000000）。",
              "先转成浮点再除：(double)" + divArg[1] + " / " + divArg[2] + "。");
          } else if (isIntLiteral(arg.text)) {
            add("warning", arg.start, "用 %" + p.conv + " 输出整数常量 " + arg.text.trim(),
              "整数常量的类型是 int，用 %f 输出会得到错误结果。",
              "把常量写成小数形式，例如 " + arg.text.trim() + ".0。");
          }
        }
      }

      function checkScanTarget(s, target) {
        var text = target.text;
        var ident = baseIdentLoose(text);
        var sym = ident ? symbols[ident.name] : null;
        var hasAmp = /&/.test(text);
        var convIsFloat = "fFeEgG".indexOf(s.conv) >= 0;
        var convIsInt = "diuoxX".indexOf(s.conv) >= 0;
        var isArrayName = !!(sym && sym.kind === "array" && !ident.indexed);

        if (hasAmp && isArrayName) {
          add("error", target.start, "scanf 读入 " + ident.name + " 时多写了 &",
            ident.name + " 是数组，数组名本身就是地址，再加 & 类型就不对了（&" + ident.name + " 是「整个数组的指针」）。",
            "去掉 &，写成 scanf(\"…\", " + ident.name + ")。");
          return;
        }
        if (s.conv === "s") {
          if (sym && sym.kind === "scalar" && !sym.isFloat && !hasAmp) {
            add("error", target.start, "scanf 用 %s 读入，但 " + ident.name + " 不是数组",
              "%s 需要一个字符数组（例如 char s[32]）来存放整个字符串，单个 char 装不下。",
              "把 " + ident.name + " 改成字符数组，例如 char " + ident.name + "[64];");
          }
          return;
        }
        if (!hasAmp) {
          if (isArrayName) {
            add("error", target.start, "scanf 读入 " + ident.name + " 时少了 &",
              ident.name + " 是数组，把「整个数组首地址」交给 scanf 读一个数语义不明。",
              "读第 i 个元素要写 &" + ident.name + "[i]；如果是读字符串，请用 %s 并且不加 &。");
            return;
          }
          if (sym && sym.kind === "pointer") return;
          add("error", target.start, "scanf 需要的是地址，这里少了 &",
            "scanf 要把读到的值写回变量，必须传变量的地址。直接写变量名等于把变量的值当成地址来用，程序通常立刻崩溃。",
            "写成 &" + (ident ? ident.name : "变量名") + "（数组名和本身就是指针的变量除外）。");
          return;
        }
        if (!ident || !sym) return;
        var t = ident.indexed && sym.kind === "array" ? sym.elemType : sym.base;
        if (convIsInt && isFloatLike(t)) {
          add("error", target.start, "用 %" + s.spec.replace(/^%/, "") + " 读入 " + sym.typeName + " 变量 " + ident.name,
            "%d 只能读整数；读 double 要用 %lf，读 float 要用 %f。用错格式符读进来的值完全不对。",
            "double 用 scanf(\"%lf\", &" + ident.name + ")，float 用 scanf(\"%f\", &" + ident.name + ")。");
        }
        if (convIsFloat && isIntLike(t) && !sym.isFloat) {
          add("error", target.start, "用 %" + s.spec.replace(/^%/, "") + " 读入 " + sym.typeName + " 变量 " + ident.name,
            "这个占位符要求浮点变量，但 " + ident.name + " 是 " + sym.typeName + "。",
            "把变量改成 double（用 %lf 读入），或改用 %d 读整数。");
        }
      }
    });

    /* ---------- 6. 整数除法 ---------- */
    var divRe = /\b([A-Za-z_]\w*)\s*\/\s*([A-Za-z_]\w*)\b/g, dm;
    while ((dm = divRe.exec(masked)) !== null) {
      var a = symbols[dm[1]], b = symbols[dm[2]];
      if (!a || !b || a.isFloat || b.isFloat) continue;
      if (!isIntLike(a.base) || !isIntLike(b.base)) continue;
      var head = masked.slice(Math.max(0, dm.index - 60), dm.index);
      if (/\(\s*(double|float)\s*\)\s*[A-Za-z_]\w*\s*$/.test(head)) continue;
      if (/\(\s*(double|float)\s*\)\s*$/.test(head)) continue;
      var target = /([A-Za-z_]\w*)\s*=\s*$/.exec(head);
      if (!target || !symbols[target[1]] || !symbols[target[1]].isFloat) continue;
      add("warning", dm.index, "两个整数相除，结果会被截断",
        dm[1] + " 和 " + dm[2] + " 都是整数，C 语言里 " + dm[1] + " / " + dm[2] + " 会做整数除法（只保留整数部分），例如 7 / 2 得到 3。",
        "先把其中一个操作数转成浮点：(double)" + dm[1] + " / " + dm[2] + "，或写成 " + dm[1] + " * 1.0 / " + dm[2] + "。");
    }

    /* ---------- 7. while (scanf(...)) 条件恒真 ---------- */
    var whileScan = /while\s*\(\s*scanf\s*\(/g, ws;
    while ((ws = whileScan.exec(masked)) !== null) {
      var scanfPos = masked.indexOf("scanf", ws.index);
      var sop = masked.indexOf("(", scanfPos);
      var sd = 0, k3 = sop;
      for (; k3 < masked.length; k3++) {
        if (masked[k3] === "(") sd++;
        else if (masked[k3] === ")") { sd--; if (sd === 0) break; }
      }
      var k4 = k3 + 1;
      while (k4 < masked.length && /\s/.test(masked[k4])) k4++;
      if (masked[k4] === ")") {
        add("warning", ws.index, "while (scanf(...)) 会变成死循环",
          "scanf 成功时返回成功读入的个数（通常大于 0），条件恒为真，读完数据后不会自动退出。",
          "多组数据一般写成 while (scanf(\"%d\", &n) != EOF) { ... } 或 while (scanf(\"%d\", &n) == 1) { ... }。");
      }
    }

    /* ---------- 8. 头文件 ---------- */
    if (/\b(printf|scanf|gets|puts|putchar|getchar|sprintf|sscanf)\s*\(/.test(masked)
      && !/#\s*include\s*[<"]stdio\.h[>"]/.test(masked)) {
      add("error", 0, "缺少 #include <stdio.h>",
        "用到了 printf / scanf 等输入输出函数，但没有包含对应头文件，编译器会报「未声明的标识符」。",
        "在文件最上面加一行：#include <stdio.h>");
    }
    if (/\b(strlen|strcpy|strcmp|strcat|strstr|strncpy)\s*\(/.test(masked)
      && !/#\s*include\s*[<"]string\.h[>"]/.test(masked)) {
      add("info", 0, "用到字符串函数但没包含 <string.h>",
        "strlen / strcpy / strcmp 等函数的声明在 <string.h> 里。",
        "在文件最上面加一行：#include <string.h>");
    }
    if (/\b(sqrt|pow|fabs|sin|cos|floor|ceil)\s*\(/.test(masked)
      && !/#\s*include\s*[<"]math\.h[>"]/.test(masked)) {
      add("info", 0, "用到数学函数但没包含 <math.h>",
        "sqrt / pow 等函数的声明在 <math.h> 里。",
        "在文件最上面加一行：#include <math.h>");
    }

    /* ---------- 9. main 函数 ---------- */
    var mainMatch = /\b(?:int|void)\s+main\s*\(/.exec(masked);
    if (!mainMatch) {
      add("error", 0, "找不到 main 函数",
        "每个 C 程序都必须有一个 main 函数，程序从它开始执行。",
        "检查函数名是否拼写正确，标准写法是 int main(void) { ... return 0; }。");
    } else if (/void\s+main\s*\(/.test(masked)) {
      add("info", mainMatch.index, "main 建议写成 int 类型",
        "标准写法是 int main(void) 并在结尾 return 0，个别 PTA 题目对返回值敏感。",
        "把 void main() 改成 int main()，并在函数末尾加 return 0;");
    } else if (!/return\s+0\s*;/.test(masked)) {
      add("info", mainMatch.index, "main 函数结尾建议补上 return 0;",
        "main 返回 0 表示程序正常结束，这是标准写法。",
        "在 main 函数最后一个 } 之前加上 return 0;");
    }

    /* ---------- 10. 声明了却从未赋值 ---------- */
    Object.keys(symbols).forEach(function (name) {
      var sym = symbols[name];
      if (sym.kind !== "scalar" || sym.isFunc) return;
      if (name === "i" || name === "j" || name === "k" || name === "n") return;
      var addr = new RegExp("&\\s*(?:[A-Za-z_]\\w*(?:\\.|->)\\s*)?" + name + "\\b");
      var assign = new RegExp("\\b" + name + "\\s*(?:=(?!=)|\\+\\+|--|[-+*/%&|^]=)");
      if (addr.test(masked) || assign.test(masked)) return;
      var usedInIO = new RegExp("\\b(printf|scanf|puts)\\s*\\([^;]*\\b" + name + "\\b");
      if (!usedInIO.test(masked)) return;
      var idx = masked.search(new RegExp("\\b" + name + "\\b"));
      add("warning", idx < 0 ? 0 : idx, "变量 " + name + " 从未被赋值",
        "全文找不到给 " + name + " 赋值的语句，也没有用 scanf 读入。它的值是随机的，输出结果不可预测。",
        "先给它一个初值，例如 int " + name + " = 0;，或者用 scanf 读入。");
    });

    /* ---------- 11. 浮点数用 == 比较 ---------- */
    var floatEq = /\b([A-Za-z_]\w*)\s*==\s*([A-Za-z_]\w*)\b/g, fe;
    while ((fe = floatEq.exec(masked)) !== null) {
      var fa = symbols[fe[1]], fb = symbols[fe[2]];
      if (!fa || !fb) continue;
      if (!(fa.isFloat || fb.isFloat)) continue;
      add("warning", fe.index, "浮点数不要直接用 == 比较",
        "小数在计算机里无法精确存储，两个本以为相等的浮点数常常差一点点，会让条件判断失败。",
        "比较差值：if (fabs(a - b) < 1e-6) 视为相等（需要 #include <math.h>）。");
    }

    /* ---------- 12. % 用在浮点数上 ---------- */
    var modRe = /\b([A-Za-z_]\w*)\s*%\s*([A-Za-z_]\w*)\b/g, mm;
    while ((mm = modRe.exec(masked)) !== null) {
      var ms = symbols[mm[1]];
      if (ms && ms.isFloat) {
        add("error", mm.index, "% 不能用在浮点数上",
          "取余运算 % 只能用于整数，" + mm[1] + " 是浮点类型，编译器会直接报错。",
          "改用 fmod(" + mm[1] + ", " + mm[2] + ")（需要 #include <math.h>），或把变量改成整数。");
      }
    }

    /* ---------- 13. 头文件名拼错 / 用了 PTA 没有的头文件 ---------- */
    var HEADER_FIX = {
      "studio.h": "stdio.h", "stdoi.h": "stdio.h", "stido.h": "stdio.h", "stdi.h": "stdio.h",
      "stdiio.h": "stdio.h", "stduio.h": "stdio.h", "studio": "stdio.h", "stdio": "stdio.h",
      "stdilb.h": "stdlib.h", "stdib.h": "stdlib.h", "stlib.h": "stdlib.h",
      "sting.h": "string.h", "strig.h": "string.h", "string": "string.h",
      "math": "math.h", "mat.h": "math.h"
    };
    var incRe = /#\s*include\s*[<"]([^>"]+)[>"]/g, im;
    while ((im = incRe.exec(masked)) !== null) {
      var header = im[1].trim();
      if (HEADER_FIX[header]) {
        add("error", im.index, "头文件名拼错了：" + header,
          "C 语言里没有 " + header + " 这个头文件，你要用的应该是 " + HEADER_FIX[header] + "。头文件写错，里面的 scanf、printf 全都用不了。",
          "把这一行改成 #include <" + HEADER_FIX[header] + ">。");
      } else if (/^conio\.h$/i.test(header)) {
        add("error", im.index, "PTA 上没有 conio.h",
          "conio.h 是 Windows 上 Turbo C 才有的头文件，PTA 的判题环境里没有它，getch()、clrscr() 这些函数也不存在。",
          "把 getch() 换成 getchar()，把 clrscr() 之类的整行删掉。");
      }
    }

    /* ---------- 14. scanf / printf 写成了尖括号 ---------- */
    var angleRe = /\b(scanf|printf|gets|puts|getchar|putchar)\s*</g, am;
    while ((am = angleRe.exec(masked)) !== null) {
      add("error", am.index, am[1] + " 要用圆括号，不是尖括号",
        "函数调用必须写圆括号，例如 " + am[1] + "(...)。写成尖括号 " + am[1] + "<...> 编译器会直接报错。",
        "把这一行的 " + am[1] + "<...> 改成 " + am[1] + "(...)，并检查参数之间用的是英文逗号。");
    }

    /* ---------- 15. 声明行结尾忘了分号 ---------- */
    var typeAlt = TYPE_WORDS.join("|");
    var declOnly = new RegExp("^\\s*(?:" + typeAlt + ")(?:\\s|\\*)+[A-Za-z_]\\w*(?:\\s*\\[\\s*\\w*\\s*\\])*(?:\\s*,\\s*[A-Za-z_]\\w*(?:\\s*\\[\\s*\\w*\\s*\\])*)*\\s*$");
    var maskedLines = masked.split("\n");
    var starts2 = lineStartsOf(src);
    for (var li = 0; li < lines.length; li++) {
      var ml = maskedLines[li] || "";
      if (!declOnly.test(ml)) continue;
      if (/,\s*$/.test(ml)) continue;              /* 结尾是逗号：多半是跨行的声明，不报 */
      var prev = li > 0 ? (maskedLines[li - 1] || "") : "";
      if (/[(,]\s*$/.test(prev)) continue;          /* 上一行还没写完，不报 */
      add("error", starts2[li], "这一行结尾少了分号",
        "C 语言每条语句结尾都要写英文分号 ; 。这里没写，编译器会把这一行和下一行连着读，然后报一堆看不懂的错。",
        "在这一行末尾补一个分号 ;（要英文的）。");
    }

    findings.sort(function (x, y) { return x.line - y.line || x.column - y.column; });
    return { findings: findings, symbols: symbols };
  }

  global.PTAAnalyzer = { analyze: analyze, maskCode: maskCode };
})(typeof window !== "undefined" ? window : globalThis);
