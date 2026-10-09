import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = { console };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(path.join(root, "assets/js/analyzer.js"), "utf8"), sandbox, { filename: "analyzer.js" });
const A = sandbox.PTAAnalyzer;

const H = '#include <stdio.h>\n';
const good = {
  "两数之和": H + 'int main(){ int a,b; scanf("%d %d",&a,&b); printf("%d\\n", a+b); return 0; }',
  "圆面积": H + 'int main(){ double r; scanf("%lf",&r); printf("%.2f\\n", 3.14159*r*r); return 0; }',
  "EOF 求和": H + 'int main(){ int n,s=0; while(scanf("%d",&n)!=EOF){ s+=n; } printf("%d\\n", s); return 0; }',
  "数组输入输出": H + 'int main(){ int n,i,a[100]; scanf("%d",&n); for(i=0;i<n;i++) scanf("%d",&a[i]); for(i=0;i<n;i++){ if(i>0) printf(" "); printf("%d", a[i]); } printf("\\n"); return 0; }',
  "字符串反转": H + '#include <string.h>\nint main(){ char s[100]; char t; int i,n; scanf("%s",s); n=strlen(s); for(i=0;i<n/2;i++){ t=s[i]; s[i]=s[n-1-i]; s[n-1-i]=t; } printf("%s\\n", s); return 0; }',
  "平均分(double)": H + 'int main(){ int n,i,x,s=0; scanf("%d",&n); for(i=0;i<n;i++){ scanf("%d",&x); s+=x; } printf("%.1f\\n", (double)s/n); return 0; }',
  "整数除法(有意)": H + 'int main(){ int a=7,b=2; printf("%d\\n", a/b); return 0; }',
  "long long 求和": H + 'int main(){ int n,i; long long s=0,x; scanf("%d",&n); for(i=0;i<n;i++){ scanf("%lld",&x); s+=x; } printf("%lld\\n", s); return 0; }',
  "浮点比较(差值法)": H + '#include <math.h>\nint main(){ double a=0.1,b=0.2; if(fabs(a+b-0.3)<1e-6) printf("ok\\n"); return 0; }',
  "switch 判断": H + 'int main(){ int n; scanf("%d",&n); switch(n){ case 1: printf("one\\n"); break; default: printf("other\\n"); } return 0; }',
  "二维数组": H + 'int main(){ int a[3][3],i,j; for(i=0;i<3;i++) for(j=0;j<3;j++) scanf("%d",&a[i][j]); printf("%d\\n", a[1][1]); return 0; }',
  "取模运算": H + 'int main(){ int n; scanf("%d",&n); if(n%2==0) printf("even\\n"); else printf("odd\\n"); return 0; }',
  "结构体": H + '#include <stdio.h>\nstruct Stu { char name[20]; int score; };\nint main(){ struct Stu s; scanf("%s %d", s.name, &s.score); printf("%s %d\\n", s.name, s.score); return 0; }',
  "字符统计": H + '#include <ctype.h>\nint main(){ int c,n=0; while((c=getchar())!=EOF){ if(isalpha(c)) n++; } printf("%d\\n", n); return 0; }',
  "指针传参交换": H + 'void swap(int *a,int *b){ int t=*a; *a=*b; *b=t; }\nint main(){ int x=1,y=2; swap(&x,&y); printf("%d %d\\n", x, y); return 0; }',
  "累乘阶乘": H + 'int main(){ int n,i; long long f=1; scanf("%d",&n); for(i=1;i<=n;i++) f*=i; printf("%lld\\n", f); return 0; }',
};

let clean = 0, dirty = 0;
for (const [name, code] of Object.entries(good)) {
  const r = A.analyze(code);
  const errs = r.findings.filter(f => f.severity === "error");
  const warns = r.findings.filter(f => f.severity === "warning");
  const infos = r.findings.filter(f => f.severity === "info");
  if (r.findings.length === 0) { clean++; console.log("干净  " + name); }
  else {
    dirty++;
    console.log("误报? " + name + "  [错误" + errs.length + " 警告" + warns.length + " 提示" + infos.length + "]");
    for (const f of r.findings) console.log("        " + f.severity + " 第" + f.line + "行: " + f.title);
  }
}
console.log("\n无任何提示: " + clean + " / " + (clean + dirty));