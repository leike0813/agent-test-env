## Context

The project already supports:
- PTY runtime with split audit artifacts,
- parser/translator logic validated by fixtures,
- interactive handle persistence and `resume`.

What is missing is a runtime-selectable output view for `start` and consistent console segmentation markers.

## Goals / Non-Goals

Goals:
- Add a command-level `--translate` option to `start` with levels `0|1|2|3`.
- Ensure option is not forwarded to agent CLI invocation.
- Reuse the same translate level when resuming by handle.
- Print clear runtime begin/end separators around agent output zone.

Non-Goals:
- No change to agent internal behavior or prompts.
- No protocol redesign (reuse existing parse/translate artifacts).
- No multi-agent start behavior change.

## Decisions

### Decision: `--translate` is a start command option, not passthrough

Parsing scope:
- Accepted only in `start` command options before `<agent-name>`.
- Forms:
  - `--translate <level>`
  - `--translate=<level>`
- Allowed values: `0`, `1`, `2`, `3`.
- Omitted value defaults to `0`.

Any `--translate` token MUST be removed from passthrough args and never forwarded to the target agent process.

### Decision: Output mode contract

Mode `0`:
- Keep current behavior.
- Stream PTY runtime output directly to console as today.

Mode `1`:
- Suppress direct PTY stream to user-facing output channel.
- After process completion, print pretty-formatted parsed structured result for this attempt.
- Include key fields:
  - parser profile
  - session extraction
  - completion summary
  - parsed assistant messages
  - diagnostics/raw counts

Mode `2`:
- Suppress direct PTY stream.
- After process completion, print pretty-formatted translated message envelopes (`FCMP`-style list).
- Apply generic raw-event normalization to suppress duplicated console echo blocks that are already represented by structured assistant messages.

Mode `3`:
- Suppress direct PTY stream.
- After process completion, print Markdown-friendly simulated frontend text view.
- Expected rendering policy:
  - show assistant messages
  - show `user.input.required` helper line `(请输入下一步指令...)`
  - show completion line `任务完成` for terminal-complete
- Reuse mode `2` raw-event normalization before frontend simulation (avoid duplicated noisy echoes).

### Decision: Raw duplication normalization for mode `2/3`

Problem:
- Some engines may print one structured assistant message and also replay the same JSON/text as fragmented console lines.
- Without normalization, translated envelopes contain correct assistant message plus many redundant `raw.stdout` fragments.

Rule:
- Keep parser output unchanged.
- In translation stage, for mode `2/3` only:
  - detect contiguous raw blocks that strongly overlap assistant message lines,
  - suppress duplicated block lines from `raw.*` emission,
  - emit one diagnostic warning with suppression count.
- Mode `1` remains unchanged (raw counts/samples reflect original parser output).

### Decision: Resume inherits translate level from handle

Handle metadata is extended with `translateLevel`.

Behavior:
1. `start` writes selected `translateLevel` into handle record.
2. `resume` resolves handle and applies stored `translateLevel` automatically.
3. If handle has no stored value (older records), fallback to `0`.

### Decision: Runtime separators are always emitted

The launcher prints separators to clearly split transaction logs and agent runtime zone:
- `runtime_begin_separator`: printed after preflight/transaction lines and right before runtime output.
- `runtime_end_separator`: printed after runtime completion and before post-run summary lines.

Separators are emitted for all translate modes (`0|1|2|3`) so users can consistently locate the runtime section.

## Risks / Trade-offs

- Mode `1/2/3` hide live runtime stream; users lose real-time output.
  - Mitigation: keep full raw runtime logs in audit artifacts.
- Pretty-output schema changes may affect downstream scripts parsing console text.
  - Mitigation: define stable top-level headings and key ordering in tests.
- Old handle records without `translateLevel` exist.
  - Mitigation: default to mode `0` on missing value.

## Verification Plan

1. CLI parse tests for `--translate` accepted forms, defaults, and invalid value rejection.
2. Passthrough tests to ensure `--translate` is not forwarded to agent CLI.
3. Mode tests:
  - mode `0` keeps existing direct PTY behavior,
  - mode `1/2/3` print corresponding pretty outputs.
  - mode `2/3` suppress duplicated raw echo blocks while retaining unrelated raw noise lines.
4. Separator tests for begin/end line presence and placement.
5. Handle/resume tests:
  - handle records `translateLevel`,
  - resume inherits same translate level.
