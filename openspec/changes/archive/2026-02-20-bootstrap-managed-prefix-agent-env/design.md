## Context

The repository needs an isolated runtime boundary for Agent CLI tools so that executable lookup and global configuration do not leak to or from the host system. The current repository has no implementation yet, so this design defines the initial architecture and contracts for bootstrap, orchestration, and config isolation.

## Goals / Non-Goals

**Goals:**
- Provide a deterministic project-local managed prefix for Node.js-based tooling.
- Support launching one or more Agent CLIs through a consistent runner interface.
- Guarantee that CLI config read/write operations happen in project-local directories.
- Provide verification hooks that confirm isolation constraints.

**Non-Goals:**
- Implementing full lifecycle management for every possible Agent CLI.
- Replacing upstream CLI-specific configuration formats.
- Managing system-wide Node.js installation outside this repository.

## Decisions

### Decision: Use a project-local managed prefix root

Use a single managed prefix root directory inside the repository (for example `.managed-prefix/`) as the source of executable resolution and tool-local state.

Alternatives considered:
- Use system prefix plus selective wrappers: rejected because isolation can be bypassed.
- Use container-only workflow: rejected for higher setup cost and reduced local developer ergonomics.

### Decision: Enforce execution through a single launcher surface

All Agent CLI invocations go through one launcher entrypoint that resolves target agents from repository configuration and injects a controlled environment.

Alternatives considered:
- Per-agent ad hoc shell scripts: rejected because behavior drifts and duplicates logic.
- Direct manual invocation by developers: rejected because isolation guarantees become unenforceable.

### Decision: Standardize environment isolation variables

The launcher sets and exports a fixed isolation environment for child processes, including prefix-first `PATH`, isolated `HOME`, and HOME-based XDG roots (`XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_DATA_HOME`).
Tool-specific config environment variables are not forced by default; agents rely on isolated `HOME` unless explicit overrides are provided.

Alternatives considered:
- Override only `PATH`: rejected because many CLIs still read global config paths.
- Override only tool-specific variables: rejected because coverage is incomplete across tools.

### Decision: Add explicit isolation verification checks

Bootstrap and launch flows include verifications that assert executable provenance and config-path redirection before declaring success.

Alternatives considered:
- Rely on manual validation: rejected because regressions are hard to detect.
- Defer validation to later integration tests only: rejected because setup failures should be caught immediately.

## Risks / Trade-offs

- [Risk] Some Agent CLIs may use non-standard config locations not covered by baseline environment variables.  
  Mitigation: maintain a per-agent override map in repository config and extend checks per agent.

- [Risk] Prefix-local environment can diverge from host expectations during debugging.  
  Mitigation: provide diagnostic output showing resolved executable paths and effective config roots.

- [Risk] Multi-agent launch can increase process management complexity.  
  Mitigation: define deterministic startup ordering and clear failure propagation rules in launcher behavior.

## Migration Plan

1. Add bootstrap and launcher scaffolding with repository-local paths only.
2. Add configuration schema for one-or-many agent definitions.
3. Add isolation verification checks and fail-fast behavior.
4. Validate with at least one single-agent and one multi-agent execution scenario.
5. Document operational commands and troubleshooting notes.

Rollback strategy:
- Revert the new bootstrap/launcher scripts and local config files.
- Remove managed prefix directory from the repository workspace.

## Open Questions

- Which initial Agent CLIs (CodeX, Gemini, iFlow, OpenCode) should be first-class tested in this change?
- Should multi-agent orchestration prioritize concurrent startup or ordered startup with dependency hints?
- Do we need a strict schema version for launcher configuration from the first iteration?
