## ADDED Requirements

### Requirement: Fixture Matrix Coverage for Parser and Translation Tests
The system SHALL provide executable tests that cover all fixture families and engines under `test/fixtures/*`.

#### Scenario: Fixture families are all covered
- **WHEN** parser/translator test suites run
- **THEN** they MUST include `interactive`, `auto`, and `file-write` fixture families
- **AND** they MUST include `codex`, `gemini`, `iflow`, and `opencode`

#### Scenario: Reused-run attempts are tested independently
- **WHEN** a fixture contains multiple attempts (`*.1.log`, `*.2.log`, ...)
- **THEN** tests MUST evaluate each attempt independently
- **AND** assertions MUST be attempt-specific rather than folder-aggregated

### Requirement: Hard Completion-State Rule Is Enforced by Tests
The system SHALL enforce completion-state behavior with deterministic, non-semantic rules in fixture tests.

#### Scenario: Marker-present attempt is completed
- **WHEN** attempt output contains `\"__SKILL_DONE__\": true`
- **THEN** tests MUST assert final state is `completed`
- **AND** tests MUST assert `conversation.completed` is emitted

#### Scenario: Marker-missing terminal attempt requires user input
- **WHEN** attempt output does not contain `\"__SKILL_DONE__\": true`
- **AND** engine terminal signal is detected
- **THEN** tests MUST assert final state is `awaiting_user_input`
- **AND** tests MUST assert `user.input.required` is emitted

#### Scenario: Interrupted attempt is interrupted
- **WHEN** attempt has interrupted terminal evidence (non-zero exit code, signal, or runtime failure)
- **THEN** tests MUST assert final state is `interrupted`
- **AND** tests MUST assert failure diagnostics are emitted

### Requirement: Engine Terminal Signals Are Verified
The system SHALL verify terminal signal detection per engine in tests.

#### Scenario: Codex terminal signal
- **WHEN** codex attempt includes `turn.completed`
- **THEN** test harness MUST detect codex terminal signal as true

#### Scenario: Gemini terminal signal
- **WHEN** gemini attempt includes a completed structured response object and attempt completion evidence
- **THEN** test harness MUST detect gemini terminal signal as true

#### Scenario: iFlow terminal signal
- **WHEN** iflow attempt includes `</Execution Info>`
- **THEN** test harness MUST detect iflow terminal signal as true

#### Scenario: OpenCode terminal signal
- **WHEN** opencode attempt includes `step_finish` with `reason=stop`
- **THEN** test harness MUST detect opencode terminal signal as true

### Requirement: Session Extraction Assertions
The system SHALL assert session extraction behavior using engine-specific field names.

#### Scenario: Engine session fields are extracted when present
- **WHEN** fixture evidence contains a session field
- **THEN** tests MUST assert extraction of:
  - codex `thread_id`
  - gemini `session_id`
  - iflow `session-id`
  - opencode `sessionID`

#### Scenario: Missing session fields produce diagnostics
- **WHEN** fixture evidence has no session field
- **THEN** tests MUST assert parser diagnostics indicate missing session extraction

### Requirement: No Data Loss in Parsing/Translation
The system SHALL ensure parser/translator tests fail when input lines are dropped silently.

#### Scenario: Unrecognized content remains observable
- **WHEN** parser cannot map line content to structured events
- **THEN** tests MUST assert fallback output through `raw.stdout` or `raw.stderr`
- **AND** tests MUST assert parser diagnostics are emitted

### Requirement: Codex Parser Excludes Runtime Script Envelope Noise
The system SHALL ignore runtime `script` wrapper envelope lines when parsing codex PTY logs.

#### Scenario: script wrapper envelope lines are not treated as raw fallback
- **WHEN** codex parser reads `pty-output.*.log` containing runtime wrapper lines like `Script started on ... [COMMAND=...]` and `Script done on ... [COMMAND_EXIT_CODE=...]`
- **THEN** these lines MUST be excluded before NDJSON parsing
- **AND** they MUST NOT be emitted as `raw.stdout`/`raw.stderr` fallback events
- **AND** they MUST NOT introduce parser diagnostics by themselves

### Requirement: Fixture Tests Are a Release Gate
The system SHALL treat fixture parser/translation tests as mandatory for protocol/parser changes.

#### Scenario: Parser/protocol change validation
- **WHEN** parser/protocol-related code changes are proposed
- **THEN** fixture parser/translation tests MUST pass
- **AND** failures MUST block acceptance until resolved or expectations are explicitly updated

### Requirement: Human-Readable Fixture Test Report
The system SHALL generate a human-readable report for fixture parser/translation test runs.

#### Scenario: Report file is produced for each run
- **WHEN** fixture parser/translation tests execute
- **THEN** a Markdown report file MUST be generated at a deterministic path
- **AND** the report MUST be produced for both passing and failing runs

#### Scenario: Report contains attempt-level summaries
- **WHEN** the report is generated
- **THEN** it MUST include an attempt-level summary for all evaluated fixture attempts
- **AND** each summary row MUST include fixture id, engine, scenario, expected state, actual state, and assertion result

#### Scenario: Report contains failure diagnostics
- **WHEN** any attempt fails one or more assertions
- **THEN** the report MUST include failure detail sections
- **AND** each section MUST include expected-vs-actual details and raw log file references
