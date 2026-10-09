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
check("提示词要求逐行注释", /每一行末尾/.test(store["prompt-out"].value));
check("提示词要求列出易错点", /容易出错的地方/.test(store["prompt-out"].value));
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
check("点「生成答案与解析」后答案框标题是「答案与解析」", store["answer-title"].textContent === "答案与解析", store["answer-title"].textContent);
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

console.log("=== 布局回归：错误列表不能盖住下方面板 ===");
check("检查结果面板不再吸附（sticky 会盖住紧随其后的面板）", html.indexOf("panel sticky") < 0, "index.html 里仍存在 panel sticky");
check("样式里不再给结果面板设 sticky", !/\.panel\.sticky\s*\{/.test(css));
check("错误列表有最大高度，长列表只在自己框内滚动", /\.findings\s*\{[^}]*max-height/.test(css));
check("题目/反馈面板紧跟在检查结果面板之后（同级）", /id="findings"[\s\S]{0,1200}?id="problem-text"/.test(html));

console.log("\n集成测试：" + ok + " 通过 / " + (ok + bad) + " 项");
if (bad) process.exitCode = 1;
