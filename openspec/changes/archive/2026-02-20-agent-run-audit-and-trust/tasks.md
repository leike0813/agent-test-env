## 1. Run Directory Isolation

- [x] 1.1 Add run directory manager that creates unique run ids and per-run directories under managed prefix run storage.
- [x] 1.2 Update start flow to execute agent command with run directory as working directory.
- [x] 1.3 Persist run id and run directory path in command output and run metadata.

## 2. Audit Logging and Replay Artifacts

- [x] 2.1 Add run metadata writer for launch command, timestamps, exit status, and termination details.
- [x] 2.2 Add separated stream capture and persistence for stdin, stdout, and stderr.
- [x] 2.3 Define deterministic run artifact layout and write replay index/discovery metadata.

## 3. Filesystem Change Detection

- [x] 3.1 Implement pre-run filesystem snapshot capture for run scope.
- [x] 3.2 Implement post-run snapshot capture and created/modified/deleted diff computation.
- [x] 3.3 Persist snapshot and diff artifacts in the run directory.
- [x] 3.4 Exclude recorder-generated fixed audit artifact files from filesystem change report outputs.

## 4. Trusted Directory Registration

- [x] 4.1 Implement CodeX trust registration in isolated-home config (`$HOME/.codex/config.toml` by default) using TOML table syntax:
  - `[projects."<run_abs_path>"]`
  - `trust_level = "trusted"`
- [x] 4.2 Implement Gemini trust registration in isolated-home trusted folders (`$HOME/.gemini/trustedFolders.json` by default) using `"<run_abs_path>": "TRUST_FOLDER"` with env override support.
- [x] 4.3 Invoke trust registration conditionally for matching agent types before process launch.
- [x] 4.4 Ensure trust registration is executed immediately after run directory creation/env preparation in start orchestration.

## 5. Validation and Documentation

- [x] 5.1 Add automated tests for run directory creation, metadata persistence, and separated stream logs.
- [x] 5.2 Add automated tests for trust registration mutations and filesystem diff detection outputs, including audit-artifact exclusion assertions.
- [x] 5.3 Update README with audit artifact locations, replay workflow, and manual cleanup guidance.
