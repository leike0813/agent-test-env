## Why

Interactive runs need a stable resume anchor that users can reference quickly.
Current workflows require manually locating run directory, session/thread id, and previously used runtime flags from audit files.
This is slow and error-prone across different Agent CLIs because each engine uses a different session id field.

## What Changes

- Define an interactive run handle model attached to `start` workflow:
  - Handle value is the trailing 8-char suffix of run id / run directory name.
  - Handle maps to one run directory and one agent type.
- Persist per-handle interactive context metadata:
  - run directory
  - parsed session id (Codex uses `thread_id`)
  - launch command flags (passthrough arguments)
- Parse and record session identifiers for four engines:
  - codex: `thread_id`
  - gemini: `session_id`
  - iflow: `session-id`
  - opencode: `sessionID`
- Add a convenience command:
  - `resume <handle> <message>`
- `resume` auto-resolves previous interactive context from handle metadata and builds engine-native resume invocation without requiring users to re-enter:
  - agent name
  - session/thread id
  - previously used launch flags

## Capabilities

### New Capabilities

- `interactive-run-handle`: deterministic handle registry and session extraction for interactive runs.
- `interactive-resume-shortcut`: resume command that accepts only handle and follow-up message.

### Modified Capabilities

- `single-agent-start-orchestration`: start flow writes/updates interactive handle context after each attempt.

## Impact

- Adds interactive handle persistence under managed metadata.
- Extends post-run audit parsing with per-engine session id extraction rules.
- Adds UX output for handle/session summary to help users construct next resume command.
- Adds `resume` command parser/orchestration for minimal-input continuation.
- Adds tests for handle derivation, session extraction across four engines, and minimal-input resume workflow.
