## ADDED Requirements

### Requirement: PTY run metadata extension
The system SHALL record PTY/tracer provenance metadata in each run artifact set.

#### Scenario: Metadata includes PTY and tracer fields
- **WHEN** a PTY run finishes
- **THEN** run metadata includes PTY runtime mode, tracer command details, and split reconstruction status

### Requirement: Replay artifact compatibility continuity
The system MUST preserve existing replay artifact discoverability while adding PTY-specific fields.

#### Scenario: Existing run discovery remains valid
- **WHEN** new PTY run artifacts are generated
- **THEN** run index and run directory lookup remain compatible with previous discovery conventions
