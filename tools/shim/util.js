// 浏览器环境下的 Node 内置模块最小替身，仅覆盖 printf 库实际用到的接口。
function inspect(value, options) {
  var depth = options && typeof options.depth === "number" ? options.depth : 2;
  var seen = new WeakSet();
  function walk(node, level) {
    if (node === null) return "null";
    if (node === undefined) return "undefined";
    var type = typeof node;
    if (type === "number" || type === "boolean" || type === "bigint") return String(node);
    if (type === "function") return "[Function]";
    if (type === "string") return "'" + node + "'";
    if (level > depth) return Array.isArray(node) ? "[Array]" : "[Object]";
    if (seen.has(node)) return "[Circular]";
    seen.add(node);
    if (Array.isArray(node)) {
      var items = node.map(function (item) { return walk(item, level + 1); });
      return "[ " + items.join(", ") + " ]";
    }
    var keys = Object.keys(node);
    if (!keys.length) return "{}";
    return "{ " + keys.map(function (key) {
      return key + ": " + walk(node[key], level + 1);
    }).join(", ") + " }";
  }
  return walk(value, 0);
}
function format() {
  var args = Array.prototype.slice.call(arguments);
  var template = String(args.shift() == null ? "" : args[0]);
  var index = 0;
  return template.replace(/%[sdifjoO%]/g, function (token) {
    if (token === "%%") return "%";
    var value = args[index++];
    if (token === "%d" || token === "%i") return String(parseInt(value, 10));
    if (token === "%f") return String(parseFloat(value));
    if (token === "%j") { try { return JSON.stringify(value); } catch (err) { return inspect(value); } }
    return String(value);
  });
}
module.exports = { inspect: inspect, format: format, types: {}, isDeepStrictEqual: function (a, b) { return a === b; } };
