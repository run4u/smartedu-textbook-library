# Architecture

The desktop app is organized around stable local domain rules. Platform-specific behavior is isolated behind adapters so a platform change does not leak through the user interface, database, or file naming rules.

```text
Electron shell
  -> React workbench
  -> preload API boundary
  -> application services
       -> catalog adapter
       -> session adapter
       -> download worker
       -> local metadata repository (JSON now, SQLite may follow)
       -> filesystem library
```

## Boundaries

`renderer` contains no Node.js access, no credentials, and no direct platform requests. It receives only the narrow APIs exposed through `preload`.

`main` owns windows, application data paths, settings, task orchestration, and IPC validation.

`platform` adapters may fetch official catalog data or use a user-authorized browser session. They return normalized resource data and never expose credentials to the renderer.

`storage` owns the private task snapshot and downloaded-file mappings (currently JSON under the application data directory). SQLite remains an optional future migration if catalog history or query volume requires it. A record that a resource was downloaded is informational only; it must not prevent a user from downloading it again.

## Current Vertical Slice

The working vertical slice includes an official catalog adapter, a private Electron session, an in-app login window, a hidden detail resolver, streamed single-file downloads, `.part` files, PDF/size validation, atomic completion, and renderer-visible progress events.

The catalog adapter and download implementation remain platform-specific. The renderer receives normalized catalog data and redacted status only; it never receives session cookies, authorization headers, or signed download URLs.
