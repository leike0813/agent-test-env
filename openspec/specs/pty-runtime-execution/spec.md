# pty-runtime-execution Specification

## Purpose
TBD - created by archiving change pty-runtime-with-stream-split-audit. Update Purpose after archive.
## Requirements
### Requirement: Start command executes in PTY
The system SHALL execute `start <agent>` runs in a real PTY context.

#### Scenario: PTY runtime available
- **WHEN** a user starts a supported agent
- **THEN** the process sees terminal semantics consistent with PTY execution

#### Scenario: PTY startup failure
- **WHEN** PTY allocation fails
- **THEN** the start command exits non-zero with an actionable PTY error message

