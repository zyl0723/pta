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

function runCase(code, input, timeout) {
  let out = "";
  let error = null;
  try {
    JSCPP.run(code, input || "", { maxTimeout: timeout || 3000, stdio: { write: (s) => { out += s; } } });
  } catch (e) {
    error = e && e.message ? e.message : String(e);
  }
  return { out, error };
}

const H = '#include <stdio.h>\n';
const cases = [
  { n: "scanf %lf 读 double", i: "2.5\n", e: "6.25",
    c: H + 'int main(){ double r; scanf("%lf",&r); printf("%.2f", r*r); return 0; }' },
  { n: "scanf %f 读 float", i: "2.5\n", e: "6.25",
    c: H + 'int main(){ float r; scanf("%f",&r); printf("%.2f", r*r); return 0; }' },
  { n: "两个整数求和", i: "3 4\n", e: "7",
    c: H + 'int main(){ int a,b; scanf("%d %d",&a,&b); printf("%d", a+b); return 0; }' },
  { n: "无空格格式串", i: "3 4\n", e: "7",
    c: H + 'int main(){ int a,b; scanf("%d%d",&a,&b); printf("%d", a+b); return 0; }' },
  { n: "逗号分隔格式", i: "3,4\n", e: "7",
    c: H + 'int main(){ int a,b; scanf("%d,%d",&a,&b); printf("%d", a+b); return 0; }' },
  { n: "EOF 循环求和", i: "1 2 3 4 5\n", e: "15",
    c: H + 'int main(){ int n,s=0; while(scanf("%d",&n)!=EOF){ s+=n; } printf("%d", s); return 0; }' },
  { n: "EOF 常量值", i: "", e: "-1",
    c: H + 'int main(){ printf("%d", EOF); return 0; }' },
  { n: "scanf 返回成功个数", i: "7\n", e: "1",
    c: H + 'int main(){ int n; printf("%d", scanf("%d",&n)); return 0; }' },
  { n: "scanf 失败返回 0", i: "abc\n", e: "0",
    c: H + 'int main(){ int n=5; printf("%d", scanf("%d",&n)); return 0; }' },
  { n: "数组元素取地址读入", i: "1 2 3\n", e: "1 2 3 ",
    c: H + 'int main(){ int a[5],i; for(i=0;i<3;i++) scanf("%d",&a[i]); for(i=0;i<3;i++) printf("%d ", a[i]); return 0; }' },
  { n: "二维数组读入", i: "1 2 3 4\n", e: "5",
    c: H + 'int main(){ int a[2][2],i,j,s=0; for(i=0;i<2;i++) for(j=0;j<2;j++) scanf("%d",&a[i][j]); printf("%d", a[0][1]+a[1][0]); return 0; }' },
  { n: "long long 输入输出", i: "2147483648\n", e: "2147483648",
    c: H + 'int main(){ long long n; scanf("%lld",&n); printf("%lld", n); return 0; }' },
  { n: "printf %lld 大数", i: "", e: "10000000000",
    c: H + 'int main(){ long long n=100000; n=n*100000; printf("%lld", n); return 0; }' },
  { n: "printf %llu", i: "", e: "4000000000",
    c: H + 'int main(){ unsigned long long n=4000000000; printf("%llu", n); return 0; }' },
  { n: "printf %.2lf", i: "", e: "3.14",
    c: H + 'int main(){ double x=3.14159; printf("%.2lf", x); return 0; }' },
  { n: "printf 宽度与标志", i: "", e: "| 3.14|[7    ][00042][+7]" ,
    c: H + 'int main(){ printf("|%5.2f|[%-5d][%05d][%+d]", 3.14159, 7, 42, 7); return 0; }' },
  { n: "printf %#x", i: "", e: "0xff",
    c: H + 'int main(){ printf("%#x", 255); return 0; }' },
  { n: "16 进制与 8 进制读入", i: "1f 17\n", e: "31 15",
    c: H + 'int main(){ int a,b; scanf("%x%o",&a,&b); printf("%d %d", a, b); return 0; }' },
  { n: "读入字符串后写数组元素", i: "ab\n", e: "Ab",
    c: H + 'int main(){ char s[8]; scanf("%s",s); s[0]=65; printf("%s", s); return 0; }' },
  { n: "字符串读入与 strlen", i: "hello\n", e: "5",
    c: H + '#include <string.h>\n' + 'int main(){ char s[64]; scanf("%s", s); printf("%d", strlen(s)); return 0; }' },
  { n: "读整行 %[^新行]", i: "hello world\n", e: "[hello world]",
    c: H + 'int main(){ char s[128]; scanf("%[^\\n]", s); printf("[%s]", s); return 0; }' },
  { n: "gets 读整行", i: "hello world\n", e: "[hello world]",
    c: H + 'int main(){ char s[128]; gets(s); printf("[%s]", s); return 0; }' },
  { n: "getchar 直到 EOF", i: "abc\n", e: "4",
    c: H + 'int main(){ int c,n=0; while((c=getchar())!=EOF){ n++; } printf("%d", n); return 0; }' },
  { n: "putchar 输出", i: "", e: "ABC",
    c: H + 'int main(){ int i; for(i=65;i<=67;i++) putchar(i); return 0; }' },
  { n: "%c 不跳过空白", i: "a b\n", e: "a",
    c: H + 'int main(){ char c; scanf("%c",&c); printf("%c", c); return 0; }' },
  { n: "空格格式跳过空白", i: "   z\n", e: "z",
    c: H + 'int main(){ char c; scanf(" %c",&c); printf("%c", c); return 0; }' },
  { n: "多字符 %2c", i: "abcd\n", e: "[ab]",
    c: H + 'int main(){ char s[8]; s[0]=0;s[1]=0;s[2]=0; scanf("%2c", s); s[2]=0; printf("[%s]", s); return 0; }' },
  { n: "字符串反转", i: "abcde\n", e: "edcba",
    c: H + '#include <string.h>\n' + 'int main(){ char s[64]; char t; int i,n; scanf("%s",s); n=strlen(s); for(i=0;i<n/2;i++){ t=s[i]; s[i]=s[n-1-i]; s[n-1-i]=t; } printf("%s", s); return 0; }' },
  { n: "冒泡排序", i: "5\n5 3 1 4 2\n", e: "1 2 3 4 5",
    c: H + 'int main(){ int n,i,j,t,a[100]; scanf("%d",&n); for(i=0;i<n;i++) scanf("%d",&a[i]); for(i=0;i<n-1;i++) for(j=0;j<n-1-i;j++) if(a[j]>a[j+1]){t=a[j];a[j]=a[j+1];a[j+1]=t;} for(i=0;i<n;i++){ if(i) printf(" "); printf("%d", a[i]); } return 0; }' },
  { n: "递归阶乘", i: "", e: "3628800",
    c: H + 'long f(int n){ return n<=1?1:n*f(n-1); }\nint main(){ printf("%ld", f(10)); return 0; }' },
  { n: "switch 分支", i: "3\n", e: "March",
    c: H + 'int main(){ int n; scanf("%d",&n); switch(n){ case 3: printf("March"); break; default: printf("?"); } return 0; }' },
  { n: "math.h sqrt", i: "16\n", e: "4.00",
    c: H + '#include <math.h>\n' + 'int main(){ int n; scanf("%d",&n); printf("%.2f", sqrt(n)); return 0; }' },
  { n: "ctype toupper", i: "abc\n", e: "ABC",
    c: H + '#include <ctype.h>\n#include <string.h>\n' + 'int main(){ char s[32]; int i; scanf("%s",s); for(i=0;i<strlen(s);i++) s[i]=toupper(s[i]); printf("%s",s); return 0; }' },
  { n: "多组输入直到 EOF（字符串）", i: "a\nb\n", e: "ab",
    c: H + 'int main(){ char s[16]; while(scanf("%s", s)!=EOF) printf("%s", s); return 0; }' },
  { n: "死循环被超时终止", i: "", e: "__TIMEOUT__",
    c: H + 'int main(){ int i=0; while(1){ i++; } return 0; }', t: 700 },
  { n: "缺少分号（编译错误）", i: "", e: "__ERROR__",
    c: H + 'int main(){ int a = 1\n printf("%d", a); return 0; }' },
  { n: "未声明变量（运行错误）", i: "", e: "__ERROR__",
    c: H + 'int main(){ x = 1; printf("%d", x); return 0; }' },
  { n: "scanf 漏取地址符", i: "5\n", e: "__ERROR__",
    c: H + 'int main(){ int n; scanf("%d", n); printf("%d", n); return 0; }' },
  { n: "数组越界写入", i: "1 2 3 4 5 6\n", e: "__ERROR__",
    c: H + 'int main(){ int a[3],i; for(i=0;i<6;i++) scanf("%d",&a[i]); printf("%d",a[0]); return 0; }' },
  { n: "int 溢出", i: "", e: "__ERROR__",
    c: H + 'int main(){ int a=100000; printf("%d", a*a); return 0; }' },
];

let pass = 0, fail = 0;
const failures = [];
for (const c of cases) {
  const r = runCase(c.c, c.i, c.t);
  let got;
  if (c.e === "__ERROR__") got = r.error ? "__ERROR__" : "NO-ERROR:" + JSON.stringify(r.out);
  else if (c.e === "__TIMEOUT__") got = r.error && /Time limit exceeded/.test(r.error) ? "__TIMEOUT__" : "NOT-TIMEOUT:" + JSON.stringify(r.error || r.out);
  else got = r.out;
  const ok = got === c.e;
  if (ok) pass++; else { fail++; failures.push({ c, got, r }); }
  console.log((ok ? "PASS " : "FAIL ") + c.n.padEnd(24) + " 期望=" + JSON.stringify(c.e) + " 实际=" + JSON.stringify(String(got).slice(0, 80)));
}
console.log("");
if (failures.length) {
  console.log("失败详情：");
  for (const f of failures) {
    console.log("  * " + f.c.n + " -> " + String(f.r.error || f.got).split("\n").slice(0, 4).join(" / ").slice(0, 220));
  }
  console.log("");
}
console.log("通过 " + pass + " / " + (pass + fail));
