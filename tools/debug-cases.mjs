import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEngine(rel) {
  const sandbox = { console };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.join(root, rel), "utf8"), sandbox, { filename: rel });
  return sandbox.JSCPP;
}
const patched = loadEngine("assets/vendor/jscpp.js");

function t(label, code, input, engine) {
  let out = "";
  try {
    const e = engine || patched;
    e.run(code, input || "", { maxTimeout: 3000, stdio: { write: (s) => { out += s; } } });
    console.log("OK   " + label.padEnd(34) + " -> " + JSON.stringify(out));
  } catch (err) {
    console.log("ERR  " + label.padEnd(34) + " -> " + String(err.message).split("\n")[0].slice(0, 110));
  }
}

const H = '#include <stdio.h>\n';
t("数组元素取地址 &a[0]", H + 'int main(){ int a[5]; scanf("%d",&a[0]); printf("%d",a[0]); return 0; }', "7\n");
t("数组元素取地址 &a[i]", H + 'int main(){ int a[5],i; for(i=0;i<3;i++) scanf("%d",&a[i]); printf("%d",a[1]); return 0; }', "1 2 3\n");
t("标量取地址 &x", H + 'int main(){ int x; scanf("%d",&x); printf("%d",x); return 0; }', "9\n");
t("二维数组 &a[i][j]", H + 'int main(){ int a[3][3],i,j; for(i=0;i<2;i++) for(j=0;j<2;j++) scanf("%d",&a[i][j]); printf("%d",a[1][1]); return 0; }', "1 2 3 4\n");
t("char 取地址 &c", H + 'int main(){ char c; scanf("%c",&c); printf("%c",c); return 0; }', "a");
t("char 数组元素赋值 s[i]=t", H + 'int main(){ char s[8],t; s[0]=65; t=s[0]; s[1]=t; printf("%c%c",s[0],s[1]); return 0; }', "");
t("char 数组+char 同句声明", H + 'int main(){ char s[8],t; t=66; printf("%c",t); return 0; }', "");
t("char 数组单独声明", H + 'int main(){ char s[8]; char t; s[0]=65; t=s[0]; s[1]=t; printf("%c%c",s[0],s[1]); return 0; }', "");
t("int 数组+int 同句声明", H + 'int main(){ int a[5],t; a[0]=3; t=a[0]; a[1]=t; printf("%d%d",a[0],a[1]); return 0; }', "");
t("字符串反转（分离声明）", H + '#include <string.h>\nint main(){ char s[64]; char tmp; int i,n; scanf("%s",s); n=strlen(s); for(i=0;i<n/2;i++){ tmp=s[i]; s[i]=s[n-1-i]; s[n-1-i]=tmp; } printf("%s",s); return 0; }', "abcde\n");
t("EOF 宏是否存在", H + 'int main(){ printf("%d", EOF); return 0; }', "");
t("long long 大数", H + 'int main(){ long long n; n=2147483648LL; printf("%lld",n); return 0; }', "");
t("long 大数", H + 'int main(){ long n; n=3000000000; printf("%ld",n); return 0; }', "");
t("getchar 到 EOF 返回 -1", H + 'int main(){ int c,n=0; while((c=getchar())!=-1) n++; printf("%d",n); return 0; }', "abc\n");