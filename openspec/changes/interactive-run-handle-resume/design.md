## Context

The project already supports:
- unique run directories,
- short `--run-dir` selector by 8-char suffix,
- per-attempt audit artifacts.

What is still missing is a first-class interactive handle context that captures session/thread identifiers and launch flags in one place, plus a minimal-input resume command.

## Goals / Non-Goals

**Goals:**
- Use run suffix (last 8 chars) as interactive handle.
- Record handle metadata with run directory, agent, session id, and flags.
- Parse session id signals for `codex`, `gemini`, `iflow`, `opencode`.
- Keep interaction on `start` command for initial runs.
- Add `resume <handle> <message>` for continuation without re-entering agent/session/flags.

**Non-Goals:**
- Replacing engine-native resume semantics; wrapper still compiles to native arguments.
- Auto-injecting follow-up user message into `start` command.
- Changing run-directory reuse selector semantics.

## Decisions

### Decision: Handle equals run suffix

Handle value is the trailing 8-char id segment from run id:
- `<timestamp>-<agent>-<suffix8>`
- handle = `<suffix8>`

This aligns with existing short selector mode of `--run-dir`.

### Decision: Attach handle context to start lifecycle

`start` is responsible for:
1. deriving handle from run id,
2. parsing session id from attempt outputs,
3. persisting/updating handle record.

### Decision: Add dedicated `resume` command with minimal input

`resume` command contract:
- input: `<handle> <message>`
- internally resolves from handle record:
  - bound agent
  - latest session/thread id
  - previous launch args (flags)
- then runs start orchestration with:
  - run selector = `<handle>`
  - reconstructed engine-native resume args

If handle record is missing required fields (for example session id not detected), command fails with actionable diagnostics.

### Decision: Session extraction profile per engine

Extraction sources are attempt logs (`pty-output`, reconstructed `stdout`, `stderr`) with engine-specific patterns:

- codex:
  - JSON event line containing `"type":"thread.started"` and `"thread_id":"..."`
  - extracted key: `thread_id`

- gemini:
  - JSON/object text containing `"session_id":"..."`
  - extracted key: `session_id`

- iflow:
  - execution info block containing `"session-id":"..."`
  - extracted key: `session-id`

- opencode:
  - JSON/object text containing `"sessionID":"..."`
  - extracted key: `sessionID`

If multiple matches exist, use last valid match in precedence order:
1. `pty-output`
2. reconstructed `stdout`
3. reconstructed `stderr`

### Decision: Handle record schema

Persist in managed metadata index (single source of truth), keyed by handle:

- `handle`
- `runId`
- `runDirectory`
- `agentName`
- `session`:
  - `field` (one of `thread_id|session_id|session-id|sessionID|null`)
  - `value` (string|null)
- `launch`:
  - `args` (passthrough args array)
- `updatedAt`

Each new attempt on same run updates same handle entry and keeps latest session info.

### Decision: Resume UX and examples

`start` prints concise handle summary after each attempt:
- handle
- run directory
- parsed session key/value if found

`resume` compiles into engine-native patterns:
- codex: `exec resume ... <thread_id> <message>`
- gemini: `--resume=<session_id> ... -p <message>`
- iflow: `--resume=<session-id> ... -p <message>`
- opencode: `run --session=<sessionID> ... <message>`

## Risks / Trade-offs

- [Risk] Some attempts may not emit a parseable session id.
  Mitigation: allow null session in handle record and fail `resume` with clear guidance.

- [Risk] Format drift in engine outputs may break regex/json extraction.
  Mitigation: keep extractor profiles isolated per engine and covered by fixture tests.

- [Risk] Previous args may already include resume/session/message fragments.
  Mitigation: normalize previous args per engine before rebuilding resume invocation.

## Migration Plan

1. Add interactive handle metadata model and persistence path.
2. Add per-engine session extraction from attempt outputs.
3. Integrate recording into `start` post-attempt flow.
4. Add `resume` command parser and resolver using handle metadata.
5. Print handle/session summary on start completion.
6. Add tests for four-engine extraction, handle updates, and minimal-input resume.
7. Update README with interactive resume examples.

Rollback strategy:
- Disable handle persistence and `resume` routing.
- Keep existing `start` and run/audit behavior unchanged.
