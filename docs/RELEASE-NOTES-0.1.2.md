# SmartEdu Textbook Library v0.1.2

首个 Windows x64 预发布版，提供安装版和便携版。

## 下载选择

- `SmartEdu Textbook Library Setup 0.1.2.exe`：Windows 安装版，可选择安装目录，并创建桌面和开始菜单快捷方式。
- `SmartEdu Textbook Library 0.1.2.exe`：Windows 便携版，无需安装即可运行。
- `SHA256SUMS.txt`：两个 EXE 的 SHA-256 校验值。

## 本版内容

- 支持官方教材目录加载、分类筛选和多关键词检索。
- 支持应用内登录、单本下载和批量顺序下载。
- 支持暂停、继续、取消、失败重试和断点续传。
- 支持下载任务历史和本地资料管理。
- 下载完成前校验 PDF 文件头和目录文件大小。
- 安装包内附 Apache-2.0 许可证和项目 NOTICE。

## 使用提示

- 本项目是非官方工具，不托管教材，也不绕过平台登录或资源权限。
- 用户只能下载本人平台账号有权访问的资源，并须自行遵守版权法和平台服务条款。
- 安装包尚未进行代码签名，Windows SmartScreen 可能显示“未知发布者”。请从本仓库 Release 页面下载并核对 SHA-256 校验值。
- 教材默认保存到系统“下载”目录下的 `SmartEdu Textbook Library` 文件夹。
- 当前仅提供 Windows x64 版本；macOS 版本尚未完成真实设备测试、Apple 签名和公证。

## 已知情况

- 当前使用默认 Electron 应用图标。
- 少量界面展示细节将在后续版本继续优化。
- 覆盖安装、卸载后重装和数据目录隔离仍建议继续补充验收。
