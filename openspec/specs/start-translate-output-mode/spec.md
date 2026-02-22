# start-translate-output-mode Specification

## Purpose
TBD - created by archiving change start-translate-modes-and-runtime-separators. Update Purpose after archive.
## Requirements
### Requirement: Start Translate Output Mode Option
The system SHALL support a non-passthrough `--translate` option on `start` command with values `0|1|2|3`.

#### Scenario: Default translate mode
- **WHEN** user runs `start` without `--translate`
- **THEN** translate mode MUST default to `0`

#### Scenario: Accepted translate option forms
- **WHEN** user provides `--translate <level>` or `--translate=<level>` before `<agent-name>`
- **THEN** the CLI MUST parse and accept level values in `0|1|2|3`

#### Scenario: Invalid translate value is rejected
- **WHEN** user provides any value outside `0|1|2|3`
- **THEN** command MUST fail before start spawn with actionable validation error

#### Scenario: Translate option is not forwarded to agent
- **WHEN** start command invokes agent process
- **THEN** parsed `--translate` token/value MUST NOT appear in passthrough args passed to agent executable

### Requirement: Translate Mode Output Contract
The system SHALL render runtime output according to selected translate level.

#### Scenario: Mode 0 preserves current direct PTY output behavior
- **WHEN** translate mode is `0`
- **THEN** runtime output MUST follow current direct PTY streaming behavior

#### Scenario: Mode 1 outputs parsed structured information
- **WHEN** translate mode is `1`
- **THEN** runtime result MUST be printed as pretty-formatted parsed structured information
- **AND** output MUST include parser/session/completion/message/diagnostic summary fields

#### Scenario: Mode 2 outputs translated message envelopes
- **WHEN** translate mode is `2`
- **THEN** runtime result MUST be printed as pretty-formatted translated message envelopes
- **AND** duplicated raw echo blocks that are already represented by structured assistant messages MUST be suppressed
- **AND** non-duplicated raw noise lines MUST remain as `raw.stdout`/`raw.stderr`

#### Scenario: Mode 3 outputs simulated frontend display text
- **WHEN** translate mode is `3`
- **THEN** runtime result MUST be printed as Markdown-friendly simulated frontend-visible text
- **AND** `user.input.required` MUST include helper text `(请输入下一步指令...)`
- **AND** completion terminal state MUST include `任务完成` message
- **AND** raw-duplication suppression behavior MUST be consistent with mode `2`

### Requirement: Translate Mode Persistence and Resume Inheritance
The system SHALL persist selected translate mode in interactive handle metadata and reuse it on `resume`.

#### Scenario: Handle records translate mode on start
- **WHEN** start completes and updates interactive handle record
- **THEN** handle metadata MUST persist current translate mode value

#### Scenario: Resume uses handle translate mode
- **WHEN** user runs `resume <handle> <message>`
- **THEN** runtime output mode MUST be taken from handle metadata
- **AND** if handle lacks translate mode (legacy record), mode MUST fallback to `0`

### Requirement: Runtime Separator Lines
The system SHALL print runtime begin/end separators around agent runtime zone.

#### Scenario: Runtime begin separator
- **WHEN** transaction/preflight info is printed and runtime is about to start
- **THEN** system MUST print one begin separator line before agent runtime output

#### Scenario: Runtime end separator
- **WHEN** agent runtime finishes
- **THEN** system MUST print one end separator line before post-run summaries

#### Scenario: Separators apply to all translate modes
- **WHEN** translate mode is any of `0|1|2|3`
- **THEN** begin/end separator lines MUST still be printed

