# Lite backend refactor

Status: in progress. A successful build is not authenticated download acceptance.

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
6. Implement directory selection/reset, file opening/reveal and completion notifications.
7. Test interrupted writes, restart recovery, pause/resume and settings normalization.

## Known remaining limitations

- Response tracking now requires explicit redirects; WebView2 event ordering and
  visibility of redirects still require integration verification. Attachment responses
  need special validation with the native browser download writer disabled.
- Current synchronous COM response reading can block the WebView thread; the overall
  timeout does not make that callback interruptible.
- Pausing restarts the current file. Range resume must be validated before parity claims.
- Failed temporary files are retained for now; lifecycle cleanup belongs to the new
  attempt owner, not independent event callbacks.
- No live authenticated download has been verified for this refactor.
- Windows is the initial target. macOS requires its own transport validation.

Package size must be reported separately from installed size and the shared WebView2
runtime. Keep the React UI and bridge shared; do not bundle Electron as a fallback.
