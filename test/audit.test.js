import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { bootstrapManagedPrefix } from "../src/bootstrap.js";
import { startAgent } from "../src/launcher.js";
import { analyzeCompletionSignal } from "../src/audit.js";
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

  const meta = JSON.parse(await readFile(path.join(result.auditDirectory, "meta.1.json"), "utf8"));
  const stdinLog = await readFile(path.join(result.auditDirectory, "stdin.1.log"), "utf8");
  const stdoutLog = await readFile(path.join(result.auditDirectory, "stdout.1.log"), "utf8");
  const stderrLog = await readFile(path.join(result.auditDirectory, "stderr.1.log"), "utf8");
  const fsDiff = JSON.parse(await readFile(path.join(result.auditDirectory, "fs-diff.1.json"), "utf8"));
  const runIndex = JSON.parse(await readFile(path.join(path.dirname(result.runDirectory), "index.json"), "utf8"));

  assert.equal(meta.runId, result.runId);
  assert.equal(meta.runDirectory, result.runDirectory);
  assert.equal(meta.attempt?.number, 1);
  assert.equal(meta.protocol?.schemaVersion, 1);
  assert.equal(typeof meta.protocol?.completion?.state, "string");
  assert.equal(Array.isArray(meta.protocol?.completion?.diagnostics), true);
  assert.match(stdinLog, /hello-input/);
  assert.match(stdoutLog, /stdout:hello-input/);
  assert.match(stderrLog, /stderr:hello-input/);
  assert.deepEqual(fsDiff.modified, []);
  assert.deepEqual(fsDiff.deleted, []);
  assert.ok(fsDiff.created.includes("generated.txt"));
  assert.equal(fsDiff.created.some((value) => value.startsWith(".audit/")), false);
  assert.equal(runIndex.some((entry) => entry.runId === result.runId), true);
  const currentRunEntries = runIndex.filter((entry) => entry.runId === result.runId);
  const latestEntry = currentRunEntries.at(-1);
  assert.equal(latestEntry?.attemptNumber, 1);
  assert.equal(latestEntry?.auditFiles?.meta, ".audit/meta.1.json");
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

test("reused run directory writes independent attempt-numbered audit files", async (t) => {
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
  const meta1 = JSON.parse(await readFile(path.join(auditDir, "meta.1.json"), "utf8"));
  const meta2 = JSON.parse(await readFile(path.join(auditDir, "meta.2.json"), "utf8"));
  const stdin1 = await readFile(path.join(auditDir, "stdin.1.log"), "utf8");
  const stdin2 = await readFile(path.join(auditDir, "stdin.2.log"), "utf8");
  const stdout1 = await readFile(path.join(auditDir, "stdout.1.log"), "utf8");
  const stdout2 = await readFile(path.join(auditDir, "stdout.2.log"), "utf8");
  const stderr1 = await readFile(path.join(auditDir, "stderr.1.log"), "utf8");
  const stderr2 = await readFile(path.join(auditDir, "stderr.2.log"), "utf8");
  const fsDiff1 = JSON.parse(await readFile(path.join(auditDir, "fs-diff.1.json"), "utf8"));
  const fsDiff2 = JSON.parse(await readFile(path.join(auditDir, "fs-diff.2.json"), "utf8"));
  const runIndex = JSON.parse(await readFile(path.join(path.dirname(first.runDirectory), "index.json"), "utf8"));

  assert.equal(meta1.attempt?.number, 1);
  assert.equal(meta2.attempt?.number, 2);
  assert.equal(meta1.runId, first.runId);
  assert.equal(meta2.runId, second.runId);
  assert.equal(meta2.reuse?.enabled, true);
  assert.match(stdin1, /first-pass/);
  assert.doesNotMatch(stdin1, /second-pass/);
  assert.match(stdin2, /second-pass/);
  assert.doesNotMatch(stdin2, /first-pass/);
  assert.match(stdout1, /stdout:first-pass/);
  assert.doesNotMatch(stdout1, /stdout:second-pass/);
  assert.match(stdout2, /stdout:second-pass/);
  assert.doesNotMatch(stdout2, /stdout:first-pass/);
  assert.match(stderr1, /stderr:first-pass/);
  assert.doesNotMatch(stderr1, /stderr:second-pass/);
  assert.match(stderr2, /stderr:second-pass/);
  assert.doesNotMatch(stderr2, /stderr:first-pass/);
  assert.deepEqual(fsDiff1.modified, []);
  assert.deepEqual(fsDiff2.modified, []);
  const currentRunEntries = runIndex.filter((entry) => entry.runId === first.runId);
  assert.equal(currentRunEntries.length >= 2, true);
  assert.equal(currentRunEntries.at(-2)?.attemptNumber, 1);
  assert.equal(currentRunEntries.at(-1)?.attemptNumber, 2);
  assert.equal(currentRunEntries.at(-1)?.auditFiles?.meta, ".audit/meta.2.json");
});

test("completion analysis prefers valid PTY signal over other streams", async (t) => {
  const projectRoot = await createTempProject(t);
  const ptyPath = path.join(projectRoot, "pty.log");
  const stdoutPath = path.join(projectRoot, "stdout.log");
  const stderrPath = path.join(projectRoot, "stderr.log");

  await writeFile(
    ptyPath,
    [
      "assistant output",
      "AGENT_ENV_DONE {\"version\":\"1\",\"state\":\"completed\",\"skill\":\"demo-auto-skill\",\"result_kind\":\"json_object\",\"needs_user_input\":false,\"reason_code\":\"FINAL_STRUCTURED_OUTPUT_SELECTED\"}",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    stdoutPath,
    "AGENT_ENV_DONE {\"version\":\"1\",\"state\":\"unknown\",\"skill\":\"demo-auto-skill\",\"result_kind\":\"text\",\"needs_user_input\":false,\"reason_code\":\"INSUFFICIENT_EVIDENCE\"}\n",
    "utf8",
  );
  await writeFile(stderrPath, "", "utf8");

  const analyzed = await analyzeCompletionSignal({
    processResult: { success: true, code: 0, signal: null },
    ptyOutputPath: ptyPath,
    stdoutPath,
    stderrPath,
    agentName: "codex",
    skillName: "demo-auto-skill",
    launchArgs: [],
  });

  assert.equal(analyzed.state, "completed");
  assert.equal(analyzed.reasonCode, "FINAL_STRUCTURED_OUTPUT_SELECTED");
  assert.equal(analyzed.method, "signal");
  assert.equal(analyzed.scenario, "auto");
  assert.equal(analyzed.signal?.source, "pty");
  assert.equal(analyzed.diagnostics.includes("DONE_SIGNAL_CONFLICT"), true);
});

test("completion analysis falls back when done signal schema is invalid", async (t) => {
  const projectRoot = await createTempProject(t);
  const ptyPath = path.join(projectRoot, "pty.log");
  const stdoutPath = path.join(projectRoot, "stdout.log");
  const stderrPath = path.join(projectRoot, "stderr.log");

  await writeFile(
    ptyPath,
    [
      "AGENT_ENV_DONE {\"version\":\"2\",\"state\":\"completed\",\"skill\":\"demo-interactive-skill\",\"result_kind\":\"json_object\",\"needs_user_input\":false,\"reason_code\":\"FINAL_STRUCTURED_OUTPUT_SELECTED\"}",
      "Could you share more details?",
    ].join("\n"),
    "utf8",
  );
  await writeFile(stdoutPath, "", "utf8");
  await writeFile(stderrPath, "", "utf8");

  const analyzed = await analyzeCompletionSignal({
    processResult: { success: true, code: 0, signal: null },
    ptyOutputPath: ptyPath,
    stdoutPath,
    stderrPath,
    agentName: "codex",
    skillName: "demo-interactive-skill",
    launchArgs: [],
  });

  assert.equal(analyzed.method, "rule");
  assert.equal(analyzed.state, "unknown");
  assert.equal(analyzed.reasonCode, "INSUFFICIENT_EVIDENCE");
  assert.equal(analyzed.scenario, "interactive");
  assert.equal(analyzed.signal, null);
  assert.equal(analyzed.diagnostics.includes("DONE_SIGNAL_INVALID_SCHEMA"), true);
  assert.equal(analyzed.diagnostics.includes("DONE_SIGNAL_NOT_FOUND"), true);
  assert.equal(analyzed.diagnostics.includes("INTERACTIVE_END_UNCERTAIN"), true);
});

test("completion analysis marks completed when done marker is present", async (t) => {
  const projectRoot = await createTempProject(t);
  const ptyPath = path.join(projectRoot, "pty.log");
  const stdoutPath = path.join(projectRoot, "stdout.log");
  const stderrPath = path.join(projectRoot, "stderr.log");

  await writeFile(
    ptyPath,
    [
      "{\"type\":\"thread.started\",\"thread_id\":\"abc\"}",
      "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"{\\\"__SKILL_DONE__\\\": true}\"}}",
      "{\"type\":\"turn.completed\"}",
    ].join("\n"),
    "utf8",
  );
  await writeFile(stdoutPath, "", "utf8");
  await writeFile(stderrPath, "", "utf8");

  const analyzed = await analyzeCompletionSignal({
    processResult: { success: true, code: 0, signal: null },
    ptyOutputPath: ptyPath,
    stdoutPath,
    stderrPath,
    agentName: "codex",
    skillName: "demo-auto-skill",
    launchArgs: [],
  });

  assert.equal(analyzed.state, "completed");
  assert.equal(analyzed.reasonCode, "DONE_MARKER_FOUND");
  assert.equal(analyzed.doneMarker.detected, true);
  assert.equal(analyzed.terminalSignal.detected, true);
  assert.equal(analyzed.needsUserInput, false);
});

test("completion analysis marks awaiting_user_input when terminal signal exists without done marker", async (t) => {
  const projectRoot = await createTempProject(t);
  const ptyPath = path.join(projectRoot, "pty.log");
  const stdoutPath = path.join(projectRoot, "stdout.log");
  const stderrPath = path.join(projectRoot, "stderr.log");

  await writeFile(
    ptyPath,
    [
      "{\"type\":\"thread.started\",\"thread_id\":\"abc\"}",
      "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"Need more details\"}}",
      "{\"type\":\"turn.completed\"}",
    ].join("\n"),
    "utf8",
  );
  await writeFile(stdoutPath, "", "utf8");
  await writeFile(stderrPath, "", "utf8");

  const analyzed = await analyzeCompletionSignal({
    processResult: { success: true, code: 0, signal: null },
    ptyOutputPath: ptyPath,
    stdoutPath,
    stderrPath,
    agentName: "codex",
    skillName: "demo-interactive-skill",
    launchArgs: [],
  });

  assert.equal(analyzed.state, "awaiting_user_input");
  assert.equal(analyzed.reasonCode, "TERMINAL_SIGNAL_WITHOUT_DONE_MARKER");
  assert.equal(analyzed.doneMarker.detected, false);
  assert.equal(analyzed.terminalSignal.detected, true);
  assert.equal(analyzed.needsUserInput, true);
  assert.equal(analyzed.diagnostics.includes("DONE_MARKER_MISSING"), true);
});

test("completion analysis marks interrupted on non-zero exit", async (t) => {
  const projectRoot = await createTempProject(t);
  const ptyPath = path.join(projectRoot, "pty.log");
  const stdoutPath = path.join(projectRoot, "stdout.log");
  const stderrPath = path.join(projectRoot, "stderr.log");

  await writeFile(ptyPath, "partial output\n", "utf8");
  await writeFile(stdoutPath, "", "utf8");
  await writeFile(stderrPath, "runtime failed\n", "utf8");

  const analyzed = await analyzeCompletionSignal({
    processResult: { success: false, code: 1, signal: null },
    ptyOutputPath: ptyPath,
    stdoutPath,
    stderrPath,
    agentName: "iflow",
    skillName: "demo-interactive-skill",
    launchArgs: [],
  });

  assert.equal(analyzed.state, "interrupted");
  assert.equal(analyzed.reasonCode, "PROCESS_EXIT_NON_ZERO");
  assert.equal(analyzed.needsUserInput, false);
  assert.equal(analyzed.diagnostics.includes("PROCESS_INTERRUPTED"), true);
  assert.equal(analyzed.scenario, "interactive");
});
