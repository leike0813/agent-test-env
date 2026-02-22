## Why

Current non-TUI outputs from Codex, Gemini, iFlow, and OpenCode are not consistent enough for a shared downstream consumer. We need a fixture-backed protocol definition and parsing strategy before implementing any new runtime behavior.

## What Changes

- Define an evidence-based characterization of non-TUI outputs for all four engines across three skill scenarios (`interactive`, `auto`, `file-write`) using `test/fixtures/*`.
- Define a stable Runtime Agent Stream Protocol (`RASP/1.0`) for in-run event streaming and normalized run results, including provenance, confidence, completion state, and replay references.
- Define an explicit completion-marker contract injected into run-copy `SKILL.md` (not source skills): output MUST include `__SKILL_DONE__ = true` only when and only when skill tasks are completed, with deterministic JSON placement rules.
- Define engine-specific parsing profiles and deterministic extraction order that tolerates mixed channels and noisy text.
- Define a four-layer standardization pipeline: `Collect -> Parse -> Translate -> Dispatch`.
- Define completion parsing order: explicit injected completion marker first, heuristic state machine as fallback.
- Define frontend-facing stable event taxonomy and SSE distribution contract (`run_event` + cursor by `seq`).
- Define additive persistence outputs: `events.jsonl`, `parser_diagnostics.jsonl`, and raw `stdout.txt`/`stderr.txt`.
- Document known ambiguity boundaries and required diagnostics so future implementation can fail safely and explain why.

## Capabilities

### New Capabilities

- `non-tui-skill-output-protocol`: Specify a unified, stable protocol and parsing contract for non-TUI skill execution outputs across Codex, Gemini, iFlow, and OpenCode.

### Modified Capabilities

- None.

## Impact

- Affects protocol and parser design for future runtime changes in `src/launcher.js`, `src/audit.js`, and parser-related modules.
- Affects future run-skill injection behavior in `src/skill-injection.js` and agent invocation contract.
- Affects test strategy by promoting `test/fixtures/*` to normative compatibility fixtures.
- Affects future frontend integration surface by standardizing all engine outputs through a single event stream envelope.
- No code behavior change in this change; this is analysis and contract definition only.
