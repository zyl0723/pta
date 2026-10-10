    /* [本项目补丁] JSCPP 的 C 解析器（PEG.js 生成的 ast.js / prepast.js）原本用 eval 解码
       C 字符串里的转义字符，而页面用的是严格 CSP（script-src 'self'，不含 unsafe-eval），
       浏览器会直接拦下 eval，于是「运行」永远失败、只能报一个看不懂的语法错误。
       下面这几个函数做的是同一件事，但不依赖 eval，语义按 C 语言来：
       \a 是响铃（\u0007）、八进制 / 十六进制转义按一个字符（& 255）取值。 */
    function peg$unescapeSimple(ch) {
        switch (ch) {
            case "'": return "'";
            case '"': return '"';
            case "?": return "?";
            case "\\": return "\\";
            case "a": return "\u0007";
            case "b": return "\b";
            case "f": return "\f";
            case "n": return "\n";
            case "r": return "\r";
            case "t": return "\t";
            case "v": return "\u000b";
            default: return ch;
        }
    }
    function peg$unescapeOctal(digits) {
        return String.fromCharCode(parseInt(digits, 8) & 255);
    }
    function peg$unescapeHex(digits) {
        return String.fromCharCode(parseInt(digits, 16) & 255);
    }
    function peg$unescapeUni(digits) {
        var code = parseInt(digits, 16);
        if (isNaN(code)) return digits;
        if (code > 65535) return String.fromCodePoint(code);
        return String.fromCharCode(code);
    }
