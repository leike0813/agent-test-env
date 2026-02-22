## Why

`non-tui-skill-output-protocol-plan` has defined parsing and translation rules, but we still lack executable proof that those rules hold against the current fixture corpus.
Without fixture-driven tests, protocol drift and parser regressions are likely when implementation starts.

## What Changes

- Introduce a fixture-driven test plan for parser and translator viability based on `test/fixtures/*`.
- Define deterministic test assertions for:
  - engine-specific parsing (`codex`, `gemini`, `iflow`, `opencode`)
  - session id extraction
  - completion-state hard rule (`__SKILL_DONE__` vs terminal signal)
  - FCMP translation output (`conversation.started`, `assistant.message.final`, `user.input.required`, `conversation.completed`)
- Define no-data-loss guardrails: unparseable content must remain observable through raw/diagnostic paths.
- Define fixture coverage requirements so every fixture family (`interactive`, `auto`, `file-write`) is exercised in tests.
- Define CI gate expectations for parser/translator tests.
- Define test-report output requirements so each run produces a human-readable summary report.

## Capabilities

### New Capabilities

- `rasp-fixture-parser-tests`: executable fixture-based verification for parser output and completion-state reduction.
- `rasp-fixture-translation-tests`: executable fixture-based verification for RASP -> FCMP translation behavior.
- `rasp-fixture-readable-report`: human-readable test report generation for fixture validation runs.

### Modified Capabilities

- `non-tui-skill-output-protocol`: add mandatory fixture-backed verification as a release gate for protocol/parser changes.

## Impact

- Affects test architecture under `test/` by adding stream-oriented fixture test suites.
- Affects parser/translator implementation work by forcing deterministic, fixture-backed contracts before rollout.
- Affects test output artifacts by introducing readable report files in addition to pass/fail status.
- No runtime behavior change in this change; this change defines test implementation work and acceptance criteria.
