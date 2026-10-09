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
    focus() {}, select() {}, setSelectionRange() {}, scrollIntoView() {}
  };
}
const store = {};
ids.forEach(id => { store[id] = El(id); });

const document = {
  readyState: "complete",
  getElementById: (id) => store[id] || (store[id] = El(id)),
  addEventListener() {},
  querySelectorAll() { return []; },
  createElement: () => El("tmp"),
  execCommand: () => true,
  body: { appendChild() {}, removeChild() {} }
};

const alerts = [];
const sandbox = {
  console,
  document,
  setTimeout: (fn) => { timers.push(fn); return timers.length; },
  clearTimeout: () => {},
  getComputedStyle: () => ({ lineHeight: "22px" }),
  confirm: () => true,
  alert: (m) => { alerts.push(String(m)); }
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

console.log("=== 题目 / 提交反馈面板 ===");
check("题目框与批改反馈框已加入页面", store["problem-text"] !== undefined && store["pta-feedback"] !== undefined);
store["problem-text"].value = "7-1 两个数的和";
store["pta-feedback"].value = "测试点 2：答案错误";
check("两个框可以正常写入", store["problem-text"].value.indexOf("两个数的和") >= 0 && store["pta-feedback"].value.indexOf("答案错误") >= 0);
check("新面板使用灰粉色主题", /class="panel subject"/.test(html));

console.log("=== 答案与解析 / 练习（提示词生成） ===");
check("答案与解析按钮已加入", html.indexOf("btn-answer") >= 0);
check("练习模块已加入", html.indexOf('class="panel practice"') >= 0 && html.indexOf("btn-practice") >= 0);
check("提示词脚本已引入", html.indexOf("assets/js/prompt.js") >= 0);

alerts.length = 0;
store["problem-text"].value = "";
store["btn-answer"].dispatch("click");
check("题目为空时先提醒粘贴题目", alerts.length > 0 && /题目/.test(alerts[0]), "alerts=" + alerts.length);

store["problem-text"].value = "7-1 两数求和\n输入 a 和 b，输出 a + b。";
store.code.value = '#include <stdio.h>\nint main(){ int a; scanf("%d", a); return 0; }';
store.code.dispatch("input");
flush();
store["btn-answer"].dispatch("click");
check("答案面板出现", !store["panel-ai"].classList.contains("hidden"));
check("提示词含题目原文", store["prompt-out"].value.indexOf("两数求和") >= 0);
check("提示词要求逐行注释", /每一行末尾/.test(store["prompt-out"].value));
check("提示词要求列出易错点", /容易出错的地方/.test(store["prompt-out"].value));
check("提示词带上自动检查出的错误点", /scanf/.test(store["prompt-out"].value), store["prompt-out"].value.slice(0, 120));
check("提示词带上 PTA 批改提示", store["prompt-out"].value.indexOf("答案错误") >= 0);

store["practice-count"].value = "3";
store["chk-practice-answer"].checked = false;
store["btn-practice"].dispatch("click");
check("练习提示词含出题数量", store["prompt-out"].value.indexOf("3 道") >= 0);
check("练习提示词要求先不给答案", /不要给答案/.test(store["prompt-out"].value));
check("练习提示词要求同题型换数据", /题型相同/.test(store["prompt-out"].value));
check("练习提示词带上错误点", /我在这道题上犯过的错误|PTA 提交后的批改提示/.test(store["prompt-out"].value));

console.log("=== 练习出题数量：1-3 道自选 ===");
const countOpts = [...html.matchAll(/<option value="(\d)"[^>]*>\d 题<\/option>/g)].map((m) => m[1]);
check("出题数量只有 1 / 2 / 3 三档", countOpts.join(",") === "1,2,3", countOpts.join(","));
check("默认选中 3 题", /<option value="3" selected>3 题<\/option>/.test(html));
check("练习提示词把数量写进要求", /仿照出 3 道/.test(store["prompt-out"].value));

console.log("=== 不内置任何 AI 接入（页面不产生任何服务端费用） ===");
check("AI 下拉里没有“本地 AI / Ollama”选项", !/value="local"/.test(html));
check("页面没有本机 AI 地址 / 模型输入框", !/ai-endpoint|ai-model|11434/.test(html));
check("页面不引用任何 AI 客户端脚本", !/localai\.js/.test(html));
check("页面没有“AI 回答”展示区（结果只由用户自己的 AI 给出）", !/ai-answer/.test(html));
store["ai-target"].value = "chatgpt";
store["problem-text"].value = "7-1 两数求和\n输入 a 和 b，输出 a + b。";
store["btn-answer"].dispatch("click");
check("“答案与解析”只拼提示词并提示去自己的 AI 粘贴", /Ctrl \+ V/.test(store["ai-status"].textContent), store["ai-status"].textContent);

console.log("=== 布局回归：错误列表不能盖住下方面板 ===");
const css = readFileSync(path.join(root, "assets/css/styles.css"), "utf8");
check("检查结果面板不再吸附（sticky 会盖住紧随其后的面板）", html.indexOf("panel sticky") < 0, "index.html 里仍存在 panel sticky");
check("样式里不再给结果面板设 sticky", !/\.panel\.sticky\s*\{/.test(css));
check("错误列表有最大高度，长列表只在自己框内滚动", /\.findings\s*\{[^}]*max-height/.test(css));
check("题目/反馈面板紧跟在检查结果面板之后（同级）", /id="findings"[\s\S]{0,1200}?id="problem-text"/.test(html));

console.log("\n集成测试：" + ok + " 通过 / " + (ok + bad) + " 项");
if (bad) process.exitCode = 1;
