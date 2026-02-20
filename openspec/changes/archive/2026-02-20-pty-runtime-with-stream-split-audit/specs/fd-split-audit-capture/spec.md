## ADDED Requirements

### Requirement: Separated stdout/stderr reconstruction for PTY runs
The system MUST persist separated `stdout` and `stderr` audit logs for PTY runs using file-descriptor-aware tracing signals.

#### Scenario: FD split capture succeeds
- **WHEN** a PTY run completes with tracer sidecar active
- **THEN** audit artifacts include reconstructed stdout and stderr logs with non-empty data when corresponding writes occurred

### Requirement: Separated stdin audit for PTY runs
The system SHALL persist stdin input stream records for PTY runs.

#### Scenario: User input is captured
- **WHEN** the user sends terminal input during a PTY run
- **THEN** stdin audit log contains the input sequence in run artifacts
