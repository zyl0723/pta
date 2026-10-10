import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---- 极简 DOM 桩：够跑通 app.js 的初始化、检查与运行流程 ---- */
const html = readFileSync(path.join(root, "index.html"), "utf8");
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);

const timers = [];
/* 把 HTML 里每个 id 元素原本的 class 抄下来，桩才能反映“一开始是隐藏还是显示” */
const classById = {};
for (const m of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
  const cls = /\bclass="([^"]*)"/.exec(m[0]);
  if (cls) classById[m[1]] = cls[1].split(/\s+/).filter(Boolean);
}
function El(id) {
  return {
    id, tagName: "DIV",
    value: "", innerHTML: "", textContent: "",
    className: "", checked: false, disabled: false, scrollTop: 0,
    style: {}, _handlers: {},
    classList: {
      _s: new Set(classById[id] || []),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c) { if (this._s.has(c)) { this._s.delete(c); return false; } this._s.add(c); return true; }
    },
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    dispatch(type, ev) { (this._handlers[type] || []).forEach(fn => fn(ev || {})); },
    appendChild() {}, removeChild() {},
    querySelectorAll() { return []; },
    getAttribute() { return null; }, setAttribute() {},
    focus() {}, select() {}, setSelectionRange() {}, scrollIntoView() {}
  };
}
const store = {};
ids.forEach(id => { store[id] = El(id); });

/* body 的 class 也记下来，用来检查「网站使用提示」的收起状态 */
const bodyClass = new Set();
/* document 上的键盘事件也要能触发，用来验证 Esc 退出全屏 */
const docHandlers = {};

const document = {
  readyState: "complete",
  getElementById: (id) => store[id] || (store[id] = El(id)),
  addEventListener(type, fn) { (docHandlers[type] = docHandlers[type] || []).push(fn); },
  removeEventListener(type, fn) { docHandlers[type] = (docHandlers[type] || []).filter((h) => h !== fn); },
  dispatch(type, ev) { (docHandlers[type] || []).slice().forEach((fn) => fn(ev || {})); },
  head: { appendChild(el) { if (el && typeof el.onload === "function") el.onload(); } },
  querySelectorAll() { return []; },
  createElement: () => El("tmp"),
  execCommand: () => true,
  body: {
    appendChild() {}, removeChild() {},
    classList: {
      add(c) { bodyClass.add(c); },
      remove(c) { bodyClass.delete(c); },
      contains(c) { return bodyClass.has(c); },
      toggle(c) { if (bodyClass.has(c)) { bodyClass.delete(c); return false; } bodyClass.add(c); return true; }
    }
  }
};

const alerts = [];
const sandbox = {
  console,
  document,
  crypto: webcrypto,
  TextEncoder,
  setTimeout: (fn) => { timers.push(fn); return timers.length; },
  clearTimeout: () => {},
  getComputedStyle: () => ({ lineHeight: "22px" }),
  confirm: () => true,
  alert: (m) => { alerts.push(String(m)); }
};
const lsData = new Map();
sandbox.localStorage = {
  getItem: (k) => (lsData.has(k) ? lsData.get(k) : null),
  setItem: (k, v) => { lsData.set(k, String(v)); },
  removeItem: (k) => { lsData.delete(k); }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ["assets/vendor/jscpp.js", "assets/js/analyzer.js", "assets/js/runner.js", "assets/js/problems.js", "assets/js/prompt.js", "assets/js/aiclient.js", "assets/js/app.js"]) {
  vm.runInContext(readFileSync(path.join(root, f), "utf8"), sandbox, { filename: f });
}
function flush() { while (timers.length) timers.shift()(); }
async function waitFor(fn, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return fn();
}

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
check("有错误时先不让跑，并指出问题", /先别跑/.test(store["run-status"].textContent) && /第 2 行/.test(store["run-body"].innerHTML), store["run-status"].textContent);
store["btn-run"].dispatch("click");
flush();
check("运行报错被翻译成中文", /scanf 的参数要写变量地址/.test(store["run-body"].innerHTML), store["run-body"].innerHTML.slice(0, 200));

console.log("=== 语法错误 ===");
store.code.value = '#include <stdio.h>\nint main(){ int a = 1\nprintf("%d", a); return 0; }';
store.code.dispatch("input");
flush();
store["btn-run"].dispatch("click");
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
check("「应用修改」有翻译按钮与括号提示", /id="btn-translate"/.test(html) && /翻译成中文/.test(html) && /新手不了解系统报错/.test(html));
check("练习与 API 模块已挪到左栏", /class="col col-left"[\s\S]*?class="panel practice"[\s\S]*?id="panel-api"[\s\S]*?<\/section>[\s\S]*?class="col col-right"/.test(html));

console.log("=== 免登录：页面不再有账号系统 ===");
check("页面里没有登录 / 注册弹窗", !/id="auth"/.test(html) && !/id="tab-register"/.test(html));
check("顶栏没有登录 / 退出按钮和账号位", !/id="btn-account"/.test(html) && !/id="btn-logout"/.test(html) && !/id="account-label"/.test(html));
check("不再引入 account.js", !/assets\/js\/account\.js/.test(html));

store["problem-text"].value = "7-1 两数求和\n输入 a 和 b，输出 a + b。";
store["prompt-out"].value = "";
store["btn-answer"].dispatch("click");
check("不登录也能直接生成「答案与解析」提示词", store["prompt-out"].value.indexOf("两数求和") >= 0);

console.log("=== 安全加固：CSP 与清除密钥 ===");
check("页面声明了 Content-Security-Policy", /http-equiv="Content-Security-Policy"/.test(html));
check("CSP 禁止外部脚本源、禁止被 iframe 嵌套", /script-src 'self'/.test(html) && /default-src 'none'/.test(html) && /frame-ancestors 'none'/.test(html));
check("CSP 仍允许自带 API Key 直连服务商", /connect-src \*/.test(html));
check("「API」模块有清除本机保存密钥的按钮", /id="btn-ai-forget"/.test(html));

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
check("提示词要求注释单独占一行写在代码下一行", /下一行/.test(store["prompt-out"].value) && /不要把 \/\/ 注释跟在代码同一行末尾/.test(store["prompt-out"].value));
check("提示词要求列出易错点", /容易出错的地方/.test(store["prompt-out"].value));
check("提示词要求严格按三段标题输出", /第 1 部分/.test(store["prompt-out"].value) && /第 2 部分/.test(store["prompt-out"].value) && /第 3 部分/.test(store["prompt-out"].value));
check("默认难度是「简单」：说清读者是新手、目标最好懂", /答案难度：简单/.test(store["prompt-out"].value) && /刚学编程的新手/.test(store["prompt-out"].value) && /一眼能看懂/.test(store["prompt-out"].value));
check("「简单」明确不要花哨写法", /不要用任何技巧/.test(store["prompt-out"].value) && /位运算 \/ 宏 \/ 递归/.test(store["prompt-out"].value) && /列表推导式 \/ lambda/.test(store["prompt-out"].value));
check("提示词要求变量名一看就懂", /变量名用 a、b、n、i、sum/.test(store["prompt-out"].value));
check("提示词带上自动检查出的错误点", /scanf/.test(store["prompt-out"].value), store["prompt-out"].value.slice(0, 120));
check("提示词带上 PTA 批改提示", store["prompt-out"].value.indexOf("答案错误") >= 0);

console.log("=== 翻译报错（把 PTA 的提示翻成大白话） ===");
alerts.length = 0;
store["pta-feedback"].value = "";
store["btn-translate"].dispatch("click");
check("反馈为空时点翻译会先提醒粘提示", alerts.length > 0 && /批改提示/.test(alerts[0]), "alerts=" + alerts.length);

store["pta-feedback"].value = "测试点 3　段错误（Segmentation Fault）";
store["prompt-out"].value = "";
store["btn-translate"].dispatch("click");
check("点翻译会拼出翻译提示词", /翻译/.test(store["prompt-out"].value) && store["prompt-out"].value.indexOf("段错误") >= 0);
check("翻译提示词要求点出哪里错、第几行、怎么改", /哪里错/.test(store["prompt-out"].value) && /第几行/.test(store["prompt-out"].value));
check("翻译提示词把术语要求解释成大白话", /大白话/.test(store["prompt-out"].value));
check("翻译后答案面板出现", !store["panel-ai"].classList.contains("hidden"));

store["pta-feedback"].value = "测试点 2：答案错误";

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

console.log("=== 不自带 AI 服务：地址和密钥都由使用者自己填 ===");
check("没有「本地 AI / Ollama」这类站点自带服务", !/value="local"/.test(html) && !/11434/.test(html));
check("页面里没有任何内置密钥", !/sk-[A-Za-z0-9_-]{12,}/.test(html));
check("API 地址由使用者填写，页面不写死服务地址", /id="ai-base"/.test(html) && !/value="https:\/\/api\./.test(html));
check("密钥输入框不显示明文", /id="ai-key"[^>]*type="password"/.test(html));
store["problem-text"].value = "7-1 两数求和\n输入 a 和 b，输出 a + b。";
store["btn-answer"].dispatch("click");
check("“答案与解析”会拼好提示词并说明两种用法", /在本站生成/.test(store["ai-status"].textContent), store["ai-status"].textContent);

console.log("=== 「API」模块（地址 / 密钥 / 模型） ===");
check("题目那边不再有选 AI 网站的下拉", !/id="ai-target"/.test(html) && !/chatgpt\.com/.test(html));
check("多出一个独立的「API」模块", /id="panel-api"/.test(html) && /<h2>API<\/h2>/.test(html));
check("模块里有服务商 / 地址 / 密钥 / 模型四个输入", /id="ai-preset"/.test(html) && /id="ai-base"/.test(html) && /id="ai-key"/.test(html) && /id="ai-model"/.test(html));
check("模块下方有「获取api」链接指向 DeepSeek 官网", /href="https:\/\/platform\.deepseek\.com\/api_keys"/.test(html) && />获取api<\/a>/.test(html));
check("密钥默认不写进本机存储", lsData.get("pta-ai-key") === undefined);
store["ai-preset"].value = "deepseek";
store["ai-preset"].dispatch("change");
check("选预设后自动填好地址", store["ai-base"].value === "https://api.deepseek.com/v1", store["ai-base"].value);
check("选预设后自动填好模型", store["ai-model"].value === "deepseek-chat", store["ai-model"].value);

store["ai-key"].value = "";
store["btn-ai-save"].dispatch("click");
check("没填密钥会提醒", /API Key/.test(store["ai-status"].textContent), store["ai-status"].textContent);

store["ai-key"].value = "sk-test-1234567890";
store["chk-ai-remember"].checked = false;
store["btn-ai-save"].dispatch("click");
check("保存后提示将要请求的地址", /chat\/completions/.test(store["ai-status"].textContent), store["ai-status"].textContent);
check("不勾「记住密钥」就不写进本机", lsData.get("pta-ai-key") === undefined);
check("地址与模型会被记住", /deepseek/.test(String(lsData.get("pta-ai-config"))));

store["chk-ai-remember"].checked = true;
store["btn-ai-save"].dispatch("click");
check("勾了「记住密钥」才把密钥写进本机", lsData.get("pta-ai-key") === "sk-test-1234567890");

store["prompt-out"].value = "";
store["btn-ai-run"].dispatch("click");
check("没准备提示词时提示先生成", /先生成|先点上面/.test(store["ai-status"].textContent), store["ai-status"].textContent);

console.log("=== 一键清除本机保存的 API 信息 ===");
check("清除前密钥确实存在本机", lsData.get("pta-ai-key") === "sk-test-1234567890" && !!lsData.get("pta-ai-config"));
store["btn-ai-forget"].dispatch("click");
check("点「清除」后本机不再有密钥与配置", lsData.get("pta-ai-key") === undefined && lsData.get("pta-ai-config") === undefined);
check("点「清除」后输入框也清空", store["ai-key"].value === "" && store["ai-model"].value === "" && store["ai-base"].value === "");
check("点「清除」有明确提示", /已清除/.test(store["ai-status"].textContent), store["ai-status"].textContent);

console.log("=== 生成结果放在单独的模组框里（答案在右、练习在左） ===");
check("右侧有独立的「答案与解析」框和复制按钮", /id="panel-answer"/.test(html) && /id="answer-body"/.test(html) && /id="btn-copy-answer"/.test(html));
check("左侧有独立的「生成的练习题」框和复制按钮", /id="panel-practice-out"/.test(html) && /id="practice-body"/.test(html) && /id="btn-copy-practice"/.test(html));
check("答案框在右栏、练习结果框在左栏", /class="col col-right"[\s\S]*?id="panel-answer"[\s\S]*?<\/section>/.test(html) && /class="col col-left"[\s\S]*?id="panel-practice-out"[\s\S]*?id="panel-api"/.test(html));
check("生成答案时右侧答案框的标题正确", /id="answer-title"/.test(html));

store["ai-preset"].value = "deepseek";
store["ai-preset"].dispatch("change");
store["ai-key"].value = "sk-test-1234567890";
store["chk-ai-remember"].checked = true;
store["btn-ai-save"].dispatch("click");

const realChat = sandbox.PTAAI.chat;
sandbox.PTAAI.chat = function (opts) {
  opts.onDelta("d", "AI 写出来的正文内容");
  opts.onDone();
  return { cancel: function () {} };
};

store["problem-text"].value = "7-1 两数求和\n输入 a 和 b，输出 a + b。";
store["answer-body"].value = "";
store["btn-answer"].dispatch("click");
check("点「生成答案与解析」后答案框标题带上语言与难度", store["answer-title"].textContent === "答案与解析（C 语言 · 简单）", store["answer-title"].textContent);
store["btn-ai-run"].dispatch("click");
check("AI 的答案写进右侧单独的答案框", store["answer-body"].value.indexOf("AI 写出来的正文内容") >= 0 && !store["panel-answer"].classList.contains("hidden"));

store["btn-practice"].dispatch("click");
store["btn-ai-run"].dispatch("click");
check("AI 出的练习题写进左侧单独的练习题框", store["practice-body"].value.indexOf("AI 写出来的正文内容") >= 0 && !store["panel-practice-out"].classList.contains("hidden"));

console.log("=== 二次检查：拿生成的答案重查代码，结果覆盖检查结果 ===");
check("「你的代码」面板有二次检查按钮", /id="btn-recheck"/.test(html));
check("「你的代码」面板顶部写明两种检查的区别", /两种检查怎么选/.test(html) && /每次改完代码都要再点一次/.test(html));
check("检查结果面板里有二次检查的输出位", /id="recheck-out"/.test(html));

alerts.length = 0;
store["problem-text"].value = "";
store["answer-body"].value = "";
store["btn-recheck"].dispatch("click");
check("没填题目时二次检查先提醒填题目", alerts.length > 0 && /题目/.test(alerts[0]), JSON.stringify(alerts));

store["problem-text"].value = "7-1 两数求和\n输入 a 和 b，输出 a + b。";
store["btn-recheck"].dispatch("click");
check("有题目但没答案时提醒先生成答案", alerts.length > 1 && /答案/.test(alerts[1]), JSON.stringify(alerts));
check("提醒后会把答案框显示出来", !store["panel-answer"].classList.contains("hidden"));

store["answer-body"].value = "标准答案：scanf(\"%d %d\", &a, &b); printf(\"%d\", a + b);";
store["prompt-out"].value = "";
sandbox.PTAAI.chat = function (opts) { opts.onDelta("d", "第 3 行：变量 b 没有读入。\n第 9 行：输出格式不对。"); opts.onDone(); return { cancel: function () {} }; };
store["btn-recheck"].dispatch("click");
check("有题目和答案后拼出的二次检查提示词已发出", /第 3 行/.test(store["recheck-out"].textContent), store["recheck-out"].textContent.slice(0, 60));
check("二次检查结果覆盖了原来的检查列表", !store["recheck-out"].classList.contains("hidden") && store["findings"].innerHTML === "");
check("总结区标明这是 AI 的二次检查结果", /AI/.test(store["summary"].innerHTML), store["summary"].innerHTML.slice(0, 80));
check("二次检查提示词要求对照答案逐行检查", /对照/.test(store["prompt-out"].value) && /标准答案/.test(store["prompt-out"].value));

store.code.value = '#include <stdio.h>\nint main(){ return 0; }';
store.code.dispatch("input");
check("改了代码不会自动重查，只提示再点一次", /再点一次/.test(store["summary"].innerHTML) && /第 3 行/.test(store["recheck-out"].textContent));

store["btn-check"].dispatch("click");
check("点「立即检查」回到本地静态检查", store["recheck-out"].classList.contains("hidden") && store["findings"].innerHTML.length > 0);

sandbox.PTAAI.chat = realChat;

console.log("=== 进站提示弹窗 ===");
const css = readFileSync(path.join(root, "assets/css/styles.css"), "utf8");
check("进站时默认弹出提示", !store["welcome"].classList.contains("hidden"));
check("弹窗有标题与「不再提示」勾选框", /id="welcome-title"/.test(html) && /id="chk-welcome-mute"/.test(html));
check("弹窗有右上角关闭按钮", /id="btn-welcome-x"/.test(html));
check("弹窗背景是粉色系、和页面同族", /\.welcome\s*\{[^}]*rgba\(150, 96, 120/.test(css) && /\.welcome-card\s*\{[^}]*#fdf7f9/.test(css));
check("「获取api」链接是蓝色小字", /\.api-link\s*\{[^}]*color:\s*#2563eb[^}]*font-size:\s*11\.5px/.test(css));
check("弹窗说明「不接 AI 也能用」", /不接 AI 也能用/.test(html));
check("弹窗说明「只检查已经写好的代码」", /只检查你已经写好的代码/.test(html));
check("弹窗说明想更聪明要自己有 AI 账号", /得你自己有 AI/.test(html) && /你自己账号/.test(html));
check("弹窗末尾小字说明来由", /嫌反复拍照问 AI 太麻烦/.test(html) && /welcome-foot/.test(html));

store["btn-welcome-x"].dispatch("click");
check("点右上角叉叉可以关掉", store["welcome"].classList.contains("hidden"));
check("没勾「不再提示」时不写本机记录", lsData.get("pta-welcome-mute") === undefined);

store["welcome"].classList.remove("hidden");
store["chk-welcome-mute"].checked = true;
store["btn-welcome-ok"].dispatch("click");
check("勾「不再提示」后关掉会记在本机", lsData.get("pta-welcome-mute") === "1");

for (const el of Object.values(store)) { el.classList._s.clear(); el._handlers = {}; }
vm.runInContext(readFileSync(path.join(root, "assets/js/app.js"), "utf8"), sandbox, { filename: "app.js" });
flush();
check("勾过之后再次进站不再弹出", store["welcome"].classList.contains("hidden"));

console.log("=== 网站使用提示：一键收起各模块的说明 ===");
check("「你的代码」右上角多了「网站使用提示」按钮", /id="btn-hints"/.test(html) && /网站使用提示/.test(html));
check("按钮排在「载入示例」左边", html.indexOf("btn-hints") < html.indexOf("btn-sample"));
check("样式里定义了收起说明的规则", /body\.hints-off \.panel \.field-note/.test(css) && /body\.hints-off \.panel \.ai-hint/.test(css) && /body\.hints-off \.panel \.toolbar-tip/.test(css) && /body\.hints-off \.panel \.ans-tip/.test(css) && /body\.hints-off \.panel \.ans-sub/.test(css));
check("功能提醒「没按三段输出」不跟着一起收", /body\.hints-off #answer-parse-hint\s*\{[^}]*display:\s*block/.test(css));

check("默认是显示说明的", !bodyClass.has("hints-off") && store["btn-hints"].textContent === "网站使用提示", store["btn-hints"].textContent);
store["btn-hints"].dispatch("click");
check("点一下说明收起来", bodyClass.has("hints-off"));
check("按钮写明已经收起", /已收起/.test(store["btn-hints"].textContent), store["btn-hints"].textContent);
check("按下的状态会高亮", store["btn-hints"].classList.contains("on"));
check("这个选择记在本机", lsData.get("pta-hints-off") === "1");
store["btn-hints"].dispatch("click");
check("再点一下说明回来", !bodyClass.has("hints-off") && store["btn-hints"].textContent === "网站使用提示", store["btn-hints"].textContent);
check("取消后不再记在本机", lsData.get("pta-hints-off") === undefined);

store["btn-hints"].dispatch("click");
for (const el of Object.values(store)) { el.classList._s.clear(); el._handlers = {}; }
vm.runInContext(readFileSync(path.join(root, "assets/js/app.js"), "utf8"), sandbox, { filename: "app.js" });
flush();
check("重开页面还记得上次收起的状态", bodyClass.has("hints-off") && /已收起/.test(store["btn-hints"].textContent));

console.log("=== 配色：灰粉藕粉不变，但文字看得更清 ===");
const relLum = (hex) => {
  const v = parseInt(hex.slice(1), 16);
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
};
const ratio = (a, b) => { const x = relLum(a), y = relLum(b); const hi = Math.max(x, y), lo = Math.min(x, y); return (hi + 0.05) / (lo + 0.05); };
const cssVar = (name) => { const m = new RegExp("--" + name + ":\\s*(#[0-9a-fA-F]{6})").exec(css); return m ? m[1] : ""; };
const pinkish = (hex) => { const v = parseInt(hex.slice(1), 16); return ((v >> 16) & 255) > ((v >> 8) & 255) && ((v >> 16) & 255) > (v & 255); };
check("正文在面板上的对比度达到 12:1", ratio(cssVar("text"), cssVar("panel")) >= 12, ratio(cssVar("text"), cssVar("panel")).toFixed(1));
check("次要文字在面板上的对比度达到 4.5:1", ratio(cssVar("muted"), cssVar("panel")) >= 4.5, ratio(cssVar("muted"), cssVar("panel")).toFixed(1));
check("说明文字颜色够深（7:1 以上）", ratio("#5b4850", cssVar("panel")) >= 7, ratio("#5b4850", cssVar("panel")).toFixed(1));
check("主按钮上的白字看得清（4.5:1 以上）", ratio("#ffffff", cssVar("accent")) >= 4.5, ratio("#ffffff", cssVar("accent")).toFixed(1));
check("仍然是粉色系：页面底色和面板底色都是粉的", pinkish(cssVar("bg")) && pinkish(cssVar("panel")));
check("第三段的复制按钮底色加深，白字看得清", /\.ans-part-3 \.ans-btn\s*\{[^}]*background:\s*#a84a72/.test(css));
check("「获取api」链接仍是蓝色小字（保持原样）", /\.api-link\s*\{[^}]*color:\s*#2563eb[^}]*font-size:\s*11\.5px/.test(css));

console.log("=== 答案三段式显示 + 放大到全屏 ===");
check("答案框里有三段容器和三个文本区", /id="answer-parts"/.test(html) && /id="part-plain"/.test(html) && /id="part-annotated"/.test(html) && /id="part-pitfalls"/.test(html));
check("有「放大到全屏」按钮", /id="btn-answer-full"/.test(html));
check("三段各自有复制按钮", /id="btn-copy-part1"/.test(html) && /id="btn-copy-part2"/.test(html) && /id="btn-copy-part3"/.test(html));
check("原始回答仍保留，收在可展开的 details 里", /<details[^>]*id="answer-raw-wrap"/.test(html));

const bgOf = (cls) => { const m = new RegExp("." + cls + "[^}]*background:\\s*(#[0-9a-fA-F]{6})").exec(css); return m ? m[1] : ""; };
const lum = (h) => { const v = parseInt(h.slice(1), 16); return ((v >> 16) & 255) * 0.299 + ((v >> 8) & 255) * 0.587 + (v & 255) * 0.114; };
const b1 = bgOf("ans-part-1"), b2 = bgOf("ans-part-2"), b3 = bgOf("ans-part-3");
check("三段背景从淡粉到深粉逐段加深", !!b1 && !!b2 && !!b3 && lum(b1) > lum(b2) && lum(b2) > lum(b3), [b1, b2, b3].join(" > "));
check("全屏样式已定义", /\.panel\.answer-panel\.fullscreen/.test(css));

const sampleAnswer = [
  "===== 第 1 部分：纯答案代码（不加注释） =====",
  "#include <stdio.h>",
  "int main(void) { return 0; }",
  "===== 第 2 部分：带注释的代码（注释单独占一行） =====",
  "#include <stdio.h>",
  "// 引入标准输入输出头文件",
  "int main(void) { return 0; }",
  "===== 第 3 部分：容易出错的地方 =====",
  "1. 忘了写 & 就会读到乱码"
].join("\n");
store["answer-body"].value = sampleAnswer;
store["answer-body"].dispatch("input");
check("第 ① 段只放纯代码", /int main/.test(store["part-plain"].textContent) && !/\/\//.test(store["part-plain"].textContent), store["part-plain"].textContent.slice(0, 60));
check("第 ② 段是带注释的版本", /\/\/ 引入标准输入输出头文件/.test(store["part-annotated"].textContent));
check("第 ③ 段是易错点", /忘了写/.test(store["part-pitfalls"].textContent));
check("标题行不会留进正文", !/第 1 部分/.test(store["part-plain"].textContent) && !/第 3 部分/.test(store["part-pitfalls"].textContent));
check("按三段输出时不显示解析提示", store["answer-parse-hint"].classList.contains("hidden"));

store["answer-body"].value = "这是一段没有分段标题的回答。";
store["answer-body"].dispatch("input");
check("没按三段输出时给出提示并展开原始回答", !store["answer-parse-hint"].classList.contains("hidden") && /原始回答/.test(store["answer-parse-hint"].textContent) && store["answer-raw-wrap"].open === true);

store["btn-answer-full"].dispatch("click");
check("点「放大到全屏」进入全屏", store["panel-answer"].classList.contains("fullscreen"));
check("全屏后按钮变成「退出全屏」", store["btn-answer-full"].textContent === "退出全屏", store["btn-answer-full"].textContent);
store["btn-answer-full"].dispatch("click");
check("再点一次退出全屏并恢复按钮文案", !store["panel-answer"].classList.contains("fullscreen") && store["btn-answer-full"].textContent === "放大到全屏");

store["pta-feedback"].value = "测试点 3　段错误（Segmentation Fault）";
store["btn-translate"].dispatch("click");
check("翻译结果不走三段式，直接展开原始回答那一段", store["answer-parts"].classList.contains("hidden") && store["answer-raw-wrap"].open === true);

console.log("=== 「你的代码」放大到全屏：整屏写代码，运行时弹终端窗口 ===");
store["stdin"].value = "";
const key = (extra) => Object.assign({ key: "Enter", preventDefault() {} }, extra || {});
check("「你的代码」面板有了 id 和放大到全屏按钮", /id="panel-code"/.test(html) && /class="panel code-panel"/.test(html) && /id="btn-code-full"/.test(html));
check("全屏样式已定义", /\.panel\.code-panel\.fullscreen/.test(css));
check("全屏时编辑器撑满整屏（终端不再占位置）", /\.panel\.code-panel\.fullscreen \.editor \{ flex: 1 1 auto/.test(css) && !/code-panel\.fullscreen \.dev/.test(css));
check("终端窗口是页面里就有的，默认收起", /id="dev-float" class="dev-float hidden"/.test(html) && /id="dev" class="dev"/.test(html));
check("终端窗口默认不显示", store["dev-float"].classList.contains("hidden"));
check("终端和「用样例数据实测」是两块独立的面板", html.indexOf('id="dev-float"') > html.indexOf('id="problem-select"'));

store["btn-code-full"].dispatch("click");
check("点一下进入全屏", store["panel-code"].classList.contains("fullscreen") && bodyClass.has("code-full-open"));
check("进全屏后终端窗口仍然收着（整屏留给代码）", store["dev-float"].classList.contains("hidden"));
check("按钮变成「退出全屏」", store["btn-code-full"].textContent === "退出全屏", store["btn-code-full"].textContent);
check("全屏里点「立即检查」会把结果打进终端窗口并弹出来", (() => {
  store["code"].value = '#include <stdio.h>\nint main(){ int a; scanf("%d", a); return 0; }';
  store["code"].dispatch("input");
  flush();
  store["btn-check"].dispatch("click");
  return !store["dev-float"].classList.contains("hidden") && /静态检查：发现/.test(store["dev-out"].textContent);
})(), store["dev-out"].textContent.slice(0, 60));

store["dev-input"].value = "3 4";
store["btn-dev-send"].dispatch("click");
check("终端有自己的输入，不会去改「样例数据实测」的输入框", store["stdin"].value === "", JSON.stringify(store["stdin"].value));
check("终端里回显了这一行", /> 3 4/.test(store["dev-out"].textContent));

store["code"].value = '#include <stdio.h>\nint main(){ int a,b; scanf("%d %d",&a,&b); printf("%d\\n", a+b); return 0; }';
store["code"].dispatch("input");
flush();
store["btn-dev-run"].dispatch("click");
flush();
check("终端里跑出了结果 7", /\[结束\]/.test(store["dev-out"].textContent) && /\n7\n/.test(store["dev-out"].textContent), store["dev-out"].textContent.slice(-140));
check("终端运行也刷新了「用样例数据实测」的结果", /正常运行结束/.test(store["run-status"].textContent), store["run-status"].textContent);

const logVoid = store["dev-out"].textContent.length;
store["code"].value = '#include <stdio.h>\nint main(void){ printf("ok"); return 0; }';
store["code"].dispatch("input");
flush();
store["btn-dev-run"].dispatch("click");
const voidLog = store["dev-out"].textContent.slice(logVoid);
check("终端能直接跑 int main(void) 这种写法", /ok/.test(voidLog) && !/\[出错\]/.test(voidLog), voidLog.replace(/\n/g, " | ").slice(0, 90));

const log1 = store["dev-out"].textContent;
store["dev-input"].value = "9 9";
store["dev-input"].dispatch("keydown", key());
check("输入框里回车等于加入一行", /> 9 9/.test(store["dev-out"].textContent) && store["dev-input"].value === "" && store["stdin"].value === "");
const log2 = store["dev-out"].textContent;
store["dev-input"].dispatch("keydown", key());
check("空着回车等于直接运行", log2.length > log1.length && /\[结束\]/.test(store["dev-out"].textContent.slice(log2.length)));
const log3 = store["dev-out"].textContent;
store["dev-input"].dispatch("keydown", key({ ctrlKey: true }));
check("Ctrl+Enter 也能运行", store["dev-out"].textContent.length > log3.length);

store["code"].value = '#include <stdio.h>\nint main(){ int a; scanf("%d", a); return 0 }';
store["code"].dispatch("input");
flush();
store["btn-dev-check"].dispatch("click");
check("终端里的「检查」会打印静态检查结果", /静态检查：发现/.test(store["dev-out"].textContent) && /少了 &/.test(store["dev-out"].textContent), store["dev-out"].textContent.slice(0, 120));

store["btn-dev-clear"].dispatch("click");
check("「清空终端」清掉日志", store["dev-out"].textContent === "", store["dev-out"].textContent.slice(0, 40));

store["btn-float-close"].dispatch("click");
check("点「收起」＝关掉终端窗口", store["dev-float"].classList.contains("hidden"));
store["btn-code-full"].dispatch("click");
check("「退出全屏」恢复正常", !store["panel-code"].classList.contains("fullscreen") && !bodyClass.has("code-full-open"));
check("退出全屏按钮文案恢复", store["btn-code-full"].textContent === "放大到全屏", store["btn-code-full"].textContent);

store["btn-dev-run"].dispatch("click");
flush();
document.dispatch("keydown", { key: "Escape" });
check("开着终端窗口时，Esc 先收终端窗口", store["dev-float"].classList.contains("hidden"));
store["btn-code-full"].dispatch("click");
document.dispatch("keydown", { key: "Escape" });
check("没开终端窗口时，Esc 退出代码全屏", !store["panel-code"].classList.contains("fullscreen") && !bodyClass.has("code-full-open"));

console.log("=== 语言与难度：检查、答案、练习都按它们来 ===");
check("「你的代码」右上角有语言下拉框（C / Python / C++ / Java）", /id="code-lang"/.test(html) && /<option value="c" selected>C 语言<\/option>/.test(html) && /<option value="python">Python<\/option>/.test(html) && /<option value="cpp">C\+\+<\/option>/.test(html) && /<option value="java">Java<\/option>/.test(html));
check("还有难度下拉框（简单 / 中等 / 困难）", /id="answer-level"/.test(html) && /<option value="easy" selected>简单<\/option>/.test(html) && /<option value="normal">中等<\/option>/.test(html) && /<option value="hard">困难<\/option>/.test(html));
check("两个下拉框都在「你的代码」面板里", html.indexOf('id="panel-code"') < html.indexOf('id="code-lang"') && html.indexOf('id="code-lang"') < html.indexOf('id="btn-sample"'));
check("默认 C 语言：本地检查与运行可用", !store["btn-check"].disabled && !store["btn-run"].disabled && !store["btn-dev-run"].disabled && store["lang-warn"].classList.contains("hidden"));
check("状态行写明当前语言与难度", /C 语言 · 简单答案/.test(store["lang-status"].textContent), store["lang-status"].textContent);

store["code-lang"].value = "python";
store["code-lang"].dispatch("change");
flush();
check("切到 Python 后本地检查/运行全部关掉", store["btn-check"].disabled && store["btn-run"].disabled && store["btn-check-run"].disabled && store["btn-fill-reference"].disabled && store["problem-select"].disabled && store["chk-strict"].disabled && store["btn-dev-run"].disabled && store["btn-dev-check"].disabled);
check("切到 Python 后给出醒目提醒", !store["lang-warn"].classList.contains("hidden") && /Python/.test(store["lang-warn-name"].textContent));
check("切到 Python 后状态行跟着变", /Python · 简单答案/.test(store["lang-status"].textContent), store["lang-status"].textContent);
check("切到 Python 后不再用 C 的规则做本地检查", /本机只装了 C 语言的检查规则/.test(store["summary"].innerHTML), store["summary"].innerHTML.slice(0, 90));
check("切到 Python 后不会擅自改掉你写的代码", store["code"].value.indexOf("#include <stdio.h>") >= 0, store["code"].value.slice(0, 30));
store["btn-sample"].dispatch("click");
flush();
check("切到 Python 后「载入示例」给的是 Python 代码", store["code"].value.indexOf("input().split()") >= 0 && store["code"].value.indexOf("#include") < 0, store["code"].value.slice(0, 40));
check("切到 Python 后示例代码用 Python 的占位提示", /Python 代码粘贴到这里/.test(store["code"].placeholder), store["code"].placeholder);
check("语言选择记在本机", lsData.get("pta-code-lang") === "python");
store["btn-run"].dispatch("click");
flush();
check("Python 下点「运行并对比」只提醒、不硬跑", /本机只装了 C 语言的解释器/.test(store["run-status"].textContent), store["run-status"].textContent);

store["problem-text"].value = "7-1 两数求和\n输入两个整数，输出它们的和。";
store["btn-answer"].dispatch("click");
check("提示词写明语言：Python 3 与它的输入输出写法", /语言：Python 3/.test(store["prompt-out"].value) && /map\(int, input\(\)\.split\(\)\)/.test(store["prompt-out"].value));
check("提示词把语言与难度标成最高优先级", /最高优先级/.test(store["prompt-out"].value) && /全部必须用 Python 3 写/.test(store["prompt-out"].value));
check("提示词带上 Python 常见坑", /忘了转 int|setrecursionlimit/.test(store["prompt-out"].value));
check("答案框标题也写出语言与难度", store["answer-title"].textContent === "答案与解析（Python · 简单）", store["answer-title"].textContent);
store["btn-practice"].dispatch("click");
check("练习也按选的语言出题", /语言：Python 3/.test(store["prompt-out"].value) && /参考答案一律用 Python 3 写/.test(store["prompt-out"].value));

store["answer-level"].value = "hard";
store["answer-level"].dispatch("change");
check("难度记在本机", lsData.get("pta-answer-level") === "hard");
store["btn-answer"].dispatch("click");
check("「困难」写进提示词：最快、最好用", /答案难度：困难/.test(store["prompt-out"].value) && /最快跑过所有测试点/.test(store["prompt-out"].value) && /collections \/ itertools|qsort/.test(store["prompt-out"].value));
check("「困难」只要求关键行注释", /只在关键行/.test(store["prompt-out"].value));
store["answer-level"].value = "normal";
store["answer-level"].dispatch("change");
store["btn-answer"].dispatch("click");
check("「中等」要求简洁但看得懂", /答案难度：中等/.test(store["prompt-out"].value) && /学过基础的人能看懂/.test(store["prompt-out"].value) && /不要引入复杂算法/.test(store["prompt-out"].value));

store["code-lang"].value = "java";
store["code-lang"].dispatch("change");
store["btn-answer"].dispatch("click");
check("Java 的提示词点出类名必须是 Main", /语言：Java/.test(store["prompt-out"].value) && /类名必须是 Main/.test(store["prompt-out"].value));
store["code-lang"].value = "cpp";
store["code-lang"].dispatch("change");
store["btn-answer"].dispatch("click");
check("C++ 的提示词点出 bits/stdc++.h", /语言：C\+\+/.test(store["prompt-out"].value) && /bits\/stdc\+\+\.h/.test(store["prompt-out"].value));

store["code-lang"].value = "c";
store["code-lang"].dispatch("change");
flush();
check("换回 C 后本地检查与运行恢复", !store["btn-check"].disabled && !store["btn-run"].disabled && store["lang-warn"].classList.contains("hidden"));
check("换回 C 后示例代码是 C 的", store["code"].value.indexOf("#include <stdio.h>") >= 0, store["code"].value.slice(0, 30));

store["code-lang"].value = "python";
store["code-lang"].dispatch("change");
store["answer-level"].value = "hard";
store["answer-level"].dispatch("change");
for (const el of Object.values(store)) { el.classList._s.clear(); el._handlers = {}; }
vm.runInContext(readFileSync(path.join(root, "assets/js/app.js"), "utf8"), sandbox, { filename: "app.js" });
flush();
check("重开页面还记得上次选的语言和难度", store["code-lang"].value === "python" && store["answer-level"].value === "hard" && store["btn-check"].disabled);
store["code-lang"].value = "c";
store["code-lang"].dispatch("change");
store["answer-level"].value = "easy";
store["answer-level"].dispatch("change");
flush();

console.log("=== 内置解释器不再依赖 eval（严格 CSP 下也能运行） ===");
const vendor = readFileSync(path.join(root, "assets/vendor/jscpp.js"), "utf8");
const buildScript = readFileSync(path.join(root, "tools/build-jscpp.mjs"), "utf8");
check("页面的 CSP 没有放松（仍然禁止 unsafe-eval）", /script-src 'self'/.test(html) && !/unsafe-eval/.test(html) && !/unsafe-eval/.test(css));
check("打包脚本里有把解析器 eval 换掉的补丁", buildScript.indexOf("parser-unescape.js") >= 0 && buildScript.indexOf("patchParserEval") >= 0 && buildScript.indexOf("ast\\.js$") >= 0 && buildScript.indexOf("prepast\\.js$") >= 0);
check("C 字符串的转义有不用 eval 的实现", /fromCharCode\(parseInt\([A-Za-z_$][\w$]*,8\)&255\)/.test(vendor));
check("解析器里不再留 eval 做转义", !/eval\('"\\\\/.test(vendor));
check("解释器能真的跑起来（main(void) + scanf + printf）", (() => {
  let out = "";
  try {
    sandbox.JSCPP.run('#include <stdio.h>\nint main(void){ int a,b; scanf("%d %d", &a, &b); printf("%d\\n", a+b); return 0; }', "3 4\n", { maxTimeout: 3000, stdio: { write: (s) => { out += s; } } });
  } catch (e) { out = "ERR:" + (e && e.message); }
  return out === "7\n";
})(), "out=" + JSON.stringify(vendor.length));

console.log("=== 布局回归：错误列表不能盖住下方面板 ===");
check("检查结果面板不再吸附（sticky 会盖住紧随其后的面板）", html.indexOf("panel sticky") < 0, "index.html 里仍存在 panel sticky");
check("样式里不再给结果面板设 sticky", !/\.panel\.sticky\s*\{/.test(css));
check("错误列表有最大高度，长列表只在自己框内滚动", /\.findings\s*\{[^}]*max-height/.test(css));
check("题目/反馈面板紧跟在检查结果面板之后（同级）", /id="findings"[\s\S]{0,1200}?id="problem-text"/.test(html));

console.log("=== 终端：用 xterm.js（署名 + 接线都要对） ===");
const xtermSrc = readFileSync(path.join(root, "assets/vendor/xterm.js"), "utf8");
const xtermCss = readFileSync(path.join(root, "assets/vendor/xterm.css"), "utf8");
const notices = readFileSync(path.join(root, "THIRD-PARTY-NOTICES.md"), "utf8");
const readme = readFileSync(path.join(root, "README.md"), "utf8");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
check("产物里带着 xterm.js 的署名 banner", /xterm\.js/.test(xtermSrc.slice(0, 600)) && /MIT/.test(xtermSrc.slice(0, 600)));
check("署名里三个版权方都写了", /The xterm\.js authors/.test(xtermSrc.slice(0, 900)) && /SourceLair/.test(xtermSrc.slice(0, 900)) && /Christopher Jeffrey/.test(xtermSrc.slice(0, 900)));
check("xterm 的样式也带署名", /xterm\.js authors/.test(xtermCss.slice(0, 400)) && /THIRD-PARTY-NOTICES\.md/.test(xtermCss.slice(0, 400)));
check("xterm.js 不依赖 eval（严格 CSP 下能用）", !/new Function/.test(xtermSrc) && !/\beval\(/.test(xtermSrc));
check("页面引了 xterm 的样式", /assets\/vendor\/xterm\.css/.test(html));
check("app.js 按需加载 xterm.js", /assets\/vendor\/xterm\.js/.test(readFileSync(path.join(root, "assets/js/app.js"), "utf8")));
check("打包脚本能重新生成它", /build:terminal/.test(readFileSync(path.join(root, "package.json"), "utf8")) && typeof pkg.dependencies["@xterm/xterm"] === "string");
check("署名文件里有 xterm.js 的条目与许可", /@xterm\/xterm/.test(notices) && /### @xterm\/xterm/.test(notices) && /The xterm\.js authors/.test(notices));
check("配套的 fit 插件也署了名", /@xterm\/addon-fit/.test(notices) && /### @xterm\/addon-fit/.test(notices) && /@xterm\/addon-fit/.test(xtermSrc.slice(0, 1200)) && /addon-fit/.test(readme));
check("README 的第三方清单里也列了它", /@xterm\/xterm/.test(readme) && /xterm\.js/.test(readme));
check("终端用官方 fit 插件自适应尺寸", /FitAddon/.test(readFileSync(path.join(root, "assets/js/app.js"), "utf8")) && /fitTerminal/.test(readFileSync(path.join(root, "assets/js/app.js"), "utf8")));

/* 用一个假的 xterm 驱动一遍终端接线：打字、回车加输入、空回车运行、退格、Ctrl+C */
const fakeTerm = {
  openedHost: null, written: "", dataHandler: null, focusCount: 0,
  open(el) { this.openedHost = el; },
  write(s) { this.written += s; },
  onData(fn) { this.dataHandler = fn; },
  focus() { this.focusCount++; }
};
sandbox.Xterm = { Terminal: function () { return fakeTerm; } };
for (const el of Object.values(store)) { el.classList._s.clear(); el._handlers = {}; }
vm.runInContext(readFileSync(path.join(root, "assets/js/app.js"), "utf8"), sandbox, { filename: "app.js" });
flush();
store["code"].value = '#include <stdio.h>\nint main(void){ int a,b; scanf("%d %d", &a, &b); printf("%d\\n", a+b); return 0; }';
store["code"].dispatch("input");
flush();
store["stdin"].value = "";
store["btn-code-full"].dispatch("click");
store["btn-dev-run"].dispatch("click");
flush();
check("点「运行」才弹出终端窗口", !store["dev-float"].classList.contains("hidden"));
check("弹出时才装上终端并渲染到 #dev-term", fakeTerm.openedHost === store["dev-term"] && store["dev"].classList.contains("term-on"));
check("终端里有就绪提示和提示符", /终端就绪/.test(fakeTerm.written) && /> $/.test(fakeTerm.written), JSON.stringify(fakeTerm.written.slice(0, 40)));
check("用上终端后原来的简易终端收起来（样式里控制）", /\.dev\.term-on \.dev-out/.test(css) && /\.dev\.term-on \.dev-input-row/.test(css));
check("终端拿到一次焦点", fakeTerm.focusCount >= 1);

fakeTerm.dataHandler("3 4\r");
check("终端里打一行回车＝进终端自己的输入缓冲（不动样例数据那个框）", store["stdin"].value === "" && /> 3 4/.test(store["dev-out"].textContent), JSON.stringify(store["stdin"].value));
check("终端里的这一行同时记进日志（供复制）", /> 3 4/.test(store["dev-out"].textContent));
const beforeRun = store["dev-out"].textContent.length;
fakeTerm.dataHandler("\r");
flush();
check("终端里空行回车＝运行并出结果", store["dev-out"].textContent.length > beforeRun && /\[结束\]/.test(store["dev-out"].textContent) && /\n7\n/.test(store["dev-out"].textContent), store["dev-out"].textContent.slice(-90));
fakeTerm.dataHandler("9");
fakeTerm.dataHandler("\u007f\u007f");
fakeTerm.dataHandler("5\r");
check("终端里退格能删字（删干净后加 5 只留下 5）", /> 5/.test(store["dev-out"].textContent) && !/> 95/.test(store["dev-out"].textContent), store["dev-out"].textContent.slice(-40));
const beforeCtrlC = store["dev-out"].textContent.length;
fakeTerm.dataHandler("x\u0003");
check("Ctrl+C 丢掉当前行、不写进输入", !/> x/.test(store["dev-out"].textContent) && store["dev-out"].textContent.length >= beforeCtrlC);
store["btn-float-close"].dispatch("click");

/* 「清空终端」以前只清了 <pre>，xterm 那边没反应——这里盯住它 */
fakeTerm.resetCount = 0;
fakeTerm.reset = function () { this.resetCount++; this.written = ""; };
store["btn-dev-clear"].dispatch("click");
check("「清空终端」真的把终端清了", fakeTerm.resetCount === 1 && /终端已清空/.test(fakeTerm.written), "reset=" + fakeTerm.resetCount);
check("「清空终端」也把日志清空了", store["dev-out"].textContent === "", store["dev-out"].textContent.slice(0, 30));

/* 检查不通过先别跑；再点一次才是强行运行 */
store["code"].value = '#include <stdio.h>\nint main(){ int n; scanf("%d", n); printf("%d", n); return 0; }';
store["code"].dispatch("input");
flush();
store["stdin"].value = "5\n";
store["btn-dev-run"].dispatch("click");
flush();
check("终端里：有错误先不让跑，并指出第几行", /先别跑/.test(store["dev-out"].textContent) && /第 2 行/.test(store["dev-out"].textContent) && !/\[结束\]/.test(store["dev-out"].textContent), store["dev-out"].textContent.slice(-90));
store["btn-dev-run"].dispatch("click");
flush();
check("再点一次＝强行运行，并写明忽略了错误", /忽略 1 个错误强行运行/.test(store["dev-out"].textContent), store["dev-out"].textContent.slice(-110));

/* 小黑框：平时点「运行」弹出来，收起后回到面板；Esc 也能收 */
store["code"].value = '#include <stdio.h>\nint main(){ printf("ok"); return 0; }';
store["code"].dispatch("input");
flush();
store["stdin"].value = "";
const movedTo = [];
store["dev-float-body"].appendChild = function (el) { movedTo.push(el); };
store["btn-float-close"].dispatch("click");
check("平时（没进全屏）小黑框是收着的", store["dev-float"].classList.contains("hidden"));
store["btn-dev-run"].dispatch("click");
flush();
check("平时点运行会弹出小黑框", !store["dev-float"].classList.contains("hidden"));
check("终端就在小黑框里（页面结构上就放在里面）", /id="dev-float-body"[\s\S]{0,200}?id="dev"/.test(html));
check("小黑框里有「清空」和「收起」两个按钮", /id="btn-dev-clear"/.test(html) && /id="btn-float-close"/.test(html));
store["btn-dev-clear"].dispatch("click");
check("小黑框上的「清空」一样管用", fakeTerm.resetCount === 2 && /终端已清空/.test(fakeTerm.written));
store["btn-float-close"].dispatch("click");
check("点「收起」关掉小黑框", store["dev-float"].classList.contains("hidden"));
store["btn-dev-run"].dispatch("click");
flush();
document.dispatch("keydown", { key: "Escape" });
check("按 Esc 也能收起小黑框", store["dev-float"].classList.contains("hidden"));
store["btn-code-full"].dispatch("click");
check("进全屏时终端窗口自动关掉（整屏留给代码）", store["dev-float"].classList.contains("hidden") && store["panel-code"].classList.contains("fullscreen"));
store["btn-code-full"].dispatch("click");

/* 工具栏的「运行并对比」也要在终端窗口里留一份（和 Dev-C++ 一样能看到输出） */
const beforeToolbar = store["dev-out"].textContent.length;
store["code"].value = '#include <stdio.h>\nint main(){ int a,b; scanf("%d %d",&a,&b); printf("%d\\n", a+b); return 0; }';
store["code"].dispatch("input");
flush();
store["stdin"].value = "8 9\n";
store["btn-run"].dispatch("click");
flush();
const toolbarLog = store["dev-out"].textContent.slice(beforeToolbar);
check("工具栏的「运行并对比」也会把结果写进终端窗口", /\[结束\]/.test(toolbarLog) && /\n17\n/.test(toolbarLog), toolbarLog.replace(/\n/g, " | ").slice(0, 90));
check("它用完还是会把终端窗口弹出来", !store["dev-float"].classList.contains("hidden"));
store["btn-float-close"].dispatch("click");

delete sandbox.Xterm;

console.log("=== 题目旁的「清空题目」 ===");
check("「生成答案与解析」右边多了「清空题目」", /id="btn-clear-problem"/.test(html) && html.indexOf('id="btn-answer"') < html.indexOf('id="btn-clear-problem"'));
store["problem-text"].value = "7-1 两数求和\n输入两个整数，输出它们的和。";
store["pta-feedback"].value = "测试点 2　答案错误";
let problemFocused = 0;
store["problem-text"].focus = function () { problemFocused++; };
store["btn-clear-problem"].dispatch("click");
check("点一下题目框就清空了", store["problem-text"].value === "", store["problem-text"].value.slice(0, 30));
check("只清题目，不动「应用修改」", store["pta-feedback"].value === "测试点 2　答案错误");
check("清空后光标回到题目框，方便直接粘下一题", problemFocused === 1);

console.log("=== 代码的「上一步 / 下一步」 ===");
check("代码工具栏里有这两个按钮", /id="btn-undo"/.test(html) && /id="btn-redo"/.test(html) && html.indexOf('id="btn-check-run"') < html.indexOf('id="btn-undo"') && html.indexOf('id="btn-undo"') < html.indexOf('id="btn-redo"'));
check("按钮写着「上一步 / 下一步」并带快捷键提示", /↶ 上一步/.test(html) && /下一步 ↷/.test(html) && /Ctrl\+Z/.test(html) && /Ctrl\+Y/.test(html));
/* 重新进一次页面，从「刚打开」的状态开始验证 */
for (const el of Object.values(store)) { el.classList._s.clear(); el._handlers = {}; }
vm.runInContext(readFileSync(path.join(root, "assets/js/app.js"), "utf8"), sandbox, { filename: "app.js" });
flush();
check("刚打开时两个按钮都是灰的", store["btn-undo"].disabled && store["btn-redo"].disabled);

const beforeEdit = store["code"].value;
store["code"].value = '#include <stdio.h>\nint main(){ printf("a"); return 0; }';
store["code"].dispatch("input");
flush();
check("改过代码以后「上一步」变可用", !store["btn-undo"].disabled && store["btn-redo"].disabled);
store["btn-undo"].dispatch("click");
check("点「上一步」回到改动前", store["code"].value === beforeEdit, store["code"].value.slice(0, 40));
check("退回去以后「下一步」变可用", !store["btn-redo"].disabled && store["btn-undo"].disabled);
store["btn-redo"].dispatch("click");
check("点「下一步」回到改动后", store["code"].value === '#include <stdio.h>\nint main(){ printf("a"); return 0; }');

store["btn-clear"].dispatch("click");
check("「清空」这一步也能撤回", store["code"].value === "" && !store["btn-undo"].disabled);
store["btn-undo"].dispatch("click");
check("撤回后内容回来了", store["code"].value === '#include <stdio.h>\nint main(){ printf("a"); return 0; }', store["code"].value.slice(0, 40));

store["code"].value = "int main(){ return 0; }";
store["code"].dispatch("input");
flush();
store["code"].dispatch("keydown", { key: "z", ctrlKey: true, preventDefault() {} });
check("Ctrl+Z 也能撤回", store["code"].value !== "int main(){ return 0; }", store["code"].value.slice(0, 40));
store["code"].dispatch("keydown", { key: "y", ctrlKey: true, preventDefault() {} });
check("Ctrl+Y 也能前进", store["code"].value === "int main(){ return 0; }", store["code"].value.slice(0, 40));
store["btn-undo"].dispatch("click");

console.log("=== 提问模块（在练习和 API 之间） ===");
check("「练习」和「API」之间多了一个「提问」模块", /id="panel-ask"/.test(html) && html.indexOf('id="panel-practice-out"') < html.indexOf('id="panel-ask"') && html.indexOf('id="panel-ask"') < html.indexOf('id="panel-api"'));
check("模块里有提问框、回答框和三个按钮", /id="ask-question"/.test(html) && /id="ask-answer"/.test(html) && /id="btn-ask"/.test(html) && /id="btn-ask-clear"/.test(html) && /id="btn-copy-ask"/.test(html));
check("说明里要求写清第几行，并给了例子", /一定要写是第几行/.test(html) && /第 6 行的 printf/.test(html) && /第 4 行的 for 循环/.test(html));
check("说明里写明按难度决定怎么讲、不确定必须明说", /简单<\/b>就尽量不用术语/.test(html) && /不确定的地方 AI 必须明说/.test(html));
check("说明里写明用你自己的 AI", /你自己的 AI/.test(html));

store["problem-text"].value = "7-1 两数求和\n输入 a 和 b，输出 a + b。";
alerts.length = 0;
store["ask-question"].value = "";
store["btn-ask"].dispatch("click");
check("没写问题就先提醒（并要求写第几行）", alerts.length > 0 && /第几行/.test(alerts[0]), "alerts=" + alerts.length);

store["code"].value = '#include <stdio.h>\n\nint main() {\n    int a, b;\n    scanf("%d %d", &a, &b);\n    printf("%d\\n", a + b);\n    return 0;\n}';
store["code"].dispatch("input");
flush();
store["ask-question"].value = "第 6 行的 printf 为什么要写 \\n？";
store["btn-ask"].dispatch("click");
const askPrompt = store["prompt-out"].value;
check("提示词里带上学生的问题", askPrompt.indexOf("第 6 行的 printf 为什么要写") >= 0);
check("提示词把语言与难度标成最高优先级", /语言：C 语言/.test(askPrompt) && /答案难度：简单/.test(askPrompt) && /最高优先级/.test(askPrompt));
check("提示词里的代码带行号，方便按行回答", /1 \| #include <stdio\.h>/.test(askPrompt) && /6 \|/.test(askPrompt));
check("要求先给结论、再用大白话复述", /第一句就给结论/.test(askPrompt) && /大白话把那句结论复述一遍/.test(askPrompt));
check("简单难度＝尽量不用术语", /尽量不用专业术语/.test(askPrompt));
check("允许举生活例子，不好举例就不举", /日常生活里人人都懂的例子/.test(askPrompt) && /不要硬编/.test(askPrompt));
check("不确定必须明说、不许编造", /必须明确写「我不确定」/.test(askPrompt) && /绝对不要为了显得流畅而编造结论/.test(askPrompt));

store["answer-level"].value = "hard";
store["answer-level"].dispatch("change");
store["btn-ask"].dispatch("click");
check("换成「困难」后允许用术语但要说人话", /适当使用专业术语/.test(store["prompt-out"].value) && /用大白话再解释一遍/.test(store["prompt-out"].value));
store["answer-level"].value = "easy";
store["answer-level"].dispatch("change");

store["ai-preset"].value = "deepseek";
store["ai-preset"].dispatch("change");
store["ai-key"].value = "sk-test-1234567890";
store["chk-ai-remember"].checked = true;
store["btn-ai-save"].dispatch("click");
const keepChat = sandbox.PTAAI.chat;
sandbox.PTAAI.chat = function (opts) { opts.onDelta("d", "AI 对提问的回答正文"); opts.onDone(); return { cancel: function () {} }; };
store["ask-question"].value = "第 6 行的 printf 为什么要写 \\n？";
store["btn-ask"].dispatch("click");
store["ask-answer"].value = "";
store["btn-ai-run"].dispatch("click");
check("AI 的回答写进提问模块的「回答」框", store["ask-answer"].value.indexOf("AI 对提问的回答正文") >= 0, store["ask-answer"].value.slice(0, 40));
check("回答框的说明变成「已生成」", /已生成/.test(store["ask-note"].textContent), store["ask-note"].textContent);
sandbox.PTAAI.chat = keepChat;

store["ask-question"].value = "随便写点";
store["btn-ask-clear"].dispatch("click");
check("「清空问题」清掉提问框", store["ask-question"].value === "");

console.log("=== 留言板页面（单独网址） ===");
const boardPage = readFileSync(path.join(root, "board.html"), "utf8");
const boardJs = readFileSync(path.join(root, "assets/js/board.js"), "utf8");
readFileSync(path.join(root, "assets/css/board.css"), "utf8");
check("主页面顶栏有「留言板」入口，指向 board.html", /href="board\.html"/.test(html) && /留言板/.test(html));
check("留言板是单独一个页面", /<!DOCTYPE html>/.test(boardPage) && /id="board"/.test(boardPage));
check("规则写清了：公开可见、永久保存、显示日期、不支持私聊", /完全公开/.test(boardPage) && /永久保存/.test(boardPage) && /显示发布时间/.test(boardPage) && /不支持私聊/.test(boardPage));
check("规则写清了谁可以删", /本人<\/b>可以删/.test(boardPage) && /站长/.test(boardPage) && /其他人删不了/.test(boardPage));
check("规则写清了要 GitHub 账号登录", /需要 GitHub 账号/.test(boardPage));
check("用 giscus 的官方脚本，并从仓库里带上出处链接", /giscus\.app\/client\.js/.test(boardJs) && /https:\/\/github\.com\/giscus\/giscus/.test(boardPage));
check("署名写明了 giscus 与 MIT", /MIT/.test(boardPage) && /THIRD-PARTY-NOTICES\.md/.test(boardPage));
check("没配置时会显示 4 步配置说明，不会白屏", /renderSetup/.test(boardJs) && /还没开通/.test(boardJs) && /data-repo-id/.test(boardJs) && /data-category-id/.test(boardJs));
check("留言板页只放行 giscus，主页面完全不加载 giscus", /frame-src https:\/\/giscus\.app/.test(boardPage) && /script-src 'self' https:\/\/giscus\.app/.test(boardPage) && !/giscus/.test(html));
check("留言板页不加载别的第三方脚本", /assets\/js\/board\.js/.test(boardPage) && !/https:\/\/[^"']*\.js/.test(boardPage));
check("留言板有回主页面的链接", /href="index\.html"/.test(boardPage));
check("署名文件与 README 里都写了 giscus", /giscus/.test(notices) && /giscus/.test(readme));
check("主页面 CSP 依然严格（没有放行任何外部脚本）", /script-src 'self';/.test(html) && !/giscus\.app/.test(html));

console.log("\n集成测试：" + ok + " 通过 / " + (ok + bad) + " 项");
if (bad) process.exitCode = 1;


