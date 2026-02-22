## MODIFIED Requirements

### Requirement: Single-process start orchestration
The system MUST orchestrate start execution for exactly one selected agent and return process exit status for that single process.

#### Scenario: Successful single-agent process
- **WHEN** the selected agent process exits with code 0
- **THEN** the start command returns exit code 0

#### Scenario: Start performs default pre-launch skill injection then runs process
- **WHEN** a user runs start for one selected agent
- **THEN** the system completes run-local default all-skill injection before process spawn
- **AND** the system starts that single selected agent process

#### Scenario: Invalid injected package fails before spawn
- **WHEN** default injection encounters an invalid candidate package (for example missing `SKILL.md`)
- **THEN** the system returns non-zero and emits actionable injection failure diagnostics before process spawn

#### Scenario: Removed inject option is rejected
- **WHEN** a user passes `--inject` as a start pre-agent option
- **THEN** the system rejects the option as unknown
- **AND** does not start the agent process

#### Scenario: Failing single-agent process
- **WHEN** the selected agent process exits non-zero or fails before spawn
- **THEN** the start command returns non-zero and emits failure diagnostics
