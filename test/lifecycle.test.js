import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

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
  assert.match(err.text(), /translate_mode=0/);
});

test("start command from CLI parses --translate option forms", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    codex: createAgentDefinition("codex-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
    verifyBootstrapExecutables: false,
  });
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "codex-cli"),
    "#!/usr/bin/env bash\necho '{\"type\":\"thread.started\",\"thread_id\":\"session-1\"}'\necho '{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"hello\"}}'\necho '{\"type\":\"turn.completed\"}'\necho '{\"__SKILL_DONE__\": true}'\nexit 0\n",
  );
  const skillSource = path.join(projectRoot, "skills", "demo-auto-skill");
  await mkdir(skillSource, { recursive: true });
  await writeFile(path.join(skillSource, "SKILL.md"), "demo\n", "utf8");

  const mode1Out = createMemoryWritable();
  const mode1Err = createMemoryWritable();
  const mode1Code = await runCli(
    ["start", "--translate", "1", "codex", "exec", "--json"],
    {
      projectRoot,
      stdout: mode1Out.stream,
      stderr: mode1Err.stream,
    },
  );
  assert.equal(mode1Code, 0);
  assert.match(mode1Out.text(), /### Parsed Structured Information/);
  assert.doesNotMatch(mode1Out.text(), /AGENT_ENV_DONE/);
  assert.match(mode1Err.text(), /passthrough=\["exec","--json"\]/);
  assert.doesNotMatch(mode1Err.text(), /"--translate"/);
  assert.match(mode1Err.text(), /translate_mode=1/);

  const mode2Out = createMemoryWritable();
  const mode2Err = createMemoryWritable();
  const mode2Code = await runCli(
    ["start", "--translate=2", "codex", "exec"],
    {
      projectRoot,
      stdout: mode2Out.stream,
      stderr: mode2Err.stream,
    },
  );
  assert.equal(mode2Code, 0);
  assert.match(mode2Out.text(), /### Translated Message Envelopes/);
  assert.match(mode2Err.text(), /passthrough=\["exec"\]/);
  assert.doesNotMatch(mode2Err.text(), /"--translate"/);
  assert.match(mode2Err.text(), /translate_mode=2/);
});

test("start command rejects invalid --translate values", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    runner: createAgentDefinition("runner-cli"),
  };
  await writeConfig(projectRoot, config);

  await assert.rejects(
    () =>
      runCli(["start", "--translate", "5", "runner"], {
        projectRoot,
      }),
    /Invalid --translate value "5"/,
  );
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

test("start command rejects removed --inject option", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    runner: createAgentDefinition("runner-cli"),
  };
  await writeConfig(projectRoot, config);

  await assert.rejects(
    () =>
      runCli(["start", "--inject"], {
        projectRoot,
      }),
    /Unknown start option: --inject/,
  );
});

test("start command keeps passthrough args unchanged with default skill injection", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    codex: createAgentDefinition("codex-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
    verifyBootstrapExecutables: false,
  });
  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "codex-cli"),
    "#!/usr/bin/env bash\necho start \"$@\"\nexit 0\n",
  );

  const skillName = "demo-auto-skill";
  const skillSource = path.join(projectRoot, "skills", skillName);
  await mkdir(skillSource, { recursive: true });
  await writeFile(path.join(skillSource, "SKILL.md"), "demo skill\n", "utf8");

  const out = createMemoryWritable();
  const err = createMemoryWritable();
  const exitCode = await runCli(
    ["start", "codex", "--mode", "quick", "--json"],
    {
      projectRoot,
      stdout: out.stream,
      stderr: err.stream,
    },
  );

  assert.equal(exitCode, 0);
  assert.match(out.text(), /start --mode quick --json/);
  assert.match(err.text(), /injected_skills=1/);
});

test("resume command reconstructs engine-native interactive continuation from handle", async (t) => {
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
    verifyBootstrapExecutables: false,
  });

  const skillSource = path.join(projectRoot, "skills", "demo-interactive-skill");
  await mkdir(skillSource, { recursive: true });
  await writeFile(path.join(skillSource, "SKILL.md"), "demo interactive\n", "utf8");

  /** @type {Array<{
   *   agentName: string;
   *   executable: string;
   *   sessionLine: string;
   *   sessionValue: string;
   *   startArgs: string[];
   *   expectedResumeArgs: string[];
   * }>} */
  const cases = [
    {
      agentName: "codex",
      executable: "codex-cli",
      sessionLine: "{\"type\":\"thread.started\",\"thread_id\":\"019c7f7d-0354-74a3-ad38-3441ca82009c\"}",
      sessionValue: "019c7f7d-0354-74a3-ad38-3441ca82009c",
      startArgs: ["codex", "exec", "--skip-git-repo-check", "--json", "--full-auto", "$demo-interactive-skill"],
      expectedResumeArgs: [
        "exec",
        "resume",
        "--skip-git-repo-check",
        "--json",
        "--full-auto",
        "019c7f7d-0354-74a3-ad38-3441ca82009c",
        "Male, Age 38, Engineer",
      ],
    },
    {
      agentName: "gemini",
      executable: "gemini-cli",
      sessionLine: "{\"session_id\":\"0d35542f-58b4-43a2-bad5-bfc3ed214f6a\"}",
      sessionValue: "0d35542f-58b4-43a2-bad5-bfc3ed214f6a",
      startArgs: [
        "gemini",
        "--yolo",
        "--model=gemini-3-flash-preview",
        "-p",
        "Please invoke the skill named demo-interactive-skill",
      ],
      expectedResumeArgs: [
        "--resume=0d35542f-58b4-43a2-bad5-bfc3ed214f6a",
        "--yolo",
        "--model=gemini-3-flash-preview",
        "-p",
        "Male, Age 38, Engineer",
      ],
    },
    {
      agentName: "iflow",
      executable: "iflow-cli",
      sessionLine: "<Execution Info> {\"session-id\":\"session-9353ed2b-4655-43d8-b41a-cc7bfe1a97a6\"}",
      sessionValue: "session-9353ed2b-4655-43d8-b41a-cc7bfe1a97a6",
      startArgs: [
        "iflow",
        "--yolo",
        "--thinking",
        "--model=glm-5",
        "-p",
        "Please invoke the skill named demo-interactive-skill",
      ],
      expectedResumeArgs: [
        "--resume=session-9353ed2b-4655-43d8-b41a-cc7bfe1a97a6",
        "--yolo",
        "--thinking",
        "--model=glm-5",
        "-p",
        "Male, Age 38, Engineer",
      ],
    },
    {
      agentName: "opencode",
      executable: "opencode-cli",
      sessionLine: "{\"sessionID\":\"ses_380952571ffeJcq8gVBkarAzXF\"}",
      sessionValue: "ses_380952571ffeJcq8gVBkarAzXF",
      startArgs: [
        "opencode",
        "run",
        "--format",
        "json",
        "--model",
        "google/gemini-3.1-pro-preview",
        "Please invoke the skill named demo-interactive-skill.",
      ],
      expectedResumeArgs: [
        "run",
        "--session=ses_380952571ffeJcq8gVBkarAzXF",
        "--format",
        "json",
        "--model",
        "google/gemini-3.1-pro-preview",
        "Male, Age 38, Engineer",
      ],
    },
  ];

  for (const item of cases) {
    await createExecutable(
      path.join(bootstrap.managedPaths.bin, item.executable),
      `#!/usr/bin/env bash\necho '${item.sessionLine}'\necho agent-args \"$@\"\nexit 0\n`,
    );

    const startOut = createMemoryWritable();
    const startErr = createMemoryWritable();
    const startExit = await runCli(["start", ...item.startArgs], {
      projectRoot,
      stdout: startOut.stream,
      stderr: startErr.stream,
    });
    assert.equal(startExit, 0);
    assert.match(startOut.text(), new RegExp(`Session:\\s+.*${item.sessionValue}`));

    const handleMatch = startOut.text().match(/Run handle:\s+([0-9a-f]{8})/i);
    assert.ok(handleMatch);

    const resumeOut = createMemoryWritable();
    const resumeErr = createMemoryWritable();
    const resumeExit = await runCli(["resume", handleMatch[1], "Male, Age 38, Engineer"], {
      projectRoot,
      stdout: resumeOut.stream,
      stderr: resumeErr.stream,
    });
    assert.equal(resumeExit, 0);
    assert.match(resumeOut.text(), /Resume complete\. exitCode=0/);

    const passthroughMatch = resumeErr.text().match(/\[agent:[^\]]+\] passthrough=(\[[^\n]+\])/);
    assert.ok(passthroughMatch);
    assert.deepEqual(JSON.parse(passthroughMatch[1]), item.expectedResumeArgs);
  }
});

test("resume command fails when handle is missing", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    codex: createAgentDefinition("codex-cli"),
  };
  await writeConfig(projectRoot, config);

  await assert.rejects(
    () =>
      runCli(["resume", "deadbeef", "hello"], {
        projectRoot,
      }),
    /Handle "deadbeef" was not found/,
  );
});

test("resume command inherits translate mode from handle metadata", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    codex: createAgentDefinition("codex-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
    verifyBootstrapExecutables: false,
  });

  const skillSource = path.join(projectRoot, "skills", "demo-interactive-skill");
  await mkdir(skillSource, { recursive: true });
  await writeFile(path.join(skillSource, "SKILL.md"), "demo interactive\n", "utf8");

  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "codex-cli"),
    "#!/usr/bin/env bash\necho '{\"type\":\"thread.started\",\"thread_id\":\"thread-translate\"}'\necho '{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"hello\"}}'\necho '{\"type\":\"turn.completed\"}'\nexit 0\n",
  );

  const startOut = createMemoryWritable();
  const startErr = createMemoryWritable();
  const startExit = await runCli(
    ["start", "--translate=2", "codex", "exec", "--json", "$demo-interactive-skill"],
    {
      projectRoot,
      stdout: startOut.stream,
      stderr: startErr.stream,
    },
  );
  assert.equal(startExit, 0);
  assert.match(startOut.text(), /### Translated Message Envelopes/);
  const handleMatch = startOut.text().match(/Run handle:\s+([0-9a-f]{8})/i);
  assert.ok(handleMatch);

  const resumeOut = createMemoryWritable();
  const resumeErr = createMemoryWritable();
  const resumeExit = await runCli(
    ["resume", handleMatch[1], "Thanks, that is enough."],
    {
      projectRoot,
      stdout: resumeOut.stream,
      stderr: resumeErr.stream,
    },
  );
  assert.equal(resumeExit, 0);
  assert.match(resumeOut.text(), /### Translated Message Envelopes/);
  assert.match(resumeErr.text(), /translate_mode=2/);
});

test("resume command falls back to translate mode 0 for legacy handle records", async (t) => {
  const projectRoot = await createTempProject(t);
  const config = baseConfig();
  config.agents = {
    codex: createAgentDefinition("codex-cli"),
  };
  await writeConfig(projectRoot, config);

  const bootstrap = await bootstrapManagedPrefix({
    projectRoot,
    configPath: "agent-env.config.json",
    verifyBootstrapExecutables: false,
  });

  const skillSource = path.join(projectRoot, "skills", "demo-interactive-skill");
  await mkdir(skillSource, { recursive: true });
  await writeFile(path.join(skillSource, "SKILL.md"), "demo interactive\n", "utf8");

  await createExecutable(
    path.join(bootstrap.managedPaths.bin, "codex-cli"),
    "#!/usr/bin/env bash\necho '{\"type\":\"thread.started\",\"thread_id\":\"thread-legacy\"}'\necho '{\"type\":\"turn.completed\"}'\nexit 0\n",
  );

  const startOut = createMemoryWritable();
  const startErr = createMemoryWritable();
  const startExit = await runCli(
    ["start", "--translate=2", "codex", "exec", "--json", "$demo-interactive-skill"],
    {
      projectRoot,
      stdout: startOut.stream,
      stderr: startErr.stream,
    },
  );
  assert.equal(startExit, 0);
  const handleMatch = startOut.text().match(/Run handle:\s+([0-9a-f]{8})/i);
  assert.ok(handleMatch);

  const indexPath = path.join(bootstrap.managedPaths.metadataRoot, "interactive-handles.json");
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  delete index.handles[handleMatch[1]].launch.translateLevel;
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

  const resumeOut = createMemoryWritable();
  const resumeErr = createMemoryWritable();
  const resumeExit = await runCli(
    ["resume", handleMatch[1], "Thanks, done."],
    {
      projectRoot,
      stdout: resumeOut.stream,
      stderr: resumeErr.stream,
    },
  );
  assert.equal(resumeExit, 0);
  assert.doesNotMatch(resumeOut.text(), /### Translated Message Envelopes/);
  assert.match(resumeOut.text(), /"thread_id":"thread-legacy"/);
  assert.match(resumeErr.text(), /translate_mode=0/);
});
