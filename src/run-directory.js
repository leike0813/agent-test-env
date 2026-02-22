import path from "node:path";
import {
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import crypto from "node:crypto";

import { isPathInsideRoot } from "./path-utils.js";

const FULL_RUN_ID_PATTERN = /^\d{8}T\d{6}(?:Z)?-[A-Za-z0-9_-]+-[0-9a-f]{8}$/;
const SHORT_RUN_ID_PATTERN = /^[0-9a-f]{8}$/i;
const ATTEMPTED_META_PATTERN = /^meta\.(\d+)\.json$/;

function nowTimestampForId() {
  const now = new Date();
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return iso;
}

/**
 * @param {import("./config.js").ManagedPaths} managedPaths
 */
export function getRunsRoot(managedPaths) {
  return path.join(managedPaths.root, "runs");
}

function createRunId(agentName) {
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${nowTimestampForId()}-${agentName}-${suffix}`;
}

function looksLikePathSelector(selector) {
  return (
    path.isAbsolute(selector) ||
    selector.includes(path.sep) ||
    selector.includes("/") ||
    selector.includes("\\") ||
    selector.startsWith(".")
  );
}

/**
 * @param {string} directoryPath
 * @param {string} selector
 */
async function assertDirectoryExists(directoryPath, selector) {
  let directoryStat;
  try {
    directoryStat = await stat(directoryPath);
  } catch (error) {
    if (error instanceof Error && String(error.message).includes("ENOENT")) {
      throw new Error(`Run selector "${selector}" does not match an existing run directory`);
    }
    throw error;
  }

  if (!directoryStat.isDirectory()) {
    throw new Error(`Run selector "${selector}" resolved to a non-directory path: ${directoryPath}`);
  }
}

/**
 * @param {string} metaPath
 */
async function readRunMetadata(metaPath) {
  let raw = "";
  try {
    raw = await readFile(metaPath, "utf8");
  } catch (error) {
    if (error instanceof Error && String(error.message).includes("ENOENT")) {
      throw new Error(`Existing run directory is missing required metadata file: ${metaPath}`);
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid run metadata JSON at ${metaPath}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid run metadata format at ${metaPath}`);
  }
  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * @param {string} auditDirectory
 */
async function resolveRunMetadataPath(auditDirectory) {
  let entries = [];
  try {
    entries = await readdir(auditDirectory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && String(error.message).includes("ENOENT")) {
      throw new Error(`Existing run directory is missing required audit directory: ${auditDirectory}`);
    }
    throw error;
  }

  let highestAttempt = 0;
  let highestAttemptName = "";
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const matched = entry.name.match(ATTEMPTED_META_PATTERN);
    if (!matched) {
      continue;
    }
    const attempt = Number.parseInt(matched[1], 10);
    if (Number.isInteger(attempt) && attempt > highestAttempt) {
      highestAttempt = attempt;
      highestAttemptName = entry.name;
    }
  }

  if (highestAttempt > 0) {
    return path.join(auditDirectory, highestAttemptName);
  }

  return path.join(auditDirectory, "meta.json");
}

/**
 * @param {Record<string, unknown>} metadata
 */
function readMetadataAgentName(metadata) {
  if (typeof metadata.agentName === "string" && metadata.agentName.length > 0) {
    return metadata.agentName;
  }

  const attempts = metadata.attempts;
  if (Array.isArray(attempts)) {
    for (const attempt of attempts) {
      if (
        attempt &&
        typeof attempt === "object" &&
        !Array.isArray(attempt) &&
        typeof /** @type {Record<string, unknown>} */ (attempt).agentName === "string"
      ) {
        return /** @type {string} */ (/** @type {Record<string, unknown>} */ (attempt).agentName);
      }
    }
  }

  return null;
}

/**
 * @param {Record<string, unknown>} metadata
 * @param {string} fallbackRunId
 */
function readMetadataRunId(metadata, fallbackRunId) {
  if (typeof metadata.runId === "string" && metadata.runId.length > 0) {
    return metadata.runId;
  }
  return fallbackRunId;
}

/**
 * @param {{
 *   runsRoot: string;
 *   selector: string;
 *   projectRoot: string;
 * }} options
 */
async function resolveRunDirectoryFromSelector(options) {
  if (looksLikePathSelector(options.selector)) {
    const candidate = path.isAbsolute(options.selector)
      ? path.resolve(options.selector)
      : path.resolve(options.projectRoot, options.selector);
    return candidate;
  }

  if (FULL_RUN_ID_PATTERN.test(options.selector)) {
    return path.join(options.runsRoot, options.selector);
  }

  if (SHORT_RUN_ID_PATTERN.test(options.selector)) {
    let entries = [];
    try {
      entries = await readdir(options.runsRoot, { withFileTypes: true });
    } catch (error) {
      if (!(error instanceof Error) || !String(error.message).includes("ENOENT")) {
        throw error;
      }
    }

    const shortId = options.selector.toLowerCase();
    const matches = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((entryName) => entryName.toLowerCase().endsWith(`-${shortId}`));

    if (matches.length === 0) {
      throw new Error(`Short run id "${options.selector}" does not match any existing run directory`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Short run id "${options.selector}" is ambiguous (${matches.join(", ")}). Use full run id or path.`,
      );
    }

    return path.join(options.runsRoot, matches[0]);
  }

  throw new Error(
    `Invalid run selector "${options.selector}". Use run directory path, full run id, or 8-char short run id.`,
  );
}

/**
 * @param {{
 *   managedPaths: import("./config.js").ManagedPaths;
  *   agentName: string;
 }} options
 */
export async function createRunDirectory(options) {
  const runsRoot = getRunsRoot(options.managedPaths);
  await mkdir(runsRoot, { recursive: true });

  const runId = createRunId(options.agentName);
  const runDirectory = path.join(runsRoot, runId);
  const auditDirectory = path.join(runDirectory, ".audit");
  await mkdir(auditDirectory, { recursive: true });

  return {
    runId,
    runsRoot,
    runDirectory,
    auditDirectory,
  };
}

/**
 * @param {{
 *   managedPaths: import("./config.js").ManagedPaths;
 *   projectRoot: string;
 *   selector: string;
 *   agentName: string;
 * }} options
 */
export async function resolveExistingRunDirectory(options) {
  const runsRoot = getRunsRoot(options.managedPaths);
  await mkdir(runsRoot, { recursive: true });

  const runDirectory = await resolveRunDirectoryFromSelector({
    runsRoot,
    selector: options.selector,
    projectRoot: options.projectRoot,
  });
  await assertDirectoryExists(runDirectory, options.selector);

  if (!isPathInsideRoot(runDirectory, runsRoot)) {
    throw new Error(`Resolved run directory must be inside managed runs root: ${runDirectory}`);
  }

  const auditDirectory = path.join(runDirectory, ".audit");
  const metadataPath = await resolveRunMetadataPath(auditDirectory);
  const metadata = await readRunMetadata(metadataPath);
  const boundAgentName = readMetadataAgentName(metadata);
  if (!boundAgentName) {
    throw new Error(`Run metadata is missing agent binding in ${metadataPath}`);
  }

  if (boundAgentName !== options.agentName) {
    throw new Error(
      `Run selector "${options.selector}" belongs to agent "${boundAgentName}", expected "${options.agentName}"`,
    );
  }

  return {
    runId: readMetadataRunId(metadata, path.basename(runDirectory)),
    runsRoot,
    runDirectory,
    auditDirectory,
    reused: true,
    metadata,
  };
}

/**
 * @param {{
 *   runsRoot: string;
 *   entry: Record<string, unknown>;
 }} options
 */
export async function appendRunIndexEntry(options) {
  const indexPath = path.join(options.runsRoot, "index.json");
  /** @type {Record<string, unknown>[]} */
  let entries = [];

  try {
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      entries = parsed;
    }
  } catch (error) {
    if (!(error instanceof Error) || !String(error.message).includes("ENOENT")) {
      throw error;
    }
  }

  entries.push(options.entry);
  await writeFile(indexPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}
