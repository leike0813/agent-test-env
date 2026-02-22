import path from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

import { analyzeCompletionSignal } from "../src/audit.js";
import { extractInteractiveSessionFromText } from "../src/interactive-handle.js";

export const FIXTURES_ROOT = path.join(process.cwd(), "test", "fixtures");
export const EXPECTATIONS_PATH = path.join(
  FIXTURES_ROOT,
  "expectations",
  "rasp-fcmp-expectations.json",
);
export const REPORT_PATH = path.join(process.cwd(), "test", "reports", "rasp-fixture-report.md");

/**
 * @param {string} text
 */
function stripSkillContent(text) {
  return text.replace(/<skill_content[\s\S]*?<\/skill_content>/gu, "");
}

/**
 * @param {string} text
 */
function splitNonEmptyLines(text) {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * @param {string} line
 */
function isRuntimeScriptEnvelopeLine(line) {
  if (line.startsWith("Script started on ") && line.includes("[COMMAND=")) {
    return true;
  }
  if (line.startsWith("Script done on ") && line.includes("[COMMAND_EXIT_CODE=")) {
    return true;
  }
  return false;
}

/**
 * @param {string} input
 */
function stripRuntimeScriptEnvelope(input) {
  return splitNonEmptyLines(input)
    .filter((line) => !isRuntimeScriptEnvelopeLine(line))
    .join("\n");
}

/**
 * @param {string} input
 * @param {"stdout" | "stderr" | "pty"} stream
 */
function parseNdjsonRecords(input, stream) {
  /** @type {unknown[]} */
  const records = [];
  /** @type {Array<{ stream: "stdout" | "stderr" | "pty"; line: string }>} */
  const rawEvents = [];

  for (const line of splitNonEmptyLines(input)) {
    try {
      records.push(JSON.parse(line));
    } catch {
      rawEvents.push({ stream, line });
    }
  }

  return { records, rawEvents };
}

/**
 * @param {unknown[]} records
 * @param {(record: Record<string, unknown>) => boolean} predicate
 */
function countRecords(records, predicate) {
  let count = 0;
  for (const record of records) {
    if (
      record &&
      typeof record === "object" &&
      !Array.isArray(record) &&
      predicate(/** @type {Record<string, unknown>} */ (record))
    ) {
      count += 1;
    }
  }
  return count;
}

/**
 * @param {unknown[]} records
 */
function collectCodexAssistantMessages(records) {
  /** @type {string[]} */
  const messages = [];
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      continue;
    }
    const typed = /** @type {Record<string, unknown>} */ (record);
    if (typed.type !== "item.completed") {
      continue;
    }
    const item = typed.item;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const itemTyped = /** @type {Record<string, unknown>} */ (item);
    if (itemTyped.type !== "agent_message" || typeof itemTyped.text !== "string") {
      continue;
    }
    messages.push(itemTyped.text);
  }
  return messages;
}

/**
 * @param {unknown[]} records
 */
function collectOpencodeAssistantMessages(records) {
  /** @type {string[]} */
  const messages = [];
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      continue;
    }
    const typed = /** @type {Record<string, unknown>} */ (record);
    if (typed.type !== "text") {
      continue;
    }
    const part = typed.part;
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      continue;
    }
    const partTyped = /** @type {Record<string, unknown>} */ (part);
    if (typeof partTyped.text === "string") {
      messages.push(partTyped.text);
    }
  }
  return messages;
}

/**
 * @param {string} text
 */
function detectDoneMarker(text) {
  return /\\?"__(?:SKILL_DONE|skill_done)__\\?"\s*:\s*true/iu.test(stripSkillContent(text));
}

/**
 * @param {{ stdout: string; stderr: string; pty: string }} logs
 */
function combinedLogs(logs) {
  return `${logs.stdout}\n${logs.stderr}\n${logs.pty}`;
}

/**
 * @param {string} engine
 * @param {{ stdout: string; stderr: string; pty: string }} logs
 */
function extractSession(engine, logs) {
  for (const [source, text] of [
    ["pty", logs.pty],
    ["stdout", logs.stdout],
    ["stderr", logs.stderr],
  ]) {
    const extracted = extractInteractiveSessionFromText(engine, text);
    if (extracted) {
      return {
        ...extracted,
        source,
      };
    }
  }
  return {
    field: null,
    value: null,
    source: null,
  };
}

/**
 * @param {{ stdout: string; stderr: string; pty: string }} logs
 */
function parseCodex(logs) {
  const cleanedPtyLog = stripRuntimeScriptEnvelope(logs.pty);
  const stdoutParsed = parseNdjsonRecords(logs.stdout, "stdout");
  const ptyParsed = parseNdjsonRecords(cleanedPtyLog, "pty");

  const stdoutMessages = collectCodexAssistantMessages(stdoutParsed.records);
  const ptyMessages = collectCodexAssistantMessages(ptyParsed.records);

  const stdoutTurnCompleted = countRecords(
    stdoutParsed.records,
    (record) => record.type === "turn.completed",
  ) > 0;
  const ptyTurnCompleted = countRecords(
    ptyParsed.records,
    (record) => record.type === "turn.completed",
  ) > 0;

  const usePtyFallback =
    (stdoutMessages.length === 0 && ptyMessages.length > 0) ||
    (!stdoutTurnCompleted && ptyTurnCompleted);
  const assistantMessages = usePtyFallback ? ptyMessages : stdoutMessages;

  /** @type {string[]} */
  const diagnostics = [];
  if (usePtyFallback) {
    diagnostics.push("PTY_FALLBACK_USED");
  }
  if (stdoutParsed.rawEvents.length + ptyParsed.rawEvents.length > 0) {
    diagnostics.push("UNPARSED_CONTENT_FELL_BACK_TO_RAW");
  }

  return {
    parser: "codex_ndjson",
    assistantMessages,
    rawEvents: [...stdoutParsed.rawEvents, ...ptyParsed.rawEvents],
    diagnostics,
    structuredEventTypes: [
      ...new Set(
        [...stdoutParsed.records, ...ptyParsed.records]
          .filter((value) => value && typeof value === "object" && !Array.isArray(value))
          .map((value) => /** @type {Record<string, unknown>} */ (value).type)
          .filter((value) => typeof value === "string"),
      ),
    ],
  };
}

/**
 * @param {{ stdout: string; stderr: string; pty: string }} logs
 */
function parseGemini(logs) {
  /** @type {string[]} */
  const assistantMessages = [];
  /** @type {Array<{ stream: "stdout" | "stderr" | "pty"; line: string }>} */
  const rawEvents = [];
  /** @type {string[]} */
  const diagnostics = [];
  /** @type {string[]} */
  const structuredEventTypes = [];

  const stderrText = logs.stderr.trim();
  if (stderrText.length > 0) {
    try {
      const parsed = JSON.parse(stderrText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const typed = /** @type {Record<string, unknown>} */ (parsed);
        structuredEventTypes.push("gemini.response");
        if (typeof typed.response === "string" && typed.response.trim().length > 0) {
          assistantMessages.push(typed.response);
        }
      }
    } catch {
      diagnostics.push("GEMINI_STDERR_JSON_PARSE_FAILED");
      for (const line of splitNonEmptyLines(logs.stderr)) {
        rawEvents.push({ stream: "stderr", line });
      }
    }
  }

  for (const line of splitNonEmptyLines(logs.stdout)) {
    rawEvents.push({ stream: "stdout", line });
  }
  if (rawEvents.some((event) => event.stream === "stdout")) {
    diagnostics.push("GEMINI_STDOUT_NOISE");
  }

  return {
    parser: "gemini_json",
    assistantMessages,
    rawEvents,
    diagnostics,
    structuredEventTypes,
  };
}

/**
 * @param {{ stdout: string; stderr: string; pty: string }} logs
 */
function parseIflow(logs) {
  const merged = combinedLogs(logs);
  const withoutExecutionInfo = merged.replace(/<Execution Info>[\s\S]*?<\/Execution Info>/gu, "").trim();
  /** @type {string[]} */
  const assistantMessages = [];
  if (withoutExecutionInfo.length > 0) {
    assistantMessages.push(withoutExecutionInfo);
  }

  /** @type {string[]} */
  const diagnostics = [];
  if (splitNonEmptyLines(logs.stdout).length > 0 && splitNonEmptyLines(logs.stderr).length > 0) {
    diagnostics.push("IFLOW_CHANNEL_DRIFT_OBSERVED");
  }

  return {
    parser: "iflow_text",
    assistantMessages,
    rawEvents: [],
    diagnostics,
    structuredEventTypes: ["iflow.execution_info"],
  };
}

/**
 * @param {{ stdout: string; stderr: string; pty: string }} logs
 */
function parseOpencode(logs) {
  const stdoutParsed = parseNdjsonRecords(logs.stdout, "stdout");
  const ptyParsed = parseNdjsonRecords(logs.pty, "pty");

  const stdoutMessages = collectOpencodeAssistantMessages(stdoutParsed.records);
  const ptyMessages = collectOpencodeAssistantMessages(ptyParsed.records);
  const usePtyFallback = stdoutMessages.length === 0 && ptyMessages.length > 0;
  const assistantMessages = usePtyFallback ? ptyMessages : stdoutMessages;

  /** @type {string[]} */
  const diagnostics = [];
  if (usePtyFallback) {
    diagnostics.push("PTY_FALLBACK_USED");
  }
  if (stdoutParsed.rawEvents.length + ptyParsed.rawEvents.length > 0) {
    diagnostics.push("UNPARSED_CONTENT_FELL_BACK_TO_RAW");
  }

  return {
    parser: "opencode_ndjson",
    assistantMessages,
    rawEvents: [...stdoutParsed.rawEvents, ...ptyParsed.rawEvents],
    diagnostics,
    structuredEventTypes: [
      ...new Set(
        [...stdoutParsed.records, ...ptyParsed.records]
          .filter((value) => value && typeof value === "object" && !Array.isArray(value))
          .map((value) => /** @type {Record<string, unknown>} */ (value).type)
          .filter((value) => typeof value === "string"),
      ),
    ],
  };
}

/**
 * @param {string} engine
 * @param {{ stdout: string; stderr: string; pty: string }} logs
 */
function parseEngineOutput(engine, logs) {
  switch (engine) {
    case "codex":
      return parseCodex(logs);
    case "gemini":
      return parseGemini(logs);
    case "iflow":
      return parseIflow(logs);
    case "opencode":
      return parseOpencode(logs);
    default:
      return {
        parser: "unknown",
        assistantMessages: [],
        rawEvents: [
          ...splitNonEmptyLines(logs.stdout).map((line) => ({ stream: "stdout", line })),
          ...splitNonEmptyLines(logs.stderr).map((line) => ({ stream: "stderr", line })),
          ...splitNonEmptyLines(logs.pty).map((line) => ({ stream: "pty", line })),
        ],
        diagnostics: ["UNKNOWN_ENGINE_PROFILE"],
        structuredEventTypes: [],
      };
  }
}

/**
 * @param {{
 *   runId: string;
 *   engine: string;
 *   attempt: number;
 *   session: { field: string | null; value: string | null; };
 *   parsed: { assistantMessages: string[]; diagnostics: string[]; rawEvents: Array<{ stream: "stdout" | "stderr" | "pty"; line: string }>; };
 *   completion: { state: string; reasonCode: string; };
 * }} options
 */
function buildFcmpEvents(options) {
  /** @type {Array<{
   *   protocol_version: "fcmp/1.0";
   *   run_id: string;
   *   seq: number;
   *   engine: string;
   *   type: string;
   *   data: Record<string, unknown>;
   *   meta: { attempt: number; };
   * }>} */
  const events = [];
  let seq = 0;

  /**
   * @param {string} type
   * @param {Record<string, unknown>} data
   */
  const pushEvent = (type, data) => {
    seq += 1;
    events.push({
      protocol_version: "fcmp/1.0",
      run_id: options.runId,
      seq,
      engine: options.engine,
      type,
      data,
      meta: {
        attempt: options.attempt,
      },
    });
  };

  if (options.session.field && options.session.value) {
    pushEvent("conversation.started", {
        session_id: options.session.value,
    });
  }

  for (const [index, message] of options.parsed.assistantMessages.entries()) {
    pushEvent("assistant.message.final", {
        message_id: `m_${options.attempt}_${index + 1}`,
        text: message,
    });
  }

  for (const diagnostic of options.parsed.diagnostics) {
    pushEvent("diagnostic.warning", {
        code: diagnostic,
    });
  }

  for (const rawEvent of options.parsed.rawEvents) {
    pushEvent(rawEvent.stream === "stderr" ? "raw.stderr" : "raw.stdout", {
        line: rawEvent.line,
    });
  }

  if (options.completion.state === "completed") {
    pushEvent("conversation.completed", {
        state: "completed",
        reason_code: options.completion.reasonCode,
    });
  } else if (options.completion.state === "awaiting_user_input") {
    pushEvent("user.input.required", {
        kind: "free_text",
        prompt: "Provide next user turn",
    });
  } else if (options.completion.state === "interrupted") {
    pushEvent("conversation.failed", {
        error: {
          category: "runtime",
          code: options.completion.reasonCode,
        },
    });
  } else {
    pushEvent("diagnostic.warning", {
        code: "INCOMPLETE_STATE_CLASSIFICATION",
    });
  }

  return events;
}

/**
 * @param {string} filePath
 */
async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

/**
 * @param {string} filePath
 */
async function readText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && String(error.message).includes("ENOENT")) {
      return "";
    }
    throw error;
  }
}

export async function discoverFixtureAttempts() {
  const fixtureNames = (await readdir(FIXTURES_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  /** @type {Array<{
   *   id: string;
   *   fixture: string;
   *   engine: string;
   *   scenario: string;
   *   attempt: number;
   *   auditDirectory: string;
   *   metaPath: string;
   *   stdoutPath: string;
   *   stderrPath: string;
   *   ptyPath: string;
   * }>} */
  const attempts = [];

  for (const fixture of fixtureNames) {
    const [engine, ...scenarioParts] = fixture.split("-");
    const scenario = scenarioParts.join("-");
    const auditDirectory = path.join(FIXTURES_ROOT, fixture, ".audit");
    /** @type {import("node:fs").Dirent[]} */
    let entries;
    try {
      entries = await readdir(auditDirectory, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && String(error.message).includes("ENOENT")) {
        continue;
      }
      throw error;
    }
    const attemptNumbers = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name.match(/^meta\.(\d+)\.json$/u))
      .filter(Boolean)
      .map((matched) => Number.parseInt(matched[1], 10))
      .sort((left, right) => left - right);

    for (const attempt of attemptNumbers) {
      attempts.push({
        id: `${fixture}#${attempt}`,
        fixture,
        engine,
        scenario,
        attempt,
        auditDirectory,
        metaPath: path.join(auditDirectory, `meta.${attempt}.json`),
        stdoutPath: path.join(auditDirectory, `stdout.${attempt}.log`),
        stderrPath: path.join(auditDirectory, `stderr.${attempt}.log`),
        ptyPath: path.join(auditDirectory, `pty-output.${attempt}.log`),
      });
    }
  }

  return attempts;
}

export async function loadExpectationManifest() {
  const manifest = await readJson(EXPECTATIONS_PATH);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`Invalid expectation manifest: ${EXPECTATIONS_PATH}`);
  }
  return manifest;
}

/**
 * @param {{
 *   id: string;
 *   fixture: string;
 *   engine: string;
 *   scenario: string;
 *   attempt: number;
 *   metaPath: string;
 *   stdoutPath: string;
 *   stderrPath: string;
 *   ptyPath: string;
 * }} attempt
 */
export async function evaluateFixtureAttempt(attempt) {
  const [meta, stdout, stderr, pty] = await Promise.all([
    readJson(attempt.metaPath),
    readText(attempt.stdoutPath),
    readText(attempt.stderrPath),
    readText(attempt.ptyPath),
  ]);

  const logs = {
    stdout,
    stderr,
    pty,
  };
  const parsed = parseEngineOutput(attempt.engine, logs);
  const session = extractSession(attempt.engine, logs);

  const completion = await analyzeCompletionSignal({
    processResult: {
      success: Boolean(meta.success),
      code: typeof meta.exitCode === "number" ? meta.exitCode : null,
      signal: typeof meta.signal === "string" ? /** @type {NodeJS.Signals} */ (meta.signal) : null,
    },
    ptyOutputPath: attempt.ptyPath,
    stdoutPath: attempt.stdoutPath,
    stderrPath: attempt.stderrPath,
    agentName: attempt.engine,
    launchArgs: Array.isArray(meta.launch?.args)
      ? /** @type {string[]} */ (meta.launch.args.filter((value) => typeof value === "string"))
      : [],
  });

  const fcmpEvents = buildFcmpEvents({
    runId: typeof meta.runId === "string" ? meta.runId : `${attempt.fixture}-${attempt.attempt}`,
    engine: attempt.engine,
    attempt: attempt.attempt,
    session,
    parsed,
    completion,
  });

  return {
    attempt,
    meta,
    logs,
    session,
    parsed,
    completion,
    doneMarkerDetected: detectDoneMarker(combinedLogs(logs)),
    fcmpEvents,
  };
}

/**
 * @param {Array<{
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
 * }>} rows
 */
export async function writeFixtureReport(rows) {
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });

  const total = rows.length;
  const failedRows = rows.filter((row) => !row.pass);
  const passedRows = total - failedRows.length;
  const byEngine = new Map();

  for (const row of rows) {
    const current = byEngine.get(row.engine) ?? { total: 0, pass: 0 };
    current.total += 1;
    if (row.pass) {
      current.pass += 1;
    }
    byEngine.set(row.engine, current);
  }

  const lines = [
    "# RASP Fixture Test Report",
    "",
    `- Total attempts: ${total}`,
    `- Passed: ${passedRows}`,
    `- Failed: ${failedRows.length}`,
    "",
    "## Per-engine pass rate",
    "",
  ];

  /**
   * @param {unknown} value
   */
  const toCompactJson = (value) => {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  /**
   * @param {string} value
   * @param {number} maxLength
   */
  const truncate = (value, maxLength) => {
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength)}...`;
  };

  /**
   * @param {Array<{ type: string; data: Record<string, unknown> }>} envelopes
   */
  const renderFrontendPreview = (envelopes) => {
    /** @type {string[]} */
    const rendered = [];
    for (const envelope of envelopes) {
      if (envelope.type === "assistant.message.final") {
        const text = typeof envelope.data.text === "string" ? envelope.data.text : "";
        if (text.trim().length > 0) {
          rendered.push(`Assistant: ${text}`);
        }
        continue;
      }

      if (envelope.type === "user.input.required") {
        rendered.push("System: (请输入下一步指令...)");
        continue;
      }

      if (envelope.type === "conversation.completed") {
        rendered.push("System: 任务完成");
        continue;
      }

      if (envelope.type === "conversation.failed") {
        const error = envelope.data.error;
        if (error && typeof error === "object" && !Array.isArray(error)) {
          const message = typeof /** @type {Record<string, unknown>} */ (error).message === "string"
            ? /** @type {string} */ (/** @type {Record<string, unknown>} */ (error).message)
            : "任务执行失败";
          rendered.push(`System: ${message}`);
        } else {
          rendered.push("System: 任务执行失败");
        }
      }
    }

    if (rendered.length === 0) {
      rendered.push("(无可展示的前端对话文本)");
    }
    return rendered;
  };

  for (const [engine, stats] of [...byEngine.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    lines.push(`- ${engine}: ${stats.pass}/${stats.total}`);
  }

  lines.push(
    "",
    "## Attempt Summary",
    "",
    "| attempt | engine | scenario | expected state | actual state | session | FCMP | diagnostics | pass |",
    "| --- | --- | --- | --- | --- | --- | --- | ---: | --- |",
  );

  for (const row of rows) {
    lines.push(
      `| ${row.id} | ${row.engine} | ${row.scenario} | ${row.expectedState} | ${row.actualState} | ${row.session} | ${row.fcmp} | ${row.diagnostics} | ${row.pass ? "yes" : "no"} |`,
    );
  }

  if (failedRows.length > 0) {
    lines.push("", "## Failure Details", "");
    for (const row of failedRows) {
      lines.push(`### ${row.id}`, "");
      lines.push("- Expected vs actual:");
      lines.push(`  - state: expected=${row.expectedState}, actual=${row.actualState}`);
      lines.push(`  - session: ${row.session}`);
      lines.push(`  - FCMP: ${row.fcmp}`);
      lines.push("- Assertion failures:");
      for (const failure of row.failures) {
        lines.push(`  - ${failure}`);
      }
      lines.push("- Raw references:");
      for (const rawRef of row.rawRefs) {
        lines.push(`  - ${rawRef}`);
      }
      lines.push("");
    }
  }

  lines.push("", "## Attempt Details", "");
  for (const row of rows) {
    lines.push(`### ${row.id}`, "");
    lines.push(`- Status: ${row.pass ? "pass" : "fail"}`);
    lines.push(`- Expected state: ${row.expectedState}`);
    lines.push(`- Actual state: ${row.actualState}`);
    lines.push("");
    lines.push("#### Parsed Information");
    lines.push(`- Parser profile: ${row.parsedInfo.parser}`);
    lines.push(`- Session extraction: ${row.parsedInfo.session}`);
    lines.push(`- Structured event types: ${row.parsedInfo.structuredEventTypes.join(", ") || "(none)"}`);
    lines.push(`- Assistant messages parsed: ${row.parsedInfo.assistantMessageCount}`);
    lines.push(`- Done marker detected: ${row.parsedInfo.doneMarkerDetected ? "yes" : "no"}`);
    lines.push(`- Terminal signal: ${row.parsedInfo.terminalSignal}`);
    lines.push(`- Completion reason: ${row.parsedInfo.completionReason}`);
    lines.push(`- Parser diagnostics: ${row.parsedInfo.diagnostics.join(", ") || "(none)"}`);
    lines.push(`- Raw fallback events: ${row.parsedInfo.rawEventCount}`);
    if (row.parsedInfo.rawSamples.length > 0) {
      lines.push("- Raw fallback samples:");
      for (const sample of row.parsedInfo.rawSamples) {
        lines.push(`  - [${sample.stream}] ${truncate(sample.line, 200)}`);
      }
    }
    lines.push("");
    lines.push("#### Translated Information (FCMP)");
    lines.push(`- Event count: ${row.translatedInfo.length}`);
    lines.push("- Raw envelopes:");
    for (const translatedEvent of row.translatedInfo) {
      lines.push(
        `  - ${truncate(toCompactJson(translatedEvent), 420)}`,
      );
    }
    lines.push("");
    lines.push("#### Simulated Frontend View (Markdown)");
    for (const renderedLine of renderFrontendPreview(row.translatedInfo)) {
      lines.push(`- ${truncate(renderedLine, 360)}`);
    }
    lines.push("");
  }

  await writeFile(REPORT_PATH, `${lines.join("\n")}\n`, "utf8");
}
