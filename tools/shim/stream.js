// printf 库用 `args[0] instanceof require('stream').Stream` 判断首参是否为输出流。
// JSCPP 调用 printf 时首参恒为格式字符串，该分支不会命中，这里给出最小替身即可。
function Stream() {}
module.exports = { Stream: Stream };
