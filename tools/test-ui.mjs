import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---- 极简 DOM 桩：够跑通 app.js 的初始化、检查与运行流程 ---- */
const html = readFileSync(path.join(root, "index.html"), "utf8");
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);

const timers = [];
function El(id) {
  return {
    id, tagName: "DIV",
    value: "", innerHTML: "", textContent: "",
    className: "", checked: false, disabled: false, scrollTop: 0,
    style: {}, _handlers: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c) { if (this._s.has(c)) { this._s.delete(c); return false; } this._s.add(c); return true; }
    },
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    dispatch(type, ev) { (this._handlers[type] || []).forEach(fn => fn(ev || {})); },
    querySelectorAll() { return []; },
    getAttribute() { return null; }, setAttribute() {},
    focus() {}, setSelectionRange() {}, scrollIntoView() {}
  };
}
const store = {};
ids.forEach(id => { store[id] = El(id); });

const document = {
  readyState: "complete",
  getElementById: (id) => store[id] || (store[id] = El(id)),
  addEventListener() {},
  querySelectorAll() { return []; },
  createElement: () => El("tmp")
};

const sandbox = {
  console,
  document,
  setTimeout: (fn) => { timers.push(fn); return timers.length; },
  clearTimeout: () => {},
  getComputedStyle: () => ({ lineHeight: "22px" }),
  confirm: () => true,
  alert: () => {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ["assets/vendor/jscpp.js", "assets/js/analyzer.js", "assets/js/runner.js", "assets/js/problems.js", "assets/js/prompt.js", "assets/js/app.js"]) {
  vm.runInContext(readFileSync(path.join(root, f), "utf8"), sandbox, { filename: f });
}
function flush() { while (timers.length) timers.shift()(); }

let ok = 0, bad = 0;
function check(label, cond, extra) {
  if (cond) { ok++; console.log("通过 " + label); }
  else { bad++; console.log("失败 " + label + (extra ? "  -> " + extra : "")); }
}

console.log("=== 初始化 ===");
check("初始代码已填入", store.code.value.length > 0);
check("题目下拉框已填充", store["problem-select"].innerHTML.indexOf("两数求和") >= 0);
check("初始检查无错误", /没有发现问题/.test(store.summary.innerHTML), store.summary.innerHTML.slice(0, 80));

console.log("=== 有错误的代码 ===");
store.code.value = '#include <stdio.h>\nint main(){ int a; scanf("%d", a); double x=1.0/3; printf("%d %f", x, a); return 0 }';
store.code.dispatch("input");
flush();
const findingsHtml = store.findings.innerHTML;
check("检查结果里有「少了 &」", findingsHtml.indexOf("少了 &amp;") >= 0 || findingsHtml.indexOf("少了 &") >= 0, findingsHtml.slice(0, 120));
check("检查结果里有「输出浮点变量」", findingsHtml.indexOf("输出浮点变量") >= 0);
check("汇总显示错误数量", /个错误/.test(store.summary.innerHTML), store.summary.innerHTML.slice(0, 100));
check("行号标记已生成", store.gutterInner.innerHTML.indexOf("gline-") >= 0);

console.log("=== 正确代码 + 运行对比 ===");
store.code.value = '#include <stdio.h>\nint main(){ int a,b; scanf("%d %d",&a,&b); printf("%d\\n", a+b); return 0; }';
store.code.dispatch("input");
flush();
check("正确代码静态检查干净", /没有发现问题/.test(store.summary.innerHTML), store.summary.innerHTML.slice(0, 100));

store.stdin.value = "3 4\n";
store.expected.value = "7\n";
store["btn-run"].dispatch("click");
flush();
check("运行状态为成功", /正常运行结束/.test(store["run-status"].textContent), store["run-status"].textContent);
check("程序输出为 7", /<pre class="stdout">7/.test(store["run-body"].innerHTML), store["run-body"].innerHTML.slice(0, 160));
check("判定输出一致", /输出与期望完全一致/.test(store["run-body"].innerHTML));

console.log("=== 输出不一致的情况 ===");
store.expected.value = "8\n";
store["btn-run"].dispatch("click");
flush();
check("判定输出不一致", /输出与期望不一致/.test(store["run-body"].innerHTML));
check("逐行对比表已渲染", /d-row/.test(store["run-body"].innerHTML));

console.log("=== 运行期错误（漏 & ）===");
store.code.value = '#include <stdio.h>\nint main(){ int n; scanf("%d", n); printf("%d", n); return 0; }';
store.stdin.value = "5\n";
store.expected.value = "5";
store["btn-run"].dispatch("click");
flush();
check("运行报错被翻译成中文", /scanf 的参数要写变量地址/.test(store["run-body"].innerHTML), store["run-body"].innerHTML.slice(0, 200));

console.log("=== 语法错误 ===");
store.code.value = '#include <stdio.h>\nint main(){ int a = 1\nprintf("%d", a); return 0; }';
store.code.dispatch("input");
flush();
store["btn-run"].dispatch("click");
flush();
check("语法错误提示含行号", /第 3 行/.test(store["run-body"].innerHTML) || /第 2 行/.test(store["run-body"].innerHTML), store["run-body"].innerHTML.slice(0, 240));

console.log("=== 题目 / 提交反馈 / 提示词 ===");
check("题目框与批改反馈框已加入页面", store["problem-text"] !== undefined && store["pta-feedback"] !== undefined);
store.code.value = '#include <stdio.h>\nint main(){ int a,b; scanf("%d %d",&a,&b); printf("%d", a+b); return 0; }';
store.code.dispatch("input");
flush();
store["problem-text"].value = "7-1 两个数的和\n输入两个整数，输出它们的和。";
store["pta-feedback"].value = "测试点 2：答案错误";
store.stdin.value = "3 4\n";
store.expected.value = "7\n";
const prompt = sandbox.PTAPrompt.build({
  code: store.code.value,
  problem: store["problem-text"].value,
  feedback: store["pta-feedback"].value,
  stdin: store.stdin.value,
  expected: store.expected.value,
  findings: sandbox.PTAAnalyzer.analyze(store.code.value).findings,
  run: { summary: "输出与题目要求的输出不一致，第一个不同的地方在第 2 行。", stdout: "7\n" }
});
check("提示词含题目原文", prompt.indexOf("两个数的和") >= 0);
check("提示词含 PTA 批改提示", prompt.indexOf("测试点 2：答案错误") >= 0);
check("提示词含代码块", prompt.indexOf("```c") >= 0 && prompt.indexOf("scanf") >= 0);
check("提示词含样例输入与期望输出", prompt.indexOf("3 4") >= 0 && prompt.indexOf("【题目要求的输出】") >= 0);
check("提示词含运行小结", prompt.indexOf("第一个不同的地方在第 2 行") >= 0);
const badFindings = sandbox.PTAAnalyzer.analyze('#include <stdio.h>\nint main(){ int a; scanf("%d", a); return 0; }').findings;
check("提示词会带上静态检查结论", /本机静态检查工具列出的可疑点/.test(sandbox.PTAPrompt.build({ code: "x", findings: badFindings })) && badFindings.length > 0);
check("题目为空时给出占位提示", sandbox.PTAPrompt.build({ code: "int main(){}" }).indexOf("（未填写") >= 0);
store["btn-copy-prompt"].dispatch("click");
check("点「复制提示词」不会崩", typeof store["copy-status"].textContent === "string" && store["copy-status"].textContent.length > 0, store["copy-status"].textContent);

console.log("\n集成测试：" + ok + " 通过 / " + (ok + bad) + " 项");
if (bad) process.exitCode = 1;
