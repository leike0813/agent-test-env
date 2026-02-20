## MODIFIED Requirements

### Requirement: Single-process start orchestration
The system MUST orchestrate start execution for exactly one selected agent and return process exit status for that single process, including existing-run reuse mode.

#### Scenario: Successful start with existing run directory
- **WHEN** a user runs start with one valid agent name and a compatible existing run directory resolved from path/full-id/short-id selector
- **THEN** the system runs that single agent process in the selected run directory and returns the process exit status

#### Scenario: Invalid existing run directory fails start
- **WHEN** a user provides a missing or invalid existing run directory for start
- **THEN** the system exits non-zero before process launch with an actionable validation error

#### Scenario: Ambiguous short run id fails start
- **WHEN** a user provides a short run id selector that matches multiple existing run directories
- **THEN** the system exits non-zero before process launch with an actionable ambiguity error
