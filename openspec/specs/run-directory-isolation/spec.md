# run-directory-isolation Specification

## Purpose
TBD - created by archiving change agent-run-audit-and-trust. Update Purpose after archive.
## Requirements
### Requirement: Per-start run directory creation
The system SHALL create a unique run directory for each `start <agent>` invocation before process launch unless the user explicitly selects an existing run directory for reuse.

#### Scenario: Start creates new run directory by default
- **WHEN** a user starts an agent command without existing-run selection
- **THEN** the system creates a new run directory under managed run storage and uses it for that run only

#### Scenario: Start reuses selected existing run directory
- **WHEN** a user starts an agent command with an explicit existing run selector
- **THEN** the system reuses that existing run directory instead of creating a new one

### Requirement: Start execution working directory isolation
The system MUST execute the agent process with the selected run directory as current working directory.

#### Scenario: Process starts in selected run directory
- **WHEN** the start command launches the target agent process
- **THEN** the process working directory is the newly created or explicitly selected run directory for that invocation

### Requirement: Existing run selector resolution
The system SHALL resolve existing-run selectors in three modes: path, full run id, and short run id.

#### Scenario: Path selector resolves existing run directory
- **WHEN** a user provides a run directory path selector that points to an existing run directory
- **THEN** the system resolves that path as the selected run directory

#### Scenario: Full run id selector resolves existing run directory
- **WHEN** a user provides a full run id selector
- **THEN** the system resolves it to one run directory under managed run storage

#### Scenario: Short run id selector resolves existing run directory
- **WHEN** a user provides an 8-char short run id selector with exactly one candidate
- **THEN** the system resolves it to that matching run directory under managed run storage

#### Scenario: Short run id selector ambiguity is rejected
- **WHEN** a user provides an 8-char short run id selector that matches multiple run directories
- **THEN** the system exits non-zero before process launch and reports an ambiguity error requiring full run id or path

#### Scenario: Selector with no match is rejected
- **WHEN** a user provides a selector that cannot be resolved to any existing run directory
- **THEN** the system exits non-zero before process launch and reports a no-match error

### Requirement: Existing run directory agent compatibility
The system SHALL reject existing-run reuse when the run directory metadata indicates a different agent type.

#### Scenario: Agent mismatch is rejected
- **WHEN** a user selects an existing run directory previously associated with another agent
- **THEN** the start command exits non-zero before process launch and reports an agent-mismatch error

