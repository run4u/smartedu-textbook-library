# Roadmap

## M0: Product Foundation

- [x] Repository boundary and privacy rules
- [x] Electron shell and responsive catalog workbench
- [ ] Code signing and release automation
- [x] First unsigned Windows x64 GitHub pre-release

## M1: Local Catalog and Library

- [x] Private persistent task/library metadata (JSON)
- [ ] SQLite schema and migrations if scale requires it
- [x] Official catalog loading
- [x] Local filters, multi-keyword search, and classification-based grouping
- [ ] Catalog snapshots and visible freshness/change state
- [x] Downloaded-file library and persisted output mapping
- [x] Persistent downloaded-state records (library index in app data)

## M2: Authorized Download Tasks

- [x] User-controlled persistent in-app login window and logout
- [x] Single-file platform adapter with redacted renderer feedback
- [x] One-session queue, cancellation, retries, and task history
- [x] Single-file streaming `.part` files, validation, atomic completion, and progress feedback
- [x] Pause/resume with `.part` recovery and stale-part cleanup

## M3: Quality and Distribution

- [x] Fixture-based unit tests
- [ ] IPC and packaged-app integration tests
- [x] Windows installer and portable build (unsigned)
- [ ] macOS hardware testing, signing, and notarized distribution
- [ ] Optional PDF bookmark enrichment
