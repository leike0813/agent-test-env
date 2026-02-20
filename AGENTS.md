## 项目目标：

1. 本项目旨在构建一个 Node.js 的由 Managed Prefix 管理的环境。
2. 在该环境中，可以方便地启动一个或者若干个 Agent CLI 工具（如 CodeX、Gemini、iFlow 或 OpenCode）。

在这个环境下运行的这些 Agent CLI 工具，其可执行文件以及所读取的全局配置，应与当前系统环境中的全局可执行文件及全局配置保持隔离。