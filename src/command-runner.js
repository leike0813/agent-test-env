import { spawn } from "node:child_process";

/**
 * @param {NodeJS.WritableStream} stream
 * @param {string} prefix
 * @param {Buffer | string} chunk
 */
function writeWithPrefix(stream, prefix, chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
  for (const line of normalized.split("\n")) {
    stream.write(`${prefix}${line}\n`);
  }
}

/**
 * @param {NodeJS.WritableStream | undefined} stream
 * @param {Buffer | string} chunk
 */
function writeRaw(stream, chunk) {
  if (!stream) {
    return;
  }
  stream.write(chunk);
}

/**
 * @param {{
 *   label: string;
 *   command: string;
 *   args: string[];
 *   env: NodeJS.ProcessEnv;
 *   cwd?: string;
 *   stdout: NodeJS.WritableStream;
 *   stderr: NodeJS.WritableStream;
 *   outputMode?: "prefixed";
 *   stdinSource?: NodeJS.ReadableStream;
 *   stdinCapture?: NodeJS.WritableStream;
 *   stdoutCapture?: NodeJS.WritableStream;
 *   stderrCapture?: NodeJS.WritableStream;
 *   forwardSignals?: boolean;
 * }} options
 */
export async function runPrefixedCommand(options) {
  const outputMode = options.outputMode ?? "prefixed";
  const stdio = /** @type {const} */ (["pipe", "pipe", "pipe"]);

  return new Promise((resolve) => {
    const child = spawn(options.command, options.args, {
      env: options.env,
      cwd: options.cwd,
      stdio,
    });

    let started = false;
    /** @type {{ signal: NodeJS.Signals; listener: () => void }[]} */
    const signalListeners = [];

    const cleanupSignals = () => {
      for (const { signal, listener } of signalListeners) {
        process.off(signal, listener);
      }
      signalListeners.length = 0;
    };

    const cleanupStdin = () => {
      if (!options.stdinSource) {
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
      writeRaw(options.stdinCapture, chunk);
      if (!child.stdin.destroyed) {
        child.stdin.write(chunk);
      }
    };

    const onInputEnd = () => {
      if (!child.stdin.destroyed) {
        child.stdin.end();
      }
    };

    child.once("spawn", () => {
      started = true;
      options.stderr.write(`[agent:${options.label}] status=started\n`);

      if (options.forwardSignals) {
        for (const signal of /** @type {NodeJS.Signals[]} */ (["SIGINT", "SIGTERM"])) {
          const listener = () => {
            if (!child.killed) {
              child.kill(signal);
            }
          };
          signalListeners.push({ signal, listener });
          process.on(signal, listener);
        }
      }

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
      } else {
        onInputEnd();
      }
    });

    child.stdout?.on("data", (chunk) => {
      writeRaw(options.stdoutCapture, chunk);
      if (outputMode === "prefixed") {
        writeWithPrefix(options.stdout, `[agent:${options.label}] `, chunk);
      }
    });

    child.stderr?.on("data", (chunk) => {
      writeRaw(options.stderrCapture, chunk);
      if (outputMode === "prefixed") {
        writeWithPrefix(options.stderr, `[agent:${options.label}] `, chunk);
      }
    });

    child.once("error", (error) => {
      cleanupSignals();
      cleanupStdin();
      resolve({
        success: false,
        started,
        code: null,
        signal: null,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    child.once("close", (code, signal) => {
      cleanupSignals();
      cleanupStdin();
      resolve({
        success: code === 0,
        started,
        code: code ?? null,
        signal: signal ?? null,
        error: code === 0 ? null : `Process exited with code ${code}`,
      });
    });
  });
}
