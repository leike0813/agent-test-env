import path from "node:path";
import { readFile } from "node:fs/promises";

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
  analyzeCompletionSignal,
  buildAttemptAuditPaths,
  captureFilesystemSnapshot,
  diffSnapshots,
  reconstructSplitStreamsFromTrace,
  resolveNextAuditAttemptNumber,
  writeJsonFile,
} from "./audit.js";
import {
  appendRunIndexEntry,
  createRunDirectory,
  resolveExistingRunDirectory,
} from "./run-directory.js";
import {
  deriveInteractiveHandle,
  extractInteractiveSession,
  upsertInteractiveHandleRecord,
} from "./interactive-handle.js";
import { injectAllSkillPackages } from "./skill-injection.js";
import { registerRunDirectoryTrust } from "./trust.js";
import { runPtyAuditedCommand } from "./pty-runtime.js";
import { buildTranslateArtifacts, formatTranslateOutput } from "./translate-output.js";

const AUDIT_IGNORED_PREFIXES = [".audit"];
const SKILL_INJECTION_SUPPORTED_AGENTS = new Set([
  "codex",
  "gemini",
  "iflow",
  "opencode",
]);
const TRANSLATE_LEVELS = new Set([0, 1, 2, 3]);

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

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
 *   translateLevel?: 0 | 1 | 2 | 3;
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
  const translateLevel = normalizeTranslateLevel(options.translateLevel);

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
  const attemptNumber = await resolveNextAuditAttemptNumber({
    auditDirectory: runContext.auditDirectory,
  });
  const auditPaths = buildAttemptAuditPaths({
    auditDirectory: runContext.auditDirectory,
    attemptNumber,
  });

  const executablePath = resolveManagedExecutablePath(selected.name, selected.definition, managedPaths);
  const commandArgs = [...(selected.definition.args ?? []), ...passthroughArgs];
  const startedAtIso = new Date().toISOString();
  const beforeSnapshot = await captureFilesystemSnapshot({
    runDirectory: runContext.runDirectory,
    ignoredPrefixes: AUDIT_IGNORED_PREFIXES,
  });

  /** @type {{ codexConfigPath?: string; geminiTrustedFoldersPath?: string }} */
  let trustApplied = {};
  /** @type {{
   *   mode: "all";
   *   sourceRoot: string;
   *   targetRoot: string;
   *   skillCount: number;
   *   skills: string[];
   *   injectedSkills: Array<{
   *     skillName: string;
   *     sourceDirectory: string;
   *     targetDirectory: string;
   *     targetSkillPath: string;
   *     appendedCompletionContract: boolean;
   *   }>;
   *   completionSignalPrefix: string;
   *   appendedCompletionContractCount: number;
   * } | null} */
  let skillInjection = null;
  /** @type {Record<string, unknown>} */
  let runtimePty = {};
  let runtimeStarted = false;
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
    if (SKILL_INJECTION_SUPPORTED_AGENTS.has(selected.name)) {
      skillInjection = await injectAllSkillPackages({
        projectRoot,
        runDirectory: runContext.runDirectory,
        agentName: selected.name,
      });
    }
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
    stderr.write(`[agent:${selected.name}] translate_mode=${translateLevel}\n`);
    if (skillInjection) {
      stderr.write(
        `[agent:${selected.name}] injected_skills=${skillInjection.skillCount} target_root=${skillInjection.targetRoot}\n`,
      );
    } else {
      stderr.write(`[agent:${selected.name}] injected_skills=0 target_root=(unsupported-agent)\n`);
    }
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
      forwardRuntimeOutput: translateLevel === 0,
      forcePipedStdio: translateLevel !== 0,
      auditDirectory: runContext.auditDirectory,
      auditPaths: {
        stdinPath: auditPaths.stdinPath,
        stdoutPath: auditPaths.stdoutPath,
        stderrPath: auditPaths.stderrPath,
        ptyOutputPath: auditPaths.ptyOutputPath,
        ptyTimingPath: auditPaths.ptyTimingPath,
        tracePath: auditPaths.tracePath,
      },
    });
    processResult = {
      success: execution.success,
      started: execution.started,
      code: execution.code,
      signal: execution.signal,
      error: execution.error,
    };
    runtimeStarted = execution.started;
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

  const tracePath = /** @type {string} */ (runtimePty.tracePath ?? auditPaths.tracePath);
  const reconstructedStdoutPath = /** @type {string} */ (runtimePty.stdoutPath ?? auditPaths.stdoutPath);
  const reconstructedStderrPath = /** @type {string} */ (runtimePty.stderrPath ?? auditPaths.stderrPath);
  const reconstructed = await reconstructSplitStreamsFromTrace({
    tracePath,
    stdoutPath: reconstructedStdoutPath,
    stderrPath: reconstructedStderrPath,
  });
  const completion = await analyzeCompletionSignal({
    processResult,
    ptyOutputPath: /** @type {string} */ (runtimePty.ptyOutputPath ?? auditPaths.ptyOutputPath),
    stdoutPath: reconstructedStdoutPath,
    stderrPath: reconstructedStderrPath,
    agentName: selected.name,
    launchArgs: commandArgs,
  });
  const interactiveHandle = deriveInteractiveHandle({
    runId: runContext.runId,
    runDirectory: runContext.runDirectory,
  });
  const interactiveSession = await extractInteractiveSession({
    agentName: selected.name,
    ptyOutputPath: /** @type {string} */ (runtimePty.ptyOutputPath ?? auditPaths.ptyOutputPath),
    stdoutPath: reconstructedStdoutPath,
    stderrPath: reconstructedStderrPath,
  });
  /** @type {{ indexPath: string; entry: Record<string, unknown> } | null} */
  let interactiveHandleIndex = null;
  if (interactiveHandle) {
    interactiveHandleIndex = await upsertInteractiveHandleRecord({
      metadataRoot: managedPaths.metadataRoot,
      handle: interactiveHandle,
      runId: runContext.runId,
      runDirectory: runContext.runDirectory,
      agentName: selected.name,
      session: interactiveSession,
      launchArgs: commandArgs,
      translateLevel,
    });
  }

  if (translateLevel !== 0) {
    const [stdoutText, stderrText, ptyText] = await Promise.all([
      readTextIfExists(reconstructedStdoutPath),
      readTextIfExists(reconstructedStderrPath),
      readTextIfExists(/** @type {string} */ (runtimePty.ptyOutputPath ?? auditPaths.ptyOutputPath)),
    ]);
    const artifacts = buildTranslateArtifacts({
      runId: runContext.runId,
      attemptNumber,
      agentName: selected.name,
      session: interactiveSession,
      completion,
      stdoutText,
      stderrText,
      ptyText,
      translateMode: translateLevel,
    });
    const formatted = formatTranslateOutput({
      mode: translateLevel,
      runId: runContext.runId,
      attemptNumber,
      agentName: selected.name,
      session: interactiveSession,
      completion,
      artifacts,
    });
    if (formatted.trim().length > 0) {
      stdout.write(formatted);
    }
  }
  if (runtimeStarted) {
    stderr.write(`[agent:${selected.name}] ---------------- runtime end ----------------\n`);
  }

  const endedAtIso = new Date().toISOString();
  const afterSnapshot = await captureFilesystemSnapshot({
    runDirectory: runContext.runDirectory,
    ignoredPrefixes: AUDIT_IGNORED_PREFIXES,
  });
  const fsDiff = diffSnapshots(beforeSnapshot, afterSnapshot);

  await writeJsonFile(auditPaths.fsBeforePath, beforeSnapshot);
  await writeJsonFile(auditPaths.fsAfterPath, afterSnapshot);
  await writeJsonFile(auditPaths.fsDiffPath, fsDiff);

  const runMetadata = {
    schemaVersion: 3,
    runId: runContext.runId,
    agentName: selected.name,
    runDirectory: runContext.runDirectory,
    reuse: {
      enabled: reuseMode,
      selector: runSelector ?? null,
    },
    attempt: {
      number: attemptNumber,
    },
    inject: skillInjection
      ? {
        mode: skillInjection.mode,
        sourceRoot: skillInjection.sourceRoot,
        targetRoot: skillInjection.targetRoot,
        skillCount: skillInjection.skillCount,
        skills: skillInjection.skills,
        completionSignalPrefix: skillInjection.completionSignalPrefix,
        appendedCompletionContractCount: skillInjection.appendedCompletionContractCount,
      }
      : null,
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
    auditFiles: {
      meta: path.relative(runContext.runDirectory, auditPaths.metaPath),
      stdin: path.relative(runContext.runDirectory, auditPaths.stdinPath),
      stdout: path.relative(runContext.runDirectory, auditPaths.stdoutPath),
      stderr: path.relative(runContext.runDirectory, auditPaths.stderrPath),
      ptyOutput: path.relative(runContext.runDirectory, auditPaths.ptyOutputPath),
      ptyTiming: path.relative(runContext.runDirectory, auditPaths.ptyTimingPath),
      trace: path.relative(runContext.runDirectory, auditPaths.tracePath),
      fsBefore: path.relative(runContext.runDirectory, auditPaths.fsBeforePath),
      fsAfter: path.relative(runContext.runDirectory, auditPaths.fsAfterPath),
      fsDiff: path.relative(runContext.runDirectory, auditPaths.fsDiffPath),
    },
    logs: {
      stdin: path.relative(
        runContext.runDirectory,
        /** @type {string} */ (runtimePty.stdinPath ?? auditPaths.stdinPath),
      ),
      stdout: path.relative(runContext.runDirectory, reconstructedStdoutPath),
      stderr: path.relative(runContext.runDirectory, reconstructedStderrPath),
      ptyOutput: path.relative(
        runContext.runDirectory,
        /** @type {string} */ (runtimePty.ptyOutputPath ?? auditPaths.ptyOutputPath),
      ),
      trace: path.relative(runContext.runDirectory, tracePath),
    },
    filesystem: {
      ignoredPrefixes: AUDIT_IGNORED_PREFIXES,
      diffPath: path.relative(runContext.runDirectory, auditPaths.fsDiffPath),
    },
    protocol: {
      schemaVersion: 1,
      completion,
    },
    interactive: {
      handle: interactiveHandle,
      session: interactiveSession,
      handleIndexPath: interactiveHandleIndex?.indexPath ?? null,
      translateLevel,
    },
  };
  await writeJsonFile(auditPaths.metaPath, runMetadata);

  await appendRunIndexEntry({
    runsRoot: runContext.runsRoot,
    entry: {
      runId: runContext.runId,
      attemptNumber,
      agentName: selected.name,
      runDirectory: runContext.runDirectory,
      startedAt: startedAtIso,
      endedAt: endedAtIso,
      success: processResult.success,
      exitCode: processResult.code,
      signal: processResult.signal,
      runtimeMode: "pty",
      auditFiles: {
        meta: path.relative(runContext.runDirectory, auditPaths.metaPath),
        stdout: path.relative(runContext.runDirectory, auditPaths.stdoutPath),
        stderr: path.relative(runContext.runDirectory, auditPaths.stderrPath),
        stdin: path.relative(runContext.runDirectory, auditPaths.stdinPath),
      },
    },
  });

  stderr.write(`[agent:${selected.name}] handle=${interactiveHandle ?? "unknown"}\n`);
  if (interactiveSession.field && interactiveSession.value) {
    stderr.write(
      `[agent:${selected.name}] session=${interactiveSession.field}=${interactiveSession.value}\n`,
    );
  } else {
    stderr.write(`[agent:${selected.name}] session=not-detected\n`);
  }

  return {
    runId: runContext.runId,
    runDirectory: runContext.runDirectory,
    auditDirectory: runContext.auditDirectory,
    handle: interactiveHandle,
    session: interactiveSession,
    exitCode: processResult.success ? 0 : 1,
    result: {
      agentName: selected.name,
      ...processResult,
    },
  };
}
