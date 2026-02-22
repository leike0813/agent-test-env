# 各 Agent 输出解析与前端转译指南

本文档规定“引擎原始输出 -> RASP -> FCMP”的逐引擎实现规则。

## 1. 总体流程

1. 采集：读取 `.audit/stdout.*.log`、`.audit/stderr.*.log`、`.audit/pty-output.*.log`、`meta.*.json`、`fs-diff.*.json`。
2. 解析：按引擎 parser profile 提取结构化事件。
3. 转译：结构化事件映射到 RASP taxonomy，再映射到 FCMP 对话事件。
4. 分发：SSE 推送，同时写 `events.jsonl` 与 `parser_diagnostics.jsonl`。

## 2. Codex（`codex_ndjson`）

样式特征：
- NDJSON 事件，关键字段：`type`, `item.type`, `thread_id`。
- 已知异常：首轮 `agent_message` 可能在 PTY 有、stdout 无。

解析规则：
- 先解析 `stdout` NDJSON，再补解析 `pty-output` NDJSON。
- 去重键建议：`hash(type + item.id + text + timestamp_approx)`。
- `thread.started` 提取 `thread_id` -> `session_id`。
- `item.completed` 且 `item.type=agent_message` -> 主消息。
- `item.completed` 且 `item.type=reasoning` -> reasoning 摘要。

RASP 映射：
- `thread.started` -> `lifecycle.run.status`
- `item.completed(agent_message)` -> `agent.message.final`
- `item.completed(reasoning)` -> `agent.reasoning.summary`
- 缺失补偿触发 -> `diagnostic.parser.warning` (`PTY_STREAM_MISMATCH`)

FCMP 映射：
- `lifecycle.run.status(thread.started)` -> `conversation.started`
- `agent.message.final` -> `assistant.message.final`
- 检测到 `turn.completed` 且未检测到 `__SKILL_DONE__` -> `user.input.required`

## 3. Gemini（`gemini_json`）

样式特征：
- 主结构化对象通常在 `stderr`，字段包括 `session_id`, `response`, `stats`。
- `stdout` 常有重试与错误噪声（如 429）。

解析规则：
- 优先解析 `stderr` 为完整 JSON 文档。
- 从 `response` 中提取：
  - 纯文本回复
  - fenced JSON（若存在）作为 `structured_payload` 候选
- `stdout` 中失败日志映射 `engine.error`。

RASP 映射：
- `session_id` -> `correlation.session_id`
- `response` -> `agent.message.final`
- `stats` -> `lifecycle.run.status` 或扩展字段
- 429/请求失败 -> `diagnostic.engine.error`

FCMP 映射：
- 首条带 `session_id` 的响应 -> `conversation.started`
- `response` -> `assistant.message.final`
- 检测到本次响应 JSON 已结束且未检测到 `__SKILL_DONE__` -> `user.input.required`
- `engine.error` -> `conversation.failed` 或 `diagnostic.warning`（按严重性）

## 4. iFlow（`iflow_text`）

样式特征：
- 纯文本主导，`stdout`/`stderr` 存在漂移。
- `<Execution Info>...</Execution Info>` 内常有 `session-id` 与 token 统计。

解析规则（三段式）：
1. 正则层：
   - 提取 `session-id`、`Resuming session`、错误关键字。
2. 块解析层：
   - 提取 fenced JSON 或大括号 JSON 段。
   - 提取 `<Execution Info>` JSON 块。
3. 残余文本层：
   - 非结构化正文识别 `agent.message.final`。

置信度建议：
- 正则命中结构字段：`0.7`
- JSON 块可解析：`0.8`
- 非结构化文本：`0.3~0.6`

RASP 映射：
- `session-id` -> `lifecycle.run.status` + `correlation.session_id`
- `<Execution Info>` -> `diagnostic` 或 `lifecycle.run.status`
- 正文 -> `agent.message.final`
- 低置信度 -> `diagnostic.parser.warning` + `raw.*`

FCMP 映射：
- 识别到 `session-id` -> `conversation.started`（若尚未发出）
- 正文 -> `assistant.message.final`
- 检测到 `</Execution Info>` 且未检测到 `__SKILL_DONE__` -> `user.input.required`

## 5. OpenCode（`opencode_ndjson`）

样式特征：
- `stdout` NDJSON 稳定，字段 `type`, `sessionID`, `part`。
- 常见事件：`step_start`, `tool_use`, `text`, `step_finish`。

解析规则：
- 逐行 JSON 解码，失败行进入 `raw.stdout`。
- `sessionID` 写入 `correlation.session_id`。
- `tool_use` 的 `state.status` 生成 tool 生命周期事件。
- `text` 的 `part.text` 生成主消息文本。

RASP 映射：
- `step_start/step_finish` -> `lifecycle.run.status`
- `tool_use` -> `tool.call.started|tool.call.completed|tool.call.failed`
- `text` -> `agent.message.final`

FCMP 映射：
- 首次 `sessionID` -> `conversation.started`
- `text` -> `assistant.message.final`
- 检测到 `step_finish` 且 `reason=stop` 且未检测到 `__SKILL_DONE__` -> `user.input.required`

## 6. Artifact 与文件写入事件

通用规则（四引擎一致）：
- 从 `fs-diff.*.json` 提取 `created/modified/deleted`。
- 将新增业务文件（排除 `.audit`）映射：
  - RASP: `artifact.created`
  - FCMP: 可选 `diagnostic.warning` 或侧边栏事件（聊天主流可不显示）

示例：
- `artifacts/text.md`
- `artifacts/info.json`

## 7. 完成态与失败态转译

完成态优先级：
1. 显式 marker：`"__SKILL_DONE__": true`
2. 引擎“本次调用结束”信号且未命中 marker -> `awaiting_user_input`
3. 中断/失败证据（非零退出码、信号、runtime error）-> `interrupted`
4. `unknown`

结束信号（硬判）：
- Codex: `turn.completed`
- Gemini: 单次响应 JSON 完整输出并返回
- iFlow: `</Execution Info>`
- OpenCode: `step_finish` 且 `reason=stop`

FCMP 终态映射：
- `completed` -> `conversation.completed`
- `interrupted` -> `conversation.failed`
- `awaiting_user_input` -> `user.input.required`
- `unknown` -> `diagnostic.warning`

## 8. 错误与兜底策略

- 任意解析失败行：必须发 `raw.stdout/raw.stderr`。
- 任意分类不确定：必须发 `diagnostic.warning`，附 `confidence`。
- 任意引擎字段漂移：不允许丢数据，只允许降级为 `raw + warning`。

## 9. 最小实现检查清单（P0）

- 能稳定提取 `session_id`（若存在）。
- 能输出 `assistant.message.final`。
- 能识别 `user.input.required`。
- 能输出 `conversation.completed|conversation.failed`。
- 无法解析时保证 `raw` 事件可回放。
