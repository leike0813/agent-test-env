## Context

The project currently runs one Agent CLI command with isolation environment variables but does not persist complete run artifacts for replay. To evaluate real response patterns across tools, we need per-run isolation directories, process IO audit logs, filesystem mutation tracking, and trust registration for run directories before startup.

## Goals / Non-Goals

**Goals:**
- Create a dedicated run directory for every `start` invocation.
- Record launch metadata, separated `stdin/stdout/stderr`, and runtime outcome for each run.
- Detect filesystem deltas produced during each run.
- Register run directory trust for CodeX and Gemini before launch.
- Produce replay-friendly run artifacts that users can inspect after completion.

**Non-Goals:**
- Automatic run retention cleanup policies (manual cleanup remains user responsibility).
- Perfect reconstruction of terminal rendering semantics beyond captured audit streams.
- Introducing multi-agent execution in a single run.

## Decisions

### Decision: Persistent run directories under managed prefix

Create run directories under a deterministic root like `.managed-prefix/runs/<run-id>/` and keep them after execution.

Alternatives considered:
- OS temp directories auto-cleaned on exit: rejected because replay artifacts may disappear.
- Reusing one shared run directory: rejected due data collision and poor traceability.

### Decision: Strong stream separation over strict TTY fidelity

Use non-PTY process execution so `stdin`, `stdout`, and `stderr` can be independently recorded for audit and replay.

Alternatives considered:
- PTY-first execution with merged output: rejected because the selected requirement prioritizes stream separation.
- Dual-run (one PTY and one pipe capture): rejected due behavioral divergence and complexity.

### Decision: Run-level audit artifact contract

Store metadata, IO logs, and filesystem diff files with a stable schema per run so tooling can replay sessions.

Alternatives considered:
- Append-only global log file: rejected because per-run reconstruction is harder.
- Database-backed audit store: rejected as unnecessary complexity for current scope.

### Decision: Pre-start trust registration for CodeX and Gemini

Before start execution, mutate managed config files to trust the current run directory:
- CodeX: append TOML table block in isolated home config:
  - `[projects."<run_abs_path>"]`
  - `trust_level = "trusted"`
  - default target: `$HOME/.codex/config.toml` (or `$CODEX_HOME/config.toml` when overridden)
- Gemini: add `"<run_abs_path>": "TRUST_FOLDER"` to trusted folders JSON:
  - default target: `$HOME/.gemini/trustedFolders.json`
  - override target: `$GEMINI_CLI_TRUSTED_FOLDERS_PATH` (or `$GEMINI_CLI_HOME/.gemini/trustedFolders.json`)

Execution ordering for start runtime is strict:
1. Create run directory.
2. Build isolated env and ensure env directories.
3. Register run-directory trust for matching agent.
4. Continue remaining preflight checks and process launch.

Alternatives considered:
- Per-process runtime flags only: rejected because tools may consult persisted trust stores.
- Trusting only parent runs root: rejected because requirement is run-directory-specific trust.

### Decision: Filesystem delta by pre/post snapshots

Take filesystem snapshots for the run directory (or specified scope) before and after execution, then compute created/modified/deleted lists.
The diff computation excludes audit-system fixed artifacts (for example metadata and audit log files) so change reports represent agent-generated file effects rather than recorder output.

Alternatives considered:
- Inotify/FSEvents streaming: rejected for portability and complexity.
- Post-run scan only: rejected because “created vs pre-existing” cannot be inferred reliably.

## Risks / Trade-offs

- [Risk] Non-PTY mode may reduce compatibility for some interactive agents.  
  Mitigation: clearly document trade-off and provide explicit failure diagnostics.

- [Risk] Snapshot-based file diff may miss transient files created and deleted during run.  
  Mitigation: document limitation and optionally add future event-based watcher capability.

- [Risk] Trust config writes can fail due malformed existing files.  
  Mitigation: validate/backup and fail with actionable remediation messages.

- [Risk] Large runs can generate large audit artifacts.  
  Mitigation: support optional output limits and compression in later iteration.

## Migration Plan

1. Add run directory manager and audit artifact schema.
2. Add trust registration module for CodeX and Gemini.
3. Refactor start flow to execute inside run directory with trust registration immediately after run creation/env preparation.
4. Add filesystem snapshot/diff persistence.
5. Extend tests and docs for replay workflow.

Rollback strategy:
- Disable audit+trust path in start flow and revert to previous start execution.
- Keep existing run artifacts as static historical files; no migration required.

## Open Questions

- Do we need a future opt-in mode to switch back to PTY-first execution for tools that cannot run without TTY?
- Should replay metadata include environment-variable allowlist snapshots for deeper reproducibility?
