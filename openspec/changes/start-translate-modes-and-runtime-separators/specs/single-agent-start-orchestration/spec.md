## MODIFIED Requirements

### Requirement: Single-process start orchestration
The system MUST orchestrate start execution for exactly one selected agent and return process exit status for that single process.

#### Scenario: Start option parsing includes translate mode
- **WHEN** user runs start with command options before `<agent-name>`
- **THEN** orchestration MUST parse `--run-dir`, `--config`, and `--translate`
- **AND** MUST pass only agent passthrough args (excluding start-only options) into spawned process args
