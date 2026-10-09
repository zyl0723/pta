import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = { console }; sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(path.join(root, "assets/vendor/jscpp.js"), "utf8"), sandbox, { filename: "jscpp.js" });
const JSCPP = sandbox.JSCPP;
function t(label, code, input) {
  let out = "";
  try { JSCPP.run(code, input || "", { maxTimeout: 3000, stdio: { write: (s) => { out += s; } } });
    console.log("OK   " + label.padEnd(34) + " -> " + JSON.stringify(out));
  } catch (e) { console.log("ERR  " + label.padEnd(34) + " -> " + String(e.message).split("\n")[0].slice(0, 110)); }
}
const H = '#include <stdio.h>\n';
t("sizeof 各类型", H + 'int main(){ printf("%d %d %d %d", sizeof(char), sizeof(short), sizeof(int), sizeof(long long)); return 0; }');
t("long long 小值", H + 'int main(){ long long n; n=5; printf("%lld", n); return 0; }');
t("long long 声明初始化小值", H + 'int main(){ long long n = 5; printf("%lld", n); return 0; }');
t("long 小值", H + 'int main(){ long n; n=5; printf("%ld", n); return 0; }');
t("long long 乘法溢出", H + 'int main(){ long long n=100000; n=n*100000; printf("%lld", n); return 0; }');
t("两个 int 相加溢出", H + 'int main(){ int a=100000; printf("%d", a*a); return 0; }');