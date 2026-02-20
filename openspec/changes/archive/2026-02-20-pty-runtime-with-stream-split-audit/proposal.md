## Why

The current separated-stream audit path uses non-PTY execution, which breaks real agent behavior for tools that require terminal semantics. We need a PTY-first runtime that preserves actual agent interaction while still producing separated `stdin/stdout/stderr` audit records.

## What Changes

- Add PTY-based agent start execution as the default runtime path for interactive tools.
- Add sidecar stream-splitting audit capture that infers stdout/stderr from file descriptor writes while preserving PTY execution.
- Add tracer lifecycle handling and failure policy for sidecar audit components.
- Preserve existing run directory, trust registration, and replay artifact contracts with a PTY-compatible audit format.

## Capabilities

### New Capabilities

- `pty-runtime-execution`: Execute agent start runs in a real PTY while preserving run-directory isolation.
- `fd-split-audit-capture`: Capture and persist separated stdout/stderr audit streams from PTY runs using file-descriptor-aware tracing.
- `tracer-sidecar-lifecycle`: Manage sidecar tracer startup, termination, and error handling for run audit capture.
- `pty-replay-artifact-compatibility`: Persist replay artifacts that include PTY session output and separated stream reconstruction metadata.

### Modified Capabilities

- None.

## Impact

- Affects start runtime process orchestration and audit capture internals.
- Adds dependency on Linux tracer tooling for separated stream reconstruction.
- Extends run artifact schema with PTY/tracer metadata and reconstruction details.
- Requires new tests for PTY execution validity and split-stream audit behavior.
