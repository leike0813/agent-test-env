## Context

We already have protocol/design artifacts in:
- `openspec/changes/non-tui-skill-output-protocol-plan/design.md`
- `docs/agent-parser-and-translation-guide.md`
- `docs/frontend-conversation-message-protocol.md`

The next step is to prove those rules are executable through code tests driven by the current fixture corpus in `test/fixtures/*`.

## Goals / Non-Goals

Goals:
- Define an implementation-ready blueprint for fixture-driven parser/translator tests.
- Validate parser behavior and translation behavior separately, then as an integrated pipeline.
- Enforce hard completion rule:
  - `__SKILL_DONE__` present -> completed
  - marker missing + terminal signal present -> `user.input.required`
- Ensure test coverage spans all engines and all scenarios (`interactive`, `auto`, `file-write`).

Non-Goals:
- No runtime/parser production code changes in this change.
- No fixture mutation.
- No protocol redesign.

## Decisions

### Decision: Treat fixture folders as normative test matrix

Test matrix source: `test/fixtures/*`

Required coverage dimensions:
1. Engine: `codex`, `gemini`, `iflow`, `opencode`
2. Scenario: `interactive`, `auto`, `file-write`
3. Attempt-level variability: multiple attempts in reused run folders must be tested independently.

### Decision: Split test layers by responsibility

Three layers of tests are required:
1. Parser layer tests:
  - Input: raw fixture logs (`stdout.*`, `stderr.*`, `pty-output.*`, `meta.*`)
  - Output: normalized parse records (engine-profile specific output model)
2. Translation layer tests:
  - Input: parser layer output
  - Output: RASP envelopes and FCMP events
3. Integrated fixture pipeline tests:
  - Input: fixture attempt
  - Output: final state + FCMP essentials + diagnostics guarantees

### Decision: Hard completion rule is assertion-first

Tests MUST assert deterministic completion behavior:
1. If parsed final payload contains `__SKILL_DONE__ = true`, final state is `completed`.
2. If marker is absent and engine terminal signal is observed, final state is `awaiting_user_input`, and FCMP contains `user.input.required`.
3. If execution is interrupted with non-success terminal evidence, final state is `interrupted`.

Terminal signal definitions in tests:
- Codex: `turn.completed`
- Gemini: structured response object finished + process completion evidence from attempt metadata
- iFlow: `</Execution Info>`
- OpenCode: `step_finish` with `reason=stop`

### Decision: Session extraction is mandatory assertion

Per engine expected fields:
- Codex: `thread_id`
- Gemini: `session_id`
- iFlow: `session-id`
- OpenCode: `sessionID`

Tests MUST assert extraction success whenever field exists in fixture evidence.

### Decision: No-data-loss invariants are tested

For each attempt:
- Any unparsed line must still be representable via raw path (`raw.stdout`/`raw.stderr`) and/or parser diagnostics.
- Tests must fail if records disappear silently.

### Decision: Codex parser strips runtime script envelope lines

Codex PTY logs are produced through a runtime `script` wrapper, which adds envelope lines:
- `Script started on ... [COMMAND=...]`
- `Script done on ... [COMMAND_EXIT_CODE=...]`

These lines are transport/runtime metadata, not engine output.  
Parser behavior:
1. Remove these envelope lines before NDJSON parsing in codex profile.
2. Do not treat these lines as raw fallback.
3. Do not emit parser diagnostics for these lines alone.

### Decision: Fixture expectation data should be explicit

Maintain a dedicated expectation manifest under test assets (follow-up implementation), with attempt-level expected outcomes:
- expected terminal state
- expected session field/value presence
- expected FCMP minimal events
- expected diagnostics (when mismatch/noise exists)

This avoids brittle ad-hoc assertions and keeps fixtures auditable.

### Decision: Generate a human-readable test report

Each fixture test run should generate a readable report artifact, in addition to normal test pass/fail output.

Report requirements:
1. Markdown format for easy local reading and code review attachment.
2. Attempt-level summary table with at least:
  - fixture id
  - engine
  - scenario
  - expected state
  - actual state
  - session extraction result
  - key FCMP assertions result
  - diagnostics count
3. Failure detail sections that include:
  - assertion name
  - expected vs actual
  - raw reference pointers (`stdout/stderr` attempt file)
4. Aggregate section with totals:
  - total attempts
  - pass/fail counts
  - per-engine pass rates

Planned output location:
- `test/reports/rasp-fixture-report.md`

Report generation behavior:
- Generated on every fixture test run (even when tests fail).
- Overwrite the previous report for deterministic CI artifacts.

## Implementation Blueprint

Planned test files (implementation phase):
- `test/stream-fixture-loader.test.js` (or helper module imported by suites)
- `test/stream-parser-codex.test.js`
- `test/stream-parser-gemini.test.js`
- `test/stream-parser-iflow.test.js`
- `test/stream-parser-opencode.test.js`
- `test/stream-translation-fcmp.test.js`
- `test/stream-fixture-integration.test.js`

Planned expectation asset:
- `test/fixtures/expectations/rasp-fcmp-expectations.json`

Planned report asset:
- `test/reports/rasp-fixture-report.md`

## Verification Plan

1. Parser unit tests pass for all four engines with fixture samples.
2. Translation tests verify FCMP required events for each scenario family.
3. Integration tests confirm hard completion rule and session extraction.
4. Integration tests confirm no-data-loss invariant through diagnostics/raw fallback.
5. `npm test` includes these suites in CI/local default run.
6. A human-readable report is produced for every run and includes failed-attempt details.

## Risks / Trade-offs

- Risk: Fixture updates can invalidate strict assertions frequently.
  Mitigation: central expectation manifest with explicit review diff.

- Risk: iFlow channel drift increases flakiness.
  Mitigation: assert by normalized semantics (state/event presence), not strict stream ordering.

- Risk: Overfitting tests to current noisy logs.
  Mitigation: keep P0 assertions minimal and protocol-driven, not log-verbatim-driven.
