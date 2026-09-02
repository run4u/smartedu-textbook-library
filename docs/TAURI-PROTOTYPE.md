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
- 单本教材下载改为由已登录的隐藏详情 WebView 发起，并由 WebView2 原生下载回调写入 `.part` 文件；Rust 后端负责进度同步、PDF 文件头与大小校验以及最终改名。该链路用于避免脱离浏览器会话重放请求时出现 HTTP 401。
- 已接入多本教材顺序下载队列，以及暂停、继续、取消、单项重试和批量重试。
- 下载队列会保存到轻量版应用数据目录；程序异常退出后，未完成任务恢复为暂停状态。
- 当前批次结束后会保留最近 5 个历史批次。
- Windows 轻量版仅配置 NSIS 安装包。

## 当前限制

- 多本队列、暂停、取消和重试已完成实现，仍需通过打包版人工验收。
- 资料库仅记录本次轻量版下载结果，系统文件选择、打开和定位操作仍未接入。
- 浏览器下载链路目前不支持断点续传；暂停或取消会中断当前文件，继续时从头下载该任务。
- 轻量版数据目录与 Electron 标准版隔离，尚未实现设置或任务数据迁移。
- 原型的登录、目录缓存和单本下载已经过真实账号与打包版人工验收；完整队列验收前仍不应作为 Release 发布。

## 开发命令

```powershell
npm run lite:dev
npm run lite:check
npm run lite:build
```

Windows 本机构建需要 Rust MSVC 工具链、Microsoft C++ Build Tools、Windows SDK 和 WebView2 Runtime。
