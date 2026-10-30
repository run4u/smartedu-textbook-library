# Tauri 轻量版原型

该原型位于 `tauri-prototype` 分支，目标是验证在复用现有 React 界面的前提下，以系统 WebView 替代 Electron 内置 Chromium。

当前进度及构建记录以 [Lite 状态文档](LITE-STATUS.md) 为准（更新于 2026-10-30）。Windows CI 已能生成安装包，但登录和下载仍待真实账号验收。

## 当前完成

- Electron 与 Tauri 共用同一套 `TextbookBridge` 页面契约。
- Electron 仍使用原有 preload/IPC，不改变标准版行为。
- Tauri 使用 Rust command 和 event 适配器。
- Rust 后端可加载官方教材目录，并在失败时读取本地缓存。
- 已有目录缓存会在启动时立即显示，官方分片在后台并发刷新，完成后自动更新界面。
- Rust 后端提供独立设置文件和平台登录 WebView 窗口。
- 登录窗口可读取平台 HttpOnly Cookie，依据令牌变化和 Cookie 稳定时间判断何时自动返回，并复用 WebView 的持久化登录档案。这是登录就绪判断，不能证明服务端会话仍然有效。
- 可在轻量版内清除平台 Cookie、缓存及其他 WebView 浏览数据。
- 单本教材下载由共享登录档案的详情 WebView 发起，Windows 通过 WebView2 响应观察器读取内容并写入每次尝试独立的 `.part` 文件；原生下载写入器已禁用。Rust 后端负责状态同步、PDF 文件头与大小校验以及最终替换。解析超过 15 秒会显示详情页，便于完成登录或阅读确认。
- 已接入多本教材顺序下载队列，以及暂停、继续、取消、单项重试和批量重试。
- 下载队列会保存到轻量版应用数据目录；程序异常退出后，未完成任务恢复为暂停状态。
- 当前批次结束后会保留最近 5 个历史批次。
- Windows 轻量版仅配置 NSIS 安装包。

## 当前限制

- 多本队列、暂停、取消和重试已完成实现，仍需通过打包版人工验收。
- 资料库记录轻量版下载结果；目录选择/重置、文件打开/定位已接入，仍需打包版人工验收。
- 浏览器下载链路目前不支持断点续传；暂停或取消会中断当前文件，继续时从头下载该任务。
- 轻量版数据目录与 Electron 标准版隔离，尚未实现设置或任务数据迁移。
- 旧文档曾记录早期原型验收；后续 `c019fad` 安装包的真实下载失败，`c716eca` 虽通过 Windows CI，但没有复测结论。当前不能视为登录下载闭环已验收。
- 同步 COM 响应读取仍可能阻塞 WebView 线程，重定向、附件、取消和大文件需要集成验证。

## 开发命令

```powershell
npm run lite:dev
npm run lite:check
npm run lite:build
```

当前采用 GitHub Actions 的 Windows runner 检查和打包，无需在本机安装 C++ Build Tools。只有选择本机构建时，才需要 Rust MSVC 工具链、Microsoft C++ Build Tools、Windows SDK 和 WebView2 Runtime。
