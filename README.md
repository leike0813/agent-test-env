# agent-test-env

Managed-prefix isolated runtime for installing, starting, and upgrading one Agent CLI tool per command invocation.

## Quick Start

1. Review base config in `agent-env.config.json` and bundled agent presets in `agents/*.json`.
2. Bootstrap project-local managed prefix:

```bash
npm run bootstrap
```

3. Install one agent into the managed prefix:

```bash
npm run install -- codex
```

4. Start one agent (supports passthrough args):

```bash
npm run start -- codex -- --model gpt-5
```

Or choose translated runtime output mode:

```bash
npm run start -- --translate 2 codex exec --json
```

The command prints `Run id`, `Run directory`, `Run handle`, and parsed session info for replay and continuation.

`start` will automatically inject all project-local skill packages from `skills/` into the run-local agent skills directory.

```bash
npm run start -- codex exec --json
```

5. Upgrade one agent:

```bash
npm run upgrade -- codex
```

## Commands

- `npm run bootstrap`
  - Creates/refreshes managed prefix directories.
  - Verifies executables for agents where `requiredOnBootstrap` is `true`.
- `npm run install -- <agent>`
  - Runs fixed install command for exactly one configured agent.
- `npm run start -- <agent> [args...]`
  - Starts exactly one configured agent with managed-prefix executable resolution.
  - Supports command-level `--translate <0|1|2|3>` (or `--translate=<0|1|2|3>`) before `<agent>`:
    - `0`: direct PTY output (default)
    - `1`: parsed structured information
    - `2`: translated message envelopes
    - `3`: simulated frontend-visible text
  - Forwards all trailing args to the agent process unchanged.
  - `--translate` is launcher-only and is never forwarded to agent passthrough args.
  - Supports existing run reuse via `--run-dir <selector>` before `<agent>`.
  - Prints interactive handle summary and parsed session key/value when available.
  - Injects all project skill packages from `skills/` by default before process launch.
  - Prints runtime separators before and after the agent runtime zone.
- `npm run resume <handle8> <message>`
  - Continues an interactive run using only handle and follow-up message.
  - Automatically resolves agent/session/flags from interactive handle metadata.
  - Automatically inherits the stored `translate` mode from handle metadata (legacy handles fallback to mode `0`).
  - Internally reuses start flow with `--run-dir <handle8>`.
- `npm run upgrade -- <agent>`
  - Runs fixed upgrade command for exactly one configured agent.
- Backward compatible aliases remain available:
  - `npm run install-agent -- <agent>`
  - `npm run start-agent -- <agent> [args...]`
  - `npm run upgrade-agent -- <agent>`
- `npm run test`
  - Runs automated checks for bootstrap, launch orchestration, config isolation, and fixture-driven parser/translation validation.
  - Always emits a human-readable fixture report at `test/reports/rasp-fixture-report.md`.
- `npm run typecheck`
  - Runs syntax/type guard checks over source, test, bin, and scripts directories.

Fixture parser/translation troubleshooting:
- If fixture tests fail, open `test/reports/rasp-fixture-report.md` first; it includes attempt-level expected/actual state, FCMP assertions, and raw log references.
- If a fixture intentionally changes, update `test/fixtures/expectations/rasp-fcmp-expectations.json` in the same change.
- Parser/protocol-related changes are accepted only when fixture parser/translation tests are green.

## Directory Layout

Managed prefix root defaults to `.managed-prefix/` and contains:

- `bin/`: managed executable resolution root
- `state/`: project-local runtime state
- `logs/`: runtime logs
- `metadata/`: launcher metadata
- `home/`: isolated HOME roots for launched processes
- `runs/`: per-run isolated execution directories and audit artifacts

Default agent config locations (inside isolated `HOME`):
- codex: `.managed-prefix/home/default/.codex`
- gemini: `.managed-prefix/home/default/.gemini`
- iflow: `.managed-prefix/home/default/.iflow`
- opencode: `.managed-prefix/home/default/.opencode`
- xdg config: `.managed-prefix/home/default/.config`

Bundled agent preset files:
- `agents/codex.json`
- `agents/gemini.json`
- `agents/iflow.json`
- `agents/opencode.json`

## Isolation and Diagnostics

- Runtime prepends managed `bin` to `PATH`.
- Runtime exports isolated `XDG_*` roots under `HOME` (`.config`, `.local/state`, `.local/share`).
- Runtime detects host-global path leakage and aborts before spawn when detected.
- Runtime prints diagnostics for effective command and key config roots per agent.
- `start` runs in PTY mode (Linux only) so Agent CLI tools get real terminal semantics.
- PTY runtime depends on `script` and `strace`; startup fails fast when either command is unavailable.

## Run Audit Artifacts

Each `start` invocation creates a dedicated run directory:

- `.managed-prefix/runs/<run-id>/`

The run directory includes audit artifacts under `.audit/`:

- `.audit/meta.<attemptNumber>.json`: launch command, timestamps, exit status/signal, trust registration info
- `.audit/stdin.<attemptNumber>.log`: captured stdin stream
- `.audit/stdout.<attemptNumber>.log`: captured stdout stream
- `.audit/stderr.<attemptNumber>.log`: captured stderr stream
- `.audit/pty-output.<attemptNumber>.log`: raw merged PTY output
- `.audit/pty-timing.<attemptNumber>.log`: PTY timing file generated by `script`
- `.audit/fd-trace.<attemptNumber>.log`: tracer output used for stdout/stderr reconstruction
- `.audit/fs-before.<attemptNumber>.json`: pre-run snapshot
- `.audit/fs-after.<attemptNumber>.json`: post-run snapshot
- `.audit/fs-diff.<attemptNumber>.json`: created/modified/deleted files
- Attempt numbering starts at `1` per run directory and increments by one on each reused-run execution.

Run reuse selector modes (`--run-dir <selector>`):

- Path mode: absolute or relative run directory path.
- Full run id mode: `<timestamp>-<agent>-<suffix8>`.
- Short run id mode: trailing 8-char hex suffix only.
- Short-id ambiguity is rejected: if multiple runs match the same suffix, command fails and requires full run id or path.
- The same 8-char suffix is reported as `Run handle`.

Interactive handle metadata:

- Handle index: `.managed-prefix/metadata/interactive-handles.json`
- Per handle record includes:
  - run directory
  - agent name
  - parsed session key/value (`thread_id` or session id variants)
  - launch args used in last attempt

Minimal resume shortcut:

- `npm run resume <handle8> '<message>'`
- Example:
  - `npm run resume b2ca57f0 'Thanks, that is enough.'`

Translate mode examples:

- Default (`0`, direct PTY):
  - `npm run start -- codex exec --json`
- Parsed structured (`1`):
  - `npm run start -- --translate 1 codex exec --json`
- Translated envelopes (`2`):
  - `npm run start -- --translate=2 codex exec --json`
- Simulated frontend (`3`):
  - `npm run start -- --translate 3 codex exec --json`

Interactive resume examples:

- codex first run:
  - `npm run start -- codex exec --skip-git-repo-check --json --full-auto '$demo-interactive-skill'`
- codex resume:
  - `npm run start -- --run-dir b2ca57f0 codex exec resume --skip-git-repo-check --json --full-auto '019c7f7d-0354-74a3-ad38-3441ca82009c' 'Thanks, that is enough.'`

- gemini first run:
  - `npm run start -- gemini --yolo --model=gemini-3-flash-preview -p 'Please invoke the skill named demo-interactive-skill'`
- gemini resume:
  - `npm run start -- --run-dir bee8c9de gemini --resume=0d35542f-58b4-43a2-bad5-bfc3ed214f6a --yolo --model=gemini-3-flash-preview -p 'Male, Age 38, Engineer'`

- iflow first run:
  - `npm run start -- iflow --yolo --thinking --model=glm-5 -p 'Please invoke the skill named demo-interactive-skill'`
- iflow resume:
  - `npm run start -- --run-dir e52005bc iflow --resume=session-9353ed2b-4655-43d8-b41a-cc7bfe1a97a6 --yolo --thinking --model=glm-5 -p 'Male, Age 38, Engineer'`

- opencode first run:
  - `npm run start -- opencode run --format json --model google/gemini-3.1-pro-preview 'Please invoke the skill named demo-interactive-skill.'`
- opencode resume:
  - `npm run start -- --run-dir b8638d16 opencode run --session=ses_380952571ffeJcq8gVBkarAzXF --format json --model=google/gemini-3.1-pro-preview 'Male, Age 38, Engineer'`

Run-local skill injection (default behavior):

- Source root: `<project-root>/skills/`
- Each subdirectory under `skills/` is copied as one skill package.
- Target root mapping:
  - `codex` -> `<run_dir>/.codex/skills/`
  - `gemini` -> `<run_dir>/.gemini/skills/`
  - `iflow` -> `<run_dir>/.iflow/skills/`
  - `opencode` -> `<run_dir>/.opencode/skills/`
- If `skills/` does not exist, injection is treated as zero packages and start continues.

Run discovery index:

- `.managed-prefix/runs/index.json`

Filesystem diff notes:

- Diff output excludes recorder-generated fixed audit files under `.audit/`.
- Diff is based on pre/post snapshots; transient files created and deleted during a run may not appear.

Replay notes:

- `stdout.<attemptNumber>.log` and `stderr.<attemptNumber>.log` are reconstructed from fd-write traces during PTY execution.
- For advanced TTY behaviors, reconstructed stream boundaries may differ from what users visually observe in a live terminal.
- Reused runs create new attempt-numbered files; earlier attempt files remain unchanged.

Trust registration before start:

- `codex`: appends TOML table block below to `$HOME/.codex/config.toml`
  - `[projects."<run_abs_path>"]`
  - `trust_level = "trusted"`
- `gemini`: writes `"<run_abs_path>": "TRUST_FOLDER"` to `$HOME/.gemini/trustedFolders.json`

Cleanup:

- Run directories are persistent by design for replay.
- Users can remove old run directories manually from `.managed-prefix/runs/`.
- Legacy config paths are not auto-migrated; move old files manually if needed.
