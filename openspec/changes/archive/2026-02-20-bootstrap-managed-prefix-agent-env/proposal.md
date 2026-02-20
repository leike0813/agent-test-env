## Why

We need a repeatable way to run multiple Agent CLI tools in this repository without leaking into system-level executables or global configuration. We should define this now so implementation can proceed with a clear isolation contract and consistent developer workflow.

## What Changes

- Define how a managed-prefix Node.js environment is created and reused inside the project.
- Define how one or more Agent CLI tools can be started from the isolated environment.
- Define how executable resolution and global configuration paths are isolated from the host system.
- Define baseline validation checks to confirm isolation behavior before implementation is considered complete.

## Capabilities

### New Capabilities

- `managed-prefix-bootstrap`: Create and maintain a project-local managed prefix that provides isolated Node.js executable resolution for agent tooling.
- `agent-cli-orchestration`: Start one or many configured Agent CLI tools from the managed prefix with a consistent invocation interface.
- `global-config-isolation`: Ensure Agent CLI global config reads/writes are redirected to managed-prefix-owned locations, isolated from system global configs.

### Modified Capabilities

- None.

## Impact

- Affects project bootstrap scripts, CLI launch scripts, and environment-variable wiring.
- Introduces dependency on managed-prefix tooling conventions and project-local config directories.
- Establishes behavior contract for executable lookup and config isolation across supported Agent CLIs.
