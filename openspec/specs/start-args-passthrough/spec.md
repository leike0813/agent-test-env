# start-args-passthrough Specification

## Purpose
TBD - created by archiving change single-agent-lifecycle-commands. Update Purpose after archive.
## Requirements
### Requirement: Start command argument passthrough
The system SHALL append all trailing user-provided arguments after `<agent>` to the target agent process invocation without reinterpretation.

#### Scenario: Forward mixed flags and values
- **WHEN** a user runs start with additional options and values
- **THEN** the spawned agent process receives the same trailing argument sequence in the same order

#### Scenario: Forward literal separator and remaining args
- **WHEN** a user includes `--` and additional values in start command input
- **THEN** the spawned agent process receives all trailing values after `<agent>` exactly as provided

