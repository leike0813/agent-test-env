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
 * @param {Record<string, unknown>} source
 */
function toAttemptRecord(source) {
  return {
    runId: source.runId ?? null,
    agentName: source.agentName ?? null,
    launch: source.launch ?? null,
    startedAt: source.startedAt ?? null,
    endedAt: source.endedAt ?? null,
    success: source.success ?? null,
    started: source.started ?? null,
    exitCode: source.exitCode ?? null,
    signal: source.signal ?? null,
    error: source.error ?? null,
    trustApplied: source.trustApplied ?? null,
    runtime: source.runtime ?? null,
    logs: source.logs ?? null,
    filesystem: source.filesystem ?? null,
  };
}

/**
 * @param {string} metaPath
 * @param {Record<string, unknown>} runMetadata
 */
export async function appendRunMetadata(metaPath, runMetadata) {
  /** @type {Record<string, unknown> | null} */
  let existing = null;

  try {
    const raw = await readFile(metaPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = /** @type {Record<string, unknown>} */ (parsed);
    }
  } catch (error) {
    if (!(error instanceof Error) || !String(error.message).includes("ENOENT")) {
      throw error;
    }
  }

  /** @type {Record<string, unknown>[]} */
  const attempts = [];
  if (existing) {
    const existingAttempts = existing.attempts;
    if (Array.isArray(existingAttempts)) {
      for (const attempt of existingAttempts) {
        if (attempt && typeof attempt === "object" && !Array.isArray(attempt)) {
          attempts.push(/** @type {Record<string, unknown>} */ (attempt));
        }
      }
    } else {
      attempts.push(toAttemptRecord(existing));
    }
  }

  const nextAttempt = {
    attemptNumber: attempts.length + 1,
    ...toAttemptRecord(runMetadata),
  };

  const merged = {
    ...runMetadata,
    schemaVersion: 3,
    attemptCount: attempts.length + 1,
    attempts: [...attempts, nextAttempt],
  };

  await writeJsonFile(metaPath, merged);
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
 *   append?: boolean;
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

  const writeOptions = {
    encoding: "utf8",
    flag: options.append ? "a" : "w",
  };
  await writeFile(options.stdoutPath, stdoutChunks.join(""), writeOptions);
  await writeFile(options.stderrPath, stderrChunks.join(""), writeOptions);

  return {
    stdoutChunks: stdoutChunks.length,
    stderrChunks: stderrChunks.length,
    append: options.append ?? false,
  };
}
