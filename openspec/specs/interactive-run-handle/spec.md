# interactive-run-handle Specification

## Purpose
TBD - created by archiving change interactive-run-handle-resume. Update Purpose after archive.
## Requirements
### Requirement: Deterministic interactive handle
The system SHALL derive an interactive handle from run id suffix and use the trailing 8-char segment as the handle value.

#### Scenario: Derive handle from run id
- **WHEN** a run id has format `<timestamp>-<agent>-<suffix8>`
- **THEN** the handle is set to `<suffix8>`
- **AND** the handle maps to that run directory

### Requirement: Interactive handle metadata record
The system SHALL persist interactive handle metadata with run context, parsed session identifier, and launch flags.

#### Scenario: Write handle entry after attempt
- **WHEN** one start attempt finishes (success or failure)
- **THEN** the system writes/updates a handle entry containing:
  - `handle`
  - `runId`
  - `runDirectory`
  - `agentName`
  - `session.field`
  - `session.value`
  - `launch.args`
  - `updatedAt`

### Requirement: Multi-engine session id extraction
The system SHALL extract and record session identifier using engine-specific field names.

#### Scenario: Codex extraction
- **WHEN** codex output includes a `thread.started` event with `thread_id`
- **THEN** handle record stores `session.field = "thread_id"` and `session.value = <thread_id>`

#### Scenario: Gemini extraction
- **WHEN** gemini output includes `session_id`
- **THEN** handle record stores `session.field = "session_id"` and `session.value = <session_id>`

#### Scenario: iFlow extraction
- **WHEN** iflow output includes `session-id`
- **THEN** handle record stores `session.field = "session-id"` and `session.value = <session-id>`

#### Scenario: OpenCode extraction
- **WHEN** opencode output includes `sessionID`
- **THEN** handle record stores `session.field = "sessionID"` and `session.value = <sessionID>`

#### Scenario: No session id found
- **WHEN** no valid session field is detected
- **THEN** handle record stores `session.field = null` and `session.value = null`
- **AND** command output includes a diagnostic indicating session id was not detected

### Requirement: Minimal-input resume command
The system SHALL provide `resume <handle> <message>` that continues prior interactive context without requiring users to re-enter agent name, session id, or flags.

#### Scenario: Resume from handle succeeds
- **WHEN** a valid handle record exists with agent binding, prior launch args, and non-null session value
- **THEN** `resume <handle> <message>` resolves those fields automatically
- **AND** executes continuation in the same run directory
- **AND** passes a reconstructed engine-native resume invocation to the selected agent

#### Scenario: Resume fails on missing handle context
- **WHEN** handle record does not exist or has null/empty session value
- **THEN** resume exits non-zero
- **AND** emits actionable diagnostics indicating what metadata is missing

