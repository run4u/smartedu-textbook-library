# Contributing

感谢参与 SmartEdu Textbook Library。请先阅读 README、项目总体设计、功能规格和开源规范。

## 开发环境

- Node.js LTS
- npm
- Windows 或 macOS（平台登录和打包行为需要分别验证）

```bash
npm ci
npm test
npm run check
npm run build
npm run dev
```

## 提交要求

- 每个提交只解决一个清晰的问题。
- 修改下载、登录、文件写入或 IPC 时必须补充测试或说明无法自动化的原因。
- 不提交教材文件、`.part`、登录数据、Cookie、Token、签名 URL、完整网络日志或用户截图。
- 不实现绕过登录、权限、技术保护或账号共享。
- UI 文案和错误提示应让用户知道下一步怎么做。

## Pull Request

请说明问题、实现方式、测试命令和隐私影响。涉及平台适配的改动还要说明失败时的用户可见行为。
