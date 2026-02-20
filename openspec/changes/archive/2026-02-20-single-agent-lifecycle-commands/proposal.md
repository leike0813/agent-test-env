## Why

The project currently supports bootstrap and launch with a generic multi-agent shape, but it does not provide first-class install/upgrade lifecycle commands or built-in presets for the four target Agent CLIs. We need a simplified single-agent execution model with fixed lifecycle commands so users can install, start, and upgrade one tool directly.

## What Changes

- Add built-in initial agent definitions for `codex`, `gemini`, `iflow`, and `opencode`.
- Introduce command entrypoints for `install <agent>`, `start <agent>`, and `upgrade <agent>`.
- Enforce single-agent operation per command invocation.
- Support passthrough arguments for `start`, forwarding all trailing user arguments to the target agent process.
- Keep lifecycle execution isolated inside managed prefix paths.

## Capabilities

### New Capabilities

- `single-agent-lifecycle-commands`: Provide fixed `install/start/upgrade` commands for one selected agent per invocation.
- `bundled-agent-presets`: Ship initial fixed command configuration for CodeX, Gemini CLI, iFlow CLI, and OpenCode.
- `start-args-passthrough`: Forward all trailing CLI arguments from `start` to the selected agent command unchanged.
- `single-agent-start-orchestration`: Execute start flow for exactly one selected agent and reject multi-agent invocation.

### Modified Capabilities

- None.

## Impact

- Affects CLI command parser and runtime command dispatch.
- Extends configuration schema to include fixed lifecycle command definitions.
- Updates tests and docs to reflect single-agent semantics and lifecycle entrypoints.
