import path from "node:path";

import { DEFAULT_CONFIG_FILE } from "./config.js";
import { bootstrapManagedPrefix } from "./bootstrap.js";
import { runLifecycleCommand } from "./lifecycle.js";
import { startAgent } from "./launcher.js";
import { runResumeCommand } from "./resume.js";

function usage() {
  return [
    "Usage:",
    "  agent-env bootstrap [--config <path>] [--skip-bootstrap-check]",
    "  agent-env install <agent-name> [--config <path>]",
    "  agent-env start [--run-dir <selector>] [--translate <0|1|2|3>] <agent-name> [<passthrough-args>...] [--config <path> before <agent-name>]",
    "  agent-env resume [--config <path>] <handle8> <message>",
    "  agent-env upgrade <agent-name> [--config <path>]",
  ].join("\n");
}

/**
 * @param {string[]} tokens
 */
function parseBootstrap(tokens) {
  /** @type {{ configPath: string; skipBootstrapCheck: boolean }} */
  const parsed = {
    configPath: DEFAULT_CONFIG_FILE,
    skipBootstrapCheck: false,
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--config") {
      const value = tokens[index + 1];
      if (!value) {
        throw new Error("--config requires a path");
      }
      parsed.configPath = value;
      index += 1;
      continue;
    }
    if (token === "--skip-bootstrap-check") {
      parsed.skipBootstrapCheck = true;
      continue;
    }
    throw new Error(`Unknown bootstrap option: ${token}`);
  }

  return parsed;
}

/**
 * @param {string[]} tokens
 * @param {{ commandName: string; allowPassthrough: boolean }} options
 */
function parseSingleAgentCommand(tokens, options) {
  /** @type {{ configPath: string; agentName?: string; passthroughArgs: string[] }} */
  const parsed = {
    configPath: DEFAULT_CONFIG_FILE,
    passthroughArgs: [],
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!parsed.agentName) {
      if (token === "--config") {
        const value = tokens[index + 1];
        if (!value) {
          throw new Error("--config requires a path");
        }
        parsed.configPath = value;
        index += 1;
        continue;
      }
      if (token.startsWith("--")) {
        throw new Error(`Unknown ${options.commandName} option: ${token}`);
      }
      parsed.agentName = token;
      continue;
    }

    if (!options.allowPassthrough) {
      throw new Error(`${options.commandName} supports exactly one <agent-name> argument`);
    }
    parsed.passthroughArgs = tokens.slice(index);
    break;
  }

  if (!parsed.agentName) {
    throw new Error(`${options.commandName} requires exactly one <agent-name> argument`);
  }

  return /** @type {{ configPath: string; agentName: string; passthroughArgs: string[] }} */ (parsed);
}

/**
 * @param {string[]} tokens
 * @param {string} commandName
 */
function parseStartCommand(tokens, commandName) {
  /** @type {{ configPath: string; runSelector?: string; translateLevel: 0 | 1 | 2 | 3; agentName?: string; passthroughArgs: string[] }} */
  const parsed = {
    configPath: DEFAULT_CONFIG_FILE,
    translateLevel: 0,
    passthroughArgs: [],
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!parsed.agentName) {
      if (token === "--config") {
        const value = tokens[index + 1];
        if (!value) {
          throw new Error("--config requires a path");
        }
        parsed.configPath = value;
        index += 1;
        continue;
      }
      if (token === "--run-dir") {
        const value = tokens[index + 1];
        if (!value) {
          throw new Error("--run-dir requires a selector");
        }
        parsed.runSelector = value;
        index += 1;
        continue;
      }
      if (token.startsWith("--run-dir=")) {
        const value = token.slice("--run-dir=".length);
        if (!value) {
          throw new Error("--run-dir requires a selector");
        }
        parsed.runSelector = value;
        continue;
      }
      if (token === "--translate") {
        const value = tokens[index + 1];
        if (!value) {
          throw new Error("--translate requires a value (0|1|2|3)");
        }
        parsed.translateLevel = parseTranslateLevel(value);
        index += 1;
        continue;
      }
      if (token.startsWith("--translate=")) {
        const value = token.slice("--translate=".length);
        if (!value) {
          throw new Error("--translate requires a value (0|1|2|3)");
        }
        parsed.translateLevel = parseTranslateLevel(value);
        continue;
      }
      if (token.startsWith("--")) {
        throw new Error(`Unknown ${commandName} option: ${token}`);
      }
      parsed.agentName = token;
      continue;
    }

    parsed.passthroughArgs = tokens.slice(index);
    break;
  }

  if (!parsed.agentName) {
    throw new Error(`${commandName} requires exactly one <agent-name> argument`);
  }

  return /** @type {{ configPath: string; runSelector?: string; translateLevel: 0 | 1 | 2 | 3; agentName: string; passthroughArgs: string[] }} */ (parsed);
}

/**
 * @param {string} value
 * @returns {0 | 1 | 2 | 3}
 */
function parseTranslateLevel(value) {
  if (value === "0") {
    return 0;
  }
  if (value === "1") {
    return 1;
  }
  if (value === "2") {
    return 2;
  }
  if (value === "3") {
    return 3;
  }
  throw new Error(`Invalid --translate value "${value}". Expected one of: 0, 1, 2, 3.`);
}

/**
 * @param {string[]} tokens
 * @param {string} commandName
 */
function parseResumeCommand(tokens, commandName) {
  /** @type {{ configPath: string; handle?: string; message?: string }} */
  const parsed = {
    configPath: DEFAULT_CONFIG_FILE,
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--config") {
      const value = tokens[index + 1];
      if (!value) {
        throw new Error("--config requires a path");
      }
      parsed.configPath = value;
      index += 1;
      continue;
    }

    if (!parsed.handle) {
      if (token.startsWith("--")) {
        throw new Error(`Unknown ${commandName} option: ${token}`);
      }
      parsed.handle = token;
      continue;
    }

    parsed.message = tokens.slice(index).join(" ");
    break;
  }

  if (!parsed.handle) {
    throw new Error(`${commandName} requires <handle8>`);
  }
  if (!parsed.message || parsed.message.trim().length === 0) {
    throw new Error(`${commandName} requires <message>`);
  }

  return /** @type {{ configPath: string; handle: string; message: string }} */ (parsed);
}

/**
 * @param {string[]} argv
 * @param {{
 *   projectRoot?: string;
 *   baseEnv?: NodeJS.ProcessEnv;
 *   stdout?: NodeJS.WritableStream;
 *   stderr?: NodeJS.WritableStream;
 * }} [options]
 */
export async function runCli(argv, options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const command = argv[0];
  const tokens = argv.slice(1);

  if (!command) {
    stderr.write(`${usage()}\n`);
    return 1;
  }

  if (command === "bootstrap") {
    const parsed = parseBootstrap(tokens);
    const result = await bootstrapManagedPrefix({
      projectRoot,
      configPath: parsed.configPath,
      verifyBootstrapExecutables: !parsed.skipBootstrapCheck,
    });
    stdout.write(`Managed prefix ready at: ${result.managedPaths.root}\n`);
    stdout.write(`Managed prefix bin: ${result.managedPaths.bin}\n`);
    stdout.write(`Verified executables: ${result.verifiedExecutables.length}\n`);
    return 0;
  }

  if (command === "install" || command === "upgrade") {
    const parsed = parseSingleAgentCommand(tokens, { commandName: command, allowPassthrough: false });
    const result = await runLifecycleCommand({
      action: command,
      agentName: parsed.agentName,
      projectRoot,
      configPath: parsed.configPath,
      baseEnv: options.baseEnv ?? process.env,
      stdout,
      stderr,
    });
    stdout.write(`${command} complete. exitCode=${result.exitCode}\n`);
    return result.exitCode;
  }

  if (command === "start" || command === "launch") {
    const parsed = parseStartCommand(tokens, command);
    const result = await startAgent({
      agentName: parsed.agentName,
      runSelector: parsed.runSelector,
      translateLevel: parsed.translateLevel,
      passthroughArgs: parsed.passthroughArgs,
      projectRoot,
      configPath: parsed.configPath,
      baseEnv: options.baseEnv ?? process.env,
      stdinSource: process.stdin,
      stdout,
      stderr,
    });
    stdout.write(`Run id: ${result.runId}\n`);
    stdout.write(`Run directory: ${result.runDirectory}\n`);
    stdout.write(`Run handle: ${result.handle ?? "unknown"}\n`);
    if (result.session?.field && result.session?.value) {
      stdout.write(`Session: ${result.session.field}=${result.session.value}\n`);
    } else {
      stdout.write("Session: not detected\n");
    }
    stdout.write(`Start complete. exitCode=${result.exitCode}\n`);
    return result.exitCode;
  }

  if (command === "resume") {
    const parsed = parseResumeCommand(tokens, command);
    const result = await runResumeCommand({
      handle: parsed.handle,
      message: parsed.message,
      projectRoot,
      configPath: parsed.configPath,
      baseEnv: options.baseEnv ?? process.env,
      stdinSource: process.stdin,
      stdout,
      stderr,
    });
    stdout.write(`Run id: ${result.runId}\n`);
    stdout.write(`Run directory: ${result.runDirectory}\n`);
    stdout.write(`Run handle: ${result.handle ?? "unknown"}\n`);
    if (result.session?.field && result.session?.value) {
      stdout.write(`Session: ${result.session.field}=${result.session.value}\n`);
    } else {
      stdout.write("Session: not detected\n");
    }
    stdout.write(`Resume complete. exitCode=${result.exitCode}\n`);
    return result.exitCode;
  }

  stderr.write(`${usage()}\n`);
  return 1;
}
