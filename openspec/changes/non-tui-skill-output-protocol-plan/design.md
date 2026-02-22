## Context

This change remains documentation-only and defines an implementation blueprint for a unified runtime stream protocol.

Current fixtures (`test/fixtures/*`) show that raw engine outputs are heterogeneous and must be normalized before frontend consumption.

Attempt inventory from fixtures:
- `codex`: 6 attempts (`auto=1`, `file-write=2`, `interactive=3`)
- `gemini`: 5 attempts (`auto=1`, `file-write=1`, `interactive=3`)
- `iflow`: 9 attempts (`auto=1`, `file-write=1`, `interactive=7`)
- `opencode`: 5 attempts (`auto=1`, `file-write=1`, `interactive=3`)

Observed evidence baseline:
- `codex`: NDJSON-like stream is strong, but `stdout` can miss first-turn `agent_message` while `pty-output` still has it (for example `codex-interactive/.audit/stdout.1.log` vs `pty-output.1.log`).
- `gemini`: final structured payload is consistently in `stderr` as a JSON document (`session_id`, `response`, `stats`), while `stdout` carries noisy runtime logs and retries.
- `iflow`: plain console output with channel drift; `<Execution Info>` and `session-id` can appear in either `stdout` or `stderr` across attempts.
- `opencode`: NDJSON stream in `stdout` is stable with `type` and `sessionID` fields.
- Fixtures include both marker-present and marker-missing attempts, so marker-first and marker-missing fallback rules are both required.

Cross-stream key-field evidence:
- `codex`: `thread_id` found in structured stream for all attempts; 2 attempts show `agent_message` present in PTY but missing in reconstructed `stdout`.
- `gemini`: `session_id` appears in `stderr` JSON for all attempts; `stdout` primarily contains runtime noise and retries.
- `iflow`: `session-id` alternates between `stdout` and `stderr` across interactive resumes; channel drift is expected behavior.
- `opencode`: `sessionID` and event `type` are consistently parseable from `stdout` NDJSON.

## Goals / Non-Goals

Goals:
- Define Runtime Agent Stream Protocol (`RASP/1.0`) as a single frontend-facing event contract.
- Standardize `Collect -> Parse -> Translate -> Dispatch` pipeline.
- Define deterministic parser profiles for four engines with confidence and diagnostics.
- Keep replayability by preserving offsets and raw references.
- Define completion semantics that combine injected marker and hard terminal-signal fallback.

Non-Goals:
- No runtime code changes in this change.
- No mutation of source skills under `skills/*`.
- No TUI protocol design.

## Decisions

### Decision: Adopt a four-layer pipeline

RASP is defined as four explicit layers:
1. Collect: capture `pty-output`, `stdout`, `stderr`, `stdin`, and metadata (`meta.*.json`, `fs-diff.*.json`).
2. Parse: engine-specific extraction into typed internal parse records.
3. Translate: map parse records into unified RASP envelope/events.
4. Dispatch: stream normalized events to frontend and persist normalized artifacts.

Rationale:
- Separates data acquisition concerns from semantic normalization.
- Supports parser evolution without frontend contract churn.

### Decision: Standardize the RASP envelope

All emitted events MUST use this normalized envelope:

```json
{
  "protocol_version": "rasp/1.0",
  "run_id": "20260221T091252-codex-17e67f51",
  "seq": 123,
  "ts": "2026-02-21T12:34:56.789Z",
  "source": {
    "engine": "codex|gemini|opencode|iflow",
    "stream": "stdout|stderr|control",
    "parser": "codex_ndjson|gemini_json|opencode_ndjson|iflow_text",
    "confidence": 1.0
  },
  "event": {
    "category": "lifecycle|agent|interaction|tool|artifact|diagnostic|raw",
    "type": "run.started|agent.message.final|interaction.requested|...",
    "level": "info|warning|error"
  },
  "data": {},
  "correlation": {
    "interaction_id": null,
    "tool_call_id": null,
    "session_id": null,
    "request_id": null
  },
  "raw_ref": {
    "stdout_from": 0,
    "stdout_to": 0,
    "stderr_from": 0,
    "stderr_to": 0
  }
}
```

P0 mandatory fields:
- `seq`, `ts`, `source.engine`, `event.category`, `event.type`, `data`, `raw_ref`.
- For `interaction.requested`: `interaction_id`, `kind`, `prompt`, `options`.
- For `run.failed`: `error.category`.
- `session_id` when discoverable.

### Decision: Freeze frontend-visible event taxonomy

Frontend consumes only the following categories/types:
- `lifecycle`: `run.started`, `run.status`, `run.heartbeat`, `run.completed`, `run.failed`, `run.canceled`
- `agent`: `agent.message.delta`, `agent.message.final`, `agent.reasoning.summary`
- `interaction`: `interaction.requested`, `interaction.replied`, `interaction.timeout`, `interaction.auto_decision`
- `tool`: `tool.call.started`, `tool.call.completed`, `tool.call.failed`
- `artifact`: `artifact.created`, `artifact.indexed`, `artifact.preview_ready`
- `diagnostic`: `parser.warning`, `parser.error`, `engine.error`
- `raw`: `raw.stdout`, `raw.stderr`

Any unknown parsed event MUST be converted to:
- `diagnostic.parser.warning` plus
- matching `raw.*` event

### Decision: JSON-stream engines use strict decode-first parsing

Applies to `codex`, `gemini`, `opencode` with engine-specific handlers:

- `codex_ndjson`:
  - decode line-delimited JSON from `stdout` and `pty-output`.
  - map:
    - `thread.started` -> `lifecycle.run.status` + `correlation.session_id=thread_id`
    - `item.completed` + `item.type=agent_message` -> `agent.message.final`
    - `item.completed` + `item.type=reasoning` -> `agent.reasoning.summary`
    - `turn.completed` -> `lifecycle.run.status`
  - when `stdout` lacks `agent_message` but `pty-output` has it, emit `diagnostic.parser.warning` with code `PTY_STREAM_MISMATCH` and trust PTY payload.

- `gemini_json`:
  - parse full JSON object from `stderr` first (`session_id`, `response`, `stats`).
  - extract structured payload candidates from `response` (fenced JSON if present).
  - treat noisy `stdout` logs and retry traces as diagnostics/raw fallback unless parseable payload exists.
  - map API failures from `stdout` traces to `diagnostic.engine.error`.

- `opencode_ndjson`:
  - decode NDJSON from `stdout`.
  - map:
    - `step_start`/`step_finish` -> `lifecycle.run.status`
    - `text` -> `agent.message.final`
    - `tool_use` -> `tool.call.started` or `tool.call.completed` based on state
  - `sessionID` populates `correlation.session_id`.

Confidence policy:
- exact structured parse: `1.0`
- schema inference: `0.6-0.8`
- raw-only fallback: `0.3`

### Decision: iFlow uses three-stage text parsing

`iflow_text` parser pipeline:
1. Regex layer:
  - extract `session-id`, resume hints, explicit error keywords.
2. Block layer:
  - parse fenced JSON blocks and brace-delimited JSON snippets.
  - parse `<Execution Info>{...}</Execution Info>` as structured diagnostic/lifecycle evidence.
3. Residual layer:
  - classify unresolved text into `agent.message.final`.

If classification is unreliable:
- emit `raw.stderr`/`raw.stdout`
- emit `diagnostic.parser.warning` with code `LOW_CONFIDENCE_PARSE`

Parser MUST preserve absolute offsets into `stdout`/`stderr` for replay and manual inspection.

### Decision: Completion marker contract remains run-copy only

Injection boundary:
- modify only copied skill under run directory, never source skill under `skills/*`.

Injected completion contract:
- strictly follow SKILL steps and execution boundaries.
- emit marker when and only when SKILL tasks are complete.
- if final output is JSON object, include `"__SKILL_DONE__": true` in that object.
- if final output is non-JSON, output one additional line exactly `{"__SKILL_DONE__": true}`.
- marker appears exactly once.
- no control output after marker-bearing final output.

Marker-missing attempts MUST fall back to hard terminal-signal classification.

### Decision: Completion state machine and precedence

States:
- `completed`
- `awaiting_user_input`
- `interrupted`
- `unknown`

Precedence:
1. valid marker (`__SKILL_DONE__=true`)
2. detected engine terminal signal with no marker -> `awaiting_user_input`
3. interrupted execution evidence (non-zero exit/signal/runtime error) -> `interrupted`
4. unknown

Scenario constraints:
- `auto` and `file-write`: expected `completed|interrupted`.
- `interactive`: all states allowed.

### Decision: Translation and dispatch are additive

Frontend delivery:
- SSE event name fixed to `run_event`.
- payload is RASP envelope.
- reconnect by `cursor=seq`.

Persistence outputs:
- `events.jsonl`: normalized RASP stream
- `parser_diagnostics.jsonl`: parser warnings/errors
- `stdout.txt`, `stderr.txt`: raw reconstructed streams

Raw audit artifacts remain source-of-record and are not replaced.

## Implementation Blueprint (Follow-up Change)

Planned module boundaries:
- `src/stream/collect.js`: load attempt artifacts and produce chunk iterators with offsets.
- `src/stream/parsers/{codex,gemini,opencode,iflow}.js`: engine parse profiles.
- `src/stream/translate.js`: map parser records to RASP envelope + taxonomy.
- `src/stream/dispatch.js`: SSE + persistence writer (`events.jsonl` and diagnostics).
- `src/stream/state.js`: sequence allocator, cursor index, and completion-state reducer.

Planned inputs:
- `.audit/stdout.*.log`, `.audit/stderr.*.log`, `.audit/pty-output.*.log`
- `.audit/meta.*.json`, `.audit/fs-diff.*.json`

Planned outputs:
- normalized RASP event stream
- parser diagnostics stream
- terminal run summary (state, confidence, reasons)

## Fixture-Driven Verification Plan

Verification corpus:
- all folders under `test/fixtures/*` are normative compatibility fixtures.

Success metrics:
1. No fixture drops data silently; unparsed content always appears as `raw.*`.
2. `session_id` extraction success is 100% when fixture includes it.
3. `codex` PTY-vs-stdout mismatch is detected and diagnosed.
4. `gemini` structured payload extraction prefers `stderr` and survives noisy `stdout`.
5. `iflow` parser returns reproducible state + diagnostics under channel drift.
6. Final normalized envelopes validate against one JSON Schema for `rasp/1.0`.

## Risks / Trade-offs

- Risk: PTY sanitization can over-strip content.
  Mitigation: preserve raw offsets and emit sanitized/original span references.

- Risk: hard rule may over-emit `awaiting_user_input` when an engine ends early without marker.
  Mitigation: emit explicit diagnostics and keep raw logs for user-side final judgment.

- Risk: Event taxonomy too rigid for future engines.
  Mitigation: force unknown patterns into `diagnostic` + `raw` without schema break.

- Risk: Frontend may depend on engine-specific fields accidentally.
  Mitigation: enforce only envelope/taxonomy fields as stable contract in docs and tests.

## Rollout Plan

1. Finalize `rasp/1.0` schema and parser-profile docs in this change.
2. Implement collectors/parsers/translators/dispatchers in follow-up code change.
3. Gate parser release with fixture compatibility checks.
4. Enable normalized stream as additive output while preserving current audit logs.
5. Move frontend integration to consume only RASP.

## Open Questions

- Should `agent.message.delta` be mandatory for engines that only provide final text?
- Should `events.jsonl` include periodic snapshot events for faster resume on very long runs?
