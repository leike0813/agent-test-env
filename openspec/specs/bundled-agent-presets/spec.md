# bundled-agent-presets Specification

## Purpose
TBD - created by archiving change single-agent-lifecycle-commands. Update Purpose after archive.
## Requirements
### Requirement: Bundled presets for four target Agent CLIs
The system MUST provide initial built-in definitions for `codex`, `gemini`, `iflow`, and `opencode` with fixed install command templates and executable names.

#### Scenario: Codex preset exists
- **WHEN** configuration is loaded
- **THEN** the `codex` preset includes install command `npm install -g @openai/codex` and executable `codex`

#### Scenario: Gemini preset exists
- **WHEN** configuration is loaded
- **THEN** the `gemini` preset includes install command `npm install -g @google/gemini-cli` and executable `gemini`

#### Scenario: iFlow preset exists
- **WHEN** configuration is loaded
- **THEN** the `iflow` preset includes install command `npm install -g @iflow-ai/iflow-cli` and executable `iflow`

#### Scenario: OpenCode preset exists
- **WHEN** configuration is loaded
- **THEN** the `opencode` preset includes install command `npm install -g opencode-ai` and executable `opencode`

