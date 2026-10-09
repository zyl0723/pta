import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = { console }; sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(path.join(root, "assets/vendor/jscpp.js"), "utf8"), sandbox, { filename: "jscpp.js" });
const JSCPP = sandbox.JSCPP;
function t(label, code) {
  let out = "";
  try { JSCPP.run(code, "", { maxTimeout: 3000, stdio: { write: (s) => { out += s; } } });
    console.log("OK   " + label.padEnd(32) + " -> " + JSON.stringify(out));
  } catch (e) { console.log("ERR  " + label.padEnd(32) + " -> " + String(e.message).split("\n")[0].slice(0, 110)); }
}
const H = '#include <stdio.h>\n';
t("sizeof(long long 变量)", H + 'int main(){ long long n; printf("%d", sizeof(n)); return 0; }');
t("sizeof(long 变量)", H + 'int main(){ long n; printf("%d", sizeof(n)); return 0; }');
t("sizeof(long long int 变量)", H + 'int main(){ long long int n; printf("%d", sizeof(n)); return 0; }');
t("sizeof(unsigned long long 变量)", H + 'int main(){ unsigned long long n; printf("%d", sizeof(n)); return 0; }');
t("sizeof(short 变量)", H + 'int main(){ short n; printf("%d", sizeof(n)); return 0; }');
t("long long 加法赋值给自身", H + 'int main(){ long long n=100000; n = n + 0; printf("%lld", n); return 0; }');
t("unsigned long long 大值", H + 'int main(){ unsigned long long n=4000000000; printf("%llu", n); return 0; }');