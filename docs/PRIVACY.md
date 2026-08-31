# Privacy and Security

- The application only uses resources accessible to the user's own session.
- Browser profiles, cookies, access tokens, authorization headers, signed URLs, and full request logs are private application data.
- User interface code cannot read credentials directly. Electron uses context isolation and a narrow preload API.
- Diagnostic logs are redacted by default.
- Downloaded PDFs are user files and are not included in the repository, release archives, analytics, or crash reports.
- A future release must use operating-system protected storage for session secrets. Plain-text token files are not acceptable.
