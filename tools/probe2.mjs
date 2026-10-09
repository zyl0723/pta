import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = { console };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(path.join(root, "assets/vendor/jscpp.js"), "utf8"), sandbox, { filename: "jscpp.js" });
const JSCPP = sandbox.JSCPP;
function t(label, code, input) {
  let out = "";
  try {
    JSCPP.run(code, input || "", { maxTimeout: 3000, stdio: { write: (s) => { out += s; } } });
    console.log("OK   " + label.padEnd(38) + " -> " + JSON.stringify(out));
  } catch (e) { console.log("ERR  " + label.padEnd(38) + " -> " + String(e.message).split("\n")[0].slice(0, 100)); }
}
const H = '#include <stdio.h>\n';
t("数组元素赋值：变量下标", H + 'int main(){ int a[5],i; for(i=0;i<3;i++) a[i]=i; printf("%d%d%d",a[0],a[1],a[2]); return 0; }');
t("数组元素赋值：表达式下标", H + 'int main(){ int a[5],i,n=3; for(i=0;i<n;i++) a[n-1-i]=i; printf("%d%d%d",a[0],a[1],a[2]); return 0; }');
t("char数组：变量下标赋值", H + 'int main(){ char s[8]; int i; for(i=0;i<3;i++) s[i]=65+i; printf("%s",s); return 0; }');
t("char数组：表达式下标赋值", H + 'int main(){ char s[8]; int i,n=3; for(i=0;i<n;i++) s[n-1-i]=65+i; printf("%s",s); return 0; }');
t("char数组：元素互相赋值", H + 'int main(){ char s[8]; int i,n=4; s[0]=97;s[1]=98;s[2]=99;s[3]=100; for(i=0;i<n/2;i++){ char t; t=s[i]; s[i]=s[n-1-i]; s[n-1-i]=t; } printf("%s",s); return 0; }');
t("char数组：char t 循环内声明", H + 'int main(){ char s[4]; s[0]=97; { char t; t=s[0]; } printf("%s",s); return 0; }');
t("long long 字面量 LL", H + 'int main(){ long long n; n=2147483648LL; printf("%lld",n); return 0; }');
t("long long 字面量 无后缀", H + 'int main(){ long long n; n=2147483648; printf("%lld",n); return 0; }');
t("long long 直接打印字面量", H + 'int main(){ printf("%lld", 2147483648LL); return 0; }');
t("long long 加法", H + 'int main(){ long long a,b; a=2000000000; b=2000000000; printf("%lld", a+b); return 0; }');
t("int 溢出行为", H + 'int main(){ int a=2147483647; a=a+1; printf("%d", a); return 0; }');
t("unsigned int 边界", H + 'int main(){ unsigned int a=4294967295; printf("%u", a); return 0; }');
t("printf %lld", H + 'int main(){ long long n=3000000000; printf("%lld", n); return 0; }');