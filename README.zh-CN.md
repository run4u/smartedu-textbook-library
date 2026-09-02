# SmartEdu Textbook Library

English: [README.md](README.md)

SmartEdu Textbook Library 是一个本地优先的桌面应用，用于查找、区分、下载和管理用户通过本人平台账号有权访问的教材资源。

> **非官方项目：** 本项目是独立的个人教研工具，不隶属于、也未获得国家智慧教育平台或任何教材权利人的官方认可。项目不托管教材、不提供公共下载链接，也不绕过身份认证、访问控制或技术保护措施。用户和再分发者须自行遵守版权法及平台服务条款。

本仓库只包含源代码和项目文档，不得包含已下载教材、浏览器档案、Cookie、访问令牌、授权地址、个人日志或账号凭据。

## 当前能力

- 加载官方教材目录，支持学段、学科、年级、册次和版本筛选。
- 支持原始官方标题、多关键词检索、筛选重置和搜索清除。
- 按分类展示教材；单资源使用紧凑单行，多资源使用父子关系展示。
- 支持全选当前结果、父级全选/半选和可选的“跳过已下载”。
- 在应用内受限窗口登录平台，登录成功后自动关闭，可退出并清除本应用保存的登录档案。
- 支持单本和批量顺序下载，显示解析、下载进度、校验、失败原因和任务历史。
- 支持暂停、继续、取消、失败重试、断点续传和 `.part` 临时文件清理。
- 支持本地资料索引、关键词/学科筛选、打开教材和定位所在文件夹。
- 支持在设置页更改下载目录、自定义文件名模板、配置启动筛选与默认页面，并管理任务记录和登录档案。

## 资源与文件规则

`contentId` 是资源的唯一身份。标题不是资源身份，项目不会仅因标题相同而自动合并或跳过资源。不同年度、大小、内容或 ID 的资源均可独立选择和下载。

教材文件默认保存到系统“下载”目录下的 `SmartEdu Textbook Library` 文件夹，也可以在设置页选择其他目录。默认文件名包含分类、资源年度和短资源 ID，例如：

```text
初中_英语_七年级_上册_北师大版_2026年度_f4a32947.pdf
```

下载过程先写入 `.part` 文件，完成前检查 PDF 文件头和目录提供的文件大小，校验通过后原子替换同一资源的目标文件。启用“跳过已下载”时不会覆盖已有文件；取消该选项后可以主动重新下载。

## 当前状态

开发版已支持上述完整的目录、登录、下载队列和本地资料流程。项目可以在本地生成 Windows NSIS 安装版和便携版，但产物尚未签名，仍需完成 [测试指南](docs/TESTING.md) 中列出的剩余人工验收。

Windows x64 `0.1.3-alpha.1` 安装版和便携版可从 [GitHub Releases](https://github.com/run4u/smartedu-textbook-library/releases/tag/v0.1.3-alpha.1) 下载。该测试版包含最新的设置和显示改进，安装包尚未进行代码签名，仍需补充扩展验收测试。

Windows SmartScreen 可能显示“未知发布者”提示，运行前请核对 Release 附件中的 SHA-256 校验值。

本次 GitHub Release 不包含 macOS 实验包。Apple Silicon（arm64）测试单独进行，不支持 Intel Mac；测试方法见 [macOS Apple Silicon 实验包测试](docs/MACOS-ARM64-TESTING.md)。

## 开发运行

需要当前仍受支持的 Node.js LTS 和 npm：

```bash
npm ci
npm test
npm run check
npm run build
npm run dev
```

Windows 用户也可以双击仓库根目录的 `启动桌面端.cmd`。开发版运行时请保持命令行窗口打开。

macOS 和 Linux 用户可直接在终端运行上述命令。macOS 实验包只构建 Apple Silicon（arm64），源码运行和打包行为仍需要社区在真实设备上测试。

请勿提交 `.electron-data`、已下载文件、`.part` 文件、浏览器档案或本地日志。

## 隐私与合规

- 登录在应用内受限窗口中完成，渲染界面代码不能直接读取密码、Cookie、Token、授权请求头或签名下载地址。
- 平台登录档案、任务记录和本地资料索引只保存在用户设备上。
- 项目仓库和发行包不得包含教材文件、下载记录、浏览器档案、登录数据或完整网络日志。
- 项目不提供账号共享、资源镜像、绕过权限或批量传播功能。
- 教材版权、平台内容、平台商标和服务条款归相应权利人所有。

详见 [隐私与安全说明](docs/PRIVACY.md) 和 [安全策略](SECURITY.md)。

## 文档

- [项目总体设计](docs/PROJECT-DESIGN.md)
- [功能规格与已确认决策](docs/FEATURE-SPEC.md)
- [系统架构](docs/ARCHITECTURE.md)
- [版本与资源身份规则](docs/VERSIONING.md)
- [隐私与安全说明](docs/PRIVACY.md)
- [路线图](docs/ROADMAP.md)
- [开发交接记录](docs/DEVELOPMENT-STATUS.md)
- [剩余工作清单](docs/REMAINING-WORK.md)
- [技术决策记录](docs/DECISIONS.md)
- [测试指南](docs/TESTING.md)
- [macOS Apple Silicon 实验包测试](docs/MACOS-ARM64-TESTING.md)
- [开源规范](docs/OPEN-SOURCE-GUIDE.md)

## 参与贡献

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。提交问题或拉取请求时，请勿粘贴账号、密码、Cookie、Token、授权 URL、教材文件或未脱敏日志。

## 许可证

源代码采用 Apache-2.0，详见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。该许可证不涵盖教材、平台数据、第三方商标或其他权利人的内容。
