## Context

Current reused-run audit behavior appends new execution output into shared files (metadata history and stream logs), which mixes attempts and makes per-round analysis harder. The requested model is to split each execution attempt into its own numbered audit files under the same run directory.

## Goals / Non-Goals

**Goals:**
- Allocate an attempt number per execution in one run directory, starting at `1`.
- Write audit artifacts as attempt-scoped independent files for every execution.
- Preserve prior attempt files unchanged on later attempts.
- Keep run reuse and start flow behavior unchanged outside audit file layout.

**Non-Goals:**
- Redesigning run directory naming or run selector behavior.
- Changing agent process semantics or passthrough arguments.
- Automatic cleanup/compaction of old attempt artifacts.

## Decisions

### Decision: Attempt number allocated at run start

For each run directory invocation, determine the next attempt number before process launch and reuse it consistently for all audit outputs written in that execution.

Alternatives considered:
- Allocate attempt number at process end: rejected because pre-launch artifacts and failure paths still need deterministic numbering.
- Use timestamps only: rejected because explicit round numbering is required.

### Decision: Attempt-scoped file naming for audit outputs

All run audit outputs previously written to shared paths are written to attempt-numbered files for the active attempt (for example `*.1.*`, `*.2.*`).

This includes:
- metadata file
- separated stream logs (`stdin/stdout/stderr`)
- PTY/tracer-related audit outputs
- filesystem snapshot/diff outputs

Alternatives considered:
- Keep shared files and add per-attempt sections: rejected because requirement is independent files per run.
- Split only metadata but append streams: rejected because stream mixing still breaks per-round isolation.

### Decision: Keep attempt discoverability explicit

Run-level discoverability metadata should expose attempt numbers and attempt-specific artifact paths so users can replay one attempt without reading others.

Alternatives considered:
- Infer attempts by directory scanning only: rejected because explicit discoverability is more stable and testable.

## Risks / Trade-offs

- [Risk] More files per run directory increase storage usage.  
  Mitigation: keep manual cleanup model and document expected growth.

- [Risk] Partial failures may produce incomplete attempt artifact sets.  
  Mitigation: keep deterministic naming and always emit attempt metadata with failure outcome.

- [Risk] Existing tooling expecting old shared paths may break.  
  Mitigation: update README and tests; keep run id/index semantics unchanged.

## Migration Plan

1. Add attempt-number allocation helper for run-scoped execution.
2. Refactor audit path generation to produce attempt-numbered files.
3. Update audit writers to stop append mode and write per-attempt outputs.
4. Update replay/discovery metadata to include attempt-specific artifact references.
5. Add tests for attempt numbering and multi-attempt artifact separation.
6. Update README with new naming and replay instructions.

Rollback strategy:
- Revert attempt-numbered path generation and restore shared append paths.
- Keep produced attempt-numbered files as historical artifacts; no destructive migration needed.
