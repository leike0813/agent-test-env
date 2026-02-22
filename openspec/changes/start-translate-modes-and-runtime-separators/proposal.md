## Why

Current `start` behavior always streams PTY output directly.  
For analysis/debug/replay use cases, users need deterministic output views at different abstraction levels:

1. parsed structured information
2. translated FCMP envelopes
3. simulated frontend-visible text

In addition, runtime transaction logs and agent runtime output are currently mixed, making console reading less clear.
Finally, when users continue conversations through `resume`, the selected output mode should stay stable without re-entering configuration.

## What Changes

- Add non-passthrough command option `--translate <level>` to `start`:
  - allowed values: `0|1|2|3`
  - default: `0`
  - parsed before `<agent-name>`, not forwarded to agent CLI
- Define level behavior:
  - `0`: keep current behavior (direct PTY output)
  - `1`: output parsed structured information (pretty-formatted)
  - `2`: output translated message envelopes (pretty-formatted)
  - `3`: output simulated frontend display text (Markdown-friendly)
- For `2/3`, add raw-event normalization to suppress duplicated echo blocks already represented by assistant messages, while preserving unrelated raw noise for troubleshooting.
- Persist selected translate level in interactive handle metadata.
- `resume <handle> <message>` reuses handle-bound translate level automatically.
- Add fixed console separators:
  - one line after transaction/preflight info and before agent runtime output
  - one line after agent runtime completion

## Capabilities

### New Capabilities

- `start-translate-output-mode`: selectable output view for start runtime (`0|1|2|3`).
- `runtime-output-separators`: fixed begin/end separators around agent runtime output zone.

### Modified Capabilities

- `single-agent-start-orchestration`: start parse flow includes non-passthrough `--translate`.
- `interactive-run-handle`: handle metadata records translate mode; resume inherits mode.

## Impact

- CLI parsing (`start`) must parse and validate `--translate` before agent token.
- Start orchestration and runtime output adapter must branch on translate level.
- Handle metadata schema extends with `translateLevel`.
- Resume orchestration loads and applies stored translate level.
- Tests need coverage for:
  - translate level parse/validation/default
  - non-passthrough guarantee
  - mode-specific output shaping
  - separator line emission
  - resume inheritance from handle metadata
