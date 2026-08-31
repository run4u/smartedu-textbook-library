# SmartEdu Textbook Library

中文说明：[README.zh-CN.md](README.zh-CN.md)

SmartEdu Textbook Library is a local-first desktop application for finding, distinguishing, downloading, and managing textbook resources that users can access through their own platform accounts.

> **Unofficial project:** This independent personal-research tool is not affiliated with or endorsed by the Smart Education platform or any textbook rights holder. It does not host textbooks, provide public download links, or bypass authentication, access controls, or technical protection measures. Users and redistributors are responsible for complying with copyright law and platform terms.

This repository contains source code and project documentation only. It must not contain downloaded textbooks, browser profiles, cookies, access tokens, authorization URLs, personal logs, or credentials.

## Features

- Load the official textbook catalog and filter by school stage, subject, grade, volume, and edition.
- Search original official titles with multiple keywords, reset filters, and clear searches.
- Show single-resource classifications as compact rows and multiple resources as parent-child groups.
- Select all visible results, use parent checked/indeterminate states, and optionally skip downloaded resources.
- Sign in through a restricted in-app platform window, automatically close it after successful sign-in, and clear the saved application session on sign-out.
- Run single or sequential batch downloads with resolution, progress, validation, failure details, and task history.
- Pause, resume, cancel, retry failed tasks, continue partial downloads, and clean up `.part` files.
- Browse a persisted local library, filter by keyword or subject, open a textbook, and reveal it in the system file manager.

## Resource And File Rules

`contentId` is the unique identity of a resource. A title is not an identity, and resources are never merged or skipped automatically just because their titles match. Resources with different years, sizes, contents, or IDs remain independently selectable and downloadable.

Downloaded files are saved under the system Downloads directory in `SmartEdu Textbook Library`. Filenames contain the classification, resource year, and a short resource ID, for example:

```text
初中_英语_七年级_上册_北师大版_2026年度_f4a32947.pdf
```

Downloads are first written to `.part` files. Before completion, the application checks the PDF header and catalog-provided file size, then atomically replaces the destination file for that same resource. Users may deliberately download an existing resource again.

## Current Status

The development build supports the complete catalog, sign-in, download queue, and local-library workflow described above. Windows NSIS installer and portable builds can be produced locally, but they are unsigned and still need the remaining manual acceptance checks documented in [Testing Guide](docs/TESTING.md).

Windows x64 installer and portable packages are available from [GitHub Releases](https://github.com/run4u/smartedu-textbook-library/releases/tag/v0.1.2). Version `0.1.2` is published as a pre-release because the packages are not code-signed and some display and extended acceptance scenarios remain to be refined.

Windows SmartScreen may show an “Unknown publisher” warning. Verify the SHA-256 checksums attached to the release before running a downloaded package. macOS binaries are not currently provided because the project has not yet completed macOS hardware testing, Apple signing, or notarization.

## Development

Use a current Node.js LTS release and npm:

```bash
npm ci
npm test
npm run check
npm run build
npm run dev
```

On Windows, `启动桌面端.cmd` starts the desktop development build. Keep its terminal window open while the application is running.

On macOS or Linux, run the commands above from a terminal. Packaged builds are currently Windows-only, and source-mode behavior on macOS and Linux still requires community testing.

Do not commit `.electron-data`, downloaded files, `.part` files, browser profiles, or local logs.

## Privacy And Compliance

- Sign-in takes place in a restricted in-app window. Renderer UI code cannot directly read passwords, cookies, tokens, authorization headers, or signed download URLs.
- The platform session, task records, and local-library index stay on the user's device.
- The repository and release archives must not include textbook files, download records, browser profiles, sign-in data, or full network logs.
- The project does not provide account sharing, resource mirrors, permission bypasses, or bulk redistribution features.
- Textbook copyrights, platform content, platform trademarks, and terms of service remain with their respective rights holders.

See [Privacy and Security](docs/PRIVACY.md) and [Security Policy](SECURITY.md).

## Documentation

- [Project Design](docs/PROJECT-DESIGN.md)
- [Feature Specification](docs/FEATURE-SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Version Rules](docs/VERSIONING.md)
- [Privacy and Security](docs/PRIVACY.md)
- [Roadmap](docs/ROADMAP.md)
- [Development Status](docs/DEVELOPMENT-STATUS.md)
- [Remaining Work](docs/REMAINING-WORK.md)
- [Technical Decisions](docs/DECISIONS.md)
- [Testing Guide](docs/TESTING.md)
- [Open Source Guide](docs/OPEN-SOURCE-GUIDE.md)

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing. Do not include accounts, passwords, cookies, tokens, authorization URLs, textbook files, or unredacted logs in issues or pull requests.

## License

Source code is licensed under Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). This license does not cover textbooks, platform data, third-party trademarks, or other content owned by their respective rights holders.
