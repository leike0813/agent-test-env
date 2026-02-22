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
import { buildTranslateArtifacts } from "../src/translate-output.js";
import {
  baseConfig,
  createAgentDefinition,
  createExecutable,
  createMemoryWritable,
  createTempProject,
  writeConfig,
} from "./test-helpers.js";

/**
 * @param {string} input
 */
function stripAnsi(input) {
  return input.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

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
  await access(path.join(result.runDirectory, ".audit", "meta.1.json"), constants.R_OK);
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

test("start tolerates missing skills root and proceeds to executable check", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    codex: createAgentDefinition("codex-cli"),
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
    agentName: "codex",
    stdout: out.stream,
    stderr: err.stream,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.result.error ?? "", /Missing managed-prefix executable/);
  assert.doesNotMatch(result.result.error ?? "", /Skills root was not found/);
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
  const normalizedOutput = stripAnsi(out.text()).replace(/\r/g, "");
  assert.match(normalizedOutput, /TTY true true true/i);
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

test("start injects all project skill packages into agent-specific run directories", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    codex: createAgentDefinition("codex-cli"),
    gemini: createAgentDefinition("gemini-cli"),
    iflow: createAgentDefinition("iflow-cli"),
    opencode: createAgentDefinition("opencode-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });

  const agentPaths = {
    codex: ".codex/skills",
    gemini: ".gemini/skills",
    iflow: ".iflow/skills",
    opencode: ".opencode/skills",
  };
  for (const [agentName, relativeSkillRoot] of Object.entries(agentPaths)) {
    await createExecutable(
      path.join(bootstrap.managedPaths.bin, `${agentName}-cli`),
      "#!/usr/bin/env bash\necho injected\nexit 0\n",
    );
    const sourceSkill = path.join(projectRoot, "skills", "demo-auto-skill");
    await mkdir(path.join(sourceSkill, "assets"), { recursive: true });
    await writeFile(path.join(sourceSkill, "SKILL.md"), "demo\n", "utf8");
    await writeFile(path.join(sourceSkill, "assets", "data.txt"), "payload\n", "utf8");

    const runOut = createMemoryWritable();
    const runErr = createMemoryWritable();
    const result = await startAgent({
      projectRoot,
      configPath: "agent-env.config.json",
      agentName,
      stdout: runOut.stream,
      stderr: runErr.stream,
    });
    assert.equal(result.exitCode, 0);

    const injectedSkillRoot = path.join(result.runDirectory, relativeSkillRoot, "demo-auto-skill");
    await access(path.join(injectedSkillRoot, "SKILL.md"), constants.R_OK);
    await access(path.join(injectedSkillRoot, "assets", "data.txt"), constants.R_OK);
    assert.match(runOut.text(), /injected/);
    assert.match(runErr.text(), /injected_skills=1/);
  }
});

test("start makes injected skills available before process launch", async (t) => {
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

  const skillName = "demo-auto-skill";
  const sourceSkill = path.join(projectRoot, "skills", skillName);
  await mkdir(sourceSkill, { recursive: true });
  await writeFile(path.join(sourceSkill, "SKILL.md"), "demo\n", "utf8");

  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "codex-cli"),
    "#!/usr/bin/env bash\nif [ -f ./.codex/skills/demo-auto-skill/SKILL.md ]; then echo prelaunch-ok; exit 0; fi\necho missing-skill\nexit 7\n",
  );

  const out = createMemoryWritable();
  const err = createMemoryWritable();
  const result = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "codex",
    stdout: out.stream,
    stderr: err.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.match(out.text(), /prelaunch-ok/);
});

test("start appends completion contract only to run-copy SKILL.md", async (t) => {
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

  const skillName = "demo-auto-skill";
  const sourceSkill = path.join(projectRoot, "skills", skillName);
  await mkdir(sourceSkill, { recursive: true });
  await writeFile(path.join(sourceSkill, "SKILL.md"), "# demo-auto-skill\n\noriginal-body\n", "utf8");
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "codex-cli"),
    "#!/usr/bin/env bash\necho injected\nexit 0\n",
  );

  const result = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "codex",
    stdout: createMemoryWritable().stream,
    stderr: createMemoryWritable().stream,
  });
  assert.equal(result.exitCode, 0);

  const sourceSkillBody = await readFile(path.join(sourceSkill, "SKILL.md"), "utf8");
  const copiedSkillPath = path.join(result.runDirectory, ".codex", "skills", skillName, "SKILL.md");
  const copiedSkillBody = await readFile(copiedSkillPath, "utf8");

  assert.equal(sourceSkillBody.includes("Runtime Completion Contract (Injected by agent-env)"), false);
  assert.equal(copiedSkillBody.includes("Runtime Completion Contract (Injected by agent-env)"), true);
  assert.equal(copiedSkillBody.includes("{\"__SKILL_DONE__\": true}"), true);
  assert.equal(copiedSkillBody.includes("When and only when the SKILL-defined task is fully completed"), true);
  assert.equal(copiedSkillBody.includes("include \"__SKILL_DONE__\": true in that final JSON object"), true);

  const meta = JSON.parse(await readFile(path.join(result.auditDirectory, "meta.1.json"), "utf8"));
  assert.equal(meta.inject?.skillCount, 1);
  assert.deepEqual(meta.inject?.skills, [skillName]);
  assert.equal(meta.inject?.targetRoot.endsWith("/.codex/skills"), true);
  assert.equal(meta.inject?.completionSignalPrefix, "{\"__SKILL_DONE__\": true}");
  assert.equal(meta.inject?.appendedCompletionContractCount, 1);
});

test("start records interactive handle and per-agent session fields", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    codex: createAgentDefinition("codex-cli"),
    gemini: createAgentDefinition("gemini-cli"),
    iflow: createAgentDefinition("iflow-cli"),
    opencode: createAgentDefinition("opencode-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
  });

  /** @type {Array<{ agentName: string; executable: string; outputLine: string; expectedField: string; expectedValue: string }>} */
  const cases = [
    {
      agentName: "codex",
      executable: "codex-cli",
      outputLine: "{\"type\":\"thread.started\",\"thread_id\":\"019c7f7d-0354-74a3-ad38-3441ca82009c\"}",
      expectedField: "thread_id",
      expectedValue: "019c7f7d-0354-74a3-ad38-3441ca82009c",
    },
    {
      agentName: "gemini",
      executable: "gemini-cli",
      outputLine: "{\"session_id\":\"0d35542f-58b4-43a2-bad5-bfc3ed214f6a\"}",
      expectedField: "session_id",
      expectedValue: "0d35542f-58b4-43a2-bad5-bfc3ed214f6a",
    },
    {
      agentName: "iflow",
      executable: "iflow-cli",
      outputLine: "<Execution Info> {\"session-id\":\"session-9353ed2b-4655-43d8-b41a-cc7bfe1a97a6\"}",
      expectedField: "session-id",
      expectedValue: "session-9353ed2b-4655-43d8-b41a-cc7bfe1a97a6",
    },
    {
      agentName: "opencode",
      executable: "opencode-cli",
      outputLine: "{\"sessionID\":\"ses_380952571ffeJcq8gVBkarAzXF\"}",
      expectedField: "sessionID",
      expectedValue: "ses_380952571ffeJcq8gVBkarAzXF",
    },
  ];

  for (const item of cases) {
    await createExecutable(
      path.join(bootstrap.managedPaths.bin, item.executable),
      `#!/usr/bin/env bash\necho '${item.outputLine}'\nexit 0\n`,
    );
    const sourceSkill = path.join(projectRoot, "skills", "demo-auto-skill");
    await mkdir(sourceSkill, { recursive: true });
    await writeFile(path.join(sourceSkill, "SKILL.md"), "demo\n", "utf8");

    const result = await startAgent({
      projectRoot,
      configPath: "agent-env.config.json",
      agentName: item.agentName,
      stdout: createMemoryWritable().stream,
      stderr: createMemoryWritable().stream,
    });
    assert.equal(result.exitCode, 0);

    const expectedHandle = result.runId.split("-").at(-1);
    assert.equal(result.handle, expectedHandle);
    assert.equal(result.session?.field, item.expectedField);
    assert.equal(result.session?.value, item.expectedValue);

    const indexPath = path.join(bootstrap.managedPaths.metadataRoot, "interactive-handles.json");
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    const entry = index.handles?.[/** @type {string} */ (expectedHandle)];
    assert.equal(entry?.runDirectory, result.runDirectory);
    assert.equal(entry?.agentName, item.agentName);
    assert.equal(entry?.session?.field, item.expectedField);
    assert.equal(entry?.session?.value, item.expectedValue);
    assert.equal(entry?.launch?.translateLevel, 0);
  }
});

test("reused run updates interactive handle session context", async (t) => {
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
  const sourceSkill = path.join(projectRoot, "skills", "demo-auto-skill");
  await mkdir(sourceSkill, { recursive: true });
  await writeFile(path.join(sourceSkill, "SKILL.md"), "demo\n", "utf8");

  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "codex-cli"),
    "#!/usr/bin/env bash\necho '{\"type\":\"thread.started\",\"thread_id\":\"thread-first\"}'\nexit 0\n",
  );
  const first = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "codex",
    stdout: createMemoryWritable().stream,
    stderr: createMemoryWritable().stream,
  });
  assert.equal(first.exitCode, 0);
  assert.equal(first.session?.value, "thread-first");

  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "codex-cli"),
    "#!/usr/bin/env bash\necho '{\"type\":\"thread.started\",\"thread_id\":\"thread-second\"}'\nexit 0\n",
  );
  const second = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "codex",
    runSelector: first.runId,
    stdout: createMemoryWritable().stream,
    stderr: createMemoryWritable().stream,
  });
  assert.equal(second.exitCode, 0);
  assert.equal(second.handle, first.handle);
  assert.equal(second.session?.value, "thread-second");

  const indexPath = path.join(bootstrap.managedPaths.metadataRoot, "interactive-handles.json");
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  const entry = index.handles?.[/** @type {string} */ (first.handle)];
  assert.equal(entry?.session?.value, "thread-second");
  assert.equal(entry?.runDirectory, first.runDirectory);
});

test("start mode 1/2/3 prints translated views while mode 0 keeps direct runtime output", async (t) => {
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
  const sourceSkill = path.join(projectRoot, "skills", "demo-auto-skill");
  await mkdir(sourceSkill, { recursive: true });
  await writeFile(path.join(sourceSkill, "SKILL.md"), "demo\n", "utf8");

  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "codex-cli"),
    "#!/usr/bin/env bash\necho '{\"type\":\"thread.started\",\"thread_id\":\"thread-xyz\"}'\necho '{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"hello\"}}'\necho '{\"type\":\"turn.completed\"}'\necho '{\"__SKILL_DONE__\": true}'\nexit 0\n",
  );

  const mode0Out = createMemoryWritable();
  const mode0Err = createMemoryWritable();
  const mode0 = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "codex",
    translateLevel: 0,
    stdout: mode0Out.stream,
    stderr: mode0Err.stream,
  });
  assert.equal(mode0.exitCode, 0);
  assert.match(mode0Out.text(), /thread.started/);
  assert.doesNotMatch(mode0Out.text(), /### Parsed Structured Information/);

  const mode1Out = createMemoryWritable();
  const mode1Err = createMemoryWritable();
  const mode1 = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "codex",
    translateLevel: 1,
    stdout: mode1Out.stream,
    stderr: mode1Err.stream,
  });
  assert.equal(mode1.exitCode, 0);
  assert.match(mode1Out.text(), /### Parsed Structured Information/);
  assert.doesNotMatch(mode1Out.text(), /\{"type":"thread\.started"/);

  const mode2Out = createMemoryWritable();
  const mode2Err = createMemoryWritable();
  const mode2 = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "codex",
    translateLevel: 2,
    stdout: mode2Out.stream,
    stderr: mode2Err.stream,
  });
  assert.equal(mode2.exitCode, 0);
  assert.match(mode2Out.text(), /### Translated Message Envelopes/);
  assert.match(mode2Out.text(), /"assistant\.message\.final"/);

  const mode3Out = createMemoryWritable();
  const mode3Err = createMemoryWritable();
  const mode3 = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "codex",
    translateLevel: 3,
    stdout: mode3Out.stream,
    stderr: mode3Err.stream,
  });
  assert.equal(mode3.exitCode, 0);
  assert.match(mode3Out.text(), /### Simulated Frontend View \(Markdown\)/);
  assert.match(mode3Out.text(), /System: 任务完成/);
});

test("translate mode 2 suppresses raw echo blocks duplicated from assistant message", () => {
  const response = [
    "```json",
    "{",
    "  \"x\": 100,",
    "  \"y\": 50,",
    "  \"__SKILL_DONE__\": true",
    "}",
    "```",
  ].join("\n");
  const stdoutText = [
    "YOLO mode is enabled. All tool calls will be automatically approved.",
    "Loaded cached credentials.",
    "{",
    "\"x\": 100,",
    "\"y\": 50,",
    "}",
  ].join("\n");
  const stderrText = JSON.stringify({
    session_id: "session-gemini",
    response,
  });

  const mode1Artifacts = buildTranslateArtifacts({
    runId: "run-mode-1",
    attemptNumber: 1,
    agentName: "gemini",
    session: {
      field: "session_id",
      value: "session-gemini",
      source: "stderr",
    },
    completion: {
      state: "completed",
      reasonCode: "DONE_MARKER_FOUND",
    },
    stdoutText,
    stderrText,
    ptyText: "",
    translateMode: 1,
  });
  assert.equal(mode1Artifacts.parsed.assistantMessages.length, 1);
  const mode1RawStdoutLines = mode1Artifacts.envelopes
    .filter((event) => event.type === "raw.stdout")
    .map((event) => event.data.line);
  assert.equal(mode1RawStdoutLines.includes("\"x\": 100,"), true);
  assert.equal(mode1RawStdoutLines.includes("\"y\": 50,"), true);

  const mode2Artifacts = buildTranslateArtifacts({
    runId: "run-mode-2",
    attemptNumber: 1,
    agentName: "gemini",
    session: {
      field: "session_id",
      value: "session-gemini",
      source: "stderr",
    },
    completion: {
      state: "completed",
      reasonCode: "DONE_MARKER_FOUND",
    },
    stdoutText,
    stderrText,
    ptyText: "",
    translateMode: 2,
  });
  const assistantEnvelope = mode2Artifacts.envelopes.find((event) => event.type === "assistant.message.final");
  assert.ok(assistantEnvelope);
  assert.match(assistantEnvelope.data.text, /"__SKILL_DONE__": true/);
  const mode2RawStdoutLines = mode2Artifacts.envelopes
    .filter((event) => event.type === "raw.stdout")
    .map((event) => event.data.line);
  assert.equal(mode2RawStdoutLines.includes("YOLO mode is enabled. All tool calls will be automatically approved."), true);
  assert.equal(mode2RawStdoutLines.includes("Loaded cached credentials."), true);
  assert.equal(mode2RawStdoutLines.includes("\"x\": 100,"), false);
  assert.equal(mode2RawStdoutLines.includes("\"y\": 50,"), false);
  const suppressedDiagnostic = mode2Artifacts.envelopes.find(
    (event) =>
      event.type === "diagnostic.warning" &&
      event.data &&
      typeof event.data === "object" &&
      event.data.code === "RAW_DUPLICATE_SUPPRESSED",
  );
  assert.ok(suppressedDiagnostic);
});

test("start mode 3 shows user-input helper when task is not completed", async (t) => {
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
  const sourceSkill = path.join(projectRoot, "skills", "demo-interactive-skill");
  await mkdir(sourceSkill, { recursive: true });
  await writeFile(path.join(sourceSkill, "SKILL.md"), "demo\n", "utf8");

  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "codex-cli"),
    "#!/usr/bin/env bash\necho '{\"type\":\"thread.started\",\"thread_id\":\"thread-no-done\"}'\necho '{\"type\":\"turn.completed\"}'\nexit 0\n",
  );

  const out = createMemoryWritable();
  const err = createMemoryWritable();
  const result = await startAgent({
    projectRoot,
    configPath: "agent-env.config.json",
    agentName: "codex",
    translateLevel: 3,
    stdout: out.stream,
    stderr: err.stream,
  });
  assert.equal(result.exitCode, 0);
  assert.match(out.text(), /\(请输入下一步指令\.\.\.\)/);
  assert.doesNotMatch(out.text(), /Provide next user turn/);
});

test("runtime separators are emitted for all translate modes", async (t) => {
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
  const sourceSkill = path.join(projectRoot, "skills", "demo-auto-skill");
  await mkdir(sourceSkill, { recursive: true });
  await writeFile(path.join(sourceSkill, "SKILL.md"), "demo\n", "utf8");

  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "codex-cli"),
    "#!/usr/bin/env bash\necho '{\"type\":\"turn.completed\"}'\nexit 0\n",
  );

  for (const mode of [0, 1, 2, 3]) {
    const out = createMemoryWritable();
    const err = createMemoryWritable();
    const result = await startAgent({
      projectRoot,
      configPath: "agent-env.config.json",
      agentName: "codex",
      translateLevel: /** @type {0 | 1 | 2 | 3} */ (mode),
      stdout: out.stream,
      stderr: err.stream,
    });
    assert.equal(result.exitCode, 0);
    assert.match(err.text(), /runtime begin/);
    assert.match(err.text(), /runtime end/);
    assert.doesNotMatch(err.text(), /runtime_output=suppressed_by_translate_mode/);
  }
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
