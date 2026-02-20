import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { bootstrapManagedPrefix } from "../src/bootstrap.js";
import { startAgent } from "../src/launcher.js";
import {
  baseConfig,
  createAgentDefinition,
  createExecutable,
  createMemoryWritable,
  createTempProject,
  writeConfig,
} from "./test-helpers.js";

test("start run writes replayable audit artifacts and excludes recorder files from fs diff", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    audit: createAgentDefinition("audit-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "audit-cli"),
    "#!/usr/bin/env node\nconst { stdin, stdout, stderr } = require('node:process');\nconst { writeFileSync } = require('node:fs');\nlet input = '';\nstdin.setEncoding('utf8');\nstdin.on('data', (chunk) => { input += chunk; });\nstdin.on('end', () => {\n  const line = input.trimEnd();\n  stdout.write(`stdout:${line}\\n`);\n  stderr.write(`stderr:${line}\\n`);\n  writeFileSync('generated.txt', 'payload\\n');\n});\n",
  );

  const out = createMemoryWritable();
  const err = createMemoryWritable();
  const result = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "audit",
    stdinSource: Readable.from(["hello-input\n"]),
    stdout: out.stream,
    stderr: err.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.success, true);
  assert.match(out.text(), /stdout:hello-input/);

  const meta = JSON.parse(await readFile(path.join(result.auditDirectory, "meta.json"), "utf8"));
  const stdinLog = await readFile(path.join(result.auditDirectory, "stdin.log"), "utf8");
  const stdoutLog = await readFile(path.join(result.auditDirectory, "stdout.log"), "utf8");
  const stderrLog = await readFile(path.join(result.auditDirectory, "stderr.log"), "utf8");
  const fsDiff = JSON.parse(await readFile(path.join(result.auditDirectory, "fs-diff.json"), "utf8"));
  const runIndex = JSON.parse(await readFile(path.join(path.dirname(result.runDirectory), "index.json"), "utf8"));

  assert.equal(meta.runId, result.runId);
  assert.equal(meta.runDirectory, result.runDirectory);
  assert.match(stdinLog, /hello-input/);
  assert.match(stdoutLog, /stdout:hello-input/);
  assert.match(stderrLog, /stderr:hello-input/);
  assert.deepEqual(fsDiff.modified, []);
  assert.deepEqual(fsDiff.deleted, []);
  assert.ok(fsDiff.created.includes("generated.txt"));
  assert.equal(fsDiff.created.some((value) => value.startsWith(".audit/")), false);
  assert.equal(runIndex.some((entry) => entry.runId === result.runId), true);
});

test("codex start registers run directory trust in HOME-based codex config", async (t) => {
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
  const configPath = path.join(bootstrap.managedPaths.homeRoot, "default", ".codex", "config.toml");
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    [
      "[model_providers.deepseek]",
      'name = "DeepSeek"',
      "",
      "[model_providers.deepseek.chat]",
      'name = "DeepSeek API"',
      "",
    ].join("\n"),
    "utf8",
  );
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "codex-cli"),
    "#!/usr/bin/env bash\necho codex\nexit 0\n",
  );

  const result = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "codex",
    stdout: createMemoryWritable().stream,
    stderr: createMemoryWritable().stream,
  });
  assert.equal(result.exitCode, 0);

  const content = await readFile(configPath, "utf8");
  const escapedRunDirectory = result.runDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    content,
    new RegExp(`\\[projects\\."${escapedRunDirectory}"\\]\\ntrust_level\\s*=\\s*"trusted"`),
  );
  assert.doesNotMatch(content, new RegExp(`projects\\."${escapedRunDirectory}"\\.trust_level\\s*=\\s*"trusted"`));
  assert.equal(
    content.endsWith(`[projects."${result.runDirectory}"]\ntrust_level = "trusted"\n`),
    true,
  );
  assert.equal(content.includes(`\n\n[projects."${result.runDirectory}"]\ntrust_level = "trusted"\n`), true);
});

test("gemini start registers run directory trust in HOME-based trustedFolders.json", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    gemini: createAgentDefinition("gemini-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "gemini-cli"),
    "#!/usr/bin/env bash\necho gemini\nexit 0\n",
  );

  const result = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "gemini",
    stdout: createMemoryWritable().stream,
    stderr: createMemoryWritable().stream,
  });
  assert.equal(result.exitCode, 0);

  const trustedFoldersPath = path.join(
    bootstrap.managedPaths.homeRoot,
    "default",
    ".gemini",
    "trustedFolders.json",
  );
  const trustedFolders = JSON.parse(await readFile(trustedFoldersPath, "utf8"));
  assert.equal(trustedFolders[result.runDirectory], "TRUST_FOLDER");
});

test("reused run directory appends metadata attempts and split stream logs", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    audit: createAgentDefinition("audit-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "audit-cli"),
    "#!/usr/bin/env node\nconst { stdin, stdout, stderr } = require('node:process');\nlet input = '';\nstdin.setEncoding('utf8');\nstdin.on('data', (chunk) => { input += chunk; });\nstdin.on('end', () => {\n  const line = input.trimEnd();\n  stdout.write(`stdout:${line}\\n`);\n  stderr.write(`stderr:${line}\\n`);\n});\n",
  );

  const first = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "audit",
    stdinSource: Readable.from(["first-pass\n"]),
    stdout: createMemoryWritable().stream,
    stderr: createMemoryWritable().stream,
  });
  assert.equal(first.exitCode, 0);

  const second = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "audit",
    runSelector: first.runId,
    stdinSource: Readable.from(["second-pass\n"]),
    stdout: createMemoryWritable().stream,
    stderr: createMemoryWritable().stream,
  });
  assert.equal(second.exitCode, 0);
  assert.equal(second.runDirectory, first.runDirectory);
  assert.equal(second.runId, first.runId);

  const auditDir = first.auditDirectory;
  const metadata = JSON.parse(await readFile(path.join(auditDir, "meta.json"), "utf8"));
  const stdinLog = await readFile(path.join(auditDir, "stdin.log"), "utf8");
  const stdoutLog = await readFile(path.join(auditDir, "stdout.log"), "utf8");
  const stderrLog = await readFile(path.join(auditDir, "stderr.log"), "utf8");

  assert.equal(metadata.attemptCount, 2);
  assert.equal(Array.isArray(metadata.attempts), true);
  assert.equal(metadata.attempts.length, 2);
  assert.equal(metadata.reuse?.enabled, true);
  assert.equal(metadata.attempts[0]?.runId, first.runId);
  assert.equal(metadata.attempts[1]?.runId, second.runId);
  assert.match(stdinLog, /first-pass/);
  assert.match(stdinLog, /second-pass/);
  assert.match(stdoutLog, /stdout:first-pass/);
  assert.match(stdoutLog, /stdout:second-pass/);
  assert.match(stderrLog, /stderr:first-pass/);
  assert.match(stderrLog, /stderr:second-pass/);
  assert.ok(stdoutLog.indexOf("stdout:first-pass") < stdoutLog.indexOf("stdout:second-pass"));
  assert.ok(stderrLog.indexOf("stderr:first-pass") < stderrLog.indexOf("stderr:second-pass"));
});
