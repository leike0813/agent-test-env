## 1. CLI Option and Validation

- [x] 1.1 Extend `start` command parser to accept `--translate <level>` and `--translate=<level>` before `<agent-name>`.
- [x] 1.2 Validate translate level in `0|1|2|3`, with default `0` when omitted.
- [x] 1.3 Ensure `--translate` is excluded from passthrough args forwarded to agent executable.

## 2. Runtime Output Modes

- [x] 2.1 Keep mode `0` behavior unchanged (direct PTY runtime output).
- [x] 2.2 Implement mode `1` pretty output for parsed structured information.
- [x] 2.3 Implement mode `2` pretty output for translated message envelopes.
- [x] 2.4 Implement mode `3` pretty output for simulated frontend text.
- [x] 2.5 Add mode `2/3` raw-echo normalization to suppress duplicated raw block lines already represented by assistant messages.

## 3. Separator Lines

- [x] 3.1 Add begin separator line after transaction/preflight output and before runtime output.
- [x] 3.2 Add end separator line after runtime completion and before post-run summary output.
- [x] 3.3 Ensure separators are emitted for all translate modes (`0|1|2|3`).

## 4. Handle Persistence and Resume Inheritance

- [x] 4.1 Extend interactive handle schema to persist `translateLevel`.
- [x] 4.2 Record selected `translateLevel` on each `start` completion.
- [x] 4.3 Make `resume <handle> <message>` inherit stored `translateLevel`.
- [x] 4.4 Fallback to translate mode `0` for legacy handle records without stored translate level.

## 5. Tests and Docs

- [x] 5.1 Add CLI parser tests for translate option forms, default, and invalid values.
- [x] 5.2 Add passthrough tests proving `--translate` is not forwarded to agent args.
- [x] 5.3 Add mode output tests for `0|1|2|3`.
- [x] 5.4 Add separator placement tests (pre-runtime and post-runtime).
- [x] 5.5 Add handle/resume tests for translate mode persistence and inheritance.
- [x] 5.6 Update README with `--translate` usage and mode examples.
- [x] 5.7 Add tests proving mode `2` keeps unrelated raw noise while suppressing duplicated assistant echo blocks.
