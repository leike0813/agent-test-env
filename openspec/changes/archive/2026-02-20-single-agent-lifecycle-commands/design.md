## Context

The current implementation already has managed-prefix bootstrap, isolation wiring, and a launch path, but it does not provide direct lifecycle operations (`install`, `upgrade`) and still models launch around multiple agents. This change introduces a simpler single-agent command surface with fixed lifecycle commands and bundled presets for four target Agent CLIs.

## Goals / Non-Goals

**Goals:**
- Add built-in definitions for `codex`, `gemini`, `iflow`, and `opencode`.
- Provide `install`, `start`, and `upgrade` commands that operate on exactly one agent.
- Preserve managed-prefix isolation for lifecycle and start operations.
- Support passthrough args for `start` so users can forward arbitrary options.

**Non-Goals:**
- Supporting multiple agents in a single command invocation.
- Dynamically resolving package managers per operating system.
- Implementing version pinning policy beyond fixed initial command templates.

## Decisions

### Decision: Extend config schema with fixed lifecycle commands

Each agent definition stores fixed command templates for install and upgrade, plus executable/start defaults.

Alternatives considered:
- Hardcoding command logic in source by agent name: rejected due weaker extensibility and testability.
- Supporting arbitrary shell snippets: rejected for weaker validation and safety.

### Decision: Use single-agent command contract at CLI boundary

`install`, `start`, and `upgrade` each require one agent name. Any missing or extra positional inputs are treated as usage errors.

Alternatives considered:
- Keep multi-agent support for start only: rejected to maintain a single mental model.
- Default to all agents when omitted: rejected because explicit target selection is required.

### Decision: Keep start passthrough as raw trailing argv

All arguments after `<agent>` for `start` are appended as-is to the agent process invocation.

Alternatives considered:
- Parse known start options centrally: rejected because it would block tool-specific flags.
- Require `--` separator always: rejected because it adds friction.

### Decision: Reuse one lifecycle executor for install/upgrade/start process spawning

A shared execution helper handles environment setup, diagnostics, spawn, and status mapping to avoid duplicated logic.

Alternatives considered:
- Separate executors per command: rejected because behavior drift and duplication risk increases.

## Risks / Trade-offs

- [Risk] Fixed commands may not fit all user environments.  
  Mitigation: keep command templates in config so users can override later.

- [Risk] Removing multi-agent start can break existing usage.  
  Mitigation: update docs and emit explicit error messages when multiple agents are supplied.

- [Risk] Passthrough args can include invalid tool options.  
  Mitigation: forward unchanged and report underlying tool process errors transparently.
