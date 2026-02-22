# agent-run-audit-recording Specification

## Purpose
TBD - created by archiving change agent-run-audit-and-trust. Update Purpose after archive.
## Requirements
### Requirement: Run metadata persistence
The system SHALL persist run metadata after completion or interruption, including command line, start/end timestamps, and process exit outcome, and SHALL write metadata to a new attempt-numbered file for every execution in the same run directory.

#### Scenario: First attempt writes numbered metadata file
- **WHEN** a run directory is used for its first execution
- **THEN** metadata is written to attempt number `1` using the attempt-numbered metadata file path

#### Scenario: Reused run writes next-numbered metadata file
- **WHEN** an existing run directory is reused for another execution
- **THEN** metadata is written to the next attempt number (for example `2`, `3`, ...)
- **AND** previous attempt metadata files remain unchanged

### Requirement: Separated stream audit logs
The system MUST persist separated logs for `stdin`, `stdout`, and `stderr` for each run attempt and MUST write each attempt to its own numbered log files instead of appending into shared files.

#### Scenario: Attempt writes isolated stream files
- **WHEN** an execution attempt receives input and produces output
- **THEN** the system writes `stdin`, `stdout`, and `stderr` into attempt-numbered stream log files for that attempt

#### Scenario: Reused run keeps prior attempt streams intact
- **WHEN** a later execution attempt runs in the same run directory
- **THEN** stream logs from earlier attempts are preserved as-is
- **AND** only new attempt-numbered stream files are written for the new attempt

