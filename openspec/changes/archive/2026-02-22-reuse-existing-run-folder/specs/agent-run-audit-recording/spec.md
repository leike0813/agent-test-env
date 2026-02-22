## MODIFIED Requirements

### Requirement: Run metadata persistence
The system SHALL persist run metadata after completion or interruption, including command line, start/end timestamps, and process exit outcome, and SHALL preserve prior metadata when reusing an existing run directory.

#### Scenario: Reused run appends metadata
- **WHEN** start executes in an explicitly reused existing run directory
- **THEN** the resulting metadata persistence keeps prior run records and appends new execution record(s) without deleting previous ones

### Requirement: Separated stream audit logs
The system MUST persist separated logs for `stdin`, `stdout`, and `stderr` for each run, and SHALL append new log content for reused run directories.

#### Scenario: Reused run appends stream logs
- **WHEN** the agent process receives input and produces output in an existing reused run directory
- **THEN** new `stdin/stdout/stderr` records are appended after existing log content in chronological order
