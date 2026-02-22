# single-agent-start-orchestration Specification

## Purpose
TBD - created by archiving change single-agent-lifecycle-commands. Update Purpose after archive.
## Requirements
### Requirement: Single-process start orchestration
The system MUST orchestrate start execution for exactly one selected agent and return process exit status for that single process.

#### Scenario: Start option parsing includes translate mode
- **WHEN** user runs start with command options before `<agent-name>`
- **THEN** orchestration MUST parse `--run-dir`, `--config`, and `--translate`
- **AND** MUST pass only agent passthrough args (excluding start-only options) into spawned process args

### Requirement: Isolation validation before start spawn
The system SHALL validate isolation paths before spawning the selected agent process.

#### Scenario: Isolation check passes
- **WHEN** effective environment paths stay under project root
- **THEN** the system proceeds to spawn the selected agent process

#### Scenario: Isolation check fails
- **WHEN** effective environment paths leak to host-global locations
- **THEN** the system aborts before spawn and reports leakage details

