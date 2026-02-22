## Context

The current start flow always allocates a new run directory, then writes audit artifacts as single-run outputs. This prevents iterative replay in one stable run folder and makes users manage many small run directories when they want one continuing experiment.

## Goals / Non-Goals

**Goals:**
- Allow users to run an agent inside an explicitly selected existing run directory.
- Support three existing-run selector modes: path, full run id, and short run id (last 8 random chars).
- Reject reuse when the existing run directory belongs to a different agent type.
- Reject ambiguous short run id matches with explicit error output.
- Preserve existing audit records and append new execution records for reused run directories.
- Keep default start behavior unchanged for users who do not pass run-directory reuse input.

**Non-Goals:**
- Migrating old run folders across agent types.
- Rewriting historical audit files into a new schema beyond append-compatible updates.
- Changing lifecycle commands (`install`/`upgrade`) to support run-directory reuse.

## Decisions

### Decision: Explicit run selector on start

Add an explicit start option (for example `--run-dir <selector>`) that is parsed before `<agent>` and interpreted as an existing run target selector.

Selector modes:
- Path mode: selector is treated as a run directory path.
- Full run id mode: selector matches full run id format (`<timestamp>-<agent>-<suffix8>`) and resolves under managed runs root.
- Short run id mode: selector is the trailing 8-char random suffix and resolves by searching managed runs root for matching run ids.

Resolution policy:
- No match: fail fast with actionable error.
- Short id multiple matches: fail fast and require full run id or path.
- Single match: resolve to that existing run directory.

Alternatives considered:
- Auto-selecting latest run directory on ambiguous short id: rejected to avoid accidental data mixing.
- Supporting only path mode: rejected because run ids are already stable and easier to type.

### Decision: Agent compatibility is mandatory for reuse

When `--run-dir` is provided, resolve the selector to one existing run directory, then validate run metadata (`.audit/meta.json`) and require `agentName` to match the requested agent.

Alternatives considered:
- Allowing cross-agent reuse with warnings: rejected because it corrupts audit semantics and trust assumptions.
- Matching only by run-id naming convention: rejected because naming alone is not authoritative.

### Decision: Append-only audit merge model for reused runs

For reused run directories, append new audit content instead of replacing previous records:
- Stream logs append in chronological order.
- Metadata records append as attempt entries (or equivalent appendable structure) while preserving prior entries.
- Existing run discovery remains valid for the same run directory.

Alternatives considered:
- Overwrite previous artifacts: rejected because user requirement demands merged history.
- Create a child run directory per rerun: rejected because requirement is to rerun in the same existing run folder.

## Risks / Trade-offs

- [Risk] Existing run directory may contain malformed or partial metadata.  
  Mitigation: fail fast with actionable errors and require valid run metadata for reuse mode.

- [Risk] Appended audit logs can grow quickly in long-running reused runs.  
  Mitigation: keep manual cleanup model and document expected growth.

- [Risk] Append ordering bugs can make replay interpretation ambiguous.  
  Mitigation: persist per-attempt timestamps and deterministic append order.

## Migration Plan

1. Add start option parsing and selector resolution logic for path/full-id/short-id modes.
2. Add run-directory metadata validation and agent compatibility checks.
3. Refactor audit writers to append records for reused runs while preserving current behavior for new runs.
4. Add tests for selector resolution, short-id ambiguity rejection, mismatch rejection, and append persistence.
5. Update docs with usage and constraints for existing-run reuse.

Rollback strategy:
- Remove selector-based `--run-dir` handling and fall back to always creating new run directories.
- Keep already-appended historical artifacts as read-only records.
