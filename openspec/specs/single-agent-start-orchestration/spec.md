# single-agent-start-orchestration Specification

## Purpose
TBD - created by archiving change single-agent-lifecycle-commands. Update Purpose after archive.
## Requirements
### Requirement: Single-process start orchestration
The system MUST orchestrate start execution for exactly one selected agent and return process exit status for that single process.

#### Scenario: Successful single-agent process
- **WHEN** the selected agent process exits with code 0
- **THEN** the start command returns exit code 0

#### Scenario: Failing single-agent process
- **WHEN** the selected agent process exits non-zero or fails before spawn
- **THEN** the start command returns non-zero and emits failure diagnostics

### Requirement: Isolation validation before start spawn
The system SHALL validate isolation paths before spawning the selected agent process.

#### Scenario: Isolation check passes
- **WHEN** effective environment paths stay under project root
- **THEN** the system proceeds to spawn the selected agent process

#### Scenario: Isolation check fails
- **WHEN** effective environment paths leak to host-global locations
- **THEN** the system aborts before spawn and reports leakage details

