import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const RUN_SUFFIX_PATTERN = /-([0-9a-f]{8})$/i;
const HANDLE_VALUE_PATTERN = /^[0-9a-f]{8}$/i;
const HANDLE_INDEX_FILE_NAME = "interactive-handles.json";
const TRANSLATE_LEVELS = new Set([0, 1, 2, 3]);

/**
 * @param {unknown} value
 * @returns {0 | 1 | 2 | 3}
 */
function normalizeTranslateLevel(value) {
  if (typeof value === "number" && Number.isInteger(value) && TRANSLATE_LEVELS.has(value)) {
    return /** @type {0 | 1 | 2 | 3} */ (value);
  }
  return 0;
}

/**
 * @param {string} runId
 */
function extractHandleFromRunId(runId) {
  const matched = runId.match(RUN_SUFFIX_PATTERN);
  if (!matched) {
    return null;
  }
  return matched[1].toLowerCase();
}

/**
 * @param {string} runDirectory
 */
function extractHandleFromRunDirectory(runDirectory) {
  return extractHandleFromRunId(path.basename(runDirectory));
}

/**
 * @param {{ runId?: string; runDirectory: string }} options
 */
export function deriveInteractiveHandle(options) {
  if (typeof options.runId === "string" && options.runId.length > 0) {
    const fromRunId = extractHandleFromRunId(options.runId);
    if (fromRunId) {
      return fromRunId;
    }
  }
  return extractHandleFromRunDirectory(options.runDirectory);
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

/**
 * @param {string} input
 * @param {RegExp} pattern
 */
function extractLastMatch(input, pattern) {
  let last = null;
  let matched = pattern.exec(input);
  while (matched) {
    if (typeof matched[1] === "string" && matched[1].length > 0) {
      last = matched[1];
    }
    matched = pattern.exec(input);
  }
  return last;
}

/**
 * @param {string} input
 */
function extractCodexThreadId(input) {
  const lines = input.split(/\r?\n/u);
  let last = null;
  for (const line of lines) {
    if (!line.includes("thread.started") || !line.includes("thread_id")) {
      continue;
    }

    try {
      const parsed = JSON.parse(line);
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        /** @type {Record<string, unknown>} */ (parsed).type === "thread.started" &&
        typeof /** @type {Record<string, unknown>} */ (parsed).thread_id === "string"
      ) {
        last = /** @type {string} */ (/** @type {Record<string, unknown>} */ (parsed).thread_id);
        continue;
      }
    } catch {
      // no-op: fall back to regex extraction for partially structured lines
    }

    const fromRegex = extractLastMatch(line, /"thread_id"\s*:\s*"([^"]+)"/g);
    if (fromRegex) {
      last = fromRegex;
    }
  }
  return last;
}

/**
 * @param {string} agentName
 * @param {string} input
 */
export function extractInteractiveSessionFromText(agentName, input) {
  switch (agentName) {
    case "codex": {
      const value = extractCodexThreadId(input);
      return value
        ? {
          field: "thread_id",
          value,
        }
        : null;
    }
    case "gemini": {
      const value = extractLastMatch(input, /"session_id"\s*:\s*"([^"]+)"/g);
      return value
        ? {
          field: "session_id",
          value,
        }
        : null;
    }
    case "iflow": {
      const value = extractLastMatch(input, /["']?session-id["']?\s*:\s*["']([^"']+)["']/g);
      return value
        ? {
          field: "session-id",
          value,
        }
        : null;
    }
    case "opencode": {
      const value = extractLastMatch(input, /"sessionID"\s*:\s*"([^"]+)"/g);
      return value
        ? {
          field: "sessionID",
          value,
        }
        : null;
    }
    default:
      return null;
  }
}

/**
 * @param {{
 *   agentName: string;
 *   ptyOutputPath: string;
 *   stdoutPath: string;
 *   stderrPath: string;
 * }} options
 */
export async function extractInteractiveSession(options) {
  const [ptyText, stdoutText, stderrText] = await Promise.all([
    readTextIfExists(options.ptyOutputPath),
    readTextIfExists(options.stdoutPath),
    readTextIfExists(options.stderrPath),
  ]);

  /** @type {Array<{ source: "pty" | "stdout" | "stderr"; text: string }>} */
  const candidates = [
    { source: "pty", text: ptyText },
    { source: "stdout", text: stdoutText },
    { source: "stderr", text: stderrText },
  ];

  for (const candidate of candidates) {
    const extracted = extractInteractiveSessionFromText(options.agentName, candidate.text);
    if (extracted) {
      return {
        ...extracted,
        source: candidate.source,
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
 * @param {string} metadataRoot
 */
function resolveInteractiveHandleIndexPath(metadataRoot) {
  return path.join(metadataRoot, HANDLE_INDEX_FILE_NAME);
}

/**
 * @param {string} indexPath
 */
async function readInteractiveHandleIndex(indexPath) {
  try {
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Invalid interactive handle index format: ${indexPath}`);
    }
    const object = /** @type {Record<string, unknown>} */ (parsed);
    const handles = object.handles;
    if (!handles || typeof handles !== "object" || Array.isArray(handles)) {
      throw new Error(`Invalid interactive handle index handles map: ${indexPath}`);
    }
    return {
      schemaVersion: 1,
      handles: /** @type {Record<string, Record<string, unknown>>} */ (handles),
    };
  } catch (error) {
    if (error instanceof Error && String(error.message).includes("ENOENT")) {
      return {
        schemaVersion: 1,
        handles: {},
      };
    }
    throw error;
  }
}

/**
 * @param {{
 *   metadataRoot: string;
 *   handle: string;
 *   runId: string;
 *   runDirectory: string;
 *   agentName: string;
 *   session: { field: string | null; value: string | null; source: string | null };
 *   launchArgs: string[];
 *   translateLevel: 0 | 1 | 2 | 3;
 * }} options
 */
export async function upsertInteractiveHandleRecord(options) {
  await mkdir(options.metadataRoot, { recursive: true });
  const indexPath = resolveInteractiveHandleIndexPath(options.metadataRoot);
  const index = await readInteractiveHandleIndex(indexPath);
  const updatedAt = new Date().toISOString();

  index.handles[options.handle] = {
    handle: options.handle,
    runId: options.runId,
    runDirectory: options.runDirectory,
    agentName: options.agentName,
    session: {
      field: options.session.field,
      value: options.session.value,
      source: options.session.source,
    },
    launch: {
      args: options.launchArgs,
      translateLevel: options.translateLevel,
    },
    updatedAt,
  };

  const payload = {
    schemaVersion: index.schemaVersion,
    updatedAt,
    handles: index.handles,
  };

  await writeFile(indexPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return {
    indexPath,
    entry: index.handles[options.handle],
  };
}

/**
 * @param {string} value
 */
function trimLeadingResumeMessage(value) {
  return value.trim();
}

/**
 * @param {string[]} args
 */
function removeTrailingPositional(args) {
  if (args.length === 0) {
    return args;
  }
  const tail = args[args.length - 1];
  if (tail.startsWith("-")) {
    return args;
  }
  return args.slice(0, -1);
}

/**
 * @param {string[]} args
 */
function stripPromptArgs(args) {
  const kept = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "-p" || token === "--prompt") {
      index += 1;
      continue;
    }
    if (token.startsWith("--prompt=")) {
      continue;
    }
    kept.push(token);
  }
  return kept;
}

/**
 * @param {string[]} args
 */
function stripResumeArgs(args) {
  const kept = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--resume") {
      index += 1;
      continue;
    }
    if (token.startsWith("--resume=")) {
      continue;
    }
    kept.push(token);
  }
  return kept;
}

/**
 * @param {string[]} args
 */
function stripSessionArgs(args) {
  const kept = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--session") {
      index += 1;
      continue;
    }
    if (token.startsWith("--session=")) {
      continue;
    }
    kept.push(token);
  }
  return kept;
}

/**
 * @param {string[]} previousArgs
 * @param {string} sessionValue
 * @param {string} message
 */
function buildCodexResumeArgs(previousArgs, sessionValue, message) {
  let args = [...previousArgs];
  if (args[0] !== "exec") {
    args = ["exec", ...args];
  }

  const resumeIndex = args.indexOf("resume");
  if (resumeIndex !== -1) {
    const head = args.slice(0, resumeIndex);
    let tail = args.slice(resumeIndex + 1);
    tail = removeTrailingPositional(removeTrailingPositional(tail));
    args = [...head, ...tail];
  } else {
    args = removeTrailingPositional(args);
  }

  const flags = args.slice(1);
  return ["exec", "resume", ...flags, sessionValue, message];
}

/**
 * @param {string[]} previousArgs
 * @param {string} sessionValue
 * @param {string} message
 */
function buildGeminiResumeArgs(previousArgs, sessionValue, message) {
  let args = [...previousArgs];
  args = stripResumeArgs(args);
  args = stripPromptArgs(args);
  args = removeTrailingPositional(args);
  return [`--resume=${sessionValue}`, ...args, "-p", message];
}

/**
 * @param {string[]} previousArgs
 * @param {string} sessionValue
 * @param {string} message
 */
function buildIflowResumeArgs(previousArgs, sessionValue, message) {
  let args = [...previousArgs];
  args = stripResumeArgs(args);
  args = stripPromptArgs(args);
  args = removeTrailingPositional(args);
  return [`--resume=${sessionValue}`, ...args, "-p", message];
}

/**
 * @param {string[]} previousArgs
 * @param {string} sessionValue
 * @param {string} message
 */
function buildOpencodeResumeArgs(previousArgs, sessionValue, message) {
  let args = [...previousArgs];
  args = stripSessionArgs(args);
  args = removeTrailingPositional(args);

  if (args[0] === "run") {
    return ["run", `--session=${sessionValue}`, ...args.slice(1), message];
  }
  return [`--session=${sessionValue}`, ...args, message];
}

/**
 * @param {{
 *   metadataRoot: string;
 *   handle: string;
 * }} options
 */
export async function readInteractiveHandleRecord(options) {
  const normalizedHandle = options.handle.trim().toLowerCase();
  if (!HANDLE_VALUE_PATTERN.test(normalizedHandle)) {
    throw new Error(`Invalid handle "${options.handle}". Expected 8-char hex suffix.`);
  }

  const indexPath = resolveInteractiveHandleIndexPath(options.metadataRoot);
  const index = await readInteractiveHandleIndex(indexPath);
  const raw = index.handles[normalizedHandle];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = /** @type {Record<string, unknown>} */ (raw);
  const runId = typeof record.runId === "string" ? record.runId : null;
  const runDirectory = typeof record.runDirectory === "string" ? record.runDirectory : null;
  const agentName = typeof record.agentName === "string" ? record.agentName : null;
  const sessionObject =
    record.session && typeof record.session === "object" && !Array.isArray(record.session)
      ? /** @type {Record<string, unknown>} */ (record.session)
      : {};
  const launchObject =
    record.launch && typeof record.launch === "object" && !Array.isArray(record.launch)
      ? /** @type {Record<string, unknown>} */ (record.launch)
      : {};
  const launchArgs = Array.isArray(launchObject.args)
    ? launchObject.args.filter((item) => typeof item === "string")
    : [];

  if (!runId || !runDirectory || !agentName) {
    throw new Error(`Handle "${options.handle}" has incomplete metadata in ${indexPath}`);
  }

  return {
    indexPath,
    handle: normalizedHandle,
    runId,
    runDirectory,
    agentName,
    session: {
      field: typeof sessionObject.field === "string" ? sessionObject.field : null,
      value: typeof sessionObject.value === "string" ? sessionObject.value : null,
      source: typeof sessionObject.source === "string" ? sessionObject.source : null,
    },
    launchArgs,
    translateLevel: normalizeTranslateLevel(launchObject.translateLevel),
  };
}

/**
 * @param {{
 *   agentName: string;
 *   previousArgs: string[];
 *   sessionValue: string;
 *   message: string;
 * }} options
 */
export function buildResumePassthroughArgs(options) {
  const message = trimLeadingResumeMessage(options.message);
  if (!message) {
    throw new Error("resume requires a non-empty <message>");
  }
  if (!options.sessionValue || options.sessionValue.trim().length === 0) {
    throw new Error("resume requires a detected session id in handle metadata");
  }

  switch (options.agentName) {
    case "codex":
      return buildCodexResumeArgs(options.previousArgs, options.sessionValue, message);
    case "gemini":
      return buildGeminiResumeArgs(options.previousArgs, options.sessionValue, message);
    case "iflow":
      return buildIflowResumeArgs(options.previousArgs, options.sessionValue, message);
    case "opencode":
      return buildOpencodeResumeArgs(options.previousArgs, options.sessionValue, message);
    default:
      throw new Error(`resume is unsupported for agent "${options.agentName}"`);
  }
}
