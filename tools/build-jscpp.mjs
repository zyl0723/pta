import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patch = (name) => readFileSync(path.join(root, "tools/patch", name), "utf8");

function spliceOnce(source, startAnchor, endAnchor, replacement, label) {
  const start = source.indexOf(startAnchor);
  if (start < 0) throw new Error("[patch] 未找到起始锚点: " + label);
  if (source.indexOf(startAnchor, start + 1) >= 0) throw new Error("[patch] 起始锚点不唯一: " + label);
  const end = source.indexOf(endAnchor, start);
  if (end < 0) throw new Error("[patch] 未找到结束锚点: " + label);
  return source.slice(0, start) + replacement + source.slice(end);
}

function replaceOnce(source, from, to, label) {
  const idx = source.indexOf(from);
  if (idx < 0) throw new Error("[patch] 未找到片段: " + label);
  if (source.indexOf(from, idx + 1) >= 0) throw new Error("[patch] 片段不唯一: " + label);
  return source.slice(0, idx) + to + source.slice(idx + from.length);
}

function patchCstdio(rawSource) {
  let src = rawSource.replace(/\r\n/g, "\n");

  src = spliceOnce(src,
    "const _get_input = function (pre, next, match, type) {",
    "const _deal_type = function (format) {",
    patch("scanf-readers.js"), "scanf 读取核心");

  src = spliceOnce(src,
    "const _deal_type = function (format) {",
    "const _set_pointer_value = function (pointer, value) {",
    "", "移除 _deal_type");

  src = spliceOnce(src,
    "const _set_pointer_value = function (pointer, value) {",
    "const __scanf = function (format) {",
    patch("scanf-pointer.js"), "指针写入");

  src = spliceOnce(src,
    "const __scanf = function (format) {",
    'return rt.regFunc(_sscanf, "global", "sscanf", [char_pointer, char_pointer, "?"], rt.intTypeLiteral);',
    patch("scanf-impl.js"), "scanf/sscanf 实现");

  src = spliceOnce(src,
    "const format_type_map = function (rt, ctrl) {",
    "const validate_format = function (rt, format, ...params) {",
    patch("cstdio-format.js"), "printf 类型映射");

  src = spliceOnce(src,
    "const validate_format = function (rt, format, ...params) {",
    "function __range__(left, right, inclusive) {",
    patch("cstdio-validate.js"), "printf 参数校验");

  src = replaceOnce(src, "const EOF = 0;", "const EOF = -1;", "EOF 取值");

  src = replaceOnce(src,
    "let input_stream = stdio.drain();",
    "let input_stream = stdio.drain();\n        rt.scope[0].variables.EOF = rt.val(rt.intTypeLiteral, -1);",
    "注册 EOF");

  src = replaceOnce(src,
    "const retval = printf(formatStr, ...parsed_params);",
    "const retval = printf(strip_length_modifiers(formatStr), ...parsed_params);",
    "printf 输出时去掉长度修饰符");

  return src;
}

/* C 里 f(void) 表示「没有参数」：解析器给出的是「有 void 说明符、没有名字」的参数节点。
   原版 JSCPP 会把它当成错误抛出 (missing declarator for argument)，这里让参数列表直接跳过它。 */
function patchInterpreter(rawSource) {
  let src = rawSource.replace(/\r\n/g, "\n");
  src = replaceOnce(src,
    '                    if ((_param.Declarator == null)) {\n' +
    '                        rt.raiseException("missing declarator for argument", _param);\n' +
    '                    }',
    '                    if ((_param.Declarator == null)) {\n' +
    '                        if (_param.DeclarationSpecifiers.length === 1 && _param.DeclarationSpecifiers[0] === "void") {\n' +
    '                            i++;\n' +
    '                            continue;\n' +
    '                        }\n' +
    '                        rt.raiseException("missing declarator for argument", _param);\n' +
    '                    }',
    "f(void) 参数");
  return src;
}

/* JSCPP 的 C 解析器是 PEG.js 生成的（lib/ast.js 解 C 源码、lib/prepast.js 解预处理指令），
   其中「解码字符串转义」用的是 eval。页面用严格 CSP（script-src 'self'，没有 unsafe-eval），
   浏览器会直接拦下 eval —— 结果是「运行」永远失败，只报一个看不懂的语法错误。
   这里把这几处 eval 换成 tools/patch/parser-unescape.js 里不依赖 eval 的等价实现。 */
function patchParserEval(rawSource, opts) {
  let src = rawSource.replace(/\r\n/g, "\n");
  const helper = patch("parser-unescape.js").replace(/\n+$/, "");

  src = replaceOnce(src,
    "    var options = arguments.length > 1 ? arguments[1] : {},",
    helper + "\n    var options = arguments.length > 1 ? arguments[1] : {},",
    "注入转义解码 helper");

  src = replaceOnce(src,
    "function(a, b) {return eval('\"' + a + b +'\"');}",
    "function(a, b) {return peg$unescapeSimple(b);}",
    "简单转义（\\n \\t 这一批）");

  const octalFrom = [
    '          var ret = "\\"";',
    "          ret += a;",
    "          ret += b;",
    "          if (c)",
    "            ret += c;",
    "          if (d)",
    "            ret += d;",
    '          ret += "\\"";',
    "          return eval(ret);",
  ].join("\n");
  src = replaceOnce(src, octalFrom,
    '          return peg$unescapeOctal(b + (c || "") + (d || ""));',
    "八进制转义");

  src = replaceOnce(src,
    "function(a, b) {return eval('\"'+a+b.join('')+'\"');}",
    "function(a, b) {return peg$unescapeHex(b.join(''));}",
    "十六进制转义");

  if (opts && opts.universal) {
    src = replaceOnce(src,
      "function(a) { return eval('\"\\\\u' + a.join('') + '\"'); }",
      "function(a) { return peg$unescapeUni(a.join('')); }",
      "\\u 通用字符名");
    src = replaceOnce(src,
      "function(a, b) { return eval('\"\\\\U' + a.join('') + b.join('') + '\"'); }",
      "function(a, b) { return peg$unescapeUni(a.join('') + b.join('')); }",
      "\\U 通用字符名");
  }

  return src;
}

const result = await esbuild.build({
  entryPoints: [path.join(root, "tools/jscpp-entry.js")],
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "JSCPP",
  target: "es2017",
  outfile: path.join(root, "assets/vendor/jscpp.js"),
  banner: {
    js: [
      "/*!",
      " * 本文件由 tools/build-jscpp.mjs 自动生成：内含第三方开源代码，并已针对本项目打补丁，请勿手工修改。",
      " * 第三方组件：JSCPP 2.0.9 (MIT, Copyright (c) 2015 Felix Hao)，及其依赖 lodash、pegjs-util、printf（均为 MIT）。",
      " * JSCPP 里用于解析 C 语法/预处理指令的解析器由 PEG.js 0.9.0 生成（MIT, Copyright (c) 2010-2016 David Majda, http://pegjs.org/）。",
      " * 完整许可文本见仓库根目录 THIRD-PARTY-NOTICES.md。",
      " */",
    ].join("\n"),
  },
  legalComments: "eof",
  alias: {
    util: path.join(root, "tools/shim/util.js"),
    stream: path.join(root, "tools/shim/stream.js"),
  },
  plugins: [{
    name: "jscpp-cstdio-patch",
    setup(build) {
      build.onLoad({ filter: /includes[\\/]cstdio\.js$/ }, (args) => ({
        contents: patchCstdio(readFileSync(args.path, "utf8")),
        loader: "js",
      }));
      build.onLoad({ filter: /lib[\\/]interpreter\.js$/ }, (args) => ({
        contents: patchInterpreter(readFileSync(args.path, "utf8")),
        loader: "js",
      }));
      build.onLoad({ filter: /lib[\\/]ast\.js$/ }, (args) => ({
        contents: patchParserEval(readFileSync(args.path, "utf8"), { universal: true }),
        loader: "js",
      }));
      build.onLoad({ filter: /lib[\\/]prepast\.js$/ }, (args) => ({
        contents: patchParserEval(readFileSync(args.path, "utf8"), {}),
        loader: "js",
      }));
    },
  }],
  logLevel: "warning",
  metafile: true,
});

const output = Object.entries(result.metafile.outputs)[0];
console.log("构建完成:", output[0], Math.round(output[1].bytes / 1024) + " KB");

const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const matched = input.replace(/\\/g, "/").match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)\//);
  if (matched) packages.add(matched[1]);
}
console.log("打包进产物的第三方包:", [...packages].sort().join(", "));
console.log("（署名与许可信息见 THIRD-PARTY-NOTICES.md，请保持同步）");
