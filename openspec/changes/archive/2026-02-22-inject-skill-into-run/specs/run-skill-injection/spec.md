## ADDED Requirements

### Requirement: Default all-skill injection source
The system SHALL use project root `skills/` as default source root for run-skill injection.

#### Scenario: Source root exists
- **WHEN** `projectRoot/skills/` exists
- **THEN** the system scans all top-level directories under that root as inject candidates
- **AND** copies each candidate package into run-local agent skills root before launch

#### Scenario: Source root missing
- **WHEN** `projectRoot/skills/` does not exist
- **THEN** the system treats injection as zero packages
- **AND** start continues without failing on missing source root

### Requirement: Agent-specific run-local injection target
The system SHALL copy the entire selected skill package directories recursively into an agent-specific run-local skills root under the run directory.

#### Scenario: Codex injection target
- **WHEN** selected agent is `codex`
- **THEN** source `skills/<skill-name>/` is copied to `<run_dir>/.codex/skills/<skill-name>/`

#### Scenario: Gemini injection target
- **WHEN** selected agent is `gemini`
- **THEN** source `skills/<skill-name>/` is copied to `<run_dir>/.gemini/skills/<skill-name>/`

#### Scenario: iFlow injection target
- **WHEN** selected agent is `iflow`
- **THEN** source `skills/<skill-name>/` is copied to `<run_dir>/.iflow/skills/<skill-name>/`

#### Scenario: OpenCode injection target
- **WHEN** selected agent is `opencode`
- **THEN** source `skills/<skill-name>/` is copied to `<run_dir>/.opencode/skills/<skill-name>/`

### Requirement: Run-copy completion contract injection
The system SHALL append a runtime completion contract section to each injected run-copy `SKILL.md` and MUST NOT mutate source `SKILL.md` under project `skills/`.

#### Scenario: Append contract to run-copy only
- **WHEN** a skill package containing `SKILL.md` is copied into run-local target
- **THEN** completion contract appendix is added to `<run_dir>/.../<skill-name>/SKILL.md`
- **AND** source `<projectRoot>/skills/<skill-name>/SKILL.md` remains unchanged

#### Scenario: Missing SKILL.md in candidate package
- **WHEN** an injected candidate package does not contain required `SKILL.md`
- **THEN** start exits non-zero before engine launch with actionable missing-file diagnostic
