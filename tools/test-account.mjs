/* 本机账号（assets/js/account.js）的单元测试：
 * 用一个假 localStorage + Node 自带的 WebCrypto 跑注册 / 登录 / 会话 / 密码存储。 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let ok = 0, bad = 0;
function check(label, cond, extra) {
  if (cond) { ok++; console.log("通过 " + label); }
  else { bad++; console.log("失败 " + label + (extra ? "  -> " + extra : "")); }
}

function makeAccount() {
  const data = new Map();
  const sandbox = {
    console,
    crypto: webcrypto,
    Uint8Array,
    TextEncoder,
    Promise,
    localStorage: {
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => { data.set(k, String(v)); },
      removeItem: (k) => { data.delete(k); }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.join(root, "assets/js/account.js"), "utf8"), sandbox, { filename: "account.js" });
  return { account: sandbox.PTAAccount, data };
}

async function expectReject(promise) {
  try { await promise; return null; } catch (err) { return err; }
}

const { account, data } = makeAccount();
const EMAIL = "123456789@qq.com";
const PASSWORD = "wode mima 123";

console.log("=== 邮箱与验证码 ===");
check("合法邮箱通过", account.isEmail("a.b@qq.com"));
check("非法邮箱被拒", !account.isEmail("a@b") && !account.isEmail("没有@的") && !account.isEmail(""));
check("邮箱大小写与空格被归一化", account.normalizeEmail("  ABC@QQ.com ") === "abc@qq.com");

const badMail = await expectReject(account.sendCode("a@b"));
check("发送验证码前会校验邮箱", !!badMail && /邮箱格式/.test(badMail.message), badMail && badMail.message);

const code = await account.sendCode(EMAIL);
check("验证码是 6 位数字", /^\d{6}$/.test(code), code);

console.log("=== 注册 ===");
const wrongCode = await expectReject(account.register({ email: EMAIL, password: PASSWORD, confirm: PASSWORD, code: "000000" }) );
check("验证码不对不能注册", !!wrongCode && /验证码/.test(wrongCode.message), wrongCode && wrongCode.message);

const noCode = await expectReject(account.register({ email: EMAIL, password: PASSWORD, confirm: PASSWORD, code: "" }));
check("没拿验证码不能注册", !!noCode && /验证码/.test(noCode.message), noCode && noCode.message);

const shortPwd = await expectReject(account.register({ email: EMAIL, password: "123", confirm: "123", code }));
check("密码太短不能注册", !!shortPwd && /至少 6 位/.test(shortPwd.message), shortPwd && shortPwd.message);

const mismatch = await expectReject(account.register({ email: EMAIL, password: PASSWORD, confirm: "别的密码", code }));
check("两次密码不一致不能注册", !!mismatch && /不一样/.test(mismatch.message), mismatch && mismatch.message);

const reg = await account.register({ email: EMAIL, password: PASSWORD, confirm: PASSWORD, code });
check("验证码正确时可以注册", reg && reg.email === EMAIL, JSON.stringify(reg));
check("注册后就是已登录状态", account.isLoggedIn() && account.current().email === EMAIL);

const raw = data.get("pta-accounts");
check("账号写进了本机存储", /pta-accounts/.test(JSON.stringify([...data.keys()])) || !!raw);
check("存储里没有明文密码", !raw.includes(PASSWORD), "存储中出现了明文密码");
check("存储里只有盐和摘要", /"salt"/.test(raw) && /"hash"/.test(raw));

const dup = await expectReject(account.register({ email: EMAIL, password: PASSWORD, confirm: PASSWORD, code }));
check("同一邮箱不能重复注册", !!dup && /已经注册过/.test(dup.message), dup && dup.message);

console.log("=== 会话与退出 ===");
account.logout();
check("退出后是未登录状态", !account.isLoggedIn() && account.current() === null);

console.log("=== 登录 ===");
const unknown = await expectReject(account.login({ email: "someone@qq.com", password: PASSWORD }));
check("没注册过的邮箱登录会提示去注册", !!unknown && /没有这个账号/.test(unknown.message), unknown && unknown.message);

const wrongPwd = await expectReject(account.login({ email: EMAIL, password: "不是这个密码" }));
check("密码不对登录失败", !!wrongPwd && /密码不对/.test(wrongPwd.message), wrongPwd && wrongPwd.message);

const good = await account.login({ email: EMAIL, password: PASSWORD });
check("密码正确可以登录", good && good.email === EMAIL);
check("登录后会话还在（不用每次重登）", account.isLoggedIn());

console.log("=== 会话是持久的 ===");
const again = makeAccount();
again.data.clear();
for (const [k, v] of data) again.data.set(k, v);
check("重新打开页面仍然是登录状态", again.account.isLoggedIn(), "重载后丢失了登录状态");

console.log("=== 没有 WebCrypto 时的降级 ===");
const bareData = new Map();
const bare = {
  console, Uint8Array, TextEncoder, Promise,
  localStorage: {
    getItem: (k) => (bareData.has(k) ? bareData.get(k) : null),
    setItem: (k, v) => { bareData.set(k, String(v)); },
    removeItem: (k) => { bareData.delete(k); }
  }
};
bare.window = bare;
vm.createContext(bare);
vm.runInContext(readFileSync(path.join(root, "assets/js/account.js"), "utf8"), bare, { filename: "account.js" });
const bareCode = await bare.PTAAccount.sendCode(EMAIL);
const noCrypto = await expectReject(bare.PTAAccount.register({ email: EMAIL, password: PASSWORD, confirm: PASSWORD, code: bareCode }));
check("不支持 WebCrypto 时给出清楚提示", !!noCrypto && /WebCrypto/.test(noCrypto.message), noCrypto && noCrypto.message);

console.log("\n本机账号测试：" + ok + " 通过 / " + (ok + bad) + " 项");
if (bad) process.exitCode = 1;