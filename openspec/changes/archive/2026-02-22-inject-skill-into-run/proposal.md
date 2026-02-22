## Why

To compare real Agent CLI behavior consistently, users need deterministic run-local skill context without passing per-run inject selectors.
We also need a machine-parseable completion marker contract injected into run-copy skills so downstream protocol parsing is stable.

## What Changes

- Remove explicit `--inject` option from `start`.
- Make `start` perform default all-skill injection by scanning project-local `skills/` and copying each top-level package directory into agent-specific run-local skill roots.
- Inject completion prompt contract appendix into each injected run-copy `SKILL.md` (source skills remain unchanged).
- Keep existing start passthrough semantics for arguments after `<agent>` unchanged.
- Keep launch flow fail-fast when injected package lacks required `SKILL.md`.
- Treat missing `skills/` source root as zero-package injection (start continues).

## Capabilities

### Modified Capabilities

- `run-skill-injection`: switch from selector-based injection to default all-skill injection and run-copy completion-contract injection.
- `single-agent-start-orchestration`: remove `--inject` input path and enforce automatic pre-launch injection flow.

## Impact

- Affects CLI start argument parsing and validation (`src/cli.js`) by removing `--inject`.
- Affects start orchestration ordering and pre-launch preparation (`src/launcher.js`).
- Updates run-skill injection helper behavior (`src/skill-injection.js`) to all-skill copy + completion-contract append.
- Requires tests for removed-option validation, default all-skill copy, and run-copy-only contract append behavior.
- Requires README command documentation updates for default injection behavior.
