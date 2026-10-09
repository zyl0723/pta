/*!
 * 本机账号（Local Account）
 *
 * 实现「注册 / 登录 / 退出 / 保持登录」。它不联任何服务器——本站是纯静态页面，没有后端：
 *   · 账号资料存在浏览器自己的 localStorage 里；换电脑、换浏览器、清缓存就没了；
 *   · 「验证码」是在本机生成的，页面会把它显示出来，并不会真的发邮件；
 *   · 密码不明文保存，用浏览器自带的 WebCrypto 做 PBKDF2-SHA256 加盐派生，只存摘要。
 *
 * 想要跨设备、真的用 QQ 邮箱收验证码的账号系统，必须部署一个后端，见 README「账号系统」一节。
 *
 * 版权：本文件的代码由仓库作者 zyl0723 编写（见 THIRD-PARTY-NOTICES.md 第一节）。
 */
(function () {
  "use strict";

  var ACCOUNTS_KEY = "pta-accounts";
  var SESSION_KEY = "pta-session";
  var PENDING_KEY = "pta-pending-code";
  var ITERATIONS = 120000;
  var CODE_TTL = 10 * 60 * 1000;

  /* ---------- 本机存储 ---------- */
  function storage() {
    try { return window.localStorage || null; } catch (err) { return null; }
  }

  function readJSON(key) {
    var s = storage();
    if (!s) return null;
    try {
      var raw = s.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) { return null; }
  }

  function writeJSON(key, value) {
    var s = storage();
    if (!s) return false;
    try { s.setItem(key, JSON.stringify(value)); return true; } catch (err) { return false; }
  }

  /* ---------- 小工具 ---------- */
  function normalizeEmail(email) {
    return String(email == null ? "" : email).trim().toLowerCase();
  }

  function isEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
  }

  function cryptoObj() {
    if (typeof window !== "undefined" && window.crypto) return window.crypto;
    if (typeof crypto !== "undefined") return crypto;
    return null;
  }

  function subtle() {
    var c = cryptoObj();
    return c && c.subtle ? c.subtle : null;
  }

  function hex(arr) {
    var out = "";
    for (var i = 0; i < arr.length; i++) out += (arr[i] + 256).toString(16).slice(1);
    return out;
  }

  function randomHex(bytes) {
    var c = cryptoObj();
    var arr = new Uint8Array(bytes);
    if (c && c.getRandomValues) c.getRandomValues(arr);
    else for (var i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
    return hex(arr);
  }

  function hexToBytes(h) {
    var out = new Uint8Array(Math.floor(h.length / 2));
    for (var i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }

  function randomCode() {
    var c = cryptoObj();
    var n;
    if (c && c.getRandomValues) {
      var a = new Uint32Array(1);
      c.getRandomValues(a);
      n = a[0] % 1000000;
    } else {
      n = Math.floor(Math.random() * 1000000);
    }
    var s = String(n);
    while (s.length < 6) s = "0" + s;
    return s;
  }

  function hashPassword(password, saltHex, iterations) {
    var sub = subtle();
    if (!sub) {
      return Promise.reject(new Error("这个浏览器不支持 WebCrypto，没法安全地保存密码。请换用较新版 Chrome / Edge / Firefox。"));
    }
    var enc = new TextEncoder();
    return sub.importKey("raw", enc.encode(String(password)), { name: "PBKDF2" }, false, ["deriveBits"])
      .then(function (key) {
        return sub.deriveBits(
          { name: "PBKDF2", salt: hexToBytes(saltHex), iterations: iterations || ITERATIONS, hash: "SHA-256" },
          key, 256
        );
      })
      .then(function (bits) { return hex(new Uint8Array(bits)); });
  }

  function accounts() {
    var all = readJSON(ACCOUNTS_KEY);
    return (all && typeof all === "object") ? all : {};
  }

  function saveAccounts(all) { return writeJSON(ACCOUNTS_KEY, all); }

  /* ---------- 会话 ---------- */
  function current() {
    var s = readJSON(SESSION_KEY);
    if (!s || !s.email) return null;
    return s;
  }

  function isLoggedIn() { return !!current(); }

  function logout() {
    var s = storage();
    if (s) { try { s.removeItem(SESSION_KEY); } catch (err) { /* 无所谓 */ } }
  }

  /* ---------- 验证码（本机生成，不发邮件） ---------- */
  function sendCode(email) {
    var mail = normalizeEmail(email);
    if (!isEmail(mail)) {
      return Promise.reject(new Error("邮箱格式不对，请填完整，例如 123456789@qq.com。"));
    }
    var code = randomCode();
    if (!writeJSON(PENDING_KEY, { email: mail, code: code, exp: Date.now() + CODE_TTL })) {
      return Promise.reject(new Error("浏览器不让写本机存储，验证码存不下来。请关掉无痕模式再试。"));
    }
    return Promise.resolve(code);
  }

  function checkCode(email, code) {
    var pending = readJSON(PENDING_KEY);
    var mail = normalizeEmail(email);
    if (!pending || pending.email !== mail) return "请先点「获取验证码」。";
    if (Date.now() > pending.exp) return "验证码过期了，请重新获取。";
    if (String(code == null ? "" : code).trim() !== pending.code) return "验证码不对，请照页面显示的数字重新输入。";
    return "";
  }

  /* ---------- 注册 / 登录 ---------- */
  function register(input) {
    var o = input || {};
    var email = normalizeEmail(o.email);
    var password = String(o.password == null ? "" : o.password);

    if (!isEmail(email)) return Promise.reject(new Error("邮箱格式不对，请填完整，例如 123456789@qq.com。"));
    if (password.length < 6) return Promise.reject(new Error("密码至少 6 位。"));
    if (o.confirm != null && password !== String(o.confirm)) return Promise.reject(new Error("两次输入的密码不一样。"));
    var bad = checkCode(email, o.code);
    if (bad) return Promise.reject(new Error(bad));

    var all = accounts();
    if (all[email]) return Promise.reject(new Error("这个邮箱在本机已经注册过了，直接登录就行。"));

    var salt = randomHex(16);
    return hashPassword(password, salt, ITERATIONS).then(function (hash) {
      all[email] = { email: email, salt: salt, hash: hash, iter: ITERATIONS, createdAt: Date.now() };
      if (!saveAccounts(all)) throw new Error("浏览器不让写本机存储，账号存不下来。请关掉无痕模式再试。");
      writeJSON(SESSION_KEY, { email: email, at: Date.now() });
      return { email: email };
    });
  }

  function login(input) {
    var o = input || {};
    var email = normalizeEmail(o.email);
    var password = String(o.password == null ? "" : o.password);

    if (!isEmail(email)) return Promise.reject(new Error("邮箱格式不对，请填完整，例如 123456789@qq.com。"));
    var acc = accounts()[email];
    if (!acc) {
      return Promise.reject(new Error("本机没有这个账号。请先「注册新账号」；如果你换了电脑或清过浏览器数据，账号不会跟着走。"));
    }
    return hashPassword(password, acc.salt, acc.iter).then(function (hash) {
      if (hash !== acc.hash) throw new Error("密码不对。");
      writeJSON(SESSION_KEY, { email: email, at: Date.now() });
      return { email: email };
    });
  }

  function knownEmails() { return Object.keys(accounts()); }

  window.PTAAccount = {
    isEmail: isEmail,
    normalizeEmail: normalizeEmail,
    current: current,
    isLoggedIn: isLoggedIn,
    sendCode: sendCode,
    checkCode: checkCode,
    register: register,
    login: login,
    logout: logout,
    knownEmails: knownEmails
  };
})();