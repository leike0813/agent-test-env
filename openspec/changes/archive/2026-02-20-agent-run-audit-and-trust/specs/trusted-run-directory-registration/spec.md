## ADDED Requirements

### Requirement: CodeX run directory trust registration
The system SHALL register the run directory as trusted in CodeX config before launching a CodeX run.

#### Scenario: Codex run updates trust config
- **WHEN** the selected agent is `codex` and start is invoked
- **THEN** the system appends the following block before process launch:
  - `[projects."<run_abs_path>"]`
  - `trust_level = "trusted"`
- **AND** default target path is `$HOME/.codex/config.toml` (or `$CODEX_HOME/config.toml` when overridden)

### Requirement: Gemini run directory trust registration
The system SHALL register the run directory as trusted in Gemini trusted folders config before launching a Gemini run.

#### Scenario: Gemini run updates trustedFolders
- **WHEN** the selected agent is `gemini` and start is invoked
- **THEN** the system writes `"<run_abs_path>": "TRUST_FOLDER"` before process launch
- **AND** default target path is `$HOME/.gemini/trustedFolders.json` (or `$GEMINI_CLI_TRUSTED_FOLDERS_PATH` when overridden)

### Requirement: Trust registration ordering
The system SHALL perform run-directory trust registration immediately after run directory creation/env preparation and before launching the process.

#### Scenario: Trust injected before launch attempt
- **WHEN** start is invoked for an agent requiring trust registration
- **THEN** trust files are updated before any process launch attempt for that run
