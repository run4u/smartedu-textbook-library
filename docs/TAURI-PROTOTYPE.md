# Tauri 轻量版原型

该原型位于 `tauri-prototype` 分支，目标是验证在复用现有 React 界面的前提下，以系统 WebView 替代 Electron 内置 Chromium。

## 当前完成

- Electron 与 Tauri 共用同一套 `TextbookBridge` 页面契约。
- Electron 仍使用原有 preload/IPC，不改变标准版行为。
- Tauri 使用 Rust command 和 event 适配器。
- Rust 后端可加载官方教材目录，并在失败时读取本地缓存。
- Rust 后端提供独立设置文件和平台登录 WebView 窗口。
- Windows 轻量版仅配置 NSIS 安装包。

## 当前限制

- 尚未可靠读取 WebView2 中的 HttpOnly 平台凭据 Cookie，因此登录状态检测和带凭据下载尚未完成。
- 下载队列、断点续传、资料库和系统文件操作仍使用明确的原型占位实现。
- 轻量版数据目录与 Electron 标准版隔离，尚未实现设置或任务数据迁移。
- 原型未经过真实平台账号与打包版人工验收，不应作为 Release 发布。

## 开发命令

```powershell
npm run lite:dev
npm run lite:check
npm run lite:build
```

Windows 本机构建需要 Rust MSVC 工具链、Microsoft C++ Build Tools、Windows SDK 和 WebView2 Runtime。
