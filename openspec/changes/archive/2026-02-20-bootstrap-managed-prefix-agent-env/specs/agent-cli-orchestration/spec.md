## ADDED Requirements

### Requirement: Single-agent launch workflow
The system SHALL provide a launcher command that starts one named Agent CLI from repository configuration using the managed prefix environment.

#### Scenario: Launch one configured agent
- **WHEN** a developer requests launch for a configured agent name
- **THEN** the system starts exactly that agent process with isolated environment variables

#### Scenario: Reject unknown agent name
- **WHEN** a developer requests launch for an agent that is not defined in repository configuration
- **THEN** the system fails with an error listing valid configured agent names

### Requirement: Multi-agent launch workflow
The system SHALL allow launching multiple configured Agent CLIs in one command invocation.

#### Scenario: Launch two or more agents
- **WHEN** a developer launches multiple configured agent names
- **THEN** the system starts each requested agent with the managed prefix environment and reports per-agent startup status

#### Scenario: Partial startup failure handling
- **WHEN** one requested agent fails to start during multi-agent launch
- **THEN** the system reports which agent failed and returns a non-zero exit status for the overall invocation
