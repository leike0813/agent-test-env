## 1. Repository Setup and Configuration

- [x] 1.1 Add a project-local configuration file for managed prefix location and supported Agent CLI definitions.
- [x] 1.2 Add configuration loading and validation logic for single-agent and multi-agent launch inputs.
- [x] 1.3 Define repository directory conventions for managed prefix runtime, isolated config roots, and launcher metadata.

## 2. Managed Prefix Bootstrap

- [x] 2.1 Implement bootstrap command to create and initialize the managed prefix directory structure.
- [x] 2.2 Implement idempotent bootstrap behavior that reuses existing valid managed prefix state.
- [x] 2.3 Implement executable resolution checks that verify required agent executables exist in managed prefix paths.

## 3. Agent CLI Launch Orchestration

- [x] 3.1 Implement launcher command for starting one configured Agent CLI by name with isolated environment variables.
- [x] 3.2 Implement launcher support for starting multiple configured Agent CLIs in one invocation.
- [x] 3.3 Implement startup status reporting and non-zero failure behavior when any requested agent fails to start.

## 4. Global Config Isolation and Validation

- [x] 4.1 Implement environment wiring that redirects global config lookup/write paths to project-local directories.
- [x] 4.2 Implement pre-launch leakage detection that aborts execution when host-global config paths are detected.
- [x] 4.3 Implement diagnostics output showing effective executable paths and effective config roots per launched agent.

## 5. Verification and Documentation

- [x] 5.1 Add automated checks for first-time bootstrap, idempotent bootstrap, and executable precedence behavior.
- [x] 5.2 Add automated checks for single-agent launch, multi-agent launch, and partial-startup-failure handling.
- [x] 5.3 Add automated checks for config redirection and host-global path leakage detection.
- [x] 5.4 Document bootstrap and launcher usage, expected directory layout, and troubleshooting steps.
