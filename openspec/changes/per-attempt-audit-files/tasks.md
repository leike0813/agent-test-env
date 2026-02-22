## 1. Attempt Numbering and Path Model

- [x] 1.1 Add run-attempt number allocation for each execution in the same run directory, starting from `1`.
- [x] 1.2 Add attempt-scoped audit path generation for metadata, streams, PTY/tracer outputs, and filesystem snapshots/diff.
- [x] 1.3 Remove reused-run append behavior for shared audit files and switch writes to per-attempt files.

## 2. Audit Persistence Refactor

- [x] 2.1 Update metadata persistence to write one independent file per attempt with execution outcome details.
- [x] 2.2 Update stream capture/reconstruction outputs (`stdin`, `stdout`, `stderr`) to write attempt-numbered files only.
- [x] 2.3 Update replay/discovery metadata/index content to expose attempt numbers and attempt-specific artifact paths.

## 3. Start Orchestration Integration

- [x] 3.1 Wire allocated attempt number through launcher runtime orchestration so all audit writers use the same attempt id.
- [x] 3.2 Ensure both new-run and reused-run paths produce deterministic attempt-scoped audit outputs.
- [x] 3.3 Ensure failure paths still emit attempt-scoped metadata/log artifacts for that attempt.

## 4. Validation and Documentation

- [x] 4.1 Add tests that first execution writes attempt `1` files.
- [x] 4.2 Add tests that reused runs write attempt `2+` files without modifying previous attempt files.
- [x] 4.3 Add tests for attempt-scoped replay/discovery metadata.
- [x] 4.4 Update README with attempt-numbered audit file naming and replay guidance.
