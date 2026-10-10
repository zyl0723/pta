/*!
 * 打包 xterm.js 的入口：只把需要的东西导出成浏览器全局 Xterm。
 * 用法见 tools/build-xterm.mjs（npm run build:terminal）。
 */
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

export { Terminal, FitAddon };
