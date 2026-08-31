# SmartEdu Textbook Library

SmartEdu Textbook Library is a local-first desktop application for finding, distinguishing, and saving textbook resources that a user can access through their own SmartEdu session.

> **Unofficial project:** This independent personal-research tool is not affiliated with or endorsed by the Smart Education platform or any textbook rights holder. It does not host textbooks, provide public download links, or bypass authentication and access controls. Users and redistributors are responsible for complying with copyright law and platform terms.

This repository contains application code only. It must never contain downloaded textbooks, browser profiles, cookies, access tokens, authorization URLs, personal logs, or credentials.

## Product Direction

- Desktop-first: launch a single application, not a local web server.
- Resource-first: `contentId` identifies a resource; a title never identifies a resource on its own.
- Version-aware: resource year, online time, update time, size, and ID remain visible.
- User-controlled: similar resources are shown together but never auto-merged, skipped, or overwritten.
- Local and private: session data and download history stay on the user's device.

## Current Status

The development build can load the official catalog, filter and search it, open a private in-app login window, download authorized PDFs with progress and validation, manage sequential batch tasks, and browse a persisted local library. The current release artifacts are unsigned and still require manual acceptance testing.

## Development

```powershell
npm install
npm run dev
```

For Windows development, keep the terminal window open while the app is running. The repository-root launcher `启动新版桌面端.cmd` starts the desktop development build. Do not commit `.electron-data`, downloaded files, or `.part` files.

On macOS or Linux, run `npm ci` and `npm run dev` from a terminal. Packaged releases are currently Windows-only; source-mode behavior on macOS still requires community testing.

## License

Source code is licensed under Apache-2.0. The license does not cover textbooks, platform content, third-party trademarks, or other materials owned by their respective rights holders. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Documentation

- [Project Design](docs/PROJECT-DESIGN.md)
- [Feature Specification](docs/FEATURE-SPEC.md)
- [Open Source Guide](docs/OPEN-SOURCE-GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Version Rules](docs/VERSIONING.md)
- [Privacy and Security](docs/PRIVACY.md)
- [Roadmap](docs/ROADMAP.md)
- [Development Status](docs/DEVELOPMENT-STATUS.md)
- [Technical Decisions](docs/DECISIONS.md)
- [Testing Guide](docs/TESTING.md)
