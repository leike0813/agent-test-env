import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function commandLineString(command, args) {
  return [command, ...args].map((part) => shellQuote(part)).join(" ");
}

function isInteractiveTerminal(options) {
  return (
    options.stdinSource === process.stdin &&
    options.stdout === process.stdout &&
    options.stderr === process.stderr &&
    process.stdin.isTTY === true
  );
}

/**
 * @param {string} command
 * @param {string[]} args
 */
function assertCommandAvailable(command, args) {
  const result = spawnSync(command, args, {
    stdio: "ignore",
  });
  if (result.error || result.status !== 0) {
    const detail = result.error ? String(result.error.message) : `exit=${result.status}`;
    throw new Error(`Required command "${command}" is unavailable (${detail})`);
  }
}

/**
 * @param {{
 *   label: string;
 *   command: string;
 *   args: string[];
 *   env: NodeJS.ProcessEnv;
 *   cwd: string;
 *   stdinSource?: NodeJS.ReadableStream;
 *   stdout: NodeJS.WritableStream;
 *   stderr: NodeJS.WritableStream;
 *   auditDirectory: string;
 *   appendAuditLogs?: boolean;
 }} options
 */
export async function runPtyAuditedCommand(options) {
  if (process.platform !== "linux") {
    throw new Error("PTY split-audit runtime currently requires Linux");
  }

  const tracerCommand = options.env.AGENT_ENV_TRACER_COMMAND ?? "strace";
  const scriptCommand = options.env.AGENT_ENV_SCRIPT_COMMAND ?? "script";

  assertCommandAvailable(tracerCommand, ["-V"]);
  assertCommandAvailable(scriptCommand, ["--version"]);

  const stdinPath = path.join(options.auditDirectory, "stdin.log");
  const ptyOutputPath = path.join(options.auditDirectory, "pty-output.log");
  const ptyTimingPath = path.join(options.auditDirectory, "pty-timing.log");
  const tracePath = path.join(options.auditDirectory, "fd-trace.log");
  const stdoutPath = path.join(options.auditDirectory, "stdout.log");
  const stderrPath = path.join(options.auditDirectory, "stderr.log");

  const traceArgs = [
    "-f",
    ...(options.appendAuditLogs ? ["-A"] : []),
    "-yy",
    "-s",
    "65535",
    "-e",
    "trace=write",
    "-e",
    "write=1,2",
    "-o",
    tracePath,
    "--",
    options.command,
    ...options.args,
  ];
  const traceCommand = commandLineString(tracerCommand, traceArgs);
  const scriptArgs = [
    ...(options.appendAuditLogs ? ["-a"] : []),
    "-qef",
    "--log-in",
    stdinPath,
    "--log-out",
    ptyOutputPath,
    "--log-timing",
    ptyTimingPath,
    "--command",
    traceCommand,
  ];

  const interactive = isInteractiveTerminal(options);
  const stdio = interactive ? "inherit" : "pipe";

  return new Promise((resolve) => {
    const child = spawn(scriptCommand, scriptArgs, {
      env: options.env,
      cwd: options.cwd,
      stdio,
    });

    let started = false;
    /** @type {{ signal: NodeJS.Signals; listener: () => void }[]} */
    const signalListeners = [];

    const cleanupSignalForwarding = () => {
      for (const { signal, listener } of signalListeners) {
        process.off(signal, listener);
      }
      signalListeners.length = 0;
    };

    const detachInput = () => {
      if (!options.stdinSource || interactive) {
        return;
      }
      options.stdinSource.off("data", onInputData);
      options.stdinSource.off("end", onInputEnd);
      options.stdinSource.off("close", onInputEnd);
      options.stdinSource.off("error", onInputEnd);
      if (
        options.stdinSource === process.stdin &&
        typeof /** @type {{ pause?: () => void }} */ (options.stdinSource).pause === "function"
      ) {
        /** @type {{ pause: () => void }} */ (options.stdinSource).pause();
      }
    };

    const onInputData = (chunk) => {
      if (child.stdin && !child.stdin.destroyed) {
        const writable = child.stdin.write(chunk);
        if (!writable && options.stdinSource && typeof /** @type {{ pause?: () => void }} */ (options.stdinSource).pause === "function") {
          /** @type {{ pause: () => void }} */ (options.stdinSource).pause();
        }
      }
    };

    const onInputEnd = () => {
      if (child.stdin && !child.stdin.destroyed) {
        child.stdin.end();
      }
    };

    child.once("spawn", () => {
      started = true;
      options.stderr.write(`[agent:${options.label}] status=started\n`);
      options.stderr.write(`[agent:${options.label}] runtime=pty script=${scriptCommand} tracer=${tracerCommand}\n`);

      for (const signal of /** @type {NodeJS.Signals[]} */ (["SIGINT", "SIGTERM"])) {
        const listener = () => {
          if (!child.killed) {
            child.kill(signal);
          }
        };
        signalListeners.push({ signal, listener });
        process.on(signal, listener);
      }

      if (!interactive) {
        child.stdin?.on("drain", () => {
          if (options.stdinSource && typeof /** @type {{ resume?: () => void }} */ (options.stdinSource).resume === "function") {
            /** @type {{ resume: () => void }} */ (options.stdinSource).resume();
          }
        });

        if (options.stdinSource) {
          if (
            options.stdinSource === process.stdin &&
            typeof /** @type {{ resume?: () => void }} */ (options.stdinSource).resume === "function"
          ) {
            /** @type {{ resume: () => void }} */ (options.stdinSource).resume();
          }
          options.stdinSource.on("data", onInputData);
          options.stdinSource.once("end", onInputEnd);
          options.stdinSource.once("close", onInputEnd);
          options.stdinSource.once("error", onInputEnd);
          if (
            typeof /** @type {{ readableEnded?: boolean }} */ (options.stdinSource).readableEnded === "boolean" &&
            /** @type {{ readableEnded: boolean }} */ (options.stdinSource).readableEnded
          ) {
            onInputEnd();
          }
        } else {
          onInputEnd();
        }
      }
    });

    if (!interactive) {
      child.stdout?.on("data", (chunk) => options.stdout.write(chunk));
      child.stderr?.on("data", (chunk) => options.stderr.write(chunk));
    }

    child.once("error", (error) => {
      cleanupSignalForwarding();
      detachInput();
      resolve({
        success: false,
        started,
        code: null,
        signal: null,
        error: error instanceof Error ? error.message : String(error),
        pty: {
          tracerCommand,
          scriptCommand,
          tracePath,
          stdinPath,
          stdoutPath,
          stderrPath,
          ptyOutputPath,
          ptyTimingPath,
          traceCommand,
          scriptArgs,
        },
      });
    });

    child.once("close", (code, signal) => {
      cleanupSignalForwarding();
      detachInput();
      resolve({
        success: code === 0,
        started,
        code: code ?? null,
        signal: signal ?? null,
        error: code === 0 ? null : `Process exited with code ${code}`,
        pty: {
          tracerCommand,
          scriptCommand,
          tracePath,
          stdinPath,
          stdoutPath,
          stderrPath,
          ptyOutputPath,
          ptyTimingPath,
          traceCommand,
          scriptArgs,
        },
      });
    });
  });
}
