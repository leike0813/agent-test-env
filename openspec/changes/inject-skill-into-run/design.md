## Context

`start` now needs deterministic run-local context for evaluation runs without per-invocation selector toggles.
We also need prompt-level completion signaling embedded in run-local skill copies so non-TUI parsing can rely on explicit markers.

## Goals / Non-Goals

**Goals:**
- Remove explicit `--inject` start option.
- Inject all project-local skill packages from `projectRoot/skills/*` by default before engine launch.
- Append deterministic completion contract prompt to each injected run-copy `SKILL.md`.
- Keep source skill package files immutable.
- Preserve passthrough argument behavior after `<agent>`.

**Non-Goals:**
- Auto-migrating project skill layout.
- Downloading remote skills or resolving from non-project directories.
- Introducing new lifecycle commands for skill management.

## Decisions

### Decision: Remove `--inject` and use default all-skill injection

`start` always performs injection for supported agents (`codex`, `gemini`, `iflow`, `opencode`) by scanning top-level directories under `projectRoot/skills`.
`--inject` is no longer accepted as a start pre-agent option and is treated as unknown.

Alternatives considered:
- Keeping `--inject` as optional selector: rejected to avoid split behavior and simplify repeatable test invocations.

### Decision: Reuse injection helper for all-skill copy + contract append

Create a dedicated helper module that:
- maps agent name to run-local target skills root,
- scans source root `<projectRoot>/skills`,
- recursively copies each top-level package to `<targetRoot>/<skill-name>/`,
- appends completion contract prompt only to run-copy `SKILL.md`.

Alternatives considered:
- Embedding copy logic directly in launcher: rejected to avoid duplicated path mapping and filesystem code.

### Decision: Execute injection after run-context resolution and before runtime spawn

`start` orchestration order:
1. Resolve/create run directory.
2. Build isolated env and run pre-launch checks.
3. Execute default all-skill injection.
4. Continue trust registration and runtime spawn.

This keeps injection run-scoped and guarantees no process starts when injection fails.

Alternatives considered:
- Injecting before run directory resolution: rejected because destination paths are run-directory dependent.
- Injecting after process spawn: rejected because requirement is pre-launch availability.

## Risks / Trade-offs

- [Risk] Reused run directories may already contain injected skill folders from previous attempts.
  Mitigation: define deterministic overwrite behavior in implementation/tests.

- [Risk] Large skill directories can increase start latency.
  Mitigation: keep sync point explicit and fail-fast on filesystem errors.

- [Risk] Non-skill folders under `skills/` may fail contract append due missing `SKILL.md`.
  Mitigation: keep project `skills/` curated as inject-ready packages.

## Migration Plan

1. Remove `--inject` parsing support from CLI start parser.
2. Update run-skill injection helper to default all-skill source scan.
3. Add run-copy completion contract append behavior.
4. Integrate helper into launcher pre-launch flow for supported agents.
5. Add tests for removed option handling, all-skill copy behavior, and run-copy-only contract append.
6. Update README usage examples and behavior notes.

Rollback strategy:
- Re-introduce selector-based `--inject` parsing and single-package copy behavior.
