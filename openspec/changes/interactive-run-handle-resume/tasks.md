## 1. Handle Model and Storage

- [x] 1.1 Define handle derivation rule from run id suffix (8 chars).
- [x] 1.2 Add metadata index read/write helper for interactive handles.
- [x] 1.3 Add schema validation for stored handle entries.

## 2. Session Extraction Profiles

- [x] 2.1 Implement codex `thread_id` extraction from event output.
- [x] 2.2 Implement gemini `session_id` extraction.
- [x] 2.3 Implement iflow `session-id` extraction.
- [x] 2.4 Implement opencode `sessionID` extraction.
- [x] 2.5 Implement source precedence and "last valid match" rule.

## 3. Start Flow Integration

- [x] 3.1 Integrate handle derivation + persistence into start post-attempt flow.
- [x] 3.2 Record run directory, agent name, launch args, and parsed session id in handle entry.
- [x] 3.3 Print handle/session summary after start completion.

## 4. Resume Command Integration

- [x] 4.1 Add `resume <handle> <message>` CLI command entry.
- [x] 4.2 Resolve handle record to agent/session/flags and reconstruct engine-native resume args.
- [x] 4.3 Reuse existing start orchestration with `--run-dir <handle>` under the hood.
- [x] 4.4 Return actionable diagnostics when handle/session context is missing.

## 5. Tests and Docs

- [x] 5.1 Add unit tests for handle derivation and metadata persistence.
- [x] 5.2 Add tests for four-engine session extraction using fixtures.
- [x] 5.3 Add integration tests covering handle update across reused run attempts.
- [x] 5.4 Add tests for `resume <handle> <message>` on codex/gemini/iflow/opencode.
- [x] 5.5 Update README with handle usage and resume examples for codex/gemini/iflow/opencode.
