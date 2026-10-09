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
