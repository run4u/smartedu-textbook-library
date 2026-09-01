# macOS Apple Silicon 实验包测试

本项目的 macOS 包只面向 Apple Silicon（arm64），不支持 Intel Mac。当前测试包未进行 Apple 代码签名和公证，只用于邀请测试，不属于正式发行版。

## 获取与校验

GitHub Actions 的 `macOS arm64 experimental build` 工作流会将以下文件分别上传为 Artifact，测试时优先下载 DMG 和 SHA-256 校验文件，ZIP 作为备用：

- `SmartEdu Textbook Library-0.1.3-alpha.1-macOS-arm64.dmg`
- `SmartEdu Textbook Library-0.1.3-alpha.1-macOS-arm64.zip`
- `SHA256SUMS-macOS-arm64.txt`

下载后先核对 SHA-256，再测试 DMG。

## 首次打开

由于应用未签名、未公证，macOS Gatekeeper 会阻止直接双击。测试者应在 Finder 中按住 Control 点击应用并选择“打开”，然后在系统提示中再次确认；也可以到“系统设置 → 隐私与安全性”允许本次打开。

不要全局关闭 Gatekeeper，也不要对来源不明的软件执行绕过命令。

## 最低测试项目

1. 确认设备是 Apple Silicon，并记录 macOS 版本。
2. 从 DMG 拖入“应用程序”并启动；确认菜单、侧栏和中文界面显示正常。
3. 加载教材目录，测试筛选、搜索、资源年度/大小/更新时间单行展示。
4. 打开应用内登录窗口，确认登录成功后自动关闭且重新启动后登录档案仍存在。
5. 下载一个小文件，确认保存到 `~/Downloads/SmartEdu Textbook Library`，PDF 校验和本地资料页正常。
6. 在设置页更改下载目录和文件名预设，下载另一文件并核对实际路径和名称。
7. 测试暂停、继续、取消、失败重试和重新启动后的任务恢复。
8. 测试“打开”“所在文件夹”和下载完成系统通知。
9. 清除任务记录和登录档案，确认不会删除已下载 PDF。
10. 记录崩溃、空白窗口、权限提示、登录失败、下载失败和 UI 异常的截图与复现步骤；提交前必须遮盖账号和个人信息。

## 反馈内容

- Mac 型号与芯片（例如 M1/M2/M3/M4）
- macOS 版本
- 使用 DMG 还是 ZIP
- 是否成功登录、下载、暂停/恢复、打开文件和收到通知
- 问题的复现步骤与已脱敏截图
