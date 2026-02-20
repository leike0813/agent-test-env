import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { bootstrapManagedPrefix } from "../src/bootstrap.js";
import { runLifecycleCommand } from "../src/lifecycle.js";
import { runCli } from "../src/cli.js";
import {
  baseConfig,
  createAgentDefinition,
  createExecutable,
  createMemoryWritable,
  createTempProject,
  writeConfig,
} from "./test-helpers.js";

test("install lifecycle command executes configured fixed command", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    demo: createAgentDefinition("demo-cli", {
      lifecycle: {
        install: {
          command: "install-demo",
          args: ["--flag", "1"],
        },
        upgrade: {
          command: "upgrade-demo",
          args: [],
        },
      },
    }),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
    verifyBootstrapExecutables: false,
  });
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "install-demo"),
    "#!/usr/bin/env bash\necho install-command \"$@\"\nexit 0\n",
  );
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "upgrade-demo"),
    "#!/usr/bin/env bash\necho upgrade-command \"$@\"\nexit 0\n",
  );

  const out = createMemoryWritable();
  const err = createMemoryWritable();
  const result = await runLifecycleCommand({
    action: "install",
    agentName: "demo",
    projectRoot,
    configPath: "agent-env.config.json",
    stdout: out.stream,
    stderr: err.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.match(out.text(), /install-command --flag 1/);
  assert.match(err.text(), /action=install/);
});

test("upgrade lifecycle command executes configured fixed command", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    demo: createAgentDefinition("demo-cli", {
      lifecycle: {
        install: {
          command: "install-demo",
          args: [],
        },
        upgrade: {
          command: "upgrade-demo",
          args: ["--force"],
        },
      },
    }),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
    verifyBootstrapExecutables: false,
  });
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "install-demo"),
    "#!/usr/bin/env bash\necho install\nexit 0\n",
  );
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "upgrade-demo"),
    "#!/usr/bin/env bash\necho upgrade \"$@\"\nexit 0\n",
  );

  const out = createMemoryWritable();
  const err = createMemoryWritable();
  const result = await runLifecycleCommand({
    action: "upgrade",
    agentName: "demo",
    projectRoot,
    configPath: "agent-env.config.json",
    stdout: out.stream,
    stderr: err.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.match(out.text(), /upgrade --force/);
  assert.match(err.text(), /action=upgrade/);
});

test("start command from CLI forwards all trailing arguments", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    runner: createAgentDefinition("runner-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
    verifyBootstrapExecutables: false,
  });
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "runner-cli"),
    "#!/usr/bin/env bash\necho start \"$@\"\nexit 0\n",
  );

  const out = createMemoryWritable();
  const err = createMemoryWritable();
  const exitCode = await runCli(["start", "runner", "--mode", "quick", "--", "tail"], {
    projectRoot,
    stdout: out.stream,
    stderr: err.stream,
  });

  assert.equal(exitCode, 0);
  assert.match(out.text(), /start --mode quick -- tail/);
});

test("start command from CLI accepts --run-dir selector before agent name", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    runner: createAgentDefinition("runner-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
    verifyBootstrapExecutables: false,
  });
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "runner-cli"),
    "#!/usr/bin/env bash\necho start \"$@\"\nexit 0\n",
  );

  const initialOut = createMemoryWritable();
  const initialErr = createMemoryWritable();
  const firstExitCode = await runCli(["start", "runner"], {
    projectRoot,
    stdout: initialOut.stream,
    stderr: initialErr.stream,
  });
  assert.equal(firstExitCode, 0);
  const runIdMatch = initialOut.text().match(/Run id:\s+([^\s]+)/);
  assert.ok(runIdMatch);

  const out = createMemoryWritable();
  const err = createMemoryWritable();
  const exitCode = await runCli(
    ["start", "--run-dir", runIdMatch[1], "runner", "--mode", "reused"],
    {
      projectRoot,
      stdout: out.stream,
      stderr: err.stream,
    },
  );

  assert.equal(exitCode, 0);
  assert.match(out.text(), /start --mode reused/);
});
