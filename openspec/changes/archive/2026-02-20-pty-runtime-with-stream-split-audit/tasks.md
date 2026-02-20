## 1. PTY Runtime Integration

- [x] 1.1 Add PTY-based start executor and route `start` runs through PTY path.
- [x] 1.2 Preserve run directory isolation, trust registration, and command passthrough in PTY mode.
- [x] 1.3 Add PTY startup diagnostics and clear non-zero failure reporting.

## 2. Tracer Sidecar and Stream Split Reconstruction

- [x] 2.1 Add tracer sidecar orchestration for run-scoped fd write capture.
- [x] 2.2 Implement reconstructed stdout/stderr stream outputs from tracer records.
- [x] 2.3 Preserve stdin capture and align timestamps/ordering metadata for replay.

## 3. Failure Policy and Artifact Compatibility

- [x] 3.1 Implement fail-fast policy when tracer capability is unavailable or denied.
- [x] 3.2 Extend run metadata schema with PTY/tracer provenance fields.
- [x] 3.3 Keep run index and artifact discovery compatibility with prior run layout.

## 4. Validation and Documentation

- [x] 4.1 Add tests proving PTY runtime resolves `stdin is not a terminal` startup failures for PTY-dependent agents.
- [x] 4.2 Add tests for tracer lifecycle, split reconstruction, and fail-fast error paths.
- [x] 4.3 Update README with platform requirements, PTY+tracer behavior, and replay caveats.
