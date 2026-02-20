# run-directory-isolation Specification

## Purpose
TBD - created by archiving change agent-run-audit-and-trust. Update Purpose after archive.
## Requirements
### Requirement: Per-start run directory creation
The system SHALL create a unique run directory for each `start <agent>` invocation before process launch.

#### Scenario: Start creates new run directory
- **WHEN** a user starts an agent command
- **THEN** the system creates a new run directory under managed run storage and uses it for that run only

### Requirement: Start execution working directory isolation
The system MUST execute the agent process with the run directory as current working directory.

#### Scenario: Process starts in run directory
- **WHEN** the start command launches the target agent process
- **THEN** the process working directory is the run directory path generated for that run

