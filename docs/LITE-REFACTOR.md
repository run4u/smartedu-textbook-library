# Lite backend refactor

Status (2026-09-17): in progress. A successful build is not authenticated download acceptance.

## Implemented locally

- Extract PDF validation and file replacement into `src-tauri/src/download_file.rs`.
- Match Electron's leading PDF signature check; reject HTML containing a signature.
- Close the file reader before replacement. Never delete an existing destination first.
- Perform validation and commit on a blocking worker, outside the async executor.
- Add tests for invalid responses preserving existing files and successful replacement.
- Run Rust library tests in Windows CI before packaging.
- Close the detail window if transfer startup fails; bound overall browser waiting.
- Extract Windows transport into `browser_download.rs` and explicit redirect matching
  into `response_route.rs`; reject unrelated PDFs and preserve URL path case/query.
- Disable the competing native Windows download writer. Surface response read errors
  directly, and stop delayed response writers when their result receiver is gone.

## Stability fixes (2026-09-17)

- Use process/sequence IDs for batches and detail windows; fast retries no longer
  reuse the same second-based label or task ID.
- Give each transfer a unique temporary file. Close its receiver before stopping
  the window, ignore inactive response callbacks, and clean the attempt file on exit.
  An old callback can only affect its own file, never a retry or completed PDF.
- Register cancellation under the queue lock before releasing a selected task.
  Reject retry/replacement/record deletion until the previous worker has exited.
- Recompute cached download flags from files that still exist on disk.
- Implement folder selection/reset and file open/reveal through Tauri's official
  dialog/opener plugins. Match bridge argument names and display rejected commands
  in the renderer. Block directory changes while downloading, paused, or stopping.
- Recompute default/effective directories at startup rather than loading stale
  derived paths. Add Rust regressions for attempt isolation, cached flags, and
  directory persistence/reset while a worker is active.

Validation on this workstation:

- Existing Vitest suite: 35 passed; TypeScript check and production frontend build passed.
- Rust formatting and git whitespace checks passed.
- Rust library tests/build are blocked by missing MSVC `link.exe`. New Rust tests
  have NOT run. No new Lite executable has been produced or live login verified.
- Run `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib` and
  `npm run lite:build` from a Visual Studio C++ developer environment before
  acceptance. Exercise login, download, rapid cancel/retry, directory reset, and
  opening/revealing a downloaded file in that build.

## Authentication and resolver fixes (2026-09-17)

- Install a Windows native request observer before navigating to the detail page;
  capture resource URLs and authorization in memory, including frame requests.
- Prefer authorization observed on the exact PDF URL (ignore fragment only).
  Do not substitute headers from unrelated API requests on Windows. Allow a
  six-second readiness window for cookie-only/signed PDF requests.
- Rank actual PDF candidates instead of filtering all page URLs by content ID;
  resolve relative viewer file URLs and reject non-HTTPS targets.
- Ignore empty/expired credential cookies; wait for a changed application token,
  return to basic.smartedu.cn and three seconds of stable cookies before closing
  login automatically. This remains a readiness heuristic, not server validation.
- Show actionable 401/403 errors and surface login/logout failures in the UI.
  Block clearing the session while the download queue is active.
- Added Rust request identity and PDF selection regressions. Final frontend tests
  (35), type check/build and Rust formatting passed. Rust tests remain blocked
  by missing MSVC link.exe; authenticated download and packaging remain unverified.

## Required before a new acceptance package

1. Prove a single WebView2 transport with authenticated requests, request identity,
   redirects, full response bytes, cancellation and progress. CDP is a candidate,
   not a validated replacement. Exercise controlled HTTP fixtures before live login.
2. Remove competing native-download and response-observer file writers. Late callbacks
   must not write after cancellation or into another attempt's temporary file.
3. Capture authorization for the target request, with explicit session readiness.
4. Give each queue attempt an immutable directory, filename and overwrite policy.
   Check existing downloads in the backend as well as the renderer.
5. Separate queue, session, catalog, storage and settings modules. Use shared fixture
   expectations to compare Rust and Electron behavior.
6. Verify the new directory/file commands in a packaged build; implement completion notifications.
7. Test interrupted writes, restart recovery, pause/resume and settings normalization.

## Known remaining limitations

- Response tracking now requires explicit redirects; WebView2 event ordering and
  visibility of redirects still require integration verification. Attachment responses
  need special validation with the native browser download writer disabled.
- Current synchronous COM response reading can block the WebView thread; the overall
  timeout does not make that callback interruptible.
- Pausing restarts the current file. Range resume must be validated before parity claims.
- Temporary files are cleaned on normal exit/interrupt. A process crash can still
  leave unique `.part` files; startup orphan recovery is not implemented.
- No live authenticated download has been verified for this refactor.
- Windows is the initial target. macOS requires its own transport validation.

Package size must be reported separately from installed size and the shared WebView2
runtime. Keep the React UI and bridge shared; do not bundle Electron as a fallback.
