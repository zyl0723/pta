# 第三方组件与许可声明

本文件说明本仓库中**哪部分代码由作者编写、哪部分是第三方开源代码**，并列出发行物里包含的第三方组件及其许可全文。

## 一、自有代码

以下内容由仓库作者 **zyl0723**（<https://github.com/zyl0723>）编写，版权归作者所有：

- `index.html`、`assets/css/styles.css`、`assets/js/app.js`：页面结构、样式与交互
- `assets/js/analyzer.js`：静态检查规则引擎（12 类规则）
- `assets/js/runner.js`：运行调度、输出逐行对比、报错中文翻译
- `assets/js/problems.js`：基础题型样例与参考实现
- `assets/js/prompt.js`：把题目、代码、批改提示与错误点拼装成提问文本（内置模板，不含题库、不联网）
- `tools/build-jscpp.mjs`、`tools/patch/*`、`tools/shim/*`：构建脚本、解释器补丁、浏览器环境垫片
- `tools/conformance.mjs`、`tools/verify-problems.mjs`、`tools/test-*.mjs`：测试与校验脚本
- `README.md`、`THIRD-PARTY-NOTICES.md`：文档

第三方代码没有被当作自有代码使用：所有第三方组件都在下文列明，且 `assets/vendor/jscpp.js` 文件头部带有署名 banner。

## 二、随仓库分发的第三方组件

`assets/vendor/jscpp.js` 是浏览器端产物（由 `npm run build:engine` 生成），其中打包了下列第三方组件。清单由 `tools/build-jscpp.mjs` 在构建时自动打印，可随时重跑复现核对。

| 组件 | 版本 | 许可 | 版权归属 | 作用 |
| --- | --- | --- | --- | --- |
| JSCPP | 2.0.9 | MIT | Copyright (c) 2015 Felix Hao | C 语言解释器主体 |
| lodash | 4.18.1 | MIT | Copyright OpenJS Foundation and other contributors | JSCPP 的运行时依赖 |
| pegjs-util | 1.4.21 | MIT | Dr. Ralf S. Engelschall（该包未随附 LICENSE 文件，以其 package.json 声明的 MIT 为准） | JSCPP 解析 C 源码时的辅助库 |
| printf | 0.6.1 | MIT | Copyright (c) 2008 Adaltas | JSCPP 的 printf 实现 |

上游地址：JSCPP <https://github.com/felixhao28/JSCPP>；lodash <https://github.com/lodash/lodash>；pegjs-util <https://github.com/rse/pegjs-util>；printf <https://github.com/adaltas/node-printf>。

仅用于构建、不随产物分发的开发依赖：esbuild 0.28.2（MIT，Copyright (c) 2020 Evan Wallace，<https://github.com/evanw/esbuild>）。

### 对 JSCPP 的修改说明

`assets/vendor/jscpp.js` 不是 JSCPP 的原始发布文件，而是用 esbuild 重新打包、并在打包过程中注入补丁后的产物（补丁见 `tools/build-jscpp.mjs` 与 `tools/patch/`）。主要修改：

1. 重写 `scanf` 读取核心，修复读数组元素 / `%c` / `%lf` 时报 "Memory overflow"；
2. 修正指针写入位置（按数组 position 写入）；
3. 修正 `scanf` / `sscanf` 返回值语义（返回成功读入个数，读到 EOF 时返回 -1）；
4. 将 `EOF` 由 `0` 改为 `-1`，并在全局作用域注册；
5. 修正 printf 的占位符类型映射与参数校验，输出时去掉 `%lld` / `%llu` 的长度修饰符。

按 MIT 许可的要求，上述修改在此明确声明。

## 三、署名与原创性说明（为什么不会构成抄袭）

1. **按文件划分归属**：第三方代码只出现在 `assets/vendor/`（构建产物）中，且产物文件头部带署名 banner；自有代码见第一节。
2. **履行许可义务**：MIT 类宽松许可要求「保留版权声明与许可全文」，由第二节满足；对 JSCPP 的修改也已按 MIT 要求明确声明。
3. **页面不调用任何第三方接口**：整个页面不发起任何网络请求，也不嵌入任何第三方服务、SDK 或密钥。点「答案与解析」「练习」时，它只把文本放进剪贴板并打开对应 AI 网站的**普通网页**（ChatGPT、DeepSeek、Kimi、豆包、通义），由使用者自己在那边粘贴发送；这既不涉及调用对方接口，也不代表与这些公司存在任何关联或背书关系。
4. **明确没有做的事**：没有复制、改写或搬运任何来源不明、无许可证的第三方题解仓库；没有把 PTA（拼题A）的题目原文、题目数据或他人提交的答案打包进本项目。题目与批改提示只由使用者在自己的浏览器里粘贴、且不会上传到任何服务器。
5. 本项目的「答案与解析」「练习」两个功能不内置任何题库或答案、也不含任何 AI：它们只把使用者自己粘贴的材料整理成提问文本，交给使用者自己账号的 AI，页面不存储、不收集、也不上传这些内容。

## 四、许可全文

### JSCPP 2.0.9

The MIT License (MIT)

Copyright (c) 2015 Felix Hao

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### lodash 4.18.1

Copyright OpenJS Foundation and other contributors <https://openjsf.org/>

Based on Underscore.js, copyright Jeremy Ashkenas,
DocumentCloud and Investigative Reporters & Editors <http://underscorejs.org/>

This software consists of voluntary contributions made by many
individuals. For exact contribution history, see the revision history
available at https://github.com/lodash/lodash

The following license applies to all parts of this software except as
documented below:

====

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

====

Copyright and related rights for sample code are waived via CC0. Sample
code is defined as all source code displayed within the prose of the
documentation.

CC0: http://creativecommons.org/publicdomain/zero/1.0/

====

Files located in the node_modules and vendor directories are externally
maintained libraries used by this software which have their own
licenses; we recommend you read them, as their terms may differ from the
terms above.

### printf 0.6.1

The MIT License (MIT)

Copyright (c) 2008 Adaltas

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### pegjs-util 1.4.21

该包未随附 LICENSE 文件，其 package.json 声明 `"license": "MIT"`，作者为 Dr. Ralf S. Engelschall（<http://engelschall.com>，<https://github.com/rse/pegjs-util>）。适用文本为标准 MIT 许可：

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## 五、自有代码的授权

本仓库自有代码目前未声明开源许可，作者保留所有权利（All rights reserved）。若要以 MIT 等许可发布，由作者决定后再修改本节。
