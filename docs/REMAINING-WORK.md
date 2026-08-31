# 剩余工作清单

最后更新：2026-08-31

本文档只列“还没做完 / 需要你决策 / 建议补强”的事项；当前实现状态以 [开发交接记录](DEVELOPMENT-STATUS.md) 为准。

## 当前已验证的基线

- `npm test`：27 项自动化测试通过。
- `npm run check` 与 `npm run build`：通过。
- `npm run dist`：可生成 NSIS 安装版与便携版（当前未签名、默认图标）。
- GitHub Release：`v0.1.2` 以 Windows x64 Pre-release 发布，包含安装版、便携版和 SHA-256 校验文件。
- 开发版启动入口：仓库根目录 `启动桌面端.cmd`。

## 一、待验证（需要你实际操作）

1. `0.1.2` 最新打包版登录状态、关闭登录窗口、正常登录自动关闭和未登录即时提示已验证通过。
2. `0.1.2` 批量下载断网恢复与自动续传已验证通过；仍建议补测“重试失败项”只重试失败/取消项，并自动恢复同批次暂停的剩余项。
3. `0.1.2` 安装版已完成实际安装和主要功能使用，未发现明显功能问题；仍需补测覆盖安装、卸载后重装，确认不影响下载的文件。
4. 确认打包版数据目录（`%APPDATA%\smartedu-library-desktop`）与开发版 `.electron-data` 相互独立。

## 二、发布前必须

1. 应用图标：定稿 PNG/SVG，转成多尺寸 `.ico` 放到 `build/icon.ico`，配置 `win.icon` 后重新打包。
2. 代码签名：消除 Windows SmartScreen“未知发布者”提示；需要代码签名证书（可先用自签名验证流程，正式发布再用真证书）。
3. 确定 Windows 发布者名称，并在具备代码签名证书后写入对应的打包配置。
4. 确定版本策略与发布流程：版本号规则、GitHub Releases、是否接入 `electron-updater` 自动更新。
5. macOS 发布：先在真实 Mac 或 macOS CI 上完成源码运行和打包测试；正式分发前需要 Apple Developer 证书、签名和公证。

## 三、开源准备

1. [x] Apache-2.0 许可证、`NOTICE` 与非官方合规声明。
2. [x] 独立干净仓库：`https://github.com/run4u/smartedu-textbook-library`。
3. [x] README：项目定位、源码运行、隐私、版权和许可证边界。
4. [x] 社区文件：`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`SECURITY.md`、Issue/PR 模板。
5. [x] GitHub Actions：push/PR 自动运行 `npm ci`、`test`、`check`、`build`，Ubuntu CI 已通过。

## 四、已确认搁置或待定

1. 目录快照变化提示：新增/更新资源的标记“何时消失”交互未确定，暂不实现。
2. PDF 书签增强（可选）：从官方目录树生成书签，原始 PDF 保持不变。
3. 便携版数据独立（可选）：让便携版把数据存在 exe 旁边，与安装版不共用 `%APPDATA%`。
4. 历史批次直接重试（可选）：目前只能对当前批次重试，历史批次仅可查看/清空。

## 五、工程卫生（建议但不阻塞）

1. 依赖版本维护：继续使用 `package-lock.json` 和 `npm ci`，升级依赖时审查版本范围并提交 lock 文件。
2. 引入 ESLint/Prettier（可选）。
3. 扩展自动化测试：基于脱敏 fixture 的 IPC 集成测试、下载器真实流式写入测试、安装包冒烟测试脚本。

## 优先级建议

1. 先验证最新打包版与“重试失败项”。
2. 补齐图标、签名和 Windows 发布者配置，产出可对外分发的 beta。
3. 将当前手工 GitHub Release 流程自动化，并在后续稳定版中加入签名产物。
4. 其余均为可选增强，不阻塞使用。

## 已知限制（行为说明，非缺陷）

- “已登录”判断依赖 `UC_TOKEN` / `UC_SSO_TGC` 等认证 Cookie 名；若平台改名需同步更新 `isCredentialCookie`。
- 单批历史最多保留 5 个批次；开始新批次会替换当前批次视图。
- 下载遇到 `401` 表示平台会话失效，需重新登录后重试失败项。
