# 第三方组件与协议声明

WinPlayer 本体源代码遵循 **MIT License**（见 [LICENSE](LICENSE)），但集成了若干遵循其他协议的第三方组件。分发本软件时，请保留以下声明。

## Tauri

- **项目**：[Tauri](https://github.com/tauri-apps/tauri)
- **协议**：MIT 或 Apache-2.0（双许可）
- **用途**：桌面应用框架（Rust 后端 + WebView 前端）

## Vue.js

- **项目**：[Vue](https://github.com/vuejs/core)
- **作者**：Evan You
- **协议**：MIT
- **用途**：前端 UI 框架

## qrcode

- **项目**：[node-qrcode](https://github.com/soldair/node-qrcode)
- **作者**：Ryan Day 及贡献者
- **npm 包**：[`qrcode`](https://www.npmjs.com/package/qrcode)
- **协议**：MIT
- **用途**：插件管理页的扫码登录区。插件运行在无 DOM 的 Web Worker 沙箱中，只能回传二维码的**内容字符串**（如 `https://music.163.com/login?codekey=...`），图片必须由主程序在本地渲染，本库即承担该职责。

## 其他依赖

前端与 Rust 依赖的完整列表参见 `package.json` 与 `src-tauri/Cargo.lock`，各依赖协议以其上游仓库声明为准。
