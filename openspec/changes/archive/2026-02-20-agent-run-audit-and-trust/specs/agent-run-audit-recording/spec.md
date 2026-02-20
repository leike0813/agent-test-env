## ADDED Requirements

### Requirement: Run metadata persistence
The system SHALL persist run metadata after completion or interruption, including command line, start/end timestamps, and process exit outcome.

#### Scenario: Completed run writes metadata
- **WHEN** an agent run exits normally or with error
- **THEN** the run metadata file is written with launch command, timing, and final exit status

### Requirement: Separated stream audit logs
The system MUST persist separated logs for `stdin`, `stdout`, and `stderr` for each run.

#### Scenario: Stream logs are written
- **WHEN** the agent process receives input and produces output
- **THEN** the system writes input/output data into separate run-scoped stream log files

