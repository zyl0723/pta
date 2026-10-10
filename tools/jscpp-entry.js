/*!
 * 浏览器里的 JSCPP 入口。
 * 除了官方导出（includes / run），这里再补一个 parse()：只做「预处理 + 语法解析」，不执行 main，
 * 用来像编译器那样把语法错误（行号、列号）报出来。本文件只是转发调用，不含第三方代码本身。
 */
var JSCPP = require("JSCPP");
var rt = require("JSCPP/lib/rt");
var ast = require("JSCPP/lib/ast");
var preprocessor = require("JSCPP/lib/preprocessor");
var PEGUtil = require("pegjs-util");

JSCPP.parse = function (code, config) {
  /* stdio 只是给预处理/解析过程用的桩：解析不执行 main，不该读输入、也不输出任何东西 */
  var cfg = {
    includes: JSCPP.includes,
    unsigned_overflow: "error",
    stdio: { drain: function () { return ""; }, write: function () {} }
  };
  rt.mergeConfig(cfg, config || {});
  var runtime = new rt.CRuntime(cfg);
  var src = preprocessor.parse(runtime, String(code == null ? "" : code));
  var result = PEGUtil.parse(ast, src);
  if (result.error != null) {
    var loc = (result.error.location && result.error.location.start) || {};
    return {
      ok: false,
      message: PEGUtil.errorMessage(result.error, true),
      line: loc.line || 1,
      column: loc.column || 1,
      expected: result.error.expected || [],
      found: result.error.found || null,
      source: src
    };
  }
  return { ok: true, source: src };
};

module.exports = JSCPP;
