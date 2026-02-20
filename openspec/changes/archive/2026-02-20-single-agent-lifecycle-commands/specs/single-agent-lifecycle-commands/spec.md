## ADDED Requirements

### Requirement: Single-agent install command
The system SHALL provide an `install <agent>` command that executes the configured fixed install command for exactly one selected agent.

#### Scenario: Install one supported agent
- **WHEN** a user runs install with one valid agent name
- **THEN** the system executes that agent's fixed install command and returns success only if the command exits with code 0

#### Scenario: Reject install without one agent name
- **WHEN** a user runs install with zero or more than one agent name
- **THEN** the system exits with a usage error and does not run lifecycle commands

### Requirement: Single-agent upgrade command
The system SHALL provide an `upgrade <agent>` command that executes the configured fixed upgrade command for exactly one selected agent.

#### Scenario: Upgrade one supported agent
- **WHEN** a user runs upgrade with one valid agent name
- **THEN** the system executes that agent's fixed upgrade command and returns success only if the command exits with code 0

#### Scenario: Reject unknown agent on upgrade
- **WHEN** a user runs upgrade with an unknown agent name
- **THEN** the system exits with a validation error listing configured agents

### Requirement: Single-agent start command
The system SHALL provide a `start <agent>` command that starts exactly one selected agent inside the managed-prefix isolated environment.

#### Scenario: Start one supported agent
- **WHEN** a user runs start with one valid agent name
- **THEN** the system starts that agent process with managed-prefix isolation and reports process status

#### Scenario: Reject multi-agent start
- **WHEN** a user provides more than one agent name to start
- **THEN** the system exits with a usage error and does not start agent processes
