## ADDED Requirements

### Requirement: Tracer sidecar lifecycle management
The system SHALL start, monitor, and terminate tracer sidecar processes in sync with each PTY run.

#### Scenario: Sidecar starts before command execution
- **WHEN** a PTY run begins
- **THEN** tracer sidecar starts before or at process launch and records fd write events for that run

#### Scenario: Sidecar cleanup on run completion
- **WHEN** the PTY run exits or is interrupted
- **THEN** tracer sidecar is terminated and run metadata records sidecar lifecycle outcome

### Requirement: Fail-fast tracer availability policy
The system MUST fail start execution if required tracer capability is unavailable.

#### Scenario: Tracer binary missing or denied
- **WHEN** tracer sidecar cannot be started due missing binary or permission constraints
- **THEN** start exits non-zero and reports remediation guidance
