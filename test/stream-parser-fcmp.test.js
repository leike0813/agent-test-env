import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { analyzeCompletionSignal } from "../src/audit.js";
import {
  REPORT_PATH,
  discoverFixtureAttempts,
  evaluateFixtureAttempt,
  loadExpectationManifest,
  writeFixtureReport,
} from "./fixture-stream-helpers.js";

/**
 * @param {Array<{ type: string }>} events
 */
function collectEventTypes(events) {
  return new Set(events.map((event) => event.type));
}

/**
 * @param {Array<{ id: string }>} attempts
 * @param {string} id
 */
function findAttempt(attempts, id) {
  const found = attempts.find((attempt) => attempt.id === id);
  assert.ok(found, `Missing fixture attempt: ${id}`);
  return found;
}

test("fixture discovery enumerates all fixture attempts", async () => {
  const attempts = await discoverFixtureAttempts();
  assert.equal(attempts.length, 23);
  assert.equal(new Set(attempts.map((attempt) => attempt.engine)).size, 4);
  assert.equal(new Set(attempts.map((attempt) => attempt.scenario)).size, 3);
});

test("codex parser covers thread/item/turn with PTY fallback", async () => {
  const attempts = await discoverFixtureAttempts();
  const evaluated = await evaluateFixtureAttempt(findAttempt(attempts, "codex-interactive#1"));

  assert.equal(evaluated.parsed.parser, "codex_ndjson");
  assert.equal(evaluated.session.field, "thread_id");
  assert.equal(evaluated.completion.terminalSignal.detected, true);
  assert.equal(evaluated.parsed.structuredEventTypes.includes("thread.started"), true);
  assert.equal(evaluated.parsed.structuredEventTypes.includes("item.completed"), true);
  assert.equal(evaluated.parsed.structuredEventTypes.includes("turn.completed"), true);
  assert.equal(evaluated.parsed.diagnostics.includes("PTY_FALLBACK_USED"), true);
  assert.equal(
    evaluated.parsed.rawEvents.some(
      (event) =>
        event.line.startsWith("Script started on ") ||
        event.line.startsWith("Script done on "),
    ),
    false,
  );
});

test("gemini parser prefers stderr JSON and tolerates noisy stdout", async () => {
  const attempts = await discoverFixtureAttempts();
  const evaluated = await evaluateFixtureAttempt(findAttempt(attempts, "gemini-interactive#1"));

  assert.equal(evaluated.parsed.parser, "gemini_json");
  assert.equal(evaluated.session.field, "session_id");
  assert.equal(evaluated.parsed.assistantMessages.length >= 1, true);
  assert.equal(evaluated.parsed.rawEvents.some((event) => event.stream === "stdout"), true);
  assert.equal(evaluated.parsed.diagnostics.includes("GEMINI_STDOUT_NOISE"), true);
});

test("iflow parser extracts session-id, detects execution end, and handles channel drift", async () => {
  const attempts = await discoverFixtureAttempts();
  const evaluated = await evaluateFixtureAttempt(findAttempt(attempts, "iflow-interactive#1"));

  assert.equal(evaluated.parsed.parser, "iflow_text");
  assert.equal(evaluated.session.field, "session-id");
  assert.equal(evaluated.completion.terminalSignal.detected, true);
  assert.equal(evaluated.parsed.diagnostics.includes("IFLOW_CHANNEL_DRIFT_OBSERVED"), true);
});

test("opencode parser covers NDJSON step_start/tool_use/text/step_finish", async () => {
  const attempts = await discoverFixtureAttempts();
  const evaluated = await evaluateFixtureAttempt(findAttempt(attempts, "opencode-auto#1"));

  assert.equal(evaluated.parsed.parser, "opencode_ndjson");
  assert.equal(evaluated.session.field, "sessionID");
  assert.equal(evaluated.parsed.structuredEventTypes.includes("step_start"), true);
  assert.equal(evaluated.parsed.structuredEventTypes.includes("tool_use"), true);
  assert.equal(evaluated.parsed.structuredEventTypes.includes("text"), true);
  assert.equal(evaluated.parsed.structuredEventTypes.includes("step_finish"), true);
});

test("hard completion rule: interrupted attempts map to interrupted with diagnostics", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "agent-env-interrupted-"));
  try {
    const ptyPath = path.join(tempRoot, "pty.log");
    const stdoutPath = path.join(tempRoot, "stdout.log");
    const stderrPath = path.join(tempRoot, "stderr.log");
    await writeFile(ptyPath, "{\"type\":\"turn.completed\"}\n", "utf8");
    await writeFile(stdoutPath, "", "utf8");
    await writeFile(stderrPath, "runtime failure\n", "utf8");

    const completion = await analyzeCompletionSignal({
      processResult: {
        success: false,
        code: 9,
        signal: null,
      },
      ptyOutputPath: ptyPath,
      stdoutPath,
      stderrPath,
      agentName: "codex",
      launchArgs: [],
    });

    assert.equal(completion.state, "interrupted");
    assert.equal(completion.reasonCode, "PROCESS_EXIT_NON_ZERO");
    assert.equal(completion.diagnostics.includes("PROCESS_INTERRUPTED"), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("fixture integration validates parser + FCMP translation and always emits report", async () => {
  const attempts = await discoverFixtureAttempts();
  const manifest = await loadExpectationManifest();
  const expectationById = new Map(manifest.entries.map((entry) => [entry.id, entry]));

  /** @type {Array<{
   *   id: string;
   *   engine: string;
   *   scenario: string;
   *   expectedState: string;
   *   actualState: string;
   *   session: string;
   *   fcmp: string;
   *   diagnostics: number;
   *   pass: boolean;
   *   failures: string[];
   *   rawRefs: string[];
   *   parsedInfo: {
   *     parser: string;
   *     session: string;
   *     structuredEventTypes: string[];
   *     assistantMessageCount: number;
   *     doneMarkerDetected: boolean;
   *     terminalSignal: string;
   *     completionReason: string;
   *     diagnostics: string[];
   *     rawEventCount: number;
   *     rawSamples: Array<{ stream: "stdout" | "stderr" | "pty"; line: string; }>;
   *   };
   *   translatedInfo: Array<{
   *     protocol_version: "fcmp/1.0";
   *     run_id: string;
   *     seq: number;
   *     engine: string;
   *     type: string;
   *     data: Record<string, unknown>;
   *     meta: { attempt: number; };
   *   }>;
   * }>} */
  const rows = [];

  try {
    for (const attempt of attempts) {
      const expected = expectationById.get(attempt.id);
      const evaluated = await evaluateFixtureAttempt(attempt);
      const fcmpTypes = collectEventTypes(evaluated.fcmpEvents);
      const failures = [];

      if (!expected) {
        failures.push("missing expectation entry");
      }

      if (expected && evaluated.completion.state !== expected.expectedState) {
        failures.push(
          `state mismatch expected=${expected.expectedState} actual=${evaluated.completion.state}`,
        );
      }

      if (expected && evaluated.completion.terminalSignal.detected !== expected.expectTerminalSignal) {
        failures.push(
          `terminal signal mismatch expected=${expected.expectTerminalSignal} actual=${evaluated.completion.terminalSignal.detected}`,
        );
      }

      if (expected?.expectSession.required === true) {
        if (evaluated.session.field !== expected.expectSession.field || !evaluated.session.value) {
          failures.push(
            `session extraction mismatch expected field=${expected.expectSession.field} actual=${evaluated.session.field ?? "none"}`,
          );
        }
      }

      if (expected) {
        for (const requiredEvent of expected.expectFcmp.minEvents) {
          if (!fcmpTypes.has(requiredEvent)) {
            failures.push(`missing FCMP event: ${requiredEvent}`);
          }
        }
      }

      if (evaluated.parsed.rawEvents.length > 0) {
        if (evaluated.parsed.diagnostics.length === 0) {
          failures.push("raw fallback exists without parser diagnostics");
        }
        if (!fcmpTypes.has("raw.stdout") && !fcmpTypes.has("raw.stderr")) {
          failures.push("raw fallback exists without FCMP raw.* event");
        }
      }

      if (expected?.expectedState === "completed" && evaluated.completion.doneMarker.detected !== true) {
        failures.push("completed state without __SKILL_DONE__ marker");
      }
      if (expected?.expectedState === "awaiting_user_input") {
        if (evaluated.completion.doneMarker.detected !== false) {
          failures.push("awaiting_user_input state must not include done marker");
        }
        if (evaluated.completion.terminalSignal.detected !== true) {
          failures.push("awaiting_user_input state requires terminal signal");
        }
      }

      rows.push({
        id: attempt.id,
        engine: attempt.engine,
        scenario: attempt.scenario,
        expectedState: expected?.expectedState ?? "missing",
        actualState: evaluated.completion.state,
        session:
          evaluated.session.field && evaluated.session.value
            ? `ok(${evaluated.session.field})`
            : "missing",
        fcmp: expected ? expected.expectFcmp.terminalEvent : "missing-expectation",
        diagnostics: evaluated.parsed.diagnostics.length,
        pass: failures.length === 0,
        failures,
        rawRefs: [attempt.stdoutPath, attempt.stderrPath, attempt.ptyPath],
        parsedInfo: {
          parser: evaluated.parsed.parser,
          session:
            evaluated.session.field && evaluated.session.value
              ? `${evaluated.session.field}=${evaluated.session.value}`
              : "missing",
          structuredEventTypes: evaluated.parsed.structuredEventTypes,
          assistantMessageCount: evaluated.parsed.assistantMessages.length,
          doneMarkerDetected: evaluated.completion.doneMarker.detected,
          terminalSignal: `${evaluated.completion.terminalSignal.detected ? "yes" : "no"} (${evaluated.completion.terminalSignal.rule})`,
          completionReason: evaluated.completion.reasonCode,
          diagnostics: evaluated.parsed.diagnostics,
          rawEventCount: evaluated.parsed.rawEvents.length,
          rawSamples: evaluated.parsed.rawEvents.slice(0, 3),
        },
        translatedInfo: evaluated.fcmpEvents,
      });
    }
  } finally {
    await writeFixtureReport(rows);
  }

  const failedRows = rows.filter((row) => !row.pass);
  assert.equal(failedRows.length, 0, [
    "Fixture validation failed.",
    `Report: ${REPORT_PATH}`,
    ...failedRows.map((row) => `${row.id}: ${row.failures.join("; ")}`),
  ].join("\n"));
});
