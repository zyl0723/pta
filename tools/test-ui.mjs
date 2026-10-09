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

for (const f of ["assets/vendor/jscpp.js", "assets/js/analyzer.js", "assets/js/runner.js", "assets/js/problems.js", "assets/js/prompt.js", "assets/js/account.js", "assets/js/aiclient.js", "assets/js/app.js"]) {
  vm.runInContext(readFileSync(path.join(root, f), "utf8"), sandbox, { filename: f });
}
function flush() { while (timers.length) timers.shift()(); }
const account = sandbox.PTAAccount;
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

console.log("=== 登录门禁：没登录不能用 AI 模块 ===");
check("顶栏有登录 / 退出按钮和账号位", /id="btn-account"/.test(html) && /id="btn-logout"/.test(html) && /id="account-label"/.test(html));
check("页面有登录 / 注册弹窗", /id="auth"/.test(html) && /id="tab-register"/.test(html));
check("登录弹窗写清账号只在本机、验证码不会真的发邮件", /只在这台浏览器里/.test(html) && /不会真的发邮件/.test(html));
check("登录弹窗说明登录一次长期有效", /不用再登/.test(html));
check("初始状态是未登录", !account.isLoggedIn());
check("未登录时顶栏显示「登录」", !store["btn-account"].classList.contains("hidden") && store["btn-logout"].classList.contains("hidden"));

store["problem-text"].value = "7-1 两数求和\n输入 a 和 b，输出 a + b。";
store["prompt-out"].value = "";
store["btn-answer"].dispatch("click");
check("未登录点「生成答案与解析」会弹出登录框", !store["auth"].classList.contains("hidden"));
check("未登录时不会生成提示词", store["prompt-out"].value === "");

console.log("=== 注册（验证码 + 设置密码）并自动登录 ===");
store["tab-register"].dispatch("click");
check("切到注册面板", !store["auth-register"].classList.contains("hidden") && store["auth-login"].classList.contains("hidden"));

store["reg-email"].value = "tester@qq.com";
store["btn-send-code"].dispatch("click");
await waitFor(() => /\d{6}/.test(store["code-note"].textContent));
check("点「获取验证码」后页面显示本机验证码", /\d{6}/.test(store["code-note"].textContent), store["code-note"].textContent);
check("验证码旁边写明不会发邮件", /不会发邮件/.test(store["code-note"].textContent), store["code-note"].textContent);
const regCode = (store["code-note"].textContent.match(/\d{6}/) || [""])[0];

store["reg-code"].value = "000000";
store["reg-password"].value = "abc123456";
store["reg-password2"].value = "abc123456";
store["btn-do-register"].dispatch("click");
await new Promise((r) => setTimeout(r, 250));
check("验证码填错时注册失败并提示", /验证码/.test(store["auth-status"].textContent), store["auth-status"].textContent);
check("验证码错的时候没有登录", !account.isLoggedIn());

store["reg-code"].value = regCode;
store["btn-do-register"].dispatch("click");
await waitFor(() => account.isLoggedIn());
check("验证码正确时注册成功并自动登录", account.isLoggedIn() && account.current().email === "tester@qq.com");
check("注册后登录弹窗关闭", store["auth"].classList.contains("hidden"));
check("顶栏显示邮箱", store["account-label"].textContent === "tester@qq.com" && !store["account-label"].classList.contains("hidden"));
check("顶栏出现「退出」并收起「登录」", !store["btn-logout"].classList.contains("hidden") && store["btn-account"].classList.contains("hidden"));

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

console.log("=== 退出登录后 AI 模块重新上锁 ===");
store["btn-logout"].dispatch("click");
check("退出后不再是登录状态", !account.isLoggedIn());
check("退出后顶栏回到「登录」", !store["btn-account"].classList.contains("hidden") && store["btn-logout"].classList.contains("hidden"));
store["prompt-out"].value = "";
store["btn-answer"].dispatch("click");
check("退出后再点 AI 按钮会重新要求登录", !store["auth"].classList.contains("hidden") && store["prompt-out"].value === "");

store["login-email"].value = "tester@qq.com";
store["login-password"].value = "not-the-password";
store["btn-do-login"].dispatch("click");
await new Promise((r) => setTimeout(r, 200));
check("密码不对登录失败", /密码不对/.test(store["auth-status"].textContent), store["auth-status"].textContent);

store["login-password"].value = "abc123456";
store["btn-do-login"].dispatch("click");
await waitFor(() => account.isLoggedIn());
check("用注册时的邮箱密码能登录回来", account.isLoggedIn() && account.current().email === "tester@qq.com");
check("登录后弹窗关闭、顶栏显示邮箱", store["auth"].classList.contains("hidden") && store["account-label"].textContent === "tester@qq.com");

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
check("重新打开网址仍然是登录状态（不用再登）", account.isLoggedIn());
check("重新打开后顶栏直接显示邮箱", store["account-label"].textContent === "tester@qq.com");

console.log("=== 布局回归：错误列表不能盖住下方面板 ===");
check("检查结果面板不再吸附（sticky 会盖住紧随其后的面板）", html.indexOf("panel sticky") < 0, "index.html 里仍存在 panel sticky");
check("样式里不再给结果面板设 sticky", !/\.panel\.sticky\s*\{/.test(css));
check("错误列表有最大高度，长列表只在自己框内滚动", /\.findings\s*\{[^}]*max-height/.test(css));
check("题目/反馈面板紧跟在检查结果面板之后（同级）", /id="findings"[\s\S]{0,1200}?id="problem-text"/.test(html));

console.log("\n集成测试：" + ok + " 通过 / " + (ok + bad) + " 项");
if (bad) process.exitCode = 1;
