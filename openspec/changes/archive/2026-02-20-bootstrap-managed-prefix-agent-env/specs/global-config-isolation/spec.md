## ADDED Requirements

### Requirement: Project-local global-config redirection
The system MUST redirect agent global configuration resolution to project-local managed-prefix-owned directories for all launched Agent CLIs.

#### Scenario: Read config from isolated location
- **WHEN** an Agent CLI starts through the launcher
- **THEN** the CLI resolves global config files from project-local paths instead of host user-global paths

#### Scenario: Write config to isolated location
- **WHEN** an Agent CLI writes or updates its global configuration during runtime
- **THEN** the resulting config files are created or updated only under project-local managed-prefix-owned directories

#### Scenario: HOME-based XDG roots are isolated
- **WHEN** an Agent CLI starts through the launcher
- **THEN** `HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, and `XDG_DATA_HOME` all resolve under managed-prefix-owned paths
- **AND** global config writes occur under those isolated roots by default

### Requirement: Isolation leakage detection
The system SHALL detect and fail when runtime environment configuration would cause launched Agent CLIs to use host-global config paths.

#### Scenario: Host config path detected
- **WHEN** effective config environment points to host user directories
- **THEN** the launcher aborts before starting the agent process and prints a remediation message

#### Scenario: Isolation validation passes
- **WHEN** effective config environment points exclusively to project-local directories
- **THEN** the launcher proceeds with agent startup and marks isolation validation as passed
