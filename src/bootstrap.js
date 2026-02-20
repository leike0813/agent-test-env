import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_CONFIG_FILE,
  ensureManagedPathsInsideProject,
  loadConfig,
  resolveManagedPaths,
} from "./config.js";

/**
 * @param {import("./config.js").ManagedPaths} managedPaths
 */
export async function ensureManagedPrefixLayout(managedPaths) {
  for (const directory of [
    managedPaths.root,
    managedPaths.bin,
    managedPaths.configRoot,
    managedPaths.stateRoot,
    managedPaths.logsRoot,
    managedPaths.metadataRoot,
    managedPaths.homeRoot,
  ]) {
    await mkdir(directory, { recursive: true });
  }

  const metadataPath = path.join(managedPaths.metadataRoot, "launcher-state.json");
  await writeFile(
    metadataPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

  return { metadataPath };
}

/**
 * @param {string} agentName
 * @param {import("./config.js").AgentDefinition} agentDefinition
 * @param {import("./config.js").ManagedPaths} managedPaths
 */
export function resolveManagedExecutablePath(agentName, agentDefinition, managedPaths) {
  const executableName = path.basename(agentDefinition.executable);
  if (!executableName) {
    throw new Error(`Agent "${agentName}" has an empty executable field`);
  }
  return path.join(managedPaths.bin, executableName);
}

/**
 * @param {string} agentName
 * @param {string} executablePath
 */
export async function assertManagedExecutableExists(agentName, executablePath) {
  try {
    await access(executablePath, constants.X_OK);
  } catch {
    throw new Error(
      `Missing managed-prefix executable for "${agentName}": ${executablePath}. ` +
        `Install the executable into the managed prefix bin directory, then re-run bootstrap or launch.`,
    );
  }
}

/**
 * @param {{
 *   config: import("./config.js").AgentEnvConfig;
 *   managedPaths: import("./config.js").ManagedPaths;
 *   agentNames?: string[];
 * }} options
 */
export async function verifyManagedExecutables(options) {
  const verificationNames =
    options.agentNames ??
    Object.entries(options.config.agents)
      .filter(([, definition]) => definition.requiredOnBootstrap === true)
      .map(([name]) => name);

  const verified = [];
  for (const agentName of verificationNames) {
    const definition = options.config.agents[agentName];
    if (!definition) {
      throw new Error(`Cannot verify unknown agent "${agentName}"`);
    }

    const executablePath = resolveManagedExecutablePath(agentName, definition, options.managedPaths);
    await assertManagedExecutableExists(agentName, executablePath);
    verified.push({ agentName, executablePath });
  }

  return verified;
}

/**
 * @param {{
 *   projectRoot?: string;
 *   configPath?: string;
 *   verifyBootstrapExecutables?: boolean;
 * }} [options]
 */
export async function bootstrapManagedPrefix(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const configPath = options.configPath ?? DEFAULT_CONFIG_FILE;
  const config = await loadConfig({ projectRoot, configPath });
  const managedPaths = resolveManagedPaths(projectRoot, config);
  ensureManagedPathsInsideProject(managedPaths);

  const layout = await ensureManagedPrefixLayout(managedPaths);
  const verified = options.verifyBootstrapExecutables === false ? [] : await verifyManagedExecutables({ config, managedPaths });

  return {
    projectRoot,
    config,
    managedPaths,
    verifiedExecutables: verified,
    metadataPath: layout.metadataPath,
  };
}
