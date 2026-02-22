## 1. Fixture Evidence Baseline

- [x] 1.1 Build per-engine and per-scenario evidence summary from `test/fixtures/*` covering channel distribution and structured output signatures.
- [x] 1.2 Record protocol-relevant anomalies (PTY-vs-split mismatch, channel drift, noisy wrappers, indefinite interactive continuation).
- [x] 1.3 Define fixture corpus as normative compatibility baseline for follow-up implementation.

## 2. RASP/1.0 Core Contract

- [x] 2.1 Define four-layer pipeline (`collect`, `parse`, `translate`, `dispatch`).
- [x] 2.2 Define unified runtime event envelope and P0 mandatory fields.
- [x] 2.3 Define fixed frontend event taxonomy (`lifecycle`, `agent`, `interaction`, `tool`, `artifact`, `diagnostic`, `raw`).
- [x] 2.4 Define confidence bands and raw-fallback behavior for unrecognized content.

## 3. Engine Parsing Profiles

- [x] 3.1 Define `codex_ndjson` mapping and PTY precedence when stdout misses agent message events.
- [x] 3.2 Define `gemini_json` precedence (`stderr` structured document first) with noisy-stdout diagnostics.
- [x] 3.3 Define `opencode_ndjson` mapping for step/tool/text lifecycle.
- [x] 3.4 Define `iflow_text` three-stage parser (regex, block, heuristic) and low-confidence fallback rules.

## 4. Completion and State Semantics

- [x] 4.1 Define run-copy-only completion marker contract with `__SKILL_DONE__`.
- [x] 4.2 Define marker placement rules (in final JSON or extra one-line done object).
- [x] 4.3 Define completion-state machine and precedence order.
- [x] 4.4 Define scenario constraints (`interactive` vs `auto` vs `file-write`) and violation diagnostics.

## 5. Translation and Delivery

- [x] 5.1 Define deterministic multi-source conflict resolution and provenance retention.
- [x] 5.2 Define frontend transport contract (SSE `run_event`, reconnect by `seq` cursor).
- [x] 5.3 Define additive persistence outputs (`events.jsonl`, `parser_diagnostics.jsonl`, raw logs).
- [x] 5.4 Define minimal failure semantics (`run.failed` error category and parser diagnostics).

## 6. Documentation-Only Delivery Boundary

- [x] 6.1 Record this change as specification/design only with no runtime code modifications.
- [x] 6.2 Produce follow-up implementation blueprint (module boundaries, I/O, fallback order).
- [x] 6.3 Produce fixture-driven verification plan and measurable success criteria.
- [x] 6.4 Produce phased rollout plan preserving current raw audit artifacts as system-of-record.
