import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { bootstrapManagedPrefix, resolveManagedExecutablePath } from "../src/bootstrap.js";
import { startAgent } from "../src/launcher.js";
import {
  baseConfig,
  createAgentDefinition,
  createExecutable,
  createMemoryWritable,
  createTempProject,
  writeConfig,
} from "./test-helpers.js";

test("bootstrap creates managed-prefix layout and is idempotent", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    alpha: createAgentDefinition("alpha"),
  };
  await writeConfig(projectRoot, config);

  const first = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });
  const second = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });

  assert.equal(first.managedPaths.root, second.managedPaths.root);
  await access(first.managedPaths.bin, constants.R_OK);
  await access(first.managedPaths.configRoot, constants.R_OK);
  await access(first.managedPaths.stateRoot, constants.R_OK);
  await access(first.managedPaths.logsRoot, constants.R_OK);
  await access(first.managedPaths.metadataRoot, constants.R_OK);
  await access(first.managedPaths.homeRoot, constants.R_OK);
});

test("launch resolves executable from managed prefix before host PATH", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    alpha: createAgentDefinition("alpha"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });

  const managedExecutable = resolveManagedExecutablePath("alpha", config.agents.alpha, bootstrap.managedPaths);
  await createExecutable(managedExecutable, "#!/usr/bin/env bash\necho managed-alpha\nexit 0\n");

  const hostBin = path.join(projectRoot, "host-bin");
  const hostExecutable = path.join(hostBin, "alpha");
  await createExecutable(hostExecutable, "#!/usr/bin/env bash\necho host-alpha\nexit 0\n");

  const out = createMemoryWritable();
  const err = createMemoryWritable();
  const launchResult = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "alpha",
    baseEnv: { ...process.env, PATH: [hostBin, process.env.PATH ?? ""].filter(Boolean).join(path.delimiter) },
    stdout: out.stream,
    stderr: err.stream,
  });

  assert.equal(launchResult.exitCode, 0);
  assert.match(out.text(), /managed-alpha/);
  assert.doesNotMatch(out.text(), /host-alpha/);
});

test("bootstrap executable verification fails with actionable error when required executable is missing", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    missing: createAgentDefinition("missing-cli", {
      requiredOnBootstrap: true,
    }),
  };
  await writeConfig(projectRoot, config);

  await assert.rejects(
    () =>
      bootstrapManagedPrefix({
        projectRoot,
        configPath: "agent-env.config.json",
      }),
    /Missing managed-prefix executable/,
  );
});
