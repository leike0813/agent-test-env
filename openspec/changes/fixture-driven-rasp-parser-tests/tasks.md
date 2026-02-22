## 1. Fixture Matrix and Expectations

- [x] 1.1 Build fixture discovery helper that enumerates all attempts under `test/fixtures/*/.audit/`.
- [x] 1.2 Define explicit expectation manifest for each fixture family (`interactive`, `auto`, `file-write`).
- [x] 1.3 Encode expected terminal state, session extraction expectation, and FCMP minimum events per attempt.

## 2. Parser Test Suites

- [x] 2.1 Add codex parser tests for `thread.started`, `item.completed`, `turn.completed`, and PTY fallback behavior.
- [x] 2.2 Add gemini parser tests for `stderr` JSON precedence and noisy `stdout` tolerance.
- [x] 2.3 Add iflow parser tests for `session-id`, `<Execution Info>`, and channel drift handling.
- [x] 2.4 Add opencode parser tests for NDJSON `step_start/tool_use/text/step_finish`.

## 3. Completion-State Hard Rule Tests

- [x] 3.1 Assert `__SKILL_DONE__` presence leads to `completed`.
- [x] 3.2 Assert marker-missing + terminal signal leads to `awaiting_user_input`.
- [x] 3.3 Assert interrupted attempts produce `interrupted` and failure diagnostics.

## 4. Translation (RASP -> FCMP) Tests

- [x] 4.1 Verify `conversation.started` and `assistant.message.final` emission for interactive attempts.
- [x] 4.2 Verify `conversation.completed` emission on marker-complete attempts.
- [x] 4.3 Verify `user.input.required` emission on terminal-without-marker attempts.
- [x] 4.4 Verify no-data-loss fallback via `raw.*` and parser diagnostics for unrecognized content.

## 5. Integrated Fixture Pipeline Tests

- [x] 5.1 Add integration suite that runs parse + translate end-to-end for all fixture families.
- [x] 5.2 Assert per-attempt session extraction fields (`thread_id/session_id/session-id/sessionID`) when present.
- [x] 5.3 Assert final state and FCMP terminal event consistency across all engines.

## 6. Execution and CI Gate

- [x] 6.1 Ensure fixture parser/translator tests run under `npm test`.
- [x] 6.2 Document test command and troubleshooting notes in README/testing section.
- [x] 6.3 Add CI acceptance criterion: protocol/parser changes must keep fixture tests green.

## 7. Human-Readable Report

- [x] 7.1 Generate a Markdown report for fixture test runs at `test/reports/rasp-fixture-report.md`.
- [x] 7.2 Include attempt-level summary table (fixture, engine, scenario, expected/actual state, session extraction, FCMP assertions, diagnostics).
- [x] 7.3 Include failure detail sections with expected-vs-actual and raw file references.
- [x] 7.4 Ensure report is emitted on both success and failure runs.

## 8. Codex Runtime Script-Noise Exclusion

- [x] 8.1 Exclude runtime `script` envelope lines (`Script started...` / `Script done...`) from codex PTY parsing input.
- [x] 8.2 Ensure excluded envelope lines do not appear as raw fallback events or parser diagnostics.
