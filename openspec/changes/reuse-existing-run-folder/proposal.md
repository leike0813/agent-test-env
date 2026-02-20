## Why

Current `start` always creates a new run directory, which blocks iterative experiments in the same run context. We need controlled run-directory reuse so repeated executions can accumulate audit history without losing prior records.

## What Changes

- Add optional run-directory reuse for `start` via a run selector that supports:
  - run directory path
  - full run id (`<timestamp>-<agent>-<suffix8>`)
  - short run id (`<suffix8>`)
- Enforce agent-to-run compatibility: an existing run folder can only be reused by the same agent type.
- Reject ambiguous short run id matches (multiple candidates) with actionable error output.
- Preserve prior audit artifacts and append new run records instead of replacing them when reusing a run folder.
- Keep current default behavior unchanged when no existing run folder is specified.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `run-directory-isolation`: allow explicit reuse of an existing run directory selected by path, full run id, or short run id.
- `single-agent-start-orchestration`: support selector-based run reuse and reject invalid, ambiguous, or mismatched selections.
- `agent-run-audit-recording`: change audit persistence to append mode for reused run directories.
- `replayable-run-artifacts`: preserve replay discoverability when multiple executions are merged into one run folder.

## Impact

- Affects CLI argument parsing and start orchestration (`src/cli.js`, `src/launcher.js`).
- Affects run-directory selector resolution/validation logic (`src/run-directory.js` and related helpers).
- Affects audit persistence strategy for metadata and stream logs (`src/audit.js`, `src/pty-runtime.js` interaction points).
- Requires updated tests for selector mode resolution, short-id ambiguity rejection, agent mismatch rejection, and append-only audit behavior.
