import { mkdir } from "node:fs/promises";
import path from "node:path";

import { isPathInsideRoot } from "./path-utils.js";

const LEAKAGE_KEYS = [
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
  "XDG_DATA_HOME",
  "CODEX_HOME",
  "GEMINI_CLI_HOME",
  "GEMINI_CLI_TRUSTED_FOLDERS_PATH",
  "IFLOW_HOME",
  "OPENCODE_HOME",
];

const DIRECTORY_ENV_KEYS = [
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
  "XDG_DATA_HOME",
  "CODEX_HOME",
  "GEMINI_CLI_HOME",
  "IFLOW_HOME",
  "OPENCODE_HOME",
];

/**
 * @param {{
 *   managedPaths: import("./config.js").ManagedPaths;
 *   baseEnv?: NodeJS.ProcessEnv;
 *   agentEnv?: Record<string, string>;
 }} options
 */
export function buildIsolatedEnv(options) {
  const baseEnv = options.baseEnv ?? process.env;
  const merged = { ...baseEnv };

  const isolatedHome = path.join(options.managedPaths.homeRoot, "default");
  const xdgConfigHome = path.join(isolatedHome, ".config");
  const xdgStateHome = path.join(isolatedHome, ".local", "state");
  const xdgDataHome = path.join(isolatedHome, ".local", "share");

  merged.PATH = [options.managedPaths.bin, baseEnv.PATH ?? ""].filter(Boolean).join(path.delimiter);
  merged.HOME = isolatedHome;
  merged.XDG_CONFIG_HOME = xdgConfigHome;
  merged.XDG_STATE_HOME = xdgStateHome;
  merged.XDG_DATA_HOME = xdgDataHome;
  merged.AGENT_ENV_PREFIX_ROOT = options.managedPaths.root;
  merged.AGENT_ENV_METADATA_DIR = options.managedPaths.metadataRoot;

  delete merged.CODEX_HOME;
  delete merged.GEMINI_CLI_HOME;
  delete merged.GEMINI_CLI_TRUSTED_FOLDERS_PATH;
  delete merged.IFLOW_HOME;
  delete merged.OPENCODE_HOME;
  delete merged.ZDOTDIR;

  if (options.agentEnv) {
    for (const [envName, envValue] of Object.entries(options.agentEnv)) {
      merged[envName] = envValue;
    }
  }

  delete merged.GEMINI_CONFIG_DIR;

  return merged;
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
export async function ensureIsolationEnvDirectories(env) {
  for (const key of DIRECTORY_ENV_KEYS) {
    const value = env[key];
    if (value) {
      await mkdir(value, { recursive: true });
    }
  }
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} projectRoot
 */
export function findLeakagePaths(env, projectRoot) {
  const root = path.resolve(projectRoot);
  const leaks = [];

  for (const key of LEAKAGE_KEYS) {
    const value = env[key];
    if (!value) {
      continue;
    }

    const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
    if (!isPathInsideRoot(absolute, root)) {
      leaks.push({ key, value, absolute });
    }
  }

  return leaks;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} projectRoot
 */
export function assertNoHostPathLeakage(env, projectRoot) {
  const leaks = findLeakagePaths(env, projectRoot);
  if (leaks.length === 0) {
    return;
  }

  const detail = leaks.map((leak) => `${leak.key}=${leak.value}`).join(", ");
  throw new Error(`Detected host-global config path leakage: ${detail}`);
}
