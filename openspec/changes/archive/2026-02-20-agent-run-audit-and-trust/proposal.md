## Why

The project needs reproducible evidence of real Agent CLI runtime behavior, including process IO and filesystem effects, to support post-run replay and comparison across tools. We should add this now so future experiments are based on auditable run records rather than manual observation.

## What Changes

- Add per-run isolated RUN directory creation for every `start` invocation.
- Add run-level audit persistence for launch command, lifecycle metadata, and separated `stdin/stdout/stderr` streams.
- Add filesystem change detection so each run records created, modified, and deleted files.
- Add pre-start trusted directory registration for CodeX and Gemini against the selected RUN directory.
- For CodeX, persist trust using TOML table form (`[projects."<run_abs_path>"]`) to avoid parse ambiguity with trailing table sections.
- Resolve trust file defaults from isolated `HOME` (`$HOME/.codex/config.toml`, `$HOME/.gemini/trustedFolders.json`) while still allowing explicit env overrides.
- Add replay-oriented run artifact structure so users can inspect and reconstruct a completed session.

## Capabilities

### New Capabilities

- `run-directory-isolation`: Ensure each agent start executes inside a dedicated run directory under managed prefix run storage.
- `agent-run-audit-recording`: Persist structured run metadata and separated IO logs for each agent execution.
- `run-filesystem-diff-detection`: Detect and persist filesystem deltas produced during a run.
- `trusted-run-directory-registration`: Register run directory trust for CodeX and Gemini before process launch.
- `replayable-run-artifacts`: Organize run artifacts so users can replay and inspect full session state after completion.

### Modified Capabilities

- None.

## Impact

- Affects start command runtime flow, process execution wrapper, and environment/trust preparation.
- Adds run artifact directories and audit file formats under managed prefix storage.
- Adds trust configuration mutation for CodeX and Gemini managed config files under isolated `HOME` defaults.
- Expands test coverage for audit persistence, trust registration, and filesystem delta detection.
