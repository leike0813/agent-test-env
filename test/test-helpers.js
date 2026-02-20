import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

/**
 * @param {import("node:test").TestContext} t
 */
export async function createTempProject(t) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "agent-env-"));
  t.after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });
  return projectRoot;
}

/**
 * @param {string} projectRoot
 * @param {object} config
 */
export async function writeConfig(projectRoot, config) {
  const configPath = path.join(projectRoot, "agent-env.config.json");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configPath;
}

/**
 * @param {string} filePath
 * @param {string} body
 */
export async function createExecutable(filePath, body) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, body, { mode: 0o755, encoding: "utf8" });
}

export function createMemoryWritable() {
  /** @type {Buffer[]} */
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });

  return {
    stream,
    text() {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

export function baseConfig() {
  return {
    schemaVersion: 1,
    managedPrefix: {
      root: ".managed-prefix",
      binDir: "bin",
      configDir: "config",
      stateDir: "state",
      logsDir: "logs",
      metadataDir: "metadata",
      homeDir: "home",
    },
    agents: {},
  };
}

/**
 * @param {string} executable
 * @param {Partial<import("../src/config.js").AgentDefinition>} [overrides]
 */
export function createAgentDefinition(executable, overrides = {}) {
  return {
    executable,
    args: [],
    env: {},
    requiredOnBootstrap: false,
    lifecycle: {
      install: {
        command: "npm",
        args: ["--version"],
      },
      upgrade: {
        command: "npm",
        args: ["--version"],
      },
    },
    ...overrides,
    lifecycle: {
      install: {
        command: "npm",
        args: ["--version"],
        ...(overrides.lifecycle?.install ?? {}),
      },
      upgrade: {
        command: "npm",
        args: ["--version"],
        ...(overrides.lifecycle?.upgrade ?? {}),
      },
    },
  };
}
