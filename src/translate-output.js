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
 * @param {string} text
 */
function stripSkillContent(text) {
  return text.replace(/<skill_content[\s\S]*?<\/skill_content>/gu, "");
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
 * @param {string} text
 */
function stripRuntimeScriptEnvelope(text) {
  return splitNonEmptyLines(text)
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

  return {
    records,
    rawEvents,
  };
}

/**
 * @param {unknown[]} records
 * @param {(record: Record<string, unknown>) => boolean} predicate
 */
function countRecords(records, predicate) {
  let count = 0;
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      continue;
    }
    if (predicate(/** @type {Record<string, unknown>} */ (record))) {
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
    if (typeof partTyped.text === "string" && partTyped.text.trim().length > 0) {
      messages.push(partTyped.text);
    }
  }
  return messages;
}

/**
 * @param {unknown[]} records
 */
function listStructuredEventTypes(records) {
  return [
    ...new Set(
      records
        .filter((value) => value && typeof value === "object" && !Array.isArray(value))
        .map((value) => /** @type {Record<string, unknown>} */ (value).type)
        .filter((value) => typeof value === "string"),
    ),
  ];
}

/**
 * @param {{ stdout: string; stderr: string; pty: string }} logs
 */
function parseCodex(logs) {
  const cleanedPty = stripRuntimeScriptEnvelope(logs.pty);
  const stdoutParsed = parseNdjsonRecords(logs.stdout, "stdout");
  const ptyParsed = parseNdjsonRecords(cleanedPty, "pty");

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
    assistantMessages: usePtyFallback ? ptyMessages : stdoutMessages,
    diagnostics,
    rawEvents: [...stdoutParsed.rawEvents, ...ptyParsed.rawEvents],
    structuredEventTypes: listStructuredEventTypes([
      ...stdoutParsed.records,
      ...ptyParsed.records,
    ]),
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
        structuredEventTypes.push("gemini.response");
        const typed = /** @type {Record<string, unknown>} */ (parsed);
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
    diagnostics,
    rawEvents,
    structuredEventTypes,
  };
}

/**
 * @param {{ stdout: string; stderr: string; pty: string }} logs
 */
function parseIflow(logs) {
  const merged = `${logs.stdout}\n${logs.stderr}\n${logs.pty}`;
  const cleaned = stripRuntimeScriptEnvelope(merged)
    .replace(/<Execution Info>[\s\S]*?<\/Execution Info>/gu, "")
    .trim();

  /** @type {string[]} */
  const assistantMessages = [];
  if (cleaned.length > 0) {
    assistantMessages.push(cleaned);
  }

  /** @type {string[]} */
  const diagnostics = [];
  if (splitNonEmptyLines(logs.stdout).length > 0 && splitNonEmptyLines(logs.stderr).length > 0) {
    diagnostics.push("IFLOW_CHANNEL_DRIFT_OBSERVED");
  }

  return {
    parser: "iflow_text",
    assistantMessages,
    diagnostics,
    rawEvents: [],
    structuredEventTypes: ["iflow.execution_info"],
  };
}

/**
 * @param {{ stdout: string; stderr: string; pty: string }} logs
 */
function parseOpencode(logs) {
  const cleanedPty = stripRuntimeScriptEnvelope(logs.pty);
  const stdoutParsed = parseNdjsonRecords(logs.stdout, "stdout");
  const ptyParsed = parseNdjsonRecords(cleanedPty, "pty");
  const stdoutMessages = collectOpencodeAssistantMessages(stdoutParsed.records);
  const ptyMessages = collectOpencodeAssistantMessages(ptyParsed.records);
  const usePtyFallback = stdoutMessages.length === 0 && ptyMessages.length > 0;

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
    assistantMessages: usePtyFallback ? ptyMessages : stdoutMessages,
    diagnostics,
    rawEvents: [...stdoutParsed.rawEvents, ...ptyParsed.rawEvents],
    structuredEventTypes: listStructuredEventTypes([
      ...stdoutParsed.records,
      ...ptyParsed.records,
    ]),
  };
}

/**
 * @param {string} agentName
 * @param {{ stdout: string; stderr: string; pty: string }} logs
 */
function parseByAgent(agentName, logs) {
  switch (agentName) {
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
        diagnostics: ["UNKNOWN_ENGINE_PROFILE"],
        rawEvents: [
          ...splitNonEmptyLines(logs.stdout).map((line) => ({ stream: "stdout", line })),
          ...splitNonEmptyLines(logs.stderr).map((line) => ({ stream: "stderr", line })),
          ...splitNonEmptyLines(logs.pty).map((line) => ({ stream: "pty", line })),
        ],
        structuredEventTypes: [],
      };
  }
}

/**
 * @param {string} message
 */
function extractComparableMessageLines(message) {
  let lines = splitNonEmptyLines(message);
  if (lines.length >= 2 && lines[0].startsWith("```")) {
    lines = lines.slice(1);
    if (lines.length > 0 && lines[lines.length - 1] === "```") {
      lines = lines.slice(0, -1);
    }
  }
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * @param {string[]} assistantMessages
 */
function buildAssistantLineSet(assistantMessages) {
  const lineSet = new Set();
  for (const message of assistantMessages) {
    for (const line of extractComparableMessageLines(message)) {
      lineSet.add(line);
    }
  }
  return lineSet;
}

/**
 * @param {Array<{ stream: "stdout" | "stderr" | "pty"; line: string }>} rawEvents
 * @param {Set<string>} assistantLineSet
 */
function suppressDuplicateRawEchoBlocks(rawEvents, assistantLineSet) {
  if (assistantLineSet.size === 0 || rawEvents.length === 0) {
    return {
      rawEvents,
      suppressedCount: 0,
    };
  }

  const matched = rawEvents.map((event) => assistantLineSet.has(event.line.trim()));
  const suppressIndices = new Set();
  let index = 0;

  while (index < rawEvents.length) {
    if (!matched[index]) {
      index += 1;
      continue;
    }

    const stream = rawEvents[index].stream;
    let end = index + 1;
    while (end < rawEvents.length && matched[end] && rawEvents[end].stream === stream) {
      end += 1;
    }

    const runLength = end - index;
    if (runLength >= 3) {
      for (let cursor = index; cursor < end; cursor += 1) {
        suppressIndices.add(cursor);
      }
    }
    index = end;
  }

  if (suppressIndices.size === 0) {
    return {
      rawEvents,
      suppressedCount: 0,
    };
  }

  return {
    rawEvents: rawEvents.filter((_event, rawIndex) => !suppressIndices.has(rawIndex)),
    suppressedCount: suppressIndices.size,
  };
}

/**
 * @param {{
 *   runId: string;
 *   agentName: string;
 *   attemptNumber: number;
 *   session: { field: string | null; value: string | null; };
 *   parsed: {
 *     parser: string;
 *     assistantMessages: string[];
 *     diagnostics: string[];
 *     rawEvents: Array<{ stream: "stdout" | "stderr" | "pty"; line: string }>;
 *     structuredEventTypes: string[];
 *   };
 *   translateMode: number;
 *   completion: {
 *     state: string;
 *     reasonCode: string;
 *   };
 * }} options
 */
function buildTranslatedEnvelopes(options) {
  /** @type {Array<{
   *   protocol_version: "fcmp/1.0";
   *   run_id: string;
   *   seq: number;
   *   engine: string;
   *   type: string;
   *   data: Record<string, unknown>;
   *   meta: { attempt: number; };
   * }>} */
  const envelopes = [];
  let seq = 0;
  /**
   * @param {string} type
   * @param {Record<string, unknown>} data
   */
  const pushEnvelope = (type, data) => {
    seq += 1;
    envelopes.push({
      protocol_version: "fcmp/1.0",
      run_id: options.runId,
      seq,
      engine: options.agentName,
      type,
      data,
      meta: {
        attempt: options.attemptNumber,
      },
    });
  };

  if (options.session.field && options.session.value) {
    pushEnvelope("conversation.started", {
      session_id: options.session.value,
    });
  }

  for (const [index, message] of options.parsed.assistantMessages.entries()) {
    pushEnvelope("assistant.message.final", {
      message_id: `m_${options.attemptNumber}_${index + 1}`,
      text: message,
    });
  }

  for (const diagnostic of options.parsed.diagnostics) {
    pushEnvelope("diagnostic.warning", {
      code: diagnostic,
    });
  }

  const normalizedRaw =
    options.translateMode >= 2
      ? suppressDuplicateRawEchoBlocks(
        options.parsed.rawEvents,
        buildAssistantLineSet(options.parsed.assistantMessages),
      )
      : {
        rawEvents: options.parsed.rawEvents,
        suppressedCount: 0,
      };

  if (normalizedRaw.suppressedCount > 0) {
    pushEnvelope("diagnostic.warning", {
      code: "RAW_DUPLICATE_SUPPRESSED",
      suppressed_count: normalizedRaw.suppressedCount,
    });
  }

  for (const rawEvent of normalizedRaw.rawEvents) {
    pushEnvelope(rawEvent.stream === "stderr" ? "raw.stderr" : "raw.stdout", {
      line: rawEvent.line,
    });
  }

  if (options.completion.state === "completed") {
    pushEnvelope("conversation.completed", {
      state: "completed",
      reason_code: options.completion.reasonCode,
    });
  } else if (options.completion.state === "awaiting_user_input") {
    pushEnvelope("user.input.required", {
      kind: "free_text",
      prompt: "Provide next user turn",
    });
  } else if (options.completion.state === "interrupted") {
    pushEnvelope("conversation.failed", {
      error: {
        category: "runtime",
        code: options.completion.reasonCode,
      },
    });
  } else {
    pushEnvelope("diagnostic.warning", {
      code: "INCOMPLETE_STATE_CLASSIFICATION",
    });
  }

  return envelopes;
}

/**
 * @param {Array<{
 *   type: string;
 *   data: Record<string, unknown>;
 * }>} envelopes
 */
function buildFrontendLines(envelopes) {
  /** @type {string[]} */
  const lines = [];
  for (const envelope of envelopes) {
    if (envelope.type === "assistant.message.final") {
      const text = typeof envelope.data.text === "string" ? envelope.data.text.trim() : "";
      if (text.length > 0) {
        lines.push(`Assistant: ${text}`);
      }
      continue;
    }
    if (envelope.type === "user.input.required") {
      lines.push("System: (请输入下一步指令...)");
      continue;
    }
    if (envelope.type === "conversation.completed") {
      lines.push("System: 任务完成");
      continue;
    }
    if (envelope.type === "conversation.failed") {
      lines.push("System: 任务执行失败");
    }
  }
  if (lines.length === 0) {
    lines.push("(无可展示的前端对话文本)");
  }
  return lines;
}

/**
 * @param {{
 *   runId: string;
 *   attemptNumber: number;
 *   agentName: string;
 *   session: { field: string | null; value: string | null; source: string | null; };
 *   completion: Record<string, unknown>;
 *   stdoutText: string;
 *   stderrText: string;
 *   ptyText: string;
 *   translateMode: number;
 * }} options
 */
export function buildTranslateArtifacts(options) {
  const parsed = parseByAgent(options.agentName, {
    stdout: options.stdoutText,
    stderr: options.stderrText,
    pty: options.ptyText,
  });
  const envelopes = buildTranslatedEnvelopes({
    runId: options.runId,
    attemptNumber: options.attemptNumber,
    agentName: options.agentName,
    session: options.session,
    parsed,
    translateMode: options.translateMode,
    completion: {
      state: typeof options.completion.state === "string" ? options.completion.state : "unknown",
      reasonCode:
        typeof options.completion.reasonCode === "string"
          ? options.completion.reasonCode
          : "INSUFFICIENT_EVIDENCE",
    },
  });
  const frontendLines = buildFrontendLines(envelopes);
  return {
    parsed,
    envelopes,
    frontendLines,
  };
}

/**
 * @param {{
 *   mode: number;
 *   runId: string;
 *   attemptNumber: number;
 *   agentName: string;
 *   session: { field: string | null; value: string | null; source: string | null; };
 *   completion: Record<string, unknown>;
 *   artifacts: {
 *     parsed: {
 *       parser: string;
 *       assistantMessages: string[];
 *       diagnostics: string[];
 *       rawEvents: Array<{ stream: "stdout" | "stderr" | "pty"; line: string }>;
 *       structuredEventTypes: string[];
 *     };
 *     envelopes: Array<Record<string, unknown>>;
 *     frontendLines: string[];
 *   };
 * }} options
 */
export function formatTranslateOutput(options) {
  if (options.mode === 1) {
    const completion = options.completion;
    const completionSummary = {
      scenario:
        completion && typeof completion === "object" && !Array.isArray(completion)
          ? /** @type {Record<string, unknown>} */ (completion).scenario
          : null,
      state:
        completion && typeof completion === "object" && !Array.isArray(completion)
          ? /** @type {Record<string, unknown>} */ (completion).state
          : null,
      reasonCode:
        completion && typeof completion === "object" && !Array.isArray(completion)
          ? /** @type {Record<string, unknown>} */ (completion).reasonCode
          : null,
      needsUserInput:
        completion && typeof completion === "object" && !Array.isArray(completion)
          ? /** @type {Record<string, unknown>} */ (completion).needsUserInput
          : null,
      confidence:
        completion && typeof completion === "object" && !Array.isArray(completion)
          ? /** @type {Record<string, unknown>} */ (completion).confidence
          : null,
      method:
        completion && typeof completion === "object" && !Array.isArray(completion)
          ? /** @type {Record<string, unknown>} */ (completion).method
          : null,
      diagnostics:
        completion && typeof completion === "object" && !Array.isArray(completion)
          ? /** @type {Record<string, unknown>} */ (completion).diagnostics
          : null,
      doneMarker:
        completion && typeof completion === "object" && !Array.isArray(completion)
          ? /** @type {Record<string, unknown>} */ (completion).doneMarker
          : null,
      terminalSignal:
        completion && typeof completion === "object" && !Array.isArray(completion)
          ? /** @type {Record<string, unknown>} */ (completion).terminalSignal
          : null,
    };
    const payload = {
      runId: options.runId,
      attemptNumber: options.attemptNumber,
      agentName: options.agentName,
      parserProfile: options.artifacts.parsed.parser,
      session: options.session,
      completion: completionSummary,
      structuredEventTypes: options.artifacts.parsed.structuredEventTypes,
      assistantMessages: options.artifacts.parsed.assistantMessages,
      diagnostics: options.artifacts.parsed.diagnostics,
      rawEventCount: options.artifacts.parsed.rawEvents.length,
      rawEventsSample: options.artifacts.parsed.rawEvents.slice(0, 5),
    };
    return [
      "### Parsed Structured Information",
      JSON.stringify(payload, null, 2),
      "",
    ].join("\n");
  }

  if (options.mode === 2) {
    return [
      "### Translated Message Envelopes",
      JSON.stringify(options.artifacts.envelopes, null, 2),
      "",
    ].join("\n");
  }

  if (options.mode === 3) {
    return [
      "### Simulated Frontend View (Markdown)",
      ...options.artifacts.frontendLines.map((line) => `- ${line}`),
      "",
    ].join("\n");
  }

  return "";
}
