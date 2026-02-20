## 1. CLI Reuse Input and Run Selection

- [x] 1.1 Add a `start` option for explicit existing run selection (for example `--run-dir <selector>`) with selector modes: path, full run id, short run id.
- [x] 1.2 Implement selector resolution logic against managed run storage and validate resolved run directory/audit metadata before process launch.
- [x] 1.3 Implement strict error behavior for unresolved selectors and ambiguous short run id selectors (multiple matches).
- [x] 1.4 Resolve selected run directory as the invocation working directory in reuse mode and keep new-run creation path unchanged.

## 2. Agent Compatibility Enforcement

- [x] 2.1 Read existing run metadata to determine bound agent identity for reuse checks.
- [x] 2.2 Reject reuse when selected agent does not match run metadata agent, with a non-zero exit and actionable error message.
- [x] 2.3 Add/adjust metadata persistence fields needed to keep compatibility checks deterministic across repeated runs.

## 3. Append-Only Audit Persistence for Reused Runs

- [x] 3.1 Refactor metadata writer to append new execution records instead of overwriting prior run records in reused run directories.
- [x] 3.2 Ensure `stdin.log`, `stdout.log`, and `stderr.log` use append semantics in reused run directories while preserving chronological ordering.
- [x] 3.3 Verify replay/discovery artifacts continue to reference the same run directory with merged historical and newly appended execution data.

## 4. Validation and Documentation

- [x] 4.1 Add tests for successful reuse via path selector, full run id selector, and uniquely matched short run id selector.
- [x] 4.2 Add tests for invalid/missing selector input, unresolved selector failures, and ambiguous short run id failures.
- [x] 4.3 Add tests for cross-agent mismatch rejection after selector resolution.
- [x] 4.4 Add tests for append-only metadata and stream log behavior across repeated runs in one run directory.
- [x] 4.5 Update README usage docs for selector modes, ambiguity constraints, and expected merged-audit behavior.
