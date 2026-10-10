/*!
 * 把 xterm.js 打成浏览器直接能用的单文件产物，并复制它配套的样式。
 * 用法：npm run build:terminal
 *
 * 产物：assets/vendor/xterm.js（未改动 xterm.js 源码，只做打包压缩）、
 *       assets/vendor/xterm.css（从 npm 包原样复制）。
 * 署名与许可见仓库根目录 THIRD-PARTY-NOTICES.md。
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = path.join(root, "node_modules/@xterm/xterm");
const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const fitPkg = JSON.parse(readFileSync(path.join(root, "node_modules/@xterm/addon-fit/package.json"), "utf8"));

const banner = [
  "/*!",
  " * 本文件由 tools/build-xterm.mjs 自动生成，内容是第三方开源终端库 xterm.js（未修改其源码），请勿手工编辑。",
  " * xterm.js " + pkg.version + "（MIT 许可）：Copyright (c) 2017-2019 The xterm.js authors (https://github.com/xtermjs/xterm.js)、",
  " * Copyright (c) 2014-2016 SourceLair Private Company (https://www.sourcelair.com)、Copyright (c) 2012-2013 Christopher Jeffrey。",
  " * 同时打包了官方配套插件 @xterm/addon-fit " + fitPkg.version + "（MIT 许可）：Copyright (c) 2019 The xterm.js authors。",
  " * 完整许可文本见仓库根目录 THIRD-PARTY-NOTICES.md。",
  " */",
].join("\n");

const result = await esbuild.build({
  entryPoints: [path.join(root, "tools/xterm-entry.js")],
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "Xterm",
  target: "es2019",
  outfile: path.join(root, "assets/vendor/xterm.js"),
  banner: { js: banner },
  legalComments: "eof",
  logLevel: "warning",
  metafile: true,
});

const cssBanner = [
  "/*!",
  " * xterm.js " + pkg.version + " 的配套样式（MIT 许可，版权归 The xterm.js authors / SourceLair Private Company / Christopher Jeffrey）。",
  " * 由 tools/build-xterm.mjs 从 npm 包里原样复制，未做修改；许可全文见仓库根目录 THIRD-PARTY-NOTICES.md。",
  " */",
  "",
].join("\n");
writeFileSync(
  path.join(root, "assets/vendor/xterm.css"),
  cssBanner + readFileSync(path.join(pkgDir, "css/xterm.css"), "utf8"),
  "utf8"
);

const output = Object.entries(result.metafile.outputs)[0];
console.log("构建完成:", output[0], Math.round(output[1].bytes / 1024) + " KB");
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const matched = input.replace(/\\/g, "/").match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)\//);
  if (matched) packages.add(matched[1]);
}
console.log("打包进产物的第三方包:", [...packages].sort().join(", "));
console.log("（署名与许可信息见 THIRD-PARTY-NOTICES.md，请保持同步）");
