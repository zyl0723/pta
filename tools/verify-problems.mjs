import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = { console };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ["assets/vendor/jscpp.js", "assets/js/analyzer.js", "assets/js/runner.js", "assets/js/problems.js"]) {
  vm.runInContext(readFileSync(path.join(root, f), "utf8"), sandbox, { filename: f });
}
const { PTAAnalyzer, PTARunner, PTAProblems } = sandbox;

let pass = 0, fail = 0;
for (const p of PTAProblems) {
  const findings = PTAAnalyzer.analyze(p.reference).findings;
  if (findings.length) {
    console.log("[参考实现被误报] " + p.title + " -> " + findings.map(f => f.title).join(" | "));
    fail++;
  }
  let allOk = true;
  const details = [];
  for (const s of p.samples) {
    const r = PTARunner.run(p.reference, s.input, { timeoutMs: 4000 });
    if (!r.ok) { allOk = false; details.push("运行出错: " + (r.error ? r.error.title : "?")); continue; }
    const cmp = PTARunner.compareOutput(r.stdout, s.output, {});
    if (!cmp.match) {
      allOk = false;
      const row = cmp.rows[cmp.firstDiff];
      details.push("输入 " + JSON.stringify(s.input) + " 期望 " + JSON.stringify(s.output) + " 实际 " + JSON.stringify(r.stdout)
        + (row ? " 首个不同行: 第" + row.index + "行 期望=" + JSON.stringify(row.expected) + " 实际=" + JSON.stringify(row.actual) : ""));
    }
  }
  if (allOk) { pass++; console.log("通过 " + p.title + "（" + p.samples.length + " 组数据）"); }
  else { fail++; console.log("失败 " + p.title + "\n    " + details.join("\n    ")); }
}
console.log("\n题库校验：通过 " + pass + " / " + (pass + fail));