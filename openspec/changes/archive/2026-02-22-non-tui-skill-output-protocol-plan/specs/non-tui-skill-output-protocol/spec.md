## ADDED Requirements

### Requirement: RASP Four-Layer Standardization
The system SHALL define Runtime Agent Stream Protocol (`rasp/1.0`) using four layers: `collect`, `parse`, `translate`, and `dispatch`.

#### Scenario: Pipeline responsibilities are explicit
- **WHEN** protocol architecture is documented
- **THEN** it MUST define raw artifact collection responsibilities
- **AND** it MUST define engine-specific parsing responsibilities
- **AND** it MUST define translation into a unified event envelope
- **AND** it MUST define frontend dispatch and persistence responsibilities

### Requirement: Unified Runtime Event Envelope
The system SHALL define one stable envelope schema consumed by frontend and downstream services.

#### Scenario: Envelope minimum fields are present
- **WHEN** any runtime event is emitted
- **THEN** it MUST include `protocol_version`, `run_id`, `seq`, and `ts`
- **AND** it MUST include `source.engine`, `source.stream`, `source.parser`, and `source.confidence`
- **AND** it MUST include `event.category`, `event.type`, and `event.level`
- **AND** it MUST include `data`, `correlation`, and `raw_ref`

#### Scenario: P0 contract fields are enforced
- **WHEN** P0 compatibility is validated
- **THEN** events MUST include `seq`, `ts`, `source.engine`, `event.category`, `event.type`, `data`, and `raw_ref`
- **AND** `interaction.requested` MUST include `interaction_id`, `kind`, `prompt`, and `options`
- **AND** `run.failed` MUST include `error.category`
- **AND** `session_id` MUST be populated whenever discoverable from engine output

### Requirement: Frontend Event Taxonomy
The system SHALL normalize all engines into a fixed event taxonomy.

#### Scenario: Event categories are constrained
- **WHEN** an event is translated to frontend protocol
- **THEN** `event.category` MUST be one of `lifecycle`, `agent`, `interaction`, `tool`, `artifact`, `diagnostic`, or `raw`
- **AND** `event.type` MUST belong to declared allowed type sets for that category

#### Scenario: Unknown engine output is preserved
- **WHEN** parser cannot map content to a structured known type
- **THEN** translator MUST emit `diagnostic.parser.warning`
- **AND** translator MUST emit corresponding `raw.stdout` or `raw.stderr`
- **AND** original content MUST NOT be discarded

### Requirement: JSON-Stream Engine Parsing Rules
The system SHALL define deterministic parsing behavior for `codex`, `gemini`, and `opencode`.

#### Scenario: NDJSON decode path is applied
- **WHEN** candidate stream lines are valid JSON objects
- **THEN** parser MUST decode line-by-line in order
- **AND** decoded objects MUST be translated to canonical events by engine profile mapping

#### Scenario: Decode failures are non-fatal
- **WHEN** a line fails JSON decoding
- **THEN** parser MUST keep processing subsequent lines
- **AND** failed line MUST be emitted as raw event with parser diagnostic

#### Scenario: Gemini structured payload precedence is applied
- **WHEN** Gemini attempt includes a structured JSON document in `stderr`
- **THEN** parser MUST prioritize that document for session/result extraction
- **AND** noisy `stdout` logs MUST be treated as diagnostic/raw unless they contain higher-confidence structured payload

### Requirement: iFlow Console Parsing Rules
The system SHALL define three-stage parsing for `iflow` text output.

#### Scenario: Three-stage parser executes in order
- **WHEN** iFlow attempt is parsed
- **THEN** parser MUST apply regex layer first (session-id/errors/resume hints)
- **AND** parser MUST apply block layer second (fenced JSON and brace JSON extraction)
- **AND** parser MUST apply residual-text layer third for non-structured assistant text classification

#### Scenario: Low-confidence fallback is explicit
- **WHEN** iFlow text cannot be reliably classified
- **THEN** parser MUST emit raw events
- **AND** parser MUST emit `diagnostic.parser.warning`
- **AND** confidence MUST reflect low-confidence classification band

### Requirement: Completion Marker Contract in Run-Copy Skill
The system SHALL define completion-marker instructions injected only into run-copy `SKILL.md`.

#### Scenario: Injection boundary is enforced
- **WHEN** completion marker instructions are defined
- **THEN** they MUST target run-copy skill files only
- **AND** source skill files under project `skills/` MUST remain unchanged

#### Scenario: Marker semantics are enforced
- **WHEN** skill task completion is reached
- **THEN** final output MUST contain `\"__SKILL_DONE__\": true`
- **AND** if final output is JSON object, marker MUST be included in that object
- **AND** if final output is non-JSON, a standalone one-line JSON object `{\"__SKILL_DONE__\": true}` MUST be emitted
- **AND** marker MUST appear exactly once per attempt

#### Scenario: Marker is missing in legacy runs
- **WHEN** explicit marker is absent in attempt output
- **THEN** completion-state classification MUST fall back to deterministic terminal-signal rules
- **AND** diagnostics MUST record missing explicit marker evidence

### Requirement: Deterministic Completion-State Resolution
The system SHALL define completion states and deterministic precedence.

#### Scenario: Completion precedence is applied
- **WHEN** state is resolved for an attempt
- **THEN** precedence MUST be: valid marker, engine terminal signal without marker, interrupted evidence, unknown
- **AND** resulting state MUST be one of `completed`, `awaiting_user_input`, `interrupted`, or `unknown`

#### Scenario: Scenario-specific constraints are enforced
- **WHEN** scenario is `auto` or `file-write`
- **THEN** terminal state MUST be `completed` or `interrupted`
- **AND** `awaiting_user_input` MUST produce protocol-violation diagnostics

### Requirement: Deterministic Multi-Source Resolution
The system SHALL define deterministic conflict resolution across `pty-output`, `stdout`, and `stderr`.

#### Scenario: Structured candidates conflict across sources
- **WHEN** multiple candidates disagree
- **THEN** parser MUST apply declared source precedence and position rules
- **AND** selected winner MUST include provenance
- **AND** non-selected candidates MUST remain available in diagnostics

#### Scenario: Marker candidates conflict across sources
- **WHEN** multiple valid marker-bearing objects are detected
- **THEN** parser MUST choose a deterministic winner
- **AND** parser MUST emit conflict diagnostics with winner provenance

### Requirement: Frontend Dispatch and Persistence Contract
The system SHALL define transport and persistence outputs for normalized runtime events.

#### Scenario: Frontend transport is standardized
- **WHEN** normalized events are streamed
- **THEN** SSE event name MUST be `run_event`
- **AND** payload MUST be the RASP envelope
- **AND** reconnect MUST support cursor by `seq`

#### Scenario: Additive persistence outputs are generated
- **WHEN** normalized stream processing is enabled
- **THEN** service MUST persist `events.jsonl` for normalized events
- **AND** service MUST persist `parser_diagnostics.jsonl`
- **AND** service MUST keep raw `stdout` and `stderr` logs for replay/debug

### Requirement: Fixture-Backed Compatibility Validation
The system SHALL use `test/fixtures/*` as normative validation corpus for protocol design.

#### Scenario: Fixture matrix remains compatibility baseline
- **WHEN** parser behavior or schema is changed in follow-up implementation
- **THEN** all fixture scenarios MUST be revalidated
- **AND** no fixture may lose replay-critical information (`raw_ref` and raw fallback)
