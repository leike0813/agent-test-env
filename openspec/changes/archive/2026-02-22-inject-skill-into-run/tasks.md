## 1. CLI Option Parsing

- [x] 1.1 Remove `--inject` from `start` pre-agent option parsing.
- [x] 1.2 Keep existing passthrough behavior unchanged for arguments after `<agent>`.
- [x] 1.3 Ensure `--inject` is rejected as unknown start option.

## 2. Run-Skill Injection Helper

- [x] 2.1 Resolve source root from `<projectRoot>/skills/`.
- [x] 2.2 Implement agent-to-target mapping for run-local skill roots:
  - `codex` -> `<run_dir>/.codex/skills/`
  - `gemini` -> `<run_dir>/.gemini/skills/`
  - `iflow` -> `<run_dir>/.iflow/skills/`
  - `opencode` -> `<run_dir>/.opencode/skills/`
- [x] 2.3 Implement recursive copy of all top-level skill package directories into `<targetRoot>/<skill-name>/`.
- [x] 2.4 Append completion contract prompt to each run-copy `SKILL.md` only.
- [x] 2.5 Treat missing source root `skills/` as zero-package injection and continue.

## 3. Launcher Orchestration Integration

- [x] 3.1 Execute all-skill injection for supported agents before engine spawn.
- [x] 3.2 Keep injection stage after run directory resolve/create and before runtime spawn.
- [x] 3.3 Ensure missing `SKILL.md` in injected package fails before process launch.

## 4. Validation and Documentation

- [x] 4.1 Add tests for removed `--inject` option handling and passthrough isolation.
- [x] 4.2 Add tests for default all-skill copy into each agent-specific target directory.
- [x] 4.3 Add tests for run-copy-only completion contract append behavior.
- [x] 4.4 Update README with default injection behavior notes (no explicit `--inject`).
