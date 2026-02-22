# 前端对话消息协议（FCMP/1.0）

本文档定义前端直接消费的“对话消息协议”。它来自 RASP 事件流的转译结果，目标是屏蔽引擎差异，给 UI 提供稳定接口。

## 1. 协议定位

- 输入：`RASP/1.0` 统一运行事件。
- 输出：`FCMP/1.0` 对话消息事件。
- 前端原则：只消费 FCMP，不直接解析各引擎原始输出。

## 2. 统一消息信封

```json
{
  "protocol_version": "fcmp/1.0",
  "run_id": "20260221T091252-codex-17e67f51",
  "seq": 123,
  "ts": "2026-02-21T12:34:56.789Z",
  "engine": "codex|gemini|iflow|opencode",
  "session_id": "optional",
  "type": "conversation.started|assistant.message.delta|assistant.message.final|user.input.required|conversation.completed|conversation.failed|diagnostic.warning",
  "data": {},
  "meta": {
    "confidence": 1.0,
    "attempt": 1
  },
  "raw_ref": {
    "stdout_from": 0,
    "stdout_to": 0,
    "stderr_from": 0,
    "stderr_to": 0
  }
}
```

## 3. 事件类型与最小字段

## `conversation.started`

```json
{
  "type": "conversation.started",
  "data": {
    "title": "demo-interactive-skill",
    "mode": "interactive|auto|file-write"
  }
}
```

## `assistant.message.delta`

```json
{
  "type": "assistant.message.delta",
  "data": {
    "message_id": "m_001",
    "text_delta": "你好，"
  }
}
```

## `assistant.message.final`

```json
{
  "type": "assistant.message.final",
  "data": {
    "message_id": "m_001",
    "text": "你好！很高兴和你交流。",
    "structured_payload": null
  }
}
```

## `user.input.required`

```json
{
  "type": "user.input.required",
  "data": {
    "interaction_id": "ix_001",
    "kind": "free_text|single_choice|multi_choice|form",
    "prompt": "请问你的年龄段与职业？",
    "options": []
  }
}
```

## `user.input.replied`

```json
{
  "type": "user.input.replied",
  "data": {
    "interaction_id": "ix_001",
    "content": "Male, Age 38, Engineer"
  }
}
```

## `conversation.completed`

```json
{
  "type": "conversation.completed",
  "data": {
    "state": "completed",
    "reason_code": "DONE_MARKER_FOUND|FINAL_STRUCTURED_OUTPUT_SELECTED",
    "skill_done": true
  }
}
```

## `conversation.failed`

```json
{
  "type": "conversation.failed",
  "data": {
    "error": {
      "category": "engine|parser|runtime",
      "code": "RESOURCE_EXHAUSTED",
      "message": "No capacity available for model"
    }
  }
}
```

## `diagnostic.warning`

```json
{
  "type": "diagnostic.warning",
  "data": {
    "code": "PTY_STREAM_MISMATCH|LOW_CONFIDENCE_PARSE",
    "message": "Used PTY fallback because stdout lost agent_message."
  }
}
```

## 4. 协议约束

- `seq` 在同一个 `run_id` 下严格递增。
- `assistant.message.final` 只能对应一个最终文本，不可重复终结同一 `message_id`。
- `conversation.completed` 与 `conversation.failed` 互斥。
- 发现 `session_id` 时必须回填，供恢复会话使用。
- 所有可疑解析都必须发 `diagnostic.warning`，不可静默吞掉。
- `user.input.required` 采用一步硬判：
  - 已检测到 `__SKILL_DONE__`：不得发 `user.input.required`，应发 `conversation.completed`。
  - 未检测到 `__SKILL_DONE__` 且检测到本次调用结束信号：必须发 `user.input.required`。
  - 不做问句语义识别，不引入模型判定。

结束信号定义：
- Codex: `turn.completed`
- Gemini: 单次响应 JSON 完整输出并返回
- iFlow: `</Execution Info>`
- OpenCode: `step_finish` 且 `reason=stop`

## 5. 与 RASP 的关系

- RASP 是“运行域”协议，覆盖 lifecycle/tool/artifact/raw 等。
- FCMP 是“对话域”协议，只保留前端聊天页和交互页需要的稳定消息。
- 转译器对同一条 RASP 事件可产出 0~N 条 FCMP 事件。

## 6. 传输建议

- SSE 事件名：`chat_event`
- Payload：单条 FCMP JSON
- 重连：`cursor=<seq>`
- 同时保留后端 `events.jsonl`（RASP）与前端消费流（FCMP）以便排障。
