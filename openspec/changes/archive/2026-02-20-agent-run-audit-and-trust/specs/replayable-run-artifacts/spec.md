## ADDED Requirements

### Requirement: Replayable artifact layout
The system SHALL store run artifacts in a deterministic per-run layout that can be loaded for post-run replay.

#### Scenario: Run artifact structure is complete
- **WHEN** a run finishes or is interrupted
- **THEN** the run directory contains metadata, separated stream logs, and filesystem delta artifacts required for replay

### Requirement: Run index discoverability
The system MUST provide discoverable run identifiers and artifact paths for users to locate and inspect historical runs.

#### Scenario: User can locate run artifacts
- **WHEN** a run completes
- **THEN** the command output and/or persisted index provides run id and absolute/relative artifact directory path

