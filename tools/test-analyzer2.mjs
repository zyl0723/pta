import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = { console }; sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(path.join(root, "assets/js/analyzer.js"), "utf8"), sandbox, { filename: "analyzer.js" });
const A = sandbox.PTAAnalyzer;
const H = '#include <stdio.h>\n';

const bad = [
  { name: "scanf 漏 &", want: ["少了 &"],
    code: H + 'int main(){ int n; scanf("%d", n); printf("%d", n); return 0; }' },
  { name: "scanf 读 double 用 %d", want: ["读入 double"],
    code: H + 'int main(){ double d; scanf("%d", &d); printf("%f", d); return 0; }' },
  { name: "printf %d 输出 double", want: ["输出浮点变量"],
    code: H + 'int main(){ double d=1.5; printf("%d", d); return 0; }' },
  { name: "printf %f 输出 int", want: ["输出整型变量"],
    code: H + 'int main(){ int a=5; printf("%f", a); return 0; }' },
  { name: "if 里写成 =", want: ["赋值号"],
    code: H + 'int main(){ int a=1,b=2; if(a=b) printf("yes"); return 0; }' },
  { name: "if 后多分号", want: ["多了一个分号"],
    code: H + 'int main(){ int a=1; if(a>0); { printf("ok"); } return 0; }' },
  { name: "数组越界", want: ["越界"],
    code: H + 'int main(){ int a[5]; a[5]=1; printf("%d", a[5]); return 0; }' },
  { name: "中文标点", want: ["中文标点"],
    code: H + 'int main(){ int a=1； printf("%d", a); return 0; }' },
  { name: "整数除法赋给 double", want: ["整数相除"],
    code: H + 'int main(){ int s=7,n=2; double avg=0; avg=s/n; printf("%f", avg); return 0; }' },
  { name: "printf 里整数除法", want: ["整数相除"],
    code: H + 'int main(){ int s=7,n=2; printf("%f", s/n); return 0; }' },
  { name: "while(scanf) 死循环", want: ["死循环"],
    code: H + 'int main(){ int n; while(scanf("%d",&n)){ printf("%d", n); } return 0; }' },
  { name: "long long 用 %d 输出", want: ["long long"],
    code: H + 'int main(){ long long s=0; printf("%d", s); return 0; }' },
  { name: "缺少 stdio.h", want: ["stdio.h"],
    code: 'int main(){ printf("hi"); return 0; }' },
  { name: "% 用在 double 上", want: ["不能用在浮点数上"],
    code: H + 'int main(){ double x=5.5,y=2.0; printf("%f", x%y); return 0; }' },
  { name: "浮点用 == 比较", want: ["浮点数不要直接用 =="],
    code: H + '#include <math.h>\nint main(){ double a=1.0/3.0,b=0.333; if(a==b) printf("eq"); return 0; }' },
  { name: "转义写成 /n", want: ["转义字符"],
    code: H + 'int main(){ printf("hello/n"); return 0; }' },
  { name: "格式化占位符个数不符", want: ["个数对不上"],
    code: H + 'int main(){ int a=1,b=2; printf("%d %d", a); return 0; }' },
  { name: "数组加 & 传入 scanf", want: ["多写了 &"],
    code: H + 'int main(){ char s[20]; scanf("%s", &s); printf("%s", s); return 0; }' },
  { name: "gets 不安全", want: ["gets"],
    code: H + 'int main(){ char s[20]; gets(s); printf("%s", s); return 0; }' },
  { name: "变量从未赋值", want: ["从未被赋值"],
    code: H + 'int main(){ int a; printf("%d", a); return 0; }' },
  { name: "找不到 main", want: ["找不到 main"],
    code: H + 'int mian(){ printf("hi"); return 0; }' },
];

const clean = [
  { name: "while(scanf)==1 不误报", code: H + 'int main(){ int n,s=0; while(scanf("%d",&n)==1){ s+=n; } printf("%d",s); return 0; }' },
  { name: "while(scanf)!=EOF 不误报", code: H + 'int main(){ int n,s=0; while(scanf("%d",&n)!=EOF){ s+=n; } printf("%d",s); return 0; }' },
  { name: "if(a==b) 不误报", code: H + 'int main(){ int a=1,b=1; if(a==b) printf("eq"); return 0; }' },
  { name: "if(a!=b) 不误报", code: H + 'int main(){ int a=1,b=2; if(a!=b) printf("ne"); return 0; }' },
  { name: "正常 printf 不误报", code: H + 'int main(){ int a=5; double d=1.5; printf("%d %.2f\\n", a, d); return 0; }' },
  { name: "long long 配 %lld 不误报", code: H + 'int main(){ long long s=5; printf("%lld", s); return 0; }' },
  { name: "scanf %lf 读 double 不误报", code: H + 'int main(){ double d; scanf("%lf", &d); printf("%f", d); return 0; }' },
  { name: "数组名传 scanf 不误报", code: H + '#include <string.h>\nint main(){ char s[64]; scanf("%s", s); printf("%d", strlen(s)); return 0; }' },
  { name: "结构体成员取地址不误报", code: H + 'struct P{ char n[20]; int v; };\nint main(){ struct P p; scanf("%s %d", p.n, &p.v); printf("%s %d", p.n, p.v); return 0; }' },
  { name: "多次使用不算未赋值", code: H + 'int main(){ int i; for(i=0;i<3;i++) printf("%d", i); return 0; }' },
];

let badOk = 0;
console.log("=== 应当报错 / 警告（漏报检查）===");
for (const c of bad) {
  const r = A.analyze(c.code);
  const titles = r.findings.map(f => f.title).join(" | ");
  const hit = c.want.every(w => titles.indexOf(w) >= 0);
  if (hit) badOk++;
  console.log((hit ? "命中 " : "漏报 ") + c.name.padEnd(20) + (hit ? "" : " -> 实际: " + (titles || "（无任何提示）")));
}

let cleanOk = 0;
console.log("\n=== 应当无提示（误报检查）===");
for (const c of clean) {
  const r = A.analyze(c.code);
  const titles = r.findings.map(f => f.severity + ":" + f.title).join(" | ");
  const ok = r.findings.length === 0;
  if (ok) cleanOk++;
  console.log((ok ? "干净 " : "误报 ") + c.name.padEnd(24) + (ok ? "" : " -> " + titles));
}
console.log("\n命中 " + badOk + "/" + bad.length + "，无误报 " + cleanOk + "/" + clean.length);