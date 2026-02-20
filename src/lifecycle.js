import path from "node:path";

import {
  DEFAULT_CONFIG_FILE,
  ensureManagedPathsInsideProject,
  loadConfig,
  resolveManagedPaths,
  resolveSingleAgent,
} from "./config.js";
import { ensureManagedPrefixLayout } from "./bootstrap.js";
import { runPrefixedCommand } from "./command-runner.js";
import {
  assertNoHostPathLeakage,
  buildIsolatedEnv,
  ensureIsolationEnvDirectories,
} from "./isolation.js";

/**
 * @param {import("./config.js").AgentDefinition} definition
 * @param {"install" | "upgrade"} action
 */
function lifecycleTemplateFor(definition, action) {
  return definition.lifecycle[action];
}

/**
 * @param {{
 *   action: "install" | "upgrade";
 *   agentName: string;
 *   projectRoot?: string;
 *   configPath?: string;
 *   baseEnv?: NodeJS.ProcessEnv;
 *   stdout?: NodeJS.WritableStream;
 *   stderr?: NodeJS.WritableStream;
 }} options
 */
export async function runLifecycleCommand(options) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const configPath = options.configPath ?? DEFAULT_CONFIG_FILE;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const baseEnv = options.baseEnv ?? process.env;

  const config = await loadConfig({ projectRoot, configPath });
  const managedPaths = resolveManagedPaths(projectRoot, config);
  ensureManagedPathsInsideProject(managedPaths);
  await ensureManagedPrefixLayout(managedPaths);

  const selected = resolveSingleAgent(config, options.agentName);
  const template = lifecycleTemplateFor(selected.definition, options.action);

  const env = buildIsolatedEnv({
    managedPaths,
    baseEnv,
    agentEnv: selected.definition.env ?? {},
  });
  env.npm_config_prefix = managedPaths.root;
  env.NPM_CONFIG_PREFIX = managedPaths.root;
  assertNoHostPathLeakage(env, projectRoot);
  await ensureIsolationEnvDirectories(env);

  stderr.write(`[agent:${selected.name}] action=${options.action}\n`);
  stderr.write(`[agent:${selected.name}] command=${template.command} ${template.args.join(" ")}\n`);

  const result = await runPrefixedCommand({
    label: selected.name,
    command: template.command,
    args: template.args,
    env,
    stdout,
    stderr,
  });

  return {
    exitCode: result.success ? 0 : 1,
    result: {
      agentName: selected.name,
      action: options.action,
      ...result,
    },
  };
}
