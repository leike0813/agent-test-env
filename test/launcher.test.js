import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  access,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";

import { bootstrapManagedPrefix } from "../src/bootstrap.js";
import { startAgent } from "../src/launcher.js";
import { runCli } from "../src/cli.js";
import {
  baseConfig,
  createAgentDefinition,
  createExecutable,
  createMemoryWritable,
  createTempProject,
  writeConfig,
} from "./test-helpers.js";

test("single-agent start succeeds for configured agent", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    ok: createAgentDefinition("ok-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "ok-cli"),
    "#!/usr/bin/env bash\necho ok-started\nexit 0\n",
  );

  const out = createMemoryWritable();
  const err = createMemoryWritable();
  const result = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "ok",
    stdout: out.stream,
    stderr: err.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.runId, /^[0-9TZ]+-ok-/);
  assert.equal(result.result.success, true);
  assert.match(out.text(), /ok-started/);
  assert.match(err.text(), /status=started/);
  await access(path.join(result.runDirectory, ".audit", "meta.json"), constants.R_OK);
});

test("start forwards passthrough arguments in order", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    args: createAgentDefinition("args-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "args-cli"),
    "#!/usr/bin/env bash\necho \"$@\"\nexit 0\n",
  );

  const out = createMemoryWritable();
  const err = createMemoryWritable();
  const result = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "args",
    passthroughArgs: ["--model", "gpt-5", "--", "x"],
    stdout: out.stream,
    stderr: err.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.match(out.text(), /--model gpt-5 -- x/);
});

test("unknown agent names are rejected with configured agent list", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    known: createAgentDefinition("known-cli"),
  };
  await writeConfig(projectRoot, config);

  await assert.rejects(
    () =>
      startAgent({
        projectRoot,
        configPath: "agent-env.config.json",
        agentName: "unknown",
      }),
    /Configured agents: known/,
  );
});

test("start reports failure for missing managed executable", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    missing: createAgentDefinition("missing-cli"),
  };
  await writeConfig(projectRoot, config);
  await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });

  const out = createMemoryWritable();
  const err = createMemoryWritable();
  const result = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "missing",
    stdout: out.stream,
    stderr: err.stream,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.result.success, false);
  assert.match(result.result.error ?? "", /Missing managed-prefix executable/);
});

test("codex trust injection happens immediately after run directory creation", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    codex: createAgentDefinition("codex-cli"),
  };
  await writeConfig(projectRoot, config);
  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });

  const out = createMemoryWritable();
  const err = createMemoryWritable();
  const result = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "codex",
    stdout: out.stream,
    stderr: err.stream,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.result.error ?? "", /Missing managed-prefix executable/);

  const configPath = path.join(bootstrap.managedPaths.homeRoot, "default", ".codex", "config.toml");
  const content = await readFile(configPath, "utf8");
  const escapedRunDirectory = result.runDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    content,
    new RegExp(`\\[projects\\."${escapedRunDirectory}"\\]\\ntrust_level\\s*=\\s*"trusted"`),
  );
});

test("install command requires exactly one agent name", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    one: createAgentDefinition("one-cli"),
  };
  await writeConfig(projectRoot, config);

  await assert.rejects(
    () =>
      runCli(["install", "one", "two"], {
        projectRoot,
      }),
    /supports exactly one <agent-name>/,
  );
});

test("pty runtime provides terminal semantics to started agent", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    tty: createAgentDefinition("tty-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "tty-cli"),
    "#!/usr/bin/env bash\nnode -e 'console.log(\"TTY\", process.stdin.isTTY, process.stdout.isTTY, process.stderr.isTTY)'\n",
  );

  const out = createMemoryWritable();
  const err = createMemoryWritable();
  const result = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "tty",
    stdout: out.stream,
    stderr: err.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.match(out.text(), /TTY true true true/i);
});

test("start fails fast when tracer capability is unavailable", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    failfast: createAgentDefinition("failfast-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "failfast-cli"),
    "#!/usr/bin/env bash\necho failfast\nexit 0\n",
  );

  const out = createMemoryWritable();
  const err = createMemoryWritable();
  const result = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "failfast",
    baseEnv: { ...process.env, AGENT_ENV_TRACER_COMMAND: "missing-tracer-binary" },
    stdout: out.stream,
    stderr: err.stream,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.result.success, false);
  assert.match(result.result.error ?? "", /Required command "missing-tracer-binary" is unavailable/);
});

test("start supports reusing run directory by path selector", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    reuse: createAgentDefinition("reuse-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "reuse-cli"),
    "#!/usr/bin/env bash\necho reuse\nexit 0\n",
  );

  const first = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "reuse",
    stdout: createMemoryWritable().stream,
    stderr: createMemoryWritable().stream,
  });
  assert.equal(first.exitCode, 0);

  const second = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "reuse",
    runSelector: first.runDirectory,
    stdout: createMemoryWritable().stream,
    stderr: createMemoryWritable().stream,
  });
  assert.equal(second.exitCode, 0);
  assert.equal(second.runDirectory, first.runDirectory);
  assert.equal(second.runId, first.runId);
});

test("start supports reusing run directory by full run id selector", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    reuse: createAgentDefinition("reuse-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "reuse-cli"),
    "#!/usr/bin/env bash\necho reuse\nexit 0\n",
  );

  const first = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "reuse",
    stdout: createMemoryWritable().stream,
    stderr: createMemoryWritable().stream,
  });
  assert.equal(first.exitCode, 0);

  const second = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "reuse",
    runSelector: first.runId,
    stdout: createMemoryWritable().stream,
    stderr: createMemoryWritable().stream,
  });
  assert.equal(second.exitCode, 0);
  assert.equal(second.runDirectory, first.runDirectory);
  assert.equal(second.runId, first.runId);
});

test("start supports reusing run directory by unique short run id selector", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    reuse: createAgentDefinition("reuse-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "reuse-cli"),
    "#!/usr/bin/env bash\necho reuse\nexit 0\n",
  );

  const first = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "reuse",
    stdout: createMemoryWritable().stream,
    stderr: createMemoryWritable().stream,
  });
  assert.equal(first.exitCode, 0);
  const shortId = first.runId.split("-").at(-1);
  assert.equal(typeof shortId, "string");

  const second = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "reuse",
    runSelector: shortId,
    stdout: createMemoryWritable().stream,
    stderr: createMemoryWritable().stream,
  });
  assert.equal(second.exitCode, 0);
  assert.equal(second.runDirectory, first.runDirectory);
  assert.equal(second.runId, first.runId);
});

test("start rejects ambiguous short run id selectors", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    reuse: createAgentDefinition("reuse-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });

  const suffix = "abcdef12";
  const firstRunId = `20260220T010203Z-reuse-${suffix}`;
  const secondRunId = `20260220T020304Z-reuse-${suffix}`;
  const firstRunAuditDir = path.join(bootstrap.managedPaths.root, "runs", firstRunId, ".audit");
  const secondRunAuditDir = path.join(bootstrap.managedPaths.root, "runs", secondRunId, ".audit");
  await mkdir(firstRunAuditDir, { recursive: true });
  await mkdir(secondRunAuditDir, { recursive: true });
  await writeFile(
    path.join(firstRunAuditDir, "meta.json"),
    JSON.stringify({ runId: firstRunId, agentName: "reuse" }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(secondRunAuditDir, "meta.json"),
    JSON.stringify({ runId: secondRunId, agentName: "reuse" }, null, 2),
    "utf8",
  );

  await assert.rejects(
    () =>
      startAgent({
        projectRoot,
        configPath: "agent-env.config.json",
        agentName: "reuse",
        runSelector: suffix,
        stdout: createMemoryWritable().stream,
        stderr: createMemoryWritable().stream,
      }),
    /ambiguous/i,
  );
});

test("start rejects unresolved run selectors", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    reuse: createAgentDefinition("reuse-cli"),
  };
  await writeConfig(projectRoot, config);
  await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });

  await assert.rejects(
    () =>
      startAgent({
        projectRoot,
        configPath: "agent-env.config.json",
        agentName: "reuse",
        runSelector: "deadbeef",
        stdout: createMemoryWritable().stream,
        stderr: createMemoryWritable().stream,
      }),
    /does not match any existing run directory/i,
  );
});

test("start rejects reusing a run directory owned by another agent", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    codex: createAgentDefinition("codex-cli"),
    gemini: createAgentDefinition("gemini-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "codex-cli"),
    "#!/usr/bin/env bash\necho codex\nexit 0\n",
  );

  const codexRun = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "codex",
    stdout: createMemoryWritable().stream,
    stderr: createMemoryWritable().stream,
  });
  assert.equal(codexRun.exitCode, 0);

  await assert.rejects(
    () =>
      startAgent({
        projectRoot,
        configPath: "agent-env.config.json",
        agentName: "gemini",
        runSelector: codexRun.runId,
        stdout: createMemoryWritable().stream,
        stderr: createMemoryWritable().stream,
      }),
    /belongs to agent "codex"/i,
  );
});
