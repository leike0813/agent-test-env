## MODIFIED Requirements

### Requirement: Single-process start orchestration
The system MUST orchestrate start execution for exactly one selected agent and return process exit status for that single process.

#### Scenario: Handle summary emitted after start
- **WHEN** start completes one attempt for one selected agent
- **THEN** output includes interactive handle summary
- **AND** summary includes handle value and run directory
- **AND** summary includes parsed session field/value when available

#### Scenario: Resume by handle with existing run selector
- **WHEN** user starts next attempt with `--run-dir <handle>` where `<handle>` is suffix8
- **THEN** system resolves it to the existing run directory
- **AND** process runs in that same run directory
- **AND** user-provided resume args are forwarded to the selected agent unchanged

#### Scenario: Resume command routes through start orchestration
- **WHEN** user runs `resume <handle> <message>`
- **THEN** system resolves handle context and internally invokes start orchestration for the bound agent
- **AND** start orchestration still performs standard run reuse validation and audit recording

#### Scenario: Handle re-run updates latest session context
- **WHEN** an existing handle is reused for a later attempt in the same run directory
- **THEN** the handle metadata entry is updated with latest session extraction result
- **AND** previous attempt audit artifacts remain preserved under attempt-numbered files
