import { readFileSync, writeFileSync } from "node:fs";
const file = "assets/js/analyzer.js";
let src = readFileSync(file, "utf8");
function sub(from, to, label) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error("锚点出现 " + n + " 次: " + label);
  src = src.split(from).join(to);
  console.log("已修正: " + label);
}
sub(
String.raw`      var seg = masked.slice(ws.index, ws.index + 200);
      if (/!=\s*EOF|==\s*EOF|<=\s*0|!=\s*-1/.test(seg)) continue;
      if (!/\)\s*\)/.test(seg)) continue;
      add("warning", ws.index, "while (scanf(...)) 会变成死循环",
        "scanf 成功时返回成功读入的个数（通常大于 0），判断恒为真，读完所有数据后不会自动退出。",
        "多组数据一般写成 while (scanf(\"%d\", &n) != EOF) { ... }。");`,
String.raw`      var sop = masked.indexOf("(", ws.index);
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
          "多组数据一般写成 while (scanf(\"%d\", &n) != EOF) { ... }，或 while (scanf(\"%d\", &n) == 1) { ... }。");
      }`,
"while(scanf(...)) 判定更精确");
writeFileSync(file, src);