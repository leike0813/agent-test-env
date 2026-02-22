## Why

Current reuse-mode audit append behavior mixes multiple executions into shared files, which makes each run attempt hard to inspect independently. We need per-attempt audit artifacts so each execution round can be replayed and compared in isolation.

## What Changes

- Replace append-style reused-run audit persistence with attempt-scoped independent files.
- Assign a monotonically increasing attempt number per execution in the same run directory, starting from `1`.
- Persist audit artifacts with attempt suffixes (metadata, stream logs, and related run audit outputs) instead of writing to shared append targets.
- Keep run reuse behavior, but separate every execution round into its own numbered audit file set.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `agent-run-audit-recording`: change audit persistence model from shared append files to per-attempt numbered files.
- `replayable-run-artifacts`: ensure replay/discovery can locate audit artifacts by attempt number within one run directory.

## Impact

- Affects audit writer and artifact path generation (`src/audit.js`).
- Affects start orchestration metadata/log path wiring (`src/launcher.js`, `src/pty-runtime.js` integration points).
- Affects run replay/discovery metadata shape for attempt-level lookup.
- Requires updated tests for attempt numbering and per-attempt artifact separation.
- Requires README updates for new audit file naming and replay workflow.
