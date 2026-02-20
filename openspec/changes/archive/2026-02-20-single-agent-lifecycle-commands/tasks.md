## 1. Configuration and Presets

- [x] 1.1 Extend configuration schema to include fixed `install` and `upgrade` command templates per agent.
- [x] 1.2 Add initial preset entries for `codex`, `gemini`, `iflow`, and `opencode`.
- [x] 1.3 Add validation for lifecycle command templates and single-agent selection helpers.

## 2. CLI Commands

- [x] 2.1 Add CLI command entrypoints: `install <agent>`, `start <agent>`, and `upgrade <agent>`.
- [x] 2.2 Enforce single-agent-only semantics and return usage errors for missing or extra agent names.
- [x] 2.3 Implement passthrough forwarding of all trailing `start` arguments to target process invocation.

## 3. Runtime Lifecycle Execution

- [x] 3.1 Add a shared lifecycle executor for install/upgrade command execution with managed-prefix environment.
- [x] 3.2 Refactor start orchestration to a single-agent execution path.
- [x] 3.3 Preserve isolation validation and diagnostics for lifecycle and start flows.

## 4. Tests and Documentation

- [x] 4.1 Update tests for single-agent command behavior and remove multi-agent expectations.
- [x] 4.2 Add tests for install/upgrade command dispatch and passthrough arguments.
- [x] 4.3 Update README command examples and usage guidance for single-agent lifecycle commands.
