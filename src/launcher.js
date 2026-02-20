import path from "node:path";

import {
  DEFAULT_CONFIG_FILE,
  ensureManagedPathsInsideProject,
  loadConfig,
  resolveManagedPaths,
  resolveSingleAgent,
} from "./config.js";
import {
  assertManagedExecutableExists,
  ensureManagedPrefixLayout,
  resolveManagedExecutablePath,
} from "./bootstrap.js";
import {
  assertNoHostPathLeakage,
  buildIsolatedEnv,
  ensureIsolationEnvDirectories,
} from "./isolation.js";
import {
  appendRunMetadata,
  captureFilesystemSnapshot,
  diffSnapshots,
  reconstructSplitStreamsFromTrace,
  writeJsonFile,
} from "./audit.js";
import {
  appendRunIndexEntry,
  createRunDirectory,
  resolveExistingRunDirectory,
} from "./run-directory.js";
import { registerRunDirectoryTrust } from "./trust.js";
import { runPtyAuditedCommand } from "./pty-runtime.js";

const AUDIT_IGNORED_PREFIXES = [".audit"];

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {string} agentName
 * @param {NodeJS.ProcessEnv} env
 */
function resolveAgentConfigRoots(agentName, env) {
  const home = env.HOME;
  switch (agentName) {
    case "codex":
      return [env.CODEX_HOME ?? (home ? path.join(home, ".codex") : undefined)];
    case "gemini":
      return [env.GEMINI_CLI_HOME ?? (home ? path.join(home, ".gemini") : undefined)];
    case "iflow":
      return [env.IFLOW_HOME ?? (home ? path.join(home, ".iflow") : undefined)];
    case "opencode":
      return [env.OPENCODE_HOME ?? (home ? path.join(home, ".opencode") : undefined)];
    default:
      return [];
  }
}

/**
 * @param {{
 *   projectRoot?: string;
 *   configPath?: string;
 *   agentName: string;
 *   runSelector?: string;
 *   passthroughArgs?: string[];
 *   baseEnv?: NodeJS.ProcessEnv;
 *   stdinSource?: NodeJS.ReadableStream;
 *   stdout?: NodeJS.WritableStream;
 *   stderr?: NodeJS.WritableStream;
 }} options
 */
export async function startAgent(options) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const configPath = options.configPath ?? DEFAULT_CONFIG_FILE;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const baseEnv = options.baseEnv ?? process.env;
  const passthroughArgs = options.passthroughArgs ?? [];
  const runSelector = options.runSelector?.trim() || undefined;

  const config = await loadConfig({ projectRoot, configPath });
  const managedPaths = resolveManagedPaths(projectRoot, config);
  ensureManagedPathsInsideProject(managedPaths);
  await ensureManagedPrefixLayout(managedPaths);

  const selected = resolveSingleAgent(config, options.agentName);
  const runContext = runSelector
    ? await resolveExistingRunDirectory({
      managedPaths,
      projectRoot,
      selector: runSelector,
      agentName: selected.name,
    })
    : await createRunDirectory({
      managedPaths,
      agentName: selected.name,
    });
  const reuseMode = runContext.reused === true;

  const executablePath = resolveManagedExecutablePath(selected.name, selected.definition, managedPaths);
  const commandArgs = [...(selected.definition.args ?? []), ...passthroughArgs];
  const startedAtIso = new Date().toISOString();
  const beforeSnapshot = await captureFilesystemSnapshot({
    runDirectory: runContext.runDirectory,
    ignoredPrefixes: AUDIT_IGNORED_PREFIXES,
  });

  /** @type {{ codexConfigPath?: string; geminiTrustedFoldersPath?: string }} */
  let trustApplied = {};
  /** @type {Record<string, unknown>} */
  let runtimePty = {};
  /** @type {{ success: boolean; started: boolean; code: number | null; signal: NodeJS.Signals | null; error: string | null }} */
  let processResult = {
    success: false,
    started: false,
    code: null,
    signal: null,
    error: null,
  };

  try {
    const env = buildIsolatedEnv({
      managedPaths,
      baseEnv,
      agentEnv: selected.definition.env ?? {},
    });
    env.AGENT_ENV_RUN_ID = runContext.runId;
    env.AGENT_ENV_RUN_DIR = runContext.runDirectory;

    assertNoHostPathLeakage(env, projectRoot);
    await ensureIsolationEnvDirectories(env);
    trustApplied = await registerRunDirectoryTrust({
      agentName: selected.name,
      env,
      runDirectory: runContext.runDirectory,
    });
    await assertManagedExecutableExists(selected.name, executablePath);

    stderr.write(`[agent:${selected.name}] run_id=${runContext.runId}\n`);
    stderr.write(`[agent:${selected.name}] run_dir=${runContext.runDirectory}\n`);
    stderr.write(`[agent:${selected.name}] executable=${executablePath}\n`);
    stderr.write(`[agent:${selected.name}] passthrough=${JSON.stringify(passthroughArgs)}\n`);
    const configRoots = [
      env.XDG_CONFIG_HOME,
      env.XDG_STATE_HOME,
      ...resolveAgentConfigRoots(selected.name, env),
    ].filter(Boolean);
    stderr.write(
      `[agent:${selected.name}] config_roots=${configRoots.join(",")}\n`,
    );

    const execution = await runPtyAuditedCommand({
      label: selected.name,
      command: executablePath,
      args: commandArgs,
      env,
      cwd: runContext.runDirectory,
      stdinSource: options.stdinSource,
      stdout,
      stderr,
      auditDirectory: runContext.auditDirectory,
      appendAuditLogs: reuseMode,
    });
    processResult = {
      success: execution.success,
      started: execution.started,
      code: execution.code,
      signal: execution.signal,
      error: execution.error,
    };
    runtimePty = execution.pty;
  } catch (error) {
    processResult = {
      success: false,
      started: false,
      code: null,
      signal: null,
      error: errorMessage(error),
    };
  }

  const tracePath = /** @type {string} */ (
    runtimePty.tracePath ?? path.join(runContext.auditDirectory, "fd-trace.log")
  );
  const reconstructedStdoutPath = /** @type {string} */ (
    runtimePty.stdoutPath ?? path.join(runContext.auditDirectory, "stdout.log")
  );
  const reconstructedStderrPath = /** @type {string} */ (
    runtimePty.stderrPath ?? path.join(runContext.auditDirectory, "stderr.log")
  );
  const reconstructed = await reconstructSplitStreamsFromTrace({
    tracePath,
    stdoutPath: reconstructedStdoutPath,
    stderrPath: reconstructedStderrPath,
    append: reuseMode,
  });

  const endedAtIso = new Date().toISOString();
  const afterSnapshot = await captureFilesystemSnapshot({
    runDirectory: runContext.runDirectory,
    ignoredPrefixes: AUDIT_IGNORED_PREFIXES,
  });
  const fsDiff = diffSnapshots(beforeSnapshot, afterSnapshot);

  await writeJsonFile(path.join(runContext.auditDirectory, "fs-before.json"), beforeSnapshot);
  await writeJsonFile(path.join(runContext.auditDirectory, "fs-after.json"), afterSnapshot);
  await writeJsonFile(path.join(runContext.auditDirectory, "fs-diff.json"), fsDiff);

  const runMetadata = {
    schemaVersion: 3,
    runId: runContext.runId,
    agentName: selected.name,
    runDirectory: runContext.runDirectory,
    reuse: {
      enabled: reuseMode,
      selector: runSelector ?? null,
    },
    launch: {
      command: executablePath,
      args: commandArgs,
      cwd: runContext.runDirectory,
    },
    startedAt: startedAtIso,
    endedAt: endedAtIso,
    success: processResult.success,
    started: processResult.started,
    exitCode: processResult.code,
    signal: processResult.signal,
    error: processResult.error,
    trustApplied,
    runtime: {
      mode: "pty",
      pty: runtimePty,
      splitReconstruction: reconstructed,
    },
    logs: {
      stdin: path.relative(
        runContext.runDirectory,
        /** @type {string} */ (runtimePty.stdinPath ?? path.join(runContext.auditDirectory, "stdin.log")),
      ),
      stdout: path.relative(runContext.runDirectory, reconstructedStdoutPath),
      stderr: path.relative(runContext.runDirectory, reconstructedStderrPath),
      ptyOutput: path.relative(
        runContext.runDirectory,
        /** @type {string} */ (runtimePty.ptyOutputPath ?? path.join(runContext.auditDirectory, "pty-output.log")),
      ),
      trace: path.relative(runContext.runDirectory, tracePath),
    },
    filesystem: {
      ignoredPrefixes: AUDIT_IGNORED_PREFIXES,
      diffPath: path.relative(runContext.runDirectory, path.join(runContext.auditDirectory, "fs-diff.json")),
    },
  };
  await appendRunMetadata(path.join(runContext.auditDirectory, "meta.json"), runMetadata);

  await appendRunIndexEntry({
    runsRoot: runContext.runsRoot,
    entry: {
      runId: runContext.runId,
      agentName: selected.name,
      runDirectory: runContext.runDirectory,
      startedAt: startedAtIso,
      endedAt: endedAtIso,
      success: processResult.success,
      exitCode: processResult.code,
      signal: processResult.signal,
      runtimeMode: "pty",
    },
  });

  return {
    runId: runContext.runId,
    runDirectory: runContext.runDirectory,
    auditDirectory: runContext.auditDirectory,
    exitCode: processResult.success ? 0 : 1,
    result: {
      agentName: selected.name,
      ...processResult,
    },
  };
}
