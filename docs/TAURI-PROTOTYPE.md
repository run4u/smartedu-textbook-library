# Tauri 轻量版原型

该原型位于 `tauri-prototype` 分支，目标是验证在复用现有 React 界面的前提下，以系统 WebView 替代 Electron 内置 Chromium。

## 当前完成

- Electron 与 Tauri 共用同一套 `TextbookBridge` 页面契约。
- Electron 仍使用原有 preload/IPC，不改变标准版行为。
- Tauri 使用 Rust command 和 event 适配器。
- Rust 后端可加载官方教材目录，并在失败时读取本地缓存。
- 已有目录缓存会在启动时立即显示，官方分片在后台并发刷新，完成后自动更新界面。
- Rust 后端提供独立设置文件和平台登录 WebView 窗口。
- 登录窗口可读取平台 HttpOnly Cookie，识别登录成功后自动返回，并复用 WebView 的持久化登录档案。
- 可在轻量版内清除平台 Cookie、缓存及其他 WebView 浏览数据。
- Windows 轻量版仅配置 NSIS 安装包。

## 当前限制

- 登录状态与持久化仍需使用真实平台账号验证；带凭据下载尚未完成。
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
