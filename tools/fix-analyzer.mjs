import { readFileSync, writeFileSync } from "node:fs";
const file = "assets/js/analyzer.js";
let src = readFileSync(file, "utf8");
const done = [];
function sub(from, to, label) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error("锚点出现 " + n + " 次: " + label);
  src = src.split(from).join(to);
  done.push(label);
}

sub(String.raw`      var kind = dims.length > 0 ? "array" : (stars.length > 0 ? "pointer" : "scalar");`,
    String.raw`      var kind = dims.length > 0 ? "array" : (stars.length > 0 ? "pointer" : "scalar");
      var dimsIndex = dims.length > 0 ? (m.index + m[0].length - dims.length) : -1;`,
    "记录声明位置");

sub(String.raw`        kind: kind, dims: dims, isFunc: !!isFunc,`,
    String.raw`        kind: kind, dims: dims, dimsIndex: dimsIndex, isFunc: !!isFunc,`,
    "符号表记录声明位置");

sub(String.raw`      while ((m = re.exec(masked)) !== null) {
        var idx = parseInt(m[1], 10);
        if (idx >= size) {`,
    String.raw`      while ((m = re.exec(masked)) !== null) {
        if (sym.dimsIndex >= 0 && m.index >= sym.dimsIndex - name.length - 2 && m.index <= sym.dimsIndex + sym.dims.length) continue;
        var idx = parseInt(m[1], 10);
        if (idx >= size) {`,
    "跳过数组声明处");

sub(String.raw`      var written = new RegExp("\\b" + name + "\\s*=(?!=)", "g");
      var addressOf = new RegExp("&\\s*" + name + "\\b", "g");
      var scanned = new RegExp("(&\\s*" + name + "\\b)|(\\b" + name + "\\s*(\\+|\\-)?=)", "g");`,
    String.raw`      var written = new RegExp("\\b" + name + "\\s*=(?!=)", "g");
      var addressOf = new RegExp("&\\s*(?:[A-Za-z_]\\w*(?:\\.|->)\\s*)?" + name + "\\b", "g");
      var scanned = new RegExp("&\\s*(?:[A-Za-z_]\\w*(?:\\.|->)\\s*)?" + name + "\\b|\\b" + name + "\\s*(?:\\+\\+|--|[-+*/%&|^]?=(?!=))", "g");`,
    "识别结构体成员取地址");

sub(String.raw`        if (fmt.indexOf("%s") >= 0 && !/%\d+s/.test(fmt)) {`,
    String.raw`        var smallTarget = (function () {
          var tn = targets[0];
          var idn = tn ? baseIdent(tn.text) : null;
          var symn = idn ? symbols[idn.name] : null;
          if (!symn || symn.kind !== "array") return false;
          var szn = /^\[(\d+)\]/.exec(symn.dims);
          return !!szn && parseInt(szn[1], 10) < 64;
        })();
        if (fmt.indexOf("%s") >= 0 && !/%\d+s/.test(fmt) && smallTarget) {`,
    "缓冲区太小时才提示 %s 宽度");

sub(String.raw`      var printedAsFloat = /%\s*\.?\d*\s*(l?f)\s*\"\s*,\s*[^,]*$/.test(head) && /^\s*[,)]/.test(tail);
      var usedInFloatExpr = /^\s*[*/]/.test(tail);
      if (assignedToFloat || printedAsFloat || usedInFloatExpr) {`,
    String.raw`      var usedInFloatExpr = /^\s*[*/]/.test(tail);
      if (assignedToFloat || usedInFloatExpr) {`,
    "移除失效的 printf 启发式");

sub(String.raw`        } else if (convIsFloat && isIntLiteral(arg.text)) {
          add("warning", arg.start, "用 %" + p.conv + " 输出整数常量 " + arg.text.trim(),
            "整数常量的类型是 int，用 %f 输出会得到错误结果。",
            "把常量写成小数形式，例如 " + arg.text.trim() + ".0。");
        }`,
    String.raw`        } else if (convIsFloat && isIntLiteral(arg.text)) {
          add("warning", arg.start, "用 %" + p.conv + " 输出整数常量 " + arg.text.trim(),
            "整数常量的类型是 int，用 %f 输出会得到错误结果。",
            "把常量写成小数形式，例如 " + arg.text.trim() + ".0。");
        } else if (convIsFloat) {
          var divArg = /^\s*([A-Za-z_]\w*)\s*\/\s*([A-Za-z_]\w*)\s*$/.exec(arg.text);
          if (divArg && symbols[divArg[1]] && symbols[divArg[2]]
            && !symbols[divArg[1]].isFloat && !symbols[divArg[2]].isFloat) {
            add("warning", arg.start, "两个整数相除，结果会被截断",
              divArg[1] + " 和 " + divArg[2] + " 都是整数，先做整数除法再转成小数，小数部分已经丢掉了（例如 7 / 2 得到 3.000000）。",
              "先转成浮点再除：(double)" + divArg[1] + " / " + divArg[2] + "。");
          }
        }`,
    "printf 参数是整数除法时提醒");

writeFileSync(file, src);
console.log("已应用 " + done.length + " 处修正：\n  - " + done.join("\n  - "));