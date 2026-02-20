import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { isPathInsideRoot } from "./path-utils.js";

export const DEFAULT_CONFIG_FILE = "agent-env.config.json";

/**
 * @typedef {{
 *   command: string;
 *   args?: string[];
 * }} CommandTemplate
 */

/**
 * @typedef {{
 *   install: CommandTemplate;
 *   upgrade: CommandTemplate;
 * }} AgentLifecycleCommands
 */

/**
 * @typedef {{
 *   executable: string;
 *   args?: string[];
 *   env?: Record<string, string>;
 *   requiredOnBootstrap?: boolean;
 *   lifecycle: AgentLifecycleCommands;
 * }} AgentDefinition
 */

/**
 * @typedef {{
 *   root: string;
 *   binDir: string;
 *   configDir: string;
 *   stateDir: string;
 *   logsDir: string;
 *   metadataDir: string;
 *   homeDir: string;
 * }} ManagedPrefixConfig
 */

/**
 * @typedef {{
 *   schemaVersion: number;
 *   managedPrefix: ManagedPrefixConfig;
 *   agentsDir?: string;
 *   agents: Record<string, AgentDefinition>;
 * }} AgentEnvConfig
 */

/**
 * @typedef {{
 *   projectRoot: string;
 *   root: string;
 *   bin: string;
 *   configRoot: string;
 *   stateRoot: string;
 *   logsRoot: string;
 *   metadataRoot: string;
 *   homeRoot: string;
 * }} ManagedPaths
 */

function asObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${fieldName}: expected object`);
  }
  return value;
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid ${fieldName}: expected non-empty string`);
  }
}

function assertRelativePathSegment(value, fieldName) {
  assertNonEmptyString(value, fieldName);
  if (path.isAbsolute(value)) {
    throw new Error(`Invalid ${fieldName}: absolute path is not allowed`);
  }

  const normalized = path.normalize(value);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`) || normalized.includes(`${path.sep}..${path.sep}`)) {
    throw new Error(`Invalid ${fieldName}: path traversal is not allowed`);
  }
}

function assertExecutableName(value, fieldName) {
  assertNonEmptyString(value, fieldName);
  if (path.basename(value) !== value) {
    throw new Error(`Invalid ${fieldName}: executable must not include path separators`);
  }
}

/**
 * @param {unknown} input
 * @param {string} fieldName
 * @returns {CommandTemplate}
 */
function validateCommandTemplate(input, fieldName) {
  const template = /** @type {Record<string, unknown>} */ (asObject(input, fieldName));
  assertExecutableName(template.command, `${fieldName}.command`);
  if (template.args !== undefined) {
    if (!Array.isArray(template.args) || template.args.some((value) => typeof value !== "string")) {
      throw new Error(`Invalid ${fieldName}.args: expected string[]`);
    }
  }
  return {
    command: template.command,
    args: template.args ?? [],
  };
}

/**
 * @param {unknown} input
 * @param {string} fieldName
 * @returns {AgentDefinition}
 */
function validateAgentDefinition(input, fieldName) {
  const definition = /** @type {Record<string, unknown>} */ (asObject(input, fieldName));
  assertExecutableName(definition.executable, `${fieldName}.executable`);

  if (definition.args !== undefined) {
    if (!Array.isArray(definition.args) || definition.args.some((value) => typeof value !== "string")) {
      throw new Error(`Invalid ${fieldName}.args: expected string[]`);
    }
  }

  if (definition.env !== undefined) {
    const env = asObject(definition.env, `${fieldName}.env`);
    for (const [envName, envValue] of Object.entries(env)) {
      assertNonEmptyString(envName, `${fieldName}.env.<key>`);
      if (typeof envValue !== "string") {
        throw new Error(`Invalid ${fieldName}.env.${envName}: expected string`);
      }
    }
  }

  if (definition.requiredOnBootstrap !== undefined && typeof definition.requiredOnBootstrap !== "boolean") {
    throw new Error(`Invalid ${fieldName}.requiredOnBootstrap: expected boolean`);
  }

  const lifecycle = /** @type {Record<string, unknown>} */ (asObject(definition.lifecycle, `${fieldName}.lifecycle`));
  const install = validateCommandTemplate(lifecycle.install, `${fieldName}.lifecycle.install`);
  const upgrade = validateCommandTemplate(lifecycle.upgrade, `${fieldName}.lifecycle.upgrade`);

  return {
    executable: definition.executable,
    args: definition.args ?? [],
    env: /** @type {Record<string, string>} */ (definition.env ?? {}),
    requiredOnBootstrap: definition.requiredOnBootstrap ?? false,
    lifecycle: {
      install,
      upgrade,
    },
  };
}

/**
 * @param {unknown} input
 * @returns {AgentEnvConfig}
 */
export function validateConfig(input) {
  const config = /** @type {Record<string, unknown>} */ (asObject(input, "config"));

  if (typeof config.schemaVersion !== "number" || config.schemaVersion < 1) {
    throw new Error("Invalid schemaVersion: expected number >= 1");
  }

  const managedPrefix = /** @type {Record<string, unknown>} */ (asObject(config.managedPrefix, "managedPrefix"));
  assertRelativePathSegment(managedPrefix.root, "managedPrefix.root");
  assertRelativePathSegment(managedPrefix.binDir, "managedPrefix.binDir");
  assertRelativePathSegment(managedPrefix.configDir, "managedPrefix.configDir");
  assertRelativePathSegment(managedPrefix.stateDir, "managedPrefix.stateDir");
  assertRelativePathSegment(managedPrefix.logsDir, "managedPrefix.logsDir");
  assertRelativePathSegment(managedPrefix.metadataDir, "managedPrefix.metadataDir");
  assertRelativePathSegment(managedPrefix.homeDir, "managedPrefix.homeDir");

  if (config.agentsDir !== undefined) {
    assertRelativePathSegment(config.agentsDir, "agentsDir");
  }

  const agentsInput = config.agents === undefined ? {} : asObject(config.agents, "agents");
  /** @type {Record<string, AgentDefinition>} */
  const agents = {};
  for (const [name, rawDefinition] of Object.entries(agentsInput)) {
    assertNonEmptyString(name, "agents.<name>");
    agents[name] = validateAgentDefinition(rawDefinition, `agents.${name}`);
  }

  return {
    schemaVersion: config.schemaVersion,
    managedPrefix: {
      root: managedPrefix.root,
      binDir: managedPrefix.binDir,
      configDir: managedPrefix.configDir,
      stateDir: managedPrefix.stateDir,
      logsDir: managedPrefix.logsDir,
      metadataDir: managedPrefix.metadataDir,
      homeDir: managedPrefix.homeDir,
    },
    agentsDir: config.agentsDir,
    agents,
  };
}

/**
 * @param {string} projectRoot
 * @param {string} agentsDir
 * @returns {Promise<Record<string, AgentDefinition>>}
 */
async function loadAgentsFromDirectory(projectRoot, agentsDir) {
  const directoryPath = path.resolve(projectRoot, agentsDir);
  const entries = await readdir(directoryPath, { withFileTypes: true });

  /** @type {Record<string, AgentDefinition>} */
  const fromDirectory = {};

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(directoryPath, entry.name);
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const object = /** @type {Record<string, unknown>} */ (asObject(parsed, `agentsDir.${entry.name}`));

    const explicitName = object.name;
    if (explicitName !== undefined) {
      assertNonEmptyString(explicitName, `agentsDir.${entry.name}.name`);
    }
    const inferredName = path.basename(entry.name, ".json");
    const name = explicitName ?? inferredName;

    if (fromDirectory[name]) {
      throw new Error(`Duplicate agent definition in agentsDir for "${name}"`);
    }
    fromDirectory[name] = validateAgentDefinition(object, `agentsDir.${entry.name}`);
  }

  return fromDirectory;
}

/**
 * @param {{ projectRoot?: string; configPath?: string }} [options]
 * @returns {Promise<AgentEnvConfig>}
 */
export async function loadConfig(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const configPath = options.configPath ?? DEFAULT_CONFIG_FILE;
  const resolvedPath = path.isAbsolute(configPath) ? configPath : path.resolve(projectRoot, configPath);
  const raw = await readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw);
  const validated = validateConfig(parsed);

  const directoryAgents = validated.agentsDir
    ? await loadAgentsFromDirectory(projectRoot, validated.agentsDir)
    : {};

  return {
    ...validated,
    agents: {
      ...directoryAgents,
      ...validated.agents,
    },
  };
}

/**
 * @param {string} projectRoot
 * @param {AgentEnvConfig} config
 * @returns {ManagedPaths}
 */
export function resolveManagedPaths(projectRoot, config) {
  const root = path.resolve(projectRoot, config.managedPrefix.root);
  return {
    projectRoot: path.resolve(projectRoot),
    root,
    bin: path.join(root, config.managedPrefix.binDir),
    configRoot: path.join(root, config.managedPrefix.configDir),
    stateRoot: path.join(root, config.managedPrefix.stateDir),
    logsRoot: path.join(root, config.managedPrefix.logsDir),
    metadataRoot: path.join(root, config.managedPrefix.metadataDir),
    homeRoot: path.join(root, config.managedPrefix.homeDir),
  };
}

/**
 * @param {ManagedPaths} managedPaths
 */
export function ensureManagedPathsInsideProject(managedPaths) {
  for (const value of [
    managedPaths.root,
    managedPaths.bin,
    managedPaths.configRoot,
    managedPaths.stateRoot,
    managedPaths.logsRoot,
    managedPaths.metadataRoot,
    managedPaths.homeRoot,
  ]) {
    if (!isPathInsideRoot(value, managedPaths.projectRoot)) {
      throw new Error(`Managed prefix path must stay inside project root: ${value}`);
    }
  }
}

/**
 * @param {AgentEnvConfig} config
 * @returns {string[]}
 */
export function listAgentNames(config) {
  return Object.keys(config.agents).sort();
}

/**
 * @param {AgentEnvConfig} config
 * @param {string} requestedAgentName
 */
export function resolveSingleAgent(config, requestedAgentName) {
  assertNonEmptyString(requestedAgentName, "agent name");
  const definition = config.agents[requestedAgentName];
  if (!definition) {
    const known = listAgentNames(config);
    throw new Error(
      `Unknown agent "${requestedAgentName}". Configured agents: ${known.join(", ") || "<none>"}`,
    );
  }
  return {
    name: requestedAgentName,
    definition,
  };
}
