## MODIFIED Requirements

### Requirement: Fixture-Backed Compatibility Validation
The system SHALL use `test/fixtures/*` as normative validation corpus for parser/translator compatibility.

#### Scenario: Parser and translation suites are mandatory
- **WHEN** parser or translation logic for non-TUI skill output changes
- **THEN** fixture-driven parser/translation tests MUST run
- **AND** all affected fixture assertions MUST pass before change acceptance

#### Scenario: Expectation updates are explicit
- **WHEN** fixture expectations are intentionally changed
- **THEN** change review MUST include updated expectation definitions
- **AND** previous-vs-new fixture assertion deltas MUST remain auditable
