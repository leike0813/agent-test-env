import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const ATTEMPTED_META_PATTERN = /^meta\.(\d+)\.json$/;
const DONE_SIGNAL_PREFIX = "AGENT_ENV_DONE ";
const DONE_SCHEMA_VERSION = "1";
const DONE_ALLOWED_STATES = new Set([
  "completed",
  "awaiting_user_input",
  "interrupted",
  "unknown",
]);
const DONE_ALLOWED_RESULT_KINDS = new Set([
  "json_object",
  "text",
  "none",
]);
const DONE_REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

/**
 * @param {string} relativePath
 * @param {string[]} ignoredPrefixes
 */
function shouldIgnoreRelativePath(relativePath, ignoredPrefixes) {
  const normalized = normalizeRelativePath(relativePath);
  return ignoredPrefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

/**
 * @param {string} filePath
 */
async function fileSha256(filePath) {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * @param {{
 *   runDirectory: string;
 *   auditDirectory: string;
 }} options
 */
export async function createAuditStreams(options) {
  await mkdir(options.auditDirectory, { recursive: true });
  const stdinPath = path.join(options.auditDirectory, "stdin.log");
  const stdoutPath = path.join(options.auditDirectory, "stdout.log");
  const stderrPath = path.join(options.auditDirectory, "stderr.log");

  const stdinStream = createWriteStream(stdinPath, { flags: "a" });
  const stdoutStream = createWriteStream(stdoutPath, { flags: "a" });
  const stderrStream = createWriteStream(stderrPath, { flags: "a" });

  return {
    stdinPath,
    stdoutPath,
    stderrPath,
    stdinStream,
    stdoutStream,
    stderrStream,
  };
}

/**
 * @param {Array<{ end: () => void; once: (event: string, listener: () => void) => void; }>} streams
 */
export async function closeAuditStreams(streams) {
  await Promise.all(
    streams.map(
      (stream) =>
        new Promise((resolve) => {
          stream.once("finish", () => resolve(undefined));
          stream.end();
        }),
    ),
  );
}

/**
 * @param {{
 *   runDirectory: string;
 *   ignoredPrefixes: string[];
 }} options
 */
export async function captureFilesystemSnapshot(options) {
  /** @type {Record<string, { size: number; mtimeMs: number; sha256: string }>} */
  const snapshot = {};

  /**
   * @param {string} currentDirectory
   * @param {string} relativeBase
   */
  const walk = async (currentDirectory, relativeBase) => {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      const relativePath = relativeBase
        ? path.join(relativeBase, entry.name)
        : entry.name;
      const normalizedRelativePath = normalizeRelativePath(relativePath);

      if (shouldIgnoreRelativePath(normalizedRelativePath, options.ignoredPrefixes)) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const fileStat = await stat(absolutePath);
      snapshot[normalizedRelativePath] = {
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        sha256: await fileSha256(absolutePath),
      };
    }
  };

  await walk(options.runDirectory, "");
  return snapshot;
}

/**
 * @param {Record<string, { size: number; mtimeMs: number; sha256: string }>} beforeSnapshot
 * @param {Record<string, { size: number; mtimeMs: number; sha256: string }>} afterSnapshot
 */
export function diffSnapshots(beforeSnapshot, afterSnapshot) {
  const beforeKeys = new Set(Object.keys(beforeSnapshot));
  const afterKeys = new Set(Object.keys(afterSnapshot));

  /** @type {string[]} */
  const created = [];
  /** @type {string[]} */
  const modified = [];
  /** @type {string[]} */
  const deleted = [];

  for (const key of afterKeys) {
    if (!beforeKeys.has(key)) {
      created.push(key);
      continue;
    }
    if (beforeSnapshot[key].sha256 !== afterSnapshot[key].sha256) {
      modified.push(key);
    }
  }

  for (const key of beforeKeys) {
    if (!afterKeys.has(key)) {
      deleted.push(key);
    }
  }

  created.sort();
  modified.sort();
  deleted.sort();

  return {
    created,
    modified,
    deleted,
  };
}

/**
 * @param {string} filePath
 * @param {unknown} value
 */
export async function writeJsonFile(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * @param {{
 *   auditDirectory: string;
 * }} options
 */
export async function resolveNextAuditAttemptNumber(options) {
  await mkdir(options.auditDirectory, { recursive: true });

  let highestAttempt = 0;
  const entries = await readdir(options.auditDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const matched = entry.name.match(ATTEMPTED_META_PATTERN);
    if (!matched) {
      continue;
    }
    const parsedAttempt = Number.parseInt(matched[1], 10);
    if (Number.isInteger(parsedAttempt) && parsedAttempt > highestAttempt) {
      highestAttempt = parsedAttempt;
    }
  }

  if (highestAttempt > 0) {
    return highestAttempt + 1;
  }

  const legacyMetaPath = path.join(options.auditDirectory, "meta.json");
  try {
    const raw = await readFile(legacyMetaPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const attemptCount = /** @type {Record<string, unknown>} */ (parsed).attemptCount;
      if (typeof attemptCount === "number" && Number.isInteger(attemptCount) && attemptCount >= 1) {
        return attemptCount + 1;
      }
      const attempts = /** @type {Record<string, unknown>} */ (parsed).attempts;
      if (Array.isArray(attempts) && attempts.length > 0) {
        return attempts.length + 1;
      }
      return 2;
    }
  } catch (error) {
    if (!(error instanceof Error) || !String(error.message).includes("ENOENT")) {
      throw error;
    }
  }

  return 1;
}

/**
 * @param {{
 *   auditDirectory: string;
 *   attemptNumber: number;
 * }} options
 */
export function buildAttemptAuditPaths(options) {
  const suffix = `.${options.attemptNumber}`;
  return {
    attemptNumber: options.attemptNumber,
    metaPath: path.join(options.auditDirectory, `meta${suffix}.json`),
    stdinPath: path.join(options.auditDirectory, `stdin${suffix}.log`),
    stdoutPath: path.join(options.auditDirectory, `stdout${suffix}.log`),
    stderrPath: path.join(options.auditDirectory, `stderr${suffix}.log`),
    ptyOutputPath: path.join(options.auditDirectory, `pty-output${suffix}.log`),
    ptyTimingPath: path.join(options.auditDirectory, `pty-timing${suffix}.log`),
    tracePath: path.join(options.auditDirectory, `fd-trace${suffix}.log`),
    fsBeforePath: path.join(options.auditDirectory, `fs-before${suffix}.json`),
    fsAfterPath: path.join(options.auditDirectory, `fs-after${suffix}.json`),
    fsDiffPath: path.join(options.auditDirectory, `fs-diff${suffix}.json`),
  };
}

/**
 * @param {string | undefined | null} skillName
 * @param {string[] | undefined} launchArgs
 */
export function inferRunScenario(skillName, launchArgs) {
  const classify = (input) => {
    const value = input.toLowerCase();
    if (value.includes("file-write") || value.includes("filewrite")) {
      return "file-write";
    }
    if (value.includes("interactive")) {
      return "interactive";
    }
    if (value.includes("auto")) {
      return "auto";
    }
    return null;
  };

  if (typeof skillName === "string" && skillName.trim().length > 0) {
    const fromSkill = classify(skillName);
    if (fromSkill) {
      return fromSkill;
    }
  }

  for (const token of launchArgs ?? []) {
    const fromToken = classify(token);
    if (fromToken) {
      return fromToken;
    }
  }

  return "unknown";
}

/**
 * @param {string} filePath
 */
async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && String(error.message).includes("ENOENT")) {
      return "";
    }
    throw error;
  }
}

function sanitizeForHeuristic(input) {
  return input
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\r/g, "");
}

// Accept legacy lowercase marker for historical fixture compatibility.
const DONE_MARKER_PATTERN = /\\?"__(?:SKILL_DONE|skill_done)__\\?"\s*:\s*true/iu;

function stripSkillContent(input) {
  return input.replace(/<skill_content[\s\S]*?<\/skill_content>/gu, "");
}

/**
 * @param {string | undefined} agentName
 * @param {{ pty: string; stdout: string; stderr: string }} streams
 * @param {{ success: boolean; code: number | null; signal: NodeJS.Signals | null }} processResult
 */
function detectTerminalSignal(agentName, streams, processResult) {
  const merged = [streams.pty, streams.stdout, streams.stderr].join("\n");
  switch (agentName) {
    case "codex":
      return {
        detected: /"type"\s*:\s*"turn\.completed"/u.test(merged),
        rule: "CODEX_TURN_COMPLETED",
      };
    case "gemini": {
      const hasResponseEnvelope =
        /"session_id"\s*:\s*"[^"]+"/u.test(streams.stderr) &&
        /"response"\s*:/u.test(streams.stderr);
      return {
        detected:
          hasResponseEnvelope &&
          processResult.success === true &&
          processResult.code === 0 &&
          processResult.signal === null,
        rule: "GEMINI_RESPONSE_OBJECT_FINISHED",
      };
    }
    case "iflow":
      return {
        detected: /<\/Execution Info>/u.test(merged),
        rule: "IFLOW_EXECUTION_INFO_CLOSED",
      };
    case "opencode":
      return {
        detected: /"type"\s*:\s*"step_finish"[\s\S]*?"reason"\s*:\s*"stop"/u.test(merged),
        rule: "OPENCODE_STEP_FINISH_STOP",
      };
    default:
      return {
        detected: false,
        rule: "UNKNOWN_ENGINE",
      };
  }
}

/**
 * @param {unknown} parsed
 * @param {string | undefined} expectedSkillName
 */
function validateDoneSignalPayload(parsed, expectedSkillName) {
  /** @type {string[]} */
  const errors = [];
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      valid: false,
      errors: ["payload is not a JSON object"],
      payload: null,
    };
  }

  const payload = /** @type {Record<string, unknown>} */ (parsed);
  const version = payload.version;
  if (version !== DONE_SCHEMA_VERSION) {
    errors.push(`version must be "${DONE_SCHEMA_VERSION}"`);
  }

  const state = payload.state;
  if (typeof state !== "string" || !DONE_ALLOWED_STATES.has(state)) {
    errors.push("state must be a supported enum value");
  }

  const skill = payload.skill;
  if (typeof skill !== "string" || skill.trim().length === 0) {
    errors.push("skill must be a non-empty string");
  } else if (expectedSkillName && skill !== expectedSkillName) {
    errors.push(`skill must match injected skill "${expectedSkillName}"`);
  }

  const resultKind = payload.result_kind;
  if (typeof resultKind !== "string" || !DONE_ALLOWED_RESULT_KINDS.has(resultKind)) {
    errors.push("result_kind must be a supported enum value");
  }

  if (typeof payload.needs_user_input !== "boolean") {
    errors.push("needs_user_input must be boolean");
  }

  const reasonCode = payload.reason_code;
  if (typeof reasonCode !== "string" || !DONE_REASON_CODE_PATTERN.test(reasonCode)) {
    errors.push("reason_code must match ^[A-Z][A-Z0-9_]*$");
  }

  return {
    valid: errors.length === 0,
    errors,
    payload: errors.length === 0 ? payload : null,
  };
}

/**
 * @param {{
 *   source: "pty" | "stdout" | "stderr";
 *   sourceRank: number;
 *   raw: string;
 *   expectedSkillName?: string;
 * }} options
 */
function collectDoneSignalCandidates(options) {
  /** @type {Array<{
   *   source: "pty" | "stdout" | "stderr";
   *   sourceRank: number;
   *   lineNumber: number;
   *   rawLine: string;
   *   payload: Record<string, unknown> | null;
   *   errors: string[];
   *   valid: boolean;
   * }>} */
  const candidates = [];
  const lines = options.raw.split(/\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const markerIndex = line.indexOf(DONE_SIGNAL_PREFIX);
    if (markerIndex === -1) {
      continue;
    }

    const payloadText = line.slice(markerIndex + DONE_SIGNAL_PREFIX.length).trim();
    /** @type {unknown} */
    let parsed = null;
    /** @type {string[]} */
    let errors = [];
    if (payloadText.length === 0) {
      errors = ["missing json payload"];
    } else {
      try {
        parsed = JSON.parse(payloadText);
      } catch {
        errors = ["payload is not valid JSON"];
      }
    }

    if (errors.length === 0) {
      const validated = validateDoneSignalPayload(parsed, options.expectedSkillName);
      errors = validated.errors;
      candidates.push({
        source: options.source,
        sourceRank: options.sourceRank,
        lineNumber: index + 1,
        rawLine: line,
        payload: validated.payload,
        errors,
        valid: validated.valid,
      });
      continue;
    }

    candidates.push({
      source: options.source,
      sourceRank: options.sourceRank,
      lineNumber: index + 1,
      rawLine: line,
      payload: null,
      errors,
      valid: false,
    });
  }

  return candidates;
}

function clampConfidence(value) {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

/**
 * @param {{
 *   processResult: { success: boolean; code: number | null; signal: NodeJS.Signals | null; };
 *   ptyOutputPath: string;
 *   stdoutPath: string;
 *   stderrPath: string;
 *   agentName?: string;
 *   skillName?: string;
 *   launchArgs?: string[];
 * }} options
 */
export async function analyzeCompletionSignal(options) {
  const [ptyRaw, stdoutRaw, stderrRaw] = await Promise.all([
    readTextIfExists(options.ptyOutputPath),
    readTextIfExists(options.stdoutPath),
    readTextIfExists(options.stderrPath),
  ]);

  const cleanedStreams = {
    pty: stripSkillContent(sanitizeForHeuristic(ptyRaw)),
    stdout: stripSkillContent(sanitizeForHeuristic(stdoutRaw)),
    stderr: stripSkillContent(sanitizeForHeuristic(stderrRaw)),
  };

  const scenario = inferRunScenario(options.skillName, options.launchArgs);
  const allCandidates = [
    ...collectDoneSignalCandidates({
      source: "pty",
      sourceRank: 0,
      raw: cleanedStreams.pty,
      expectedSkillName: options.skillName,
    }),
    ...collectDoneSignalCandidates({
      source: "stdout",
      sourceRank: 1,
      raw: cleanedStreams.stdout,
      expectedSkillName: options.skillName,
    }),
    ...collectDoneSignalCandidates({
      source: "stderr",
      sourceRank: 2,
      raw: cleanedStreams.stderr,
      expectedSkillName: options.skillName,
    }),
  ];

  const validCandidates = allCandidates
    .filter((candidate) => candidate.valid && candidate.payload)
    .sort((left, right) => {
      if (left.sourceRank !== right.sourceRank) {
        return left.sourceRank - right.sourceRank;
      }
      return right.lineNumber - left.lineNumber;
    });
  const selectedSignal = validCandidates[0] ?? null;

  /** @type {string[]} */
  const diagnostics = [];
  if (allCandidates.some((candidate) => !candidate.valid)) {
    diagnostics.push("DONE_SIGNAL_INVALID_SCHEMA");
  }
  if (!selectedSignal) {
    diagnostics.push("DONE_SIGNAL_NOT_FOUND");
  } else if (validCandidates.length > 1) {
    diagnostics.push("DONE_SIGNAL_CONFLICT");
  }

  let state = "unknown";
  let reasonCode = "INSUFFICIENT_EVIDENCE";
  let needsUserInput = false;
  let confidence = 0.3;
  let method = "rule";

  const doneMarkerSources = /** @type {Array<"pty" | "stdout" | "stderr">} */ ([]);
  if (DONE_MARKER_PATTERN.test(cleanedStreams.pty)) {
    doneMarkerSources.push("pty");
  }
  if (DONE_MARKER_PATTERN.test(cleanedStreams.stdout)) {
    doneMarkerSources.push("stdout");
  }
  if (DONE_MARKER_PATTERN.test(cleanedStreams.stderr)) {
    doneMarkerSources.push("stderr");
  }
  const doneMarkerDetected = doneMarkerSources.length > 0;
  const terminalSignal = detectTerminalSignal(options.agentName, cleanedStreams, options.processResult);

  if (selectedSignal && selectedSignal.payload) {
    state = /** @type {string} */ (selectedSignal.payload.state);
    reasonCode = /** @type {string} */ (selectedSignal.payload.reason_code);
    needsUserInput = /** @type {boolean} */ (selectedSignal.payload.needs_user_input);
    confidence = validCandidates.length > 1 ? 0.9 : 0.96;
    method = "signal";
  } else if (!options.processResult.success || options.processResult.code !== 0 || options.processResult.signal) {
    state = "interrupted";
    reasonCode = "PROCESS_EXIT_NON_ZERO";
    needsUserInput = false;
    confidence = 0.9;
    method = "rule";
    diagnostics.push("PROCESS_INTERRUPTED");
  } else if (doneMarkerDetected) {
    state = "completed";
    reasonCode = "DONE_MARKER_FOUND";
    needsUserInput = false;
    confidence = 0.96;
    method = "rule";
  } else if (terminalSignal.detected) {
    state = "awaiting_user_input";
    reasonCode = "TERMINAL_SIGNAL_WITHOUT_DONE_MARKER";
    needsUserInput = true;
    confidence = 0.92;
    method = "rule";
    diagnostics.push("DONE_MARKER_MISSING");
  } else {
    state = "unknown";
    reasonCode = "INSUFFICIENT_EVIDENCE";
    needsUserInput = false;
    confidence = 0.3;
    method = "rule";
    diagnostics.push("INTERACTIVE_END_UNCERTAIN");
  }

  if ((scenario === "auto" || scenario === "file-write") && state === "awaiting_user_input") {
    diagnostics.push("SCENARIO_STATE_CONSTRAINT_VIOLATION");
    confidence = clampConfidence(confidence - 0.25);
  }

  return {
    signalPrefix: DONE_SIGNAL_PREFIX,
    scenario,
    state,
    reasonCode,
    needsUserInput,
    confidence: clampConfidence(confidence),
    method,
    diagnostics: [...new Set(diagnostics)],
    doneMarker: {
      detected: doneMarkerDetected,
      sources: doneMarkerSources,
    },
    terminalSignal: {
      detected: terminalSignal.detected,
      rule: terminalSignal.rule,
      engine: options.agentName ?? null,
    },
    signal: selectedSignal && selectedSignal.payload
      ? {
        source: selectedSignal.source,
        lineNumber: selectedSignal.lineNumber,
        payload: selectedSignal.payload,
      }
      : null,
    candidates: allCandidates.map((candidate) => ({
      source: candidate.source,
      lineNumber: candidate.lineNumber,
      valid: candidate.valid,
      errors: candidate.errors,
      payload: candidate.payload,
    })),
  };
}

function decodeStraceCString(input) {
  const bytes = [];
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char !== "\\") {
      const encoded = Buffer.from(char, "utf8");
      for (const value of encoded) {
        bytes.push(value);
      }
      continue;
    }

    const next = input[index + 1];
    if (!next) {
      break;
    }
    index += 1;

    if (next === "n") {
      bytes.push(0x0a);
      continue;
    }
    if (next === "r") {
      bytes.push(0x0d);
      continue;
    }
    if (next === "t") {
      bytes.push(0x09);
      continue;
    }
    if (next === "\\") {
      bytes.push(0x5c);
      continue;
    }
    if (next === "\"") {
      bytes.push(0x22);
      continue;
    }
    if (next === "x") {
      const hex = input.slice(index + 1, index + 3);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        bytes.push(Number.parseInt(hex, 16));
        index += 2;
        continue;
      }
      continue;
    }
    if (/[0-7]/.test(next)) {
      const octalCandidate = `${next}${input[index + 1] ?? ""}${input[index + 2] ?? ""}`;
      const octal = octalCandidate.match(/^[0-7]{1,3}/)?.[0] ?? next;
      bytes.push(Number.parseInt(octal, 8));
      index += octal.length - 1;
      continue;
    }

    const encoded = Buffer.from(next, "utf8");
    for (const value of encoded) {
      bytes.push(value);
    }
  }

  return Buffer.from(bytes).toString("utf8");
}

/**
 * @param {{
 *   tracePath: string;
 *   stdoutPath: string;
 *   stderrPath: string;
 * }} options
 */
export async function reconstructSplitStreamsFromTrace(options) {
  let traceRaw = "";
  try {
    traceRaw = await readFile(options.tracePath, "utf8");
  } catch (error) {
    if (!(error instanceof Error) || !String(error.message).includes("ENOENT")) {
      throw error;
    }
    traceRaw = "";
  }

  const stdoutChunks = [];
  const stderrChunks = [];
  const lines = traceRaw.split(/\r?\n/);
  const writePattern =
    /(?:^\[pid\s+\d+\]\s+|^\d+\s+)?write\((\d+)(?:<(.+)>,)?\s*"((?:\\.|[^"\\])*)",\s*\d+\)\s*=\s*\d+/;
  /** @type {Map<string, "stdout" | "stderr">} */
  const fdToStream = new Map();

  const classifyFd = (fd) => {
    if (fdToStream.has(fd)) {
      return fdToStream.get(fd);
    }

    if (fd === "1") {
      fdToStream.set(fd, "stdout");
      return "stdout";
    }
    if (fd === "2") {
      fdToStream.set(fd, "stderr");
      return "stderr";
    }

    const hasStdout = [...fdToStream.values()].includes("stdout");
    const hasStderr = [...fdToStream.values()].includes("stderr");
    if (!hasStdout) {
      fdToStream.set(fd, "stdout");
      return "stdout";
    }
    if (!hasStderr) {
      fdToStream.set(fd, "stderr");
      return "stderr";
    }
    fdToStream.set(fd, "stdout");
    return "stdout";
  };

  for (const line of lines) {
    const match = line.match(writePattern);
    if (!match) {
      continue;
    }

    const destination = match[2] ?? "";
    if (destination && !destination.includes("/dev/pts/")) {
      continue;
    }

    const fd = match[1];
    const decoded = decodeStraceCString(match[3]);
    const stream = classifyFd(fd);
    if (stream === "stdout") {
      stdoutChunks.push(decoded);
    } else if (stream === "stderr") {
      stderrChunks.push(decoded);
    }
  }

  await writeFile(options.stdoutPath, stdoutChunks.join(""), "utf8");
  await writeFile(options.stderrPath, stderrChunks.join(""), "utf8");

  return {
    stdoutChunks: stdoutChunks.length,
    stderrChunks: stderrChunks.length,
  };
}
