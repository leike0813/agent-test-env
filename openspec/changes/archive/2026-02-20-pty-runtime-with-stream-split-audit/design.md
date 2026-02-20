## Context

The previous audit implementation separated streams by running agents outside PTY, which broke tools that require terminal semantics (`stdin is not a terminal`). The project now needs PTY-first execution for runtime fidelity while retaining stream-separated audit output for replay analysis.

## Goals / Non-Goals

**Goals:**
- Run agent start commands in a real PTY so interactive tool behavior matches actual usage.
- Capture reconstructable separated stdout/stderr audit streams while PTY execution is active.
- Keep run-directory isolation, trust registration, and replay artifact contracts.
- Emit explicit tracer/runtime diagnostics for audit reliability.

**Non-Goals:**
- Cross-platform parity beyond Linux in this change.
- Perfect byte-for-byte mapping for every PTY control sequence in reconstructed streams.
- Replacing existing run directory and trust file formats.

## Decisions

### Decision: PTY-first runtime is mandatory for start

Start runs use PTY as the primary execution channel, preserving agent terminal checks and interactive behavior.

Alternatives considered:
- Keep non-PTY execution: rejected because it fails real agent startup requirements.
- Optional PTY toggle: rejected for this iteration because fidelity is now baseline behavior.

### Decision: Sidecar fd-level tracing for stream split reconstruction

Use Linux tracer sidecar (e.g., `strace` with write syscall capture) to observe fd=1/fd=2 writes and reconstruct `stdout.log` and `stderr.log` while PTY output continues to flow to terminal.

Alternatives considered:
- PTY-only capture with merged output: rejected because stream split is required.
- Dual process mirrors: rejected due behavioral divergence and fragility.

### Decision: Fail-fast when tracer capability is unavailable

If tracer sidecar cannot start or cannot provide fd-level capture, start command exits with actionable error rather than silently downgrading.

Alternatives considered:
- Best-effort fallback to merged output: rejected because it violates selected requirement priority.

### Decision: Preserve run artifact compatibility with PTY metadata extension

Keep existing run artifact structure, add PTY/tracer metadata and reconstruction notes in run metadata to explain stream provenance and limitations.

Alternatives considered:
- New artifact root and schema reset: rejected to keep historical continuity.

## Risks / Trade-offs

- [Risk] Tracer overhead can impact interactive latency.  
  Mitigation: scope tracing to write syscalls and document performance impact.

- [Risk] Stream reconstruction may be imperfect for some advanced TTY behaviors.  
  Mitigation: include reconstruction caveats and raw PTY output references in metadata.

- [Risk] Linux-specific tracer dependency reduces portability.  
  Mitigation: clearly gate support and emit actionable platform diagnostics.

- [Risk] Tracer permission restrictions can block startup in hardened environments.  
  Mitigation: detect upfront and fail with remediation guidance.

## Migration Plan

1. Add PTY start executor and tracer sidecar orchestration.
2. Replace non-PTY start path with PTY runtime entrypoint.
3. Add fd-based split reconstruction pipeline for audit logs.
4. Extend metadata/tests/docs for PTY+split audit behavior.

Rollback strategy:
- Revert to prior non-PTY split implementation if tracer sidecar approach is rejected.
- Keep run artifacts already produced as read-only historical data.

## Open Questions

- Should we add a future explicit compatibility mode for environments where tracer permissions are blocked?
- Should tracer raw logs be retained long-term or compacted into reconstructed stream files only?
