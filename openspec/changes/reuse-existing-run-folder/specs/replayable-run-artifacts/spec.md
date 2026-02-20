## MODIFIED Requirements

### Requirement: Replayable artifact layout
The system SHALL store run artifacts in a deterministic run-directory layout that remains replayable when multiple executions are merged into the same reused run folder.

#### Scenario: Reused run preserves replayability
- **WHEN** a run directory is reused for additional executions
- **THEN** the run directory still contains coherent metadata and separated stream logs that include both historical and newly appended records

### Requirement: Run index discoverability
The system MUST provide discoverable run identifiers and artifact paths for users to locate and inspect historical runs, including repeated executions in one run directory.

#### Scenario: Reused run remains discoverable
- **WHEN** an existing run directory is reused
- **THEN** command output and persisted index/discovery data continue to reference that run directory and expose newly appended execution history
