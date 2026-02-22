import path from "node:path";

import {
  DEFAULT_CONFIG_FILE,
  ensureManagedPathsInsideProject,
  loadConfig,
  resolveManagedPaths,
} from "./config.js";
import { ensureManagedPrefixLayout } from "./bootstrap.js";
import {
  buildResumePassthroughArgs,
  readInteractiveHandleRecord,
} from "./interactive-handle.js";
import { startAgent } from "./launcher.js";

/**
 * @param {{
 *   handle: string;
 *   message: string;
 *   projectRoot?: string;
 *   configPath?: string;
 *   baseEnv?: NodeJS.ProcessEnv;
 *   stdinSource?: NodeJS.ReadableStream;
 *   stdout?: NodeJS.WritableStream;
 *   stderr?: NodeJS.WritableStream;
 * }} options
 */
export async function runResumeCommand(options) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const configPath = options.configPath ?? DEFAULT_CONFIG_FILE;
  const config = await loadConfig({ projectRoot, configPath });
  const managedPaths = resolveManagedPaths(projectRoot, config);
  ensureManagedPathsInsideProject(managedPaths);
  await ensureManagedPrefixLayout(managedPaths);

  const record = await readInteractiveHandleRecord({
    metadataRoot: managedPaths.metadataRoot,
    handle: options.handle,
  });
  if (!record) {
    throw new Error(`Handle "${options.handle}" was not found in interactive handle index`);
  }
  if (!record.session.value) {
    throw new Error(
      `Handle "${options.handle}" has no detected session id. Run start again and ensure session extraction succeeds.`,
    );
  }

  const passthroughArgs = buildResumePassthroughArgs({
    agentName: record.agentName,
    previousArgs: record.launchArgs,
    sessionValue: record.session.value,
    message: options.message,
  });

  const result = await startAgent({
    agentName: record.agentName,
    runSelector: record.handle,
    translateLevel: record.translateLevel,
    passthroughArgs,
    projectRoot,
    configPath,
    baseEnv: options.baseEnv ?? process.env,
    stdinSource: options.stdinSource,
    stdout: options.stdout,
    stderr: options.stderr,
  });

  return {
    ...result,
    resolved: {
      handle: record.handle,
      agentName: record.agentName,
      sessionField: record.session.field,
      sessionValue: record.session.value,
      translateLevel: record.translateLevel,
      passthroughArgs,
    },
  };
}
