import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { bootstrapManagedPrefix } from "../src/bootstrap.js";
import { buildIsolatedEnv, assertNoHostPathLeakage } from "../src/isolation.js";
import { startAgent } from "../src/launcher.js";
import {
  baseConfig,
  createAgentDefinition,
  createExecutable,
  createMemoryWritable,
  createTempProject,
  writeConfig,
} from "./test-helpers.js";

test("isolated env redirects config and state roots into managed prefix", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    demo: createAgentDefinition("demo-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });
  const env = buildIsolatedEnv({
    managedPaths: bootstrap.managedPaths,
    baseEnv: process.env,
    agentEnv: {},
  });

  assert.match(env.XDG_CONFIG_HOME ?? "", /^\/.+/);
  assert.match(env.XDG_STATE_HOME ?? "", /^\/.+/);
  assert.match(env.XDG_DATA_HOME ?? "", /^\/.+/);
  assert.match(env.HOME ?? "", /^\/.+/);
  assert.ok((env.XDG_CONFIG_HOME ?? "").startsWith(projectRoot));
  assert.ok((env.XDG_STATE_HOME ?? "").startsWith(projectRoot));
  assert.ok((env.XDG_DATA_HOME ?? "").startsWith(projectRoot));
  assert.ok((env.HOME ?? "").startsWith(projectRoot));
  assert.equal(env.XDG_CONFIG_HOME, path.join(env.HOME ?? "", ".config"));
  assert.equal(env.XDG_STATE_HOME, path.join(env.HOME ?? "", ".local", "state"));
  assert.equal(env.XDG_DATA_HOME, path.join(env.HOME ?? "", ".local", "share"));
  assert.equal(env.CODEX_HOME, undefined);
  assert.equal(env.GEMINI_CLI_HOME, undefined);
  assert.equal(env.GEMINI_CLI_TRUSTED_FOLDERS_PATH, undefined);
  assert.equal(env.IFLOW_HOME, undefined);
  assert.equal(env.OPENCODE_HOME, undefined);
  assert.equal(env.ZDOTDIR, undefined);
  assert.equal(env.GEMINI_CONFIG_DIR, undefined);

  assert.doesNotThrow(() => assertNoHostPathLeakage(env, projectRoot));
});

test("leakage detector rejects host-global config paths", () => {
  const projectRoot = path.resolve("/tmp/project-root");
  const leakingEnv = {
    HOME: "/home/test-user",
    XDG_CONFIG_HOME: "/home/test-user/.config",
  };

  assert.throws(() => assertNoHostPathLeakage(leakingEnv, projectRoot), /Detected host-global config path leakage/);
});

test("launcher aborts when agent-specific env introduces host leakage", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    leaking: createAgentDefinition("leaking-cli", {
      env: {
        XDG_CONFIG_HOME: "/tmp/leaking-config",
      },
    }),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });
  await createExecutable(path.join(bootstrap.managedPaths.bin, "leaking-cli"), "#!/usr/bin/env bash\necho should-not-run\nexit 0\n");

  const out = createMemoryWritable();
  const err = createMemoryWritable();
  const result = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "leaking",
    stdout: out.stream,
    stderr: err.stream,
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.result.error ?? "", /Detected host-global config path leakage/);
  assert.doesNotMatch(out.text(), /should-not-run/);
});
