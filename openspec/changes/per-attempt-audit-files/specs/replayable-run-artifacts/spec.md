## MODIFIED Requirements

### Requirement: Replayable artifact layout
The system SHALL store run artifacts in a deterministic per-run layout that can be loaded for post-run replay, and SHALL represent each execution attempt as an independent numbered artifact set inside the run directory.

#### Scenario: Run directory contains per-attempt artifact sets
- **WHEN** a run directory has multiple execution attempts
- **THEN** audit artifacts for each attempt are stored as separate numbered files
- **AND** each attempt remains replayable without reading mixed content from other attempts

### Requirement: Run index discoverability
The system MUST provide discoverable run identifiers and artifact paths for users to locate and inspect historical runs, and MUST allow locating artifacts by attempt number.

#### Scenario: User can locate attempt-specific artifacts
- **WHEN** a user inspects a run with multiple attempts
- **THEN** run metadata/index information exposes attempt numbers and corresponding artifact file paths for each attempt
