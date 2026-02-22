# 运行时构建与审计记录实现指南（跨语言复刻）

本文档面向“想在其他语言里实现同等行为”的开发者，定义本项目当前运行时与审计系统的可复刻规范。  
目标是让不同实现产出一致的审计文件与解析输入，从而得到一致的解析/转译结果。

## 1. 目标与范围

本规范覆盖四件事：

1. 运行时如何构建（隔离环境、运行目录、启动顺序）
2. 如何监控运行过程并采集审计数据
3. 如何在真实 PTY 前提下重建并分离 `stdout/stderr`
4. 如何保证输出可被现有解析链路稳定消费

不覆盖：

- Agent 本身提示词工程细节
- 前端协议细节（见其他 `docs/*protocol*` 文档）

## 2. 关键设计原则

1. **真实终端语义优先**：Agent 必须运行在 PTY 中，避免 `stdin is not a terminal`。
2. **审计可回放**：必须保留原始 PTY 输出与输入。
3. **流分离可追溯**：`stdout/stderr` 不靠猜测，靠系统调用跟踪重建。
4. **每次尝试独立落盘**：复用同一 run 目录时，审计文件按 attempt 递增编号。
5. **解析输入稳定**：解析层消费的是固定审计工件集合，而非运行时瞬时状态。

## 3. 目录与工件规范

每次运行对应一个 run 目录：

```text
<managed_prefix>/runs/<run_id>/
  .audit/
    meta.<N>.json
    stdin.<N>.log
    stdout.<N>.log
    stderr.<N>.log
    pty-output.<N>.log
    pty-timing.<N>.log
    fd-trace.<N>.log
    fs-before.<N>.json
    fs-after.<N>.json
    fs-diff.<N>.json
```

说明：

- `<N>` 为 attempt 编号，从 `1` 开始递增。
- `fs-diff` 计算时必须忽略 `.audit` 前缀路径，避免把审计器自身写入当成业务变更。
- `meta.<N>.json` 必须记录本次命令、参数、退出状态、审计文件相对路径、completion 结果等。

## 4. 启动时序（必须遵守）

以下顺序会直接影响可重复性与信任目录生效：

1. 解析命令参数（如 `agent`、`--run-dir`、`--translate`）
2. 解析或创建 run 目录，并确定 attempt 编号
3. 采集 `fs-before.<N>.json` 快照（忽略 `.audit`）
4. 构建隔离环境变量（`HOME`、`XDG_*`、`PATH`）
5. 注入技能包到 run 副本目录（若启用）
6. 注入信任目录（必须在真正启动 Agent 前完成）
7. 启动 PTY 运行时（`script` 包裹 `strace` 包裹 agent 命令）
8. 进程退出后重建 `stdout/stderr`
9. 运行完成判定（done marker / terminal signal / exit code）
10. 采集 `fs-after.<N>.json` 并计算 `fs-diff.<N>.json`
11. 写 `meta.<N>.json` 与索引记录

## 5. 运行时构建：PTY + Trace 双层

为同时满足“真实 TTY”与“流分离审计”，推荐以下链路：

```text
script(PTY recorder)
  -> strace(write fd=1,2 tracer)
    -> agent executable
```

等价命令形态（示意）：

```bash
script -qef \
  --log-in  stdin.<N>.log \
  --log-out pty-output.<N>.log \
  --log-timing pty-timing.<N>.log \
  --command "strace -f -yy -s 65535 -e trace=write -e write=1,2 -o fd-trace.<N>.log -- <agent> <args...>"
```

参数意图：

- `script --log-in`：捕获用户输入（stdin）
- `script --log-out`：捕获 PTY 合并输出（视觉真实）
- `script --log-timing`：记录终端输出时序
- `strace -e write=1,2`：只跟踪写入 fd1/fd2 的调用
- `-yy`：输出 fd 目标信息（便于过滤 `/dev/pts/*`）
- `-s 65535`：避免字符串截断

## 6. stdout/stderr 分离重建算法（核心）

### 6.1 输入

- `fd-trace.<N>.log`（`strace` 输出）

### 6.2 解析规则

1. 逐行匹配 `write(fd, "...", len) = n` 记录
2. 仅保留写向终端伪设备的记录（`destination` 包含 `/dev/pts/`）
3. 解码 C 风格字符串（`\n`、`\r`、`\t`、`\xNN`、八进制、转义引号等）
4. 将 chunk 按 stream 归并：
   - fd=`1` => `stdout`
   - fd=`2` => `stderr`
   - 其他 fd 使用“首次未占用优先”策略归类（与当前实现一致）
5. 依序拼接写入：
   - `stdout.<N>.log`
   - `stderr.<N>.log`

### 6.3 为什么不是直接用 PTY 输出分离

PTY 视角是合并流，天然不区分 `stdout/stderr`。  
只有 syscall 级 trace 能提供确定边界，因此必须重建而非推断。

## 7. 监控与审计记录内容

建议至少记录：

1. 启动上下文
   - run id / run dir / attempt / agent / command / args / cwd
2. 运行结果
   - started / success / exitCode / signal / error
3. 运行时工件路径
   - stdin/stdout/stderr/pty-output/pty-timing/fd-trace/fs-*
4. completion 分析
   - state / reasonCode / needsUserInput / diagnostics
5. 文件系统变化
   - created / modified / deleted（排除 `.audit`）

## 8. 交互模式与非交互模式

实现上通常有两种控制台转发模式：

1. **直通模式**（例如 translate=0）  
   - 运行中将 PTY 子进程输出直接转发到当前终端
2. **抑制并后处理模式**（例如 translate>0）  
   - 运行中不直通
   - 运行后读取审计日志并输出结构化/转译结果

无论哪种模式，审计文件都必须完整写入。

## 9. completion 判定（与解析行为对齐）

推荐按以下优先级判定运行状态：

1. 显式 done signal（如 `AGENT_ENV_DONE {json}`）且 schema 合法
2. 进程非零退出或收到 signal => `interrupted`
3. 命中 `__SKILL_DONE__` marker => `completed`
4. 命中引擎 terminal signal 且未命中 done marker => `awaiting_user_input`
5. 其他 => `unknown`

说明：

- done marker 需兼容 `__SKILL_DONE__` 与历史小写 `__skill_done__`。
- 各引擎 terminal signal 的规则应配置化，但必须可审计复现。

## 10. 跨语言实现最小接口建议

建议抽象以下接口，便于替换语言：

1. `prepareRun(agent, runSelector?) -> { runDir, auditDir, attemptNumber }`
2. `buildIsolatedEnv(baseEnv, managedPaths, agentEnv) -> env`
3. `injectTrustAndSkills(env, runDir, agent)`
4. `runPtyWithTrace(command, args, env, cwd, auditPaths) -> processResult`
5. `reconstructStreams(tracePath, stdoutPath, stderrPath) -> { stdoutChunks, stderrChunks }`
6. `analyzeCompletion(processResult, logs, agent) -> completion`
7. `snapshotFs(runDir, ignoredPrefixes) -> snapshot`
8. `diffFs(before, after) -> { created, modified, deleted }`
9. `writeMeta(metaPath, metadata)`

## 11. 一致性校验清单（用于验收）

1. Agent 在 PTY 中运行，不再出现 `stdin is not a terminal`
2. 每次运行均生成 `meta.<N>.json` 与对应 `<N>` 工件
3. `stdout/stderr` 可由 `fd-trace` 重建，且文件非空（视引擎输出而定）
4. `fs-diff` 中不包含 `.audit` 自身文件
5. 复用 run 时，历史 attempt 文件不被覆盖
6. completion 判定在相同输入下稳定一致
7. 解析层仅依赖审计工件，不依赖运行时临时状态

## 12. 常见问题与处理

1. **没有 `script` 或 `strace`**  
   - 启动前探测，缺失即失败并给出可操作错误。

2. **stdout/stderr 边界与肉眼观察不一致**  
   - 这是 PTY 合并显示与 syscall 分离视角差异，优先以 `fd-trace` 重建结果为准。

3. **交互任务没有显式结束**  
   - 不做语义推断；按硬规则输出 `awaiting_user_input`，由用户决定下一步。

4. **模型输出额外噪声**  
   - 保留 raw 事件用于排障；在转译层做可追踪的去重/抑制，不修改原始审计工件。

## 13. 参考实现锚点（本项目）

可直接对照以下文件验证行为：

- 运行编排：`src/launcher.js`
- PTY+trace 运行器：`src/pty-runtime.js`
- 审计与流重建：`src/audit.js`
- 转译（后处理视图）：`src/translate-output.js`

