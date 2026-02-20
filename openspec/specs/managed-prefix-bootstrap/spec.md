# managed-prefix-bootstrap Specification

## Purpose
TBD - created by archiving change bootstrap-managed-prefix-agent-env. Update Purpose after archive.
## Requirements
### Requirement: Project-local managed prefix initialization
The system SHALL initialize a project-local managed prefix layout that is sufficient to run repository-managed Agent CLI tooling without using system-global prefix locations.

#### Scenario: First-time bootstrap
- **WHEN** a developer runs the bootstrap command in a clean repository checkout
- **THEN** the system creates the managed prefix directory structure and marks bootstrap as successful

#### Scenario: Idempotent bootstrap
- **WHEN** a developer runs the bootstrap command after the managed prefix already exists
- **THEN** the system reuses existing valid state and does not fail due to pre-existing directories

### Requirement: Prefix-first executable resolution
The system MUST resolve agent tool executables from the managed prefix before any system-global executable paths.

#### Scenario: Executable path precedence
- **WHEN** an executable exists in both managed prefix and system PATH
- **THEN** the launcher resolves and executes the managed-prefix executable

#### Scenario: Missing managed-prefix executable
- **WHEN** the managed prefix does not contain the required executable
- **THEN** the system fails with an actionable error that identifies the missing executable and bootstrap/install remediation

