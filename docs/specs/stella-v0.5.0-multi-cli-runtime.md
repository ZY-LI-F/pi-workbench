# Stella v0.5.0 · 多 CLI 任务视图与执行后端代码设计

> 状态：实现基线（本文件完成代码设计，不代表功能已经实现）
>
> 目标应用版本：`v0.5.0`
>
> 目标 Board schema：`8`
>
> 外部执行投影协议：`1`

## 1. 结论

v0.5.0 增加两项彼此独立的能力：

1. **外部执行视图**：在看板中只读查看 Claude Code 后台 Agent、Codex CLI / Codex App Server Thread 等外部执行，不把它们冒充为 Stella Task。
2. **多 CLI 执行后端**：创建或编辑自动任务时，除选择 Workflow、Agent、Squad 等“推进方式”外，再选择 Pi、Codex CLI 或 Claude CLI 的“执行环境”。

代码上必须建立两个独立的深 Module：

- `ExternalExecutionCatalog`：负责发现、归一化和刷新外部执行；不参与 Stella Task 的调度和结算。
- `ExecutionBackendRegistry`：负责探测、选择并运行 Stella 自己创建的执行；不复制外部 CLI 的历史列表。

两者共享 `ExecutionBackendId`、`ExecutionSessionReference` 等值对象，但不能共享状态所有权。外部 CLI 是外部执行投影的事实来源；Board Repository 仍是 Stella Task、WorkflowRun、AgentTask 和验收状态的唯一事实来源。

高星项目、官方协议与可借鉴代码路径见[参考研究](../research/stella-v0.5.0-multi-cli-reference-projects.md)。本设计直接依据当前代码中的 `ExecutionTarget`、`AgentTaskRunner`、`WorkflowOrchestrator`、`WorkspaceAdmission`、Board schema v7、IPC 和 Kanban UI 制定。

### 1.1 参考项目如何进入最终设计

- **Multica**：采用“流式消息与单次结构化结果分开”的 Adapter 结果边界；不复制其多租户 daemon 和 20 多种 runtime。
- **Vibe Kanban**：采用 typed Profile、capability 与 Task/session/process 分层；不依赖其已进入 sunset 的 runtime，也不复制脆弱的终端文本 normalizer。
- **Paperclip**：Registry 同时登记 probe、execute、session 和配置能力；不开放 generic process/http Adapter。
- **Orca**：把外部会话扫描作为独立 read model，并对 Codex 使用 app-server；Stella 不扫描私有 transcript。
- **OpenCode**：Provider event → typed reducer → UI projection 三层分开。

参考项目中的 External Session 表、ProcessAttempt 表、heartbeat、worktree manager 和远程控制面都经过取舍；v0.5.0 复用 Stella 已有 AgentTask/StepRun、runtimeToken 和 WorkspaceAdmission，只新增完成本轮功能所需的 Seam。

## 2. 版本规则

- 产品和文档统一使用 `v0.5.0`；JSON 中不保存带 `v` 的展示字符串。
- 当前实现与 package/lockfile 已在发布集成阶段统一升级为 `0.5.0`；此前功能提交保持 `0.4.0`，避免半成品版本漂移。
- Board schema 从 `7` 升到 `8`，它是持久化格式版本，不等于应用版本。
- 内置 Profile 带独立的 `revision`；v0.5.0 首版均为 `1`。历史执行保存 Profile 快照，后续修改 Profile 定义不得追溯改变历史记录。
- Codex 与 Claude 是用户本机安装的外部 CLI，不锁定为 Stella 依赖版本；每次能力探测记录实际 CLI 版本。Pi 仍按现有方式随应用锁定并打包。

## 3. 产品范围

### 3.1 v0.5.0 必须交付

- 查看当前项目或全部项目中的 Claude Code 后台会话。
- 查看 Codex 的 CLI、`exec`、App Server 和 Sub-agent Thread。
- 按来源、项目和归一化状态过滤外部执行。
- 外部卡片显示来源、名称/摘要、工作目录、原始状态、归一化状态、开始/更新时间和父执行关系。
- 从外部卡片创建一个新的 Stella 手工 Task，并保存不可变的来源引用；创建后不与外部状态双向同步。
- 自动 Task 独立选择 `executionTarget` 和 `executionProfileId`。
- 内置 Profile：`pi.rpc`、`codex.exec`、`codex.review`、`claude.print`。
- Pi 保持现有 Agent、Workflow、Squad、Coordinator、Skills 和 session 能力。
- Codex / Claude 支持直接 Agent、普通 Agent Workflow step，以及非 Coordinator 的 Worker mention。
- 后端级能力探测、禁用原因、执行事件、最终输出、session 引用、中止和历史展示。
- v7 → v8 无损迁移，所有既有自动任务和历史执行默认归属 `pi.rpc`。

### 3.2 明确不做

- 不把外部执行列表直接写进 BoardState，也不根据外部 `done` 自动完成 Stella Task。
- 不把 Claude 的全部普通历史会话伪装成任务；v0.5.0 的 Claude 来源以 `claude agents --json` 正式返回的交互中/后台 Agent 为边界。
- 不允许用户在 Task 中保存任意 shell 字符串；v0.5.0 只支持经过定义和测试的内置 Profile。
- UI 中“执行环境”指 Pi/Codex/Claude 的 Profile，不是任意环境变量编辑器；v0.5.0 不把 Task 变成 shell launcher。
- 不把 Claude `--bg` 作为受管执行 Profile。它可被外部视图发现，但当前 CLI 没有适合 Runner 可靠取得最终产物并结算 AgentTask 的稳定机器契约。
- 不让 Codex / Claude 执行 Squad、LEAD、Coordinator 或 `coordinator-review`；这些路径依赖 Pi 的终止型 `coordinator_action` 结果。
- 不借多后端之机改变 AgentTaskRunner 的并发度或 Workflow 调度策略；v0.5.0 先保持现有队列语义，多个外部活动只影响观察视图。
- 不在受管 Codex/Claude Profile 中实现中途审批或问答回传；这些 Profile 必须非交互完成，外部 Source 仍可只读显示其他 CLI session 的 waiting 状态。
- 不统一 Pi、Codex、Claude 的压缩命令。现有 Pi session 压缩语义和 v0.4.0 修复保持不变。
- 不捆绑 Codex 或 Claude CLI，不替用户安装、不管理登录和升级。
- 不要求用户额外安装 ACP bridge。`ExecutionBackend` 保留未来增加 `AcpExecutionAdapter` 的 Seam，但 v0.5.0 对 Codex/Claude 直接使用各自官方机器接口，减少一层版本和 session 身份转换。
- 不解析 `~/.claude`、`~/.codex` 内部私有文件；优先使用 `claude agents --json` 和 Codex App Server 的公开协议。
- 不在 v0.5.0 引入远程队列、云端同步、任意 MCP 编排或第三方 CLI 插件市场。

## 4. 领域词汇与不变量

### 4.1 新词汇

- **Execution Target**：Task 要由手工、Workflow、Agent 还是 Squad 推进。它回答“由谁、按什么组织方式推进”。
- **Execution Backend**：实际拥有进程协议的执行实现，例如 Pi RPC、Codex CLI、Claude CLI。
- **Execution Profile**：用户可选、带版本的内置命令配置，例如 `codex.exec`。它把产品名称、命令模式、支持能力和 Adapter 绑定起来。
- **Execution Session Reference**：后端中可继续或定位的一次 session/thread 的规范化引用。
- **External Execution Source**：读取某个外部 CLI 执行列表的 Adapter。
- **External Execution Projection**：外部执行的只读规范化卡片。它不是 Task、AgentTask 或 WorkflowRun。

### 4.2 必须始终成立的不变量

1. 手工 Task 的 `executionProfileId` 必须为空；自动 Task 必须有 Profile。
2. Profile 必须支持 Task 的 Target，才允许保存、分发、Autopilot 触发或 mention 分发。
3. Task 保存 Profile ID；根执行保存 Profile 快照；子 AgentTask 继承根快照。
4. Runtime 的每个持久化结果仍必须同时匹配执行 ID 与 `runtimeToken`。
5. 写工作区的 Pi、Codex、Claude 执行共用同一个 `WorkspaceAdmission`；不能各自绕开租约。
6. External Projection 永远只读。只有“导入为 Stella Task”会创建新的 Board 实体。
7. 外部刷新失败不能清空其他来源，也不能用较旧响应覆盖较新快照。
8. Adapter 只能通过归一化事件与 Runner 通信；Pi/Codex/Claude 原始事件不能进入 Board Service。
9. 一个后端不可用只禁用对应 Profile 和来源；不得让 Task/Kanban 或其他后端一起失败。
10. 外部执行的 `finished` 只描述外部 CLI 已结束，不等于 Stella 的 `completed` 或“验收通过”。
11. 同一 Codex/Claude session 同时出现在 Board 历史与外部来源时，用派生关联去重；不能创建第二份状态所有权。

## 5. 总体架构

```text
Renderer
├── Stella Task plane
│   ├── TaskEditor: ExecutionTarget + ExecutionProfile
│   ├── TaskCard / TaskDetail / Timeline
│   └── useKanban (持久化 Board snapshot)
│          │ IPC
│          ▼
│   BoardService / AgentTaskService / WorkflowOrchestrator
│          │ ExecutionRequest
│          ▼
│   ExecutionBackendRegistry ── Interface: ExecutionBackend
│          ├── PiRpcExecutionAdapter
│          ├── CodexExecExecutionAdapter
│          ├── ClaudePrintExecutionAdapter
│          └── FakeExecutionAdapter (tests)
│
└── External activity plane
    ├── ExternalActivityBoard / ExternalExecutionCard
    └── useExternalExecutions (短期 snapshot)
           │ IPC
           ▼
    ExternalExecutionCatalog ── Interface: ExternalExecutionSource
           ├── ClaudeAgentSourceAdapter
           ├── CodexThreadSourceAdapter
           └── FakeExternalExecutionSource (tests)

BoardStore: Task / Run / AgentTask 的唯一持久化事实源
CLI protocols: 外部执行状态的唯一事实源
```

这个设计有两个有意保留的 Seam：`ExecutionBackend` 和 `ExternalExecutionSource`。每个 Seam 都至少有两个真实 Implementation 和一个测试 Implementation，能让 Runner、刷新逻辑与协议解析分别演进。

## 6. Shared 类型设计

### 6.1 执行 Profile

新增 `src/shared/execution-profile.ts`：

```ts
export const EXECUTION_BACKEND_IDS = ["pi", "codex", "claude"] as const;
export type ExecutionBackendId = (typeof EXECUTION_BACKEND_IDS)[number];

export const BUILTIN_EXECUTION_PROFILE_IDS = [
  "pi.rpc",
  "codex.exec",
  "codex.review",
  "claude.print",
] as const;
export type ExecutionProfileId = (typeof BUILTIN_EXECUTION_PROFILE_IDS)[number];

export type ExecutionCapability =
  | "direct-agent"
  | "workflow-step"
  | "worker-mention"
  | "coordinator"
  | "squad"
  | "required-skills"
  | "structured-result"
  | "open-session";

export interface ExecutionProfileDefinition {
  readonly id: ExecutionProfileId;
  readonly revision: number;
  readonly backendId: ExecutionBackendId;
  readonly label: string;
  readonly description: string;
  readonly commandMode: "rpc" | "exec" | "review" | "print";
  readonly capabilities: readonly ExecutionCapability[];
  readonly constraints?: {
    readonly requiresGitRepository?: boolean;
    readonly agentWorkspaceAccess?: readonly WorkspaceAccess[];
  };
  readonly defaultForBackend: boolean;
}

export interface ExecutionProfileSnapshot {
  readonly id: ExecutionProfileId;
  readonly revision: number;
  readonly backendId: ExecutionBackendId;
  readonly label: string;
  readonly commandMode: ExecutionProfileDefinition["commandMode"];
  readonly capabilities: readonly ExecutionCapability[];
  readonly constraints?: ExecutionProfileDefinition["constraints"];
}

export interface ExecutionBackendHealth {
  readonly backendId: ExecutionBackendId;
  readonly state: "checking" | "ready" | "unavailable" | "error";
  readonly version?: string;
  readonly authState?: "ready" | "required" | "unknown";
  readonly executableSource?: "bundled" | "path" | "auto";
  readonly error?: string;
  readonly updatedAt: string;
}

export interface ExecutionProfileAvailability {
  readonly profile: ExecutionProfileDefinition;
  readonly available: boolean;
  readonly reason?: string;
}
```

`ExecutionProfileCatalog` 是纯 Shared Module，持有内置定义、按 `(id, revision)` 解析的不可变历史定义、快照函数和兼容性判断。Renderer 和 Main 使用同一个 `profileSupports(profile, useCase)`，但 Main 必须再次校验，不能信任 Renderer 的过滤结果。Registry 不得用同 ID 的新 revision 偷换已经排队的旧快照。

### 6.2 Session 引用

新增 `src/shared/execution-session.ts`：

```ts
export interface ExecutionSessionReference {
  readonly backendId: ExecutionBackendId;
  /** Adapter 可稳定恢复的 session/thread ID。 */
  readonly sessionId?: string;
  /** 仅在后端公开稳定本地路径时存在；不作为跨后端主键。 */
  readonly sessionPath?: string;
}

export function hasExecutionSessionIdentity(
  value: ExecutionSessionReference,
): boolean;
```

至少 `sessionId` 或 `sessionPath` 有一个非空值。Pi 可同时保存两者；Codex 保存 Thread ID；Claude 保存 session ID。Renderer 不自行拼接 resume 命令，所有打开/继续动作交给对应 Adapter。

### 6.3 外部执行投影

新增 `src/shared/external-execution.ts`：

```ts
export const EXTERNAL_EXECUTION_SOURCE_IDS = ["claude", "codex"] as const;
export type ExternalExecutionSourceId =
  (typeof EXTERNAL_EXECUTION_SOURCE_IDS)[number];

export type ExternalExecutionState =
  | "running"
  | "waiting"
  | "idle"
  | "finished"
  | "failed"
  | "stopped"
  | "unknown";

export type ExternalProcessState = "running" | "exited" | "unknown";

export interface ExternalExecutionProjection {
  readonly sourceId: ExternalExecutionSourceId;
  readonly externalId: string;
  readonly parentExternalId?: string;
  readonly kind: "session" | "background-agent" | "sub-agent";
  readonly title: string;
  readonly summary?: string;
  readonly projectPath: string;
  readonly providerState: string;
  readonly processState?: ExternalProcessState;
  readonly state: ExternalExecutionState;
  readonly waitingReason?: string;
  readonly sourceKind?: string;
  readonly session?: ExecutionSessionReference;
  readonly startedAt?: string;
  readonly updatedAt: string;
}

export interface ExternalExecutionSourceSnapshot {
  readonly sourceId: ExternalExecutionSourceId;
  readonly state: "ready" | "unavailable" | "error";
  readonly stale: boolean;
  readonly error?: string;
  readonly refreshedAt: string;
  readonly items: readonly ExternalExecutionProjection[];
}

export interface ExternalExecutionSnapshot {
  readonly epoch: number;
  readonly scope: { readonly projectPath?: string };
  readonly sources: readonly ExternalExecutionSourceSnapshot[];
}

export interface ExternalExecutionOrigin {
  readonly sourceId: ExternalExecutionSourceId;
  readonly externalId: string;
  readonly session?: ExecutionSessionReference;
  readonly projectPath: string;
  readonly importedAt: string;
}
```

`externalId` 只在 `sourceId` 内唯一；全局 React key 使用 `${sourceId}:${externalId}`。`projectPath` 必须经过现有路径规范化逻辑后再参与过滤。

新增纯函数 `associateExternalExecutions(snapshot, board)`，按 `backendId + sessionId` 以及 `externalOrigin` 生成临时关联：

```ts
interface ExternalExecutionAssociation {
  readonly projection: ExternalExecutionProjection;
  readonly managedBy?: {
    readonly taskId: string;
    readonly kind: "agent-task" | "workflow-step";
    readonly executionId: string;
  };
  readonly importedTaskId?: string;
}
```

这个关联不回写 External Projection 或 Board，只用于链接、徽标和“全部”视图去重。

## 7. ExecutionBackend Module

### 7.1 Interface

新增 `src/main/execution-backend.ts`：

```ts
export interface ExecutionRequest {
  readonly executionId: string;
  readonly runtimeToken: string;
  readonly profile: ExecutionProfileSnapshot;
  readonly cwd: string;
  readonly trusted: boolean;
  readonly sessionName: string;
  readonly prompt: string;
  readonly agent: AgentDefinition;
  readonly expectedResult: "report" | "coordinator-action";
}

export type ExecutionEvent =
  | { readonly type: "session"; readonly session: ExecutionSessionReference }
  | { readonly type: "assistant-output"; readonly text: string }
  | { readonly type: "tool-start"; readonly name: string; readonly detail?: string }
  | { readonly type: "tool-end"; readonly name: string; readonly failed: boolean }
  | { readonly type: "stderr"; readonly message: string };

export interface ExecutionUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cost?: number;
}

export type ExecutionFinalResult =
  | { readonly kind: "report"; readonly output: string }
  | { readonly kind: "coordinator-action"; readonly action: CoordinatorAction };

export interface ExecutionOutcome {
  readonly result: ExecutionFinalResult;
  readonly session?: ExecutionSessionReference;
  readonly usage?: ExecutionUsage;
  readonly backendVersion?: string;
}

export interface OpenExecutionSessionResult {
  readonly kind: "interactive-pi" | "command-copied" | "opened-external";
  readonly runtime?: RuntimeBootstrap;
  readonly message?: string;
}

export interface ExecutionBackend {
  readonly backendId: ExecutionBackendId;
  probe(configuration: ExecutionBackendConfiguration): Promise<ExecutionBackendHealth>;
  run(
    request: ExecutionRequest,
    emit: (event: ExecutionEvent) => void,
    signal: AbortSignal,
  ): Promise<ExecutionOutcome>;
  openSession(session: ExecutionSessionReference): Promise<OpenExecutionSessionResult>;
}
```

`run()` 是核心深 Interface：Adapter 自己处理进程启动、argv、JSON/JSONL、session 捕获、最终消息、用量、退出码和中止竞争。Runner 不再发送 Pi RPC 命令，也不认识 Codex `thread.started` 或 Claude `result` 事件。

`ExecutionBackendRegistry` 提供：

```ts
interface ExecutionBackendRegistry {
  initialize(): Promise<ExecutionBackendCatalogSnapshot>;
  refresh(backendId?: ExecutionBackendId): Promise<ExecutionBackendCatalogSnapshot>;
  resolve(profileId: ExecutionProfileId): ResolvedExecutionBackend;
  assertCompatible(profileId: ExecutionProfileId, useCase: ExecutionUseCase): void;
}
```

Registry 只选择 Profile 和 Adapter；不拥有 AgentTask 状态机。AgentTask 的排队、认领、token、租约、结算仍由现有 Service 和 Runner 负责。

### 7.2 公共子进程 Adapter

新增内部实现 `src/main/cli-process.ts`：

```ts
interface CliProcessRequest {
  readonly executable: string;
  readonly prefixArgv?: readonly string[];
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly stdin?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly stdout: "json" | "jsonl" | "text";
  readonly maxLineBytes: number;
}

interface CliProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdoutTail: string;
  readonly stderrTail: string;
}
```

- 必须用 `spawn(executable, argv, { shell: false })`；Profile 生成 argv 数组，不生成 shell 命令。
- `ExecutableResolver` 返回 `{ executable, prefixArgv, displayPath }`。POSIX 直接运行二进制；Windows 优先解析 `.exe`，若只发现 npm `.cmd`，在配置探测阶段解析为固定的 `node.exe + CLI entrypoint`，无法可靠解析时标记不可用，不在运行时退回任意 shell 字符串。
- 标准输出按行增量解码，处理跨 chunk 的 UTF-8 和最后一行无换行情况。
- stderr 独立限长并通过归一化事件展示；不能混入 JSONL parser。
- 每次运行创建并持有独立进程组：Unix 使用独立 process group，Windows 使用可终止整棵子进程树的 Job Object/等价封装。abort 按“中断 → 终止 → 强制结束”的有界宽限期处理，不能只杀 CLI 父进程后留下工具子进程。
- `AbortSignal` 只能终止本次 Adapter 持有的精确进程组。正常退出和 abort 竞争必须只 settle 一次，旧 runtimeToken 也不得碰触新进程组。
- 输出事件可在内存中高频更新，但 Board 只持久化 session、最后输出、用量和终态；工具流事件继续作为短期 BridgeEvent。
- 单行、stderr tail 和最终输出都设显式上限，超过后保留头尾及截断标记，避免 CLI 输出拖垮主进程。
- Adapter 识别到审批或用户输入请求时立即结束本次受管执行并返回可操作错误；不能无限等待并占有 WorkspaceAdmission lease。后续若支持交互，必须单独增加可恢复的输入协议和 AgentTask 状态，不复用外部投影的 `waiting`。

`CliProcess` 只负责 transport；每个 Adapter 内部再使用无 I/O 的 `ProtocolReducer` 把一条机器事件累积为 session、活动、usage 和终止结果。Reducer 使用匿名化 fixture 单测，CLI 协议字段变化不会迫使 Runner 或子进程管理代码一起修改。

### 7.3 PiRpcExecutionAdapter

文件：`src/main/execution-adapters/pi-rpc-execution-adapter.ts`。

- 包装现有 `PiRpcRuntime`、`assertRequiredAgentSkills`、`finalAssistantResult` 和 `coordinatorActionResult`。
- 把 `AgentDefinition` 的 provider/model、thinking、allowedTools、requiredSkills 与 disable flags 原样映射到现有 Pi start options。
- `expectedResult === "coordinator-action"` 时启用现有 Coordinator extension，且只接受结构化工具结果。
- `get_state` 映射为 `ExecutionSessionReference`，`get_session_stats` 映射为 `ExecutionUsage`。
- `openSession` 复用当前交互式 Pi project/session 切换事务并返回 `RuntimeBootstrap`。

第一阶段重构必须让所有现有 Pi 测试保持语义不变；只有 Pi Adapter 完成等价替换后，才允许接入外部后端。

### 7.4 CodexExecExecutionAdapter

文件：`src/main/execution-adapters/codex-exec-execution-adapter.ts`。

`codex.exec` argv 基线：

```text
codex exec --json --cd <cwd> --model <optional-model> -
```

- prompt 通过 stdin 传入，不放进 argv。
- 只接受 Profile Catalog 生成的固定参数；用户级 Codex 配置仍由 Codex 自己加载。
- `workspaceAccess=read` 映射 `--sandbox read-only`；`write` 映射 `--sandbox workspace-write --approve-for-me`。审批策略使用可非交互完成的受测固定配置，不从 Task 接收任意 `-c`。
- `thread.started` 保存 Thread ID；`item.*` 归一化为工具与输出事件；`turn.completed` 的最终 Agent message 生成 `report`；非零退出、`turn.failed` 和无终止结果分别明确失败。
- Agent 的职责和 instructions 作为 Stella 生成的 prompt 前言；Pi 专用的 extension/skill/context flags 不透传。
- 带 `requiredSkills` 的 Agent 在 v0.5.0 对 Codex Profile 标记为不兼容，不能静默跳过 Skill 预检。
- `openSession` 生成并复制 `codex resume <thread-id>`，同时打开 Stella 命令抽屉；v0.5.0 不自动启动交互式 TTY。

`codex.review` 复用同一 Adapter，但 argv 改为：

```text
codex exec review --json --uncommitted -
```

该 Profile 只支持 Git 项目中 `workspaceAccess: "read"` 的直接 Agent；不支持写入 Agent、Workflow、mention、Squad 或 Autopilot。后续可单独设计 base/commit 选择，不在 v0.5.0 用自由文本 flags 代替。

### 7.5 ClaudePrintExecutionAdapter

文件：`src/main/execution-adapters/claude-print-execution-adapter.ts`。

argv 基线：

```text
claude -p --verbose --input-format text --output-format stream-json \
  --name <session-name> --effort <mapped-effort> [--model <model>]
```

- prompt 通过 stdin 传入。
- `workspaceAccess=read` 使用 `--permission-mode plan` 并在 prompt 中明确只读；`write` 使用 `--permission-mode dontAsk` 与已映射的 `--allowedTools`，让未获许可的工具明确失败而不是等待 TTY。最终精确参数必须由本机 CLI smoke 固化，不能在单元测试中猜测。
- `allowedTools` 通过一张显式、受测试的 Pi 意图到 Claude tool 名映射表转换；无法映射的 tool 记录 Profile compatibility warning，不把原字符串直接透传。
- `result`/assistant stream 生成最终 `report`；session ID、用量和 cost 从机器事件映射到统一结果。
- 带 Pi `requiredSkills` 的 Agent 对 Claude Profile 不兼容。
- `openSession` 复制 `claude --resume <session-id>` 并打开命令抽屉。
- `--bg` 只属于 `ClaudeAgentSourceAdapter` 可发现范围，不属于本 Adapter。

### 7.6 Profile 能力矩阵

| Profile | 直接 Agent | Workflow step | Worker mention | Squad / LEAD | requiredSkills | Session |
|---|---:|---:|---:|---:|---:|---:|
| `pi.rpc` | 是 | 是 | 是 | 是 | 是 | 在 Pi 中打开 |
| `codex.exec` | 是 | 是 | 是 | 否 | 否 | 复制 `codex resume` |
| `codex.review` | 是 | 否 | 否 | 否 | 否 | 复制 `codex resume` |
| `claude.print` | 是 | 是 | 是 | 否 | 否 | 复制 `claude --resume` |

当用户切换推进方式时，Renderer 过滤可用 Profile：

- `manual`：隐藏环境选择。
- `agent`：显示全部健康且兼容的 Profile。
- `workflow`：显示 `pi.rpc`、`codex.exec`、`claude.print`，但只要流程任一步 Agent 有 `requiredSkills`，只显示 `pi.rpc`。
- `squad`：只显示 `pi.rpc`，不可编辑。

Main 在创建、更新、分发和每个 Workflow step 启动前重复同一判断。已有任务因 CLI 消失而不可分发时，任务本身仍可读取和改回其他 Profile。

### 7.7 模型与 Agent 配置映射

v0.5.0 不把当前全局 Pi 模型错误地传给其他 CLI，也不增加自由格式命令参数：

- `pi.rpc` 继续使用 `agent.provider/model > 当前全局 Pi 模型` 的既有优先级。
- `codex.*` 只有在 Agent 的 provider 未指定或明确为 OpenAI 时才传 `agent.model`；否则使用 Codex CLI 自己的默认模型。
- `claude.print` 只有在 Agent 的 provider 未指定或明确为 Anthropic 时才传 `agent.model`；否则使用 Claude CLI 自己的默认模型。
- Pi thinking 继续精确映射；Claude 使用 CLI 公布的 effort 枚举；Codex 只映射已由本机版本 schema/帮助确认的 reasoning effort，无法映射时使用 CLI 默认并在执行详情显示。
- `disableExtensions`、`disableSkills`、`disablePromptTemplates`、`disableContextFiles` 是现有 Pi Runtime policy，外部 Adapter 不假装已经执行这些 Pi 开关。Codex/Claude 按各自原生项目指令与配置运行，Profile 详情必须明确显示这一点。
- `requiredSkills` 是硬兼容条件；没有对应可靠预检的外部 Profile 直接不可选。普通 `allowedTools` 通过显式映射表尽可能转换，并以 `workspaceAccess` 作为跨后端的稳定读/写意图。

后续若要让用户维护 backend-specific model、tool 和 context policy，应单独版本化 Agent Definition；v0.5.0 不在旧字段上追加不受约束的 `Record<string, unknown>`。

## 8. ExternalExecutionCatalog Module

### 8.1 Interface

新增 `src/main/external-execution-source.ts`：

```ts
export interface ExternalExecutionScope {
  readonly projectPath?: string;
}

export interface ExternalExecutionSource {
  readonly sourceId: ExternalExecutionSourceId;
  inspect(scope: ExternalExecutionScope): Promise<readonly ExternalExecutionProjection[]>;
}
```

`ExternalExecutionCatalog` 负责并发刷新各 Source、保存每个 Source 的最后成功内存快照、递增 epoch、合并错误和发 BridgeEvent。Source 只负责一个协议，不关心 UI 筛选和 Board。

刷新规则：

- 打开 Kanban 外部视图立即刷新。
- 窗口可见且外部视图激活时，每 10 秒请求一次；隐藏或切回纯 Stella Task 时暂停。
- 同一 scope 的并发 refresh 复用一个 Promise；`force=true` 才绕过 5 秒最小间隔。
- 每个 Source 8 秒超时且独立结算。一个来源失败时保留其最后成功 items，标 `stale: true`；另一个来源照常更新。
- Main 和 Renderer 都按 epoch 丢弃旧快照；不能让较慢的“全部项目”响应覆盖更新的“当前项目”视图。
- 关闭应用时停止 Codex App Server 子进程并取消所有 inspect。

### 8.2 ClaudeAgentSourceAdapter

文件：`src/main/external-execution-sources/claude-agent-source-adapter.ts`。

命令：

```text
claude agents --json --all [--cwd <projectPath>]
```

只解析官方 JSON 数组。字段缺失时保留卡片并降级到 `unknown`，单个坏项不得丢弃整个来源。

| Claude 原始 state | Stella 外部状态 |
|---|---|
| `working` | `running` |
| `blocked` | `waiting`，`waitingFor` → `waitingReason` |
| `done` | `finished` |
| `failed` | `failed` |
| `stopped` | `stopped` |
| 其他/缺失 | `unknown` |

`id` 是 externalId，`sessionId` 进入 Session Reference，`cwd` 是 projectPath，`name` 或摘要生成 title。不要读取 `~/.claude` 内部 state 文件补字段。

Claude JSON 若提供 `pid/status`，只映射到 `processState`；进程已退出但会话仍可恢复时，卡片保留 provider state 和 session action，不能仅凭 PID 消失改成 `finished` 或删除。

### 8.3 CodexThreadSourceAdapter

文件：`src/main/external-execution-sources/codex-thread-source-adapter.ts`，底层使用 `src/main/codex-app-server-client.ts`。

- 启动 `codex app-server --listen stdio://`，按官方 JSON-RPC/JSONL 流程 initialize。
- 使用当前安装版本生成的协议类型/fixture 校验 `thread/list` 响应；分页读取直到 `nextCursor=null` 或达到 500 条 UI 上限。
- `thread/list` 按 cwd 过滤；默认接受 `cli`、`exec`、`appServer`、`vscode` 和 Sub-agent source，UI 可再按 sourceKind 过滤。
- `id` 是 externalId；`parentThreadId` 是父关系；规范化 `ExecutionSessionReference.sessionId` 使用可恢复的 Thread ID。Codex 的 session-tree `sessionId` 只放在按需详情中，不作为 Stella 的打开或关联主键。
- 列表不为每项调用 `thread/read`。用户打开详情时，才按需请求 `thread/read(includeTurns=true)`，并缓存 30 秒。
- 订阅 `thread/status/changed` 更新已存在卡片；定时 `thread/list` 负责发现新增/消失项。

状态映射：

| Codex Thread status | Stella 外部状态 |
|---|---|
| `active` + `waitingOnApproval` / `waitingOnUserInput` | `waiting` |
| `active` | `running` |
| `idle` | `idle` |
| `notLoaded` | `idle` |
| `systemError` | `failed` |

详情中的最后 Turn 可细化：`completed → finished`、`interrupted → stopped`、`failed → failed`、`inProgress → running`。列表级 `idle` 不能直接声称任务已经完成。

### 8.4 导入为 Stella Task

新增 IPC `externalExecutionImport`，输入只包含 Source ID、externalId 和用户可编辑的 Task 字段；Main 必须从当前 Catalog snapshot 重新解析外部项，不能接受 Renderer 自带的 projectPath/session。

导入结果：

- 创建 `stage: "planned"`、`executionTarget: { kind: "manual" }` 的新 Task。
- title/description 是外部快照的可编辑副本。
- 保存 `externalOrigin`，用于详情中的来源标签和“打开原会话”。
- projectName 从规范化 cwd 的 basename 推导；trust 从 StateStore 的已知项目记录解析，未知项目以 `trusted: false` 导入，必须先打开项目才能执行。
- 不复制外部日志、Turn、成本或动态状态到 Board。
- 重复导入同一个来源时提示已有关联 Task，但允许用户明确“仍然创建副本”。v0.5.0 不建立持续同步。

## 9. Board schema v8

### 9.1 字段变化

`KanbanTask`：

```ts
interface KanbanTask {
  // existing fields...
  readonly executionProfileId?: ExecutionProfileId;
  readonly sourceSession?: ExecutionSessionReference;
  readonly externalOrigin?: ExternalExecutionOrigin;
}
```

- 删除 v8 类型中的 `sourcePiSessionPath` / `sourcePiSessionId`，迁移到 `sourceSession`。
- manual Task 没有 Profile；自动 Task 必须有。

`TaskSpecSnapshot` 增加 `executionProfileId?: ExecutionProfileId`。它保存用户选择，不保存可变环境状态。

`AgentTask` 与 `WorkflowRun` 都增加 Profile 快照；实际 CLI 版本保存在每次真正启动的执行节点：

```ts
readonly executionProfile: ExecutionProfileSnapshot;
// AgentTask only:
readonly backendVersion?: string;
```

`StepRun` 增加 `backendVersion?: string`。Workflow 跨人工关卡期间 CLI 可能升级，因此不能只在 WorkflowRun 根上保存一个实际版本。

`AgentTask`、`StepRun`、`AgentArtifact` 的 `sessionPath?: string` 替换为：

```ts
readonly session?: ExecutionSessionReference;
```

`Autopilot` 增加必填 `executionProfileId`。Autopilot 创建 Task 时原样复制；执行前再次检查能力，失败写明确 `AutopilotRun.error`，不降级到 Pi。

### 9.2 v7 → v8 迁移

新增 `BOARD_SCHEMA_V7 = 7`，`BOARD_SCHEMA_VERSION = 8` 和 `migrateBoardStateV7()`：

1. 所有自动 `KanbanTask`、`Autopilot` 加 `executionProfileId: "pi.rpc"`；manual Task 不加。
2. `TaskSpecSnapshot` 按同一规则加 Profile ID。
3. 所有 `AgentTask`、`WorkflowRun` 加 `pi.rpc` revision 1 快照；既有执行没有可靠 CLI 版本时保持 `backendVersion` 缺失，不伪造当前版本。
4. `sourcePiSessionId/sourcePiSessionPath` 迁入 `sourceSession` 后删除旧 key。
5. AgentTask、StepRun、Artifact 的 `sessionPath` 迁入 `session: { backendId: "pi", sessionPath }`。
6. 不改变 Task stage、specRevision、executionAttempt、runtimeToken、验收引用或历史时间。
7. 迁移完成后使用 v8 parser 进行全量引用和不变量校验，再由 BoardStore 原子写回。

必须增加 fixture 验证迁移是幂等的；v8 文件再次读取不得发生第二次重写。

### 9.3 Parser 新校验

- manual/automated 与 Profile 存在性一致。
- Profile ID 属于 v0.5.0 内置目录。
- AgentTask / WorkflowRun 的 snapshot backend 与 profile ID 匹配。
- 子 AgentTask 与根执行使用同一 Profile snapshot。
- Session Reference 至少有 ID 或 path，且 backend 与执行 snapshot 一致。
- `externalOrigin` 的来源、外部 ID、项目路径和 importedAt 有效。
- `codex.review` 不得出现在 WorkflowRun、Autopilot 或子 AgentTask 中。

## 10. Runner 与 Service 重构

### 10.1 AgentTaskRunner

移除 `AgentTaskRuntime` / `AgentTaskRuntimeFactory` 这个 Pi 专用 Interface，注入 `ExecutionBackendRegistry`。

启动流程：

1. `AgentTaskService.nextQueued()` 选择任务。
2. 用执行记录保存的 Profile snapshot 做兼容性校验。
3. 进行现有 workspace policy 和 project trust/path 解析。
4. 只有 Pi Profile 执行 Pi requiredSkills preflight；非 Pi 且 Agent 需要这些 Skills 时在创建执行前拒绝。
5. 获取共享 `WorkspaceAdmission` lease。
6. Registry resolve 当前可用 Adapter 和已探测版本；`claim()` 同时写 runtimeToken 与 backendVersion，保证启动后立即失败的记录也能说明实际运行环境。
7. 以 AbortController 调用 `backend.run()`。
8. 每个事件处理前比较当前 active execution ID 和 token。
9. `ExecutionOutcome.report` 调用现有 `service.complete()`；Coordinator action 只走现有结构化协调分支。
10. abort/shutdown 触发 signal，并等待 Adapter settle；最后释放 lease。

Adapter Promise reject 的分类：

- 用户中止或 shutdown → `interrupted`。
- CLI 明确失败、退出码非零、协议错误 → `failed`。
- 声称成功但缺少必需终止结果 → `protocol-invalid`。
- 旧 token 的迟到结果 → 忽略，不停止新 Runtime。

### 10.2 WorkflowOrchestrator

- `WorkflowRuntimeFactory` 替换为 Registry。
- WorkflowRun 在 dispatch 时冻结 Profile snapshot；每个 Agent step 使用同一 snapshot。
- human gate 不调用后端。
- 每个 step 保留独立 AbortController、runtimeToken、session 和 lease；进入 running 时把 Registry 当前 backendVersion 与 token 原子写入 StepRun。
- Artifact 从统一 outcome 生成；后续 step prompt 继续读取已持久化 Artifact，不读取 Adapter 内存。
- `codex.review` 在 dispatch 前被拒绝；外部后端不支持 Coordinator 类型结果。

### 10.3 AgentTaskService 与评论分发

- `dispatchDirect`、普通 Worker mention、普通 delegated Worker 接受并继承 Profile snapshot。
- `dispatchSquad`、`launchTeamTask`、`@LEAD` 和 Coordinator review 强制 `pi.rpc`；如果 Task 选了其他 Profile，应在用户操作前明确提示需要改为 Pi，不做隐式切换。
- `snapshotTaskSpec` 记录 Profile ID。
- Profile 改变属于 Task 规格变化，必须递增 `specRevision`。
- 对正在执行或待验收的旧执行，编辑 Task Profile 不改变历史快照。

### 10.4 WorkspaceAdmission

沿用现有一个前台/后台写租约模型。owner label 增加 Profile，例如：

```text
AgentTask · BUILD · Codex CLI
Workflow · 验证 · Claude CLI
```

所有 Adapter 在取得 lease 后才可启动；外部只读 Catalog 不取得 lease。跨后端 FIFO、排队取消、应用关闭必须加入集成测试。

## 11. 能力探测与本机配置

`src/main/state-store.ts` 的本机状态增加：

```ts
interface PersistedExecutionBackendConfiguration {
  readonly executablePath?: string;
}

interface PersistedState {
  readonly lastProject?: string;
  readonly recentProjects: readonly RecentProject[];
  readonly executionBackends?: {
    readonly codex?: PersistedExecutionBackendConfiguration;
    readonly claude?: PersistedExecutionBackendConfiguration;
  };
}
```

- Pi path 仍由现有 bundle/resolver 管理。
- Codex / Claude 默认用 `PATH` 自动发现；用户可在设置中选定绝对路径。
- Execution Adapter 和 External Source 共用同一个已解析 executable 配置；Source 仍保留独立错误状态，避免“能运行 exec，但 App Server 列表协议失败”被误报为整个 Codex 不可用。
- Board 不保存 executable path；项目数据在另一台机器打开时重新探测。
- `recordProject()` 与 `configureExecutionBackend()` 必须通过同一个 `StateStore.mutate()` 写队列读改写，不能让并发保存路径覆盖 recentProjects；文件仍使用临时文件 + rename 原子替换。
- 新配置先用候选路径 probe；成功才写入并激活。probe 或写入失败时继续使用旧配置，不留下“UI 显示已保存、Runner 仍用旧路径”的半状态。
- 路径修改只影响后续运行和下一次 Source refresh，不中止或换壳当前 ChildProcess；执行详情继续显示它启动时捕获的 backendVersion。
- 探测命令分别为 Pi 现有 smoke、`codex --version` + `codex login status` + App Server initialize、`claude --version` + `claude auth status --json` + `claude agents --json` 可用性检查。
- 探测不执行模型任务，不消费额度。
- `authState: "required"` 会禁用受管执行 Profile，但不必禁用仍能读取本地历史的 External Source；安装、协议、登录三个结论不压成一个模糊错误。
- `ExecutionBackendCatalogSnapshot` 独立于现有 `CapabilityHealthSnapshot`。现有 `pi/task/schedule/webhook` 不扩成每个 Profile 一个全局 capability key。
- 设置保存后只刷新目标后端；失败保留旧配置并展示错误，不重启其他 Runtime。

## 12. IPC 与 BridgeEvent

`StellaDesktopApi` 增加：

```ts
executionBackendsInitialize(): Promise<ExecutionBackendCatalogSnapshot>;
executionBackendConfigure(input: ConfigureExecutionBackendInput):
  Promise<ExecutionBackendCatalogSnapshot>;
executionBackendRetry(backendId: ExecutionBackendId):
  Promise<ExecutionBackendCatalogSnapshot>;

externalExecutionsRefresh(input: RefreshExternalExecutionsInput):
  Promise<ExternalExecutionSnapshot>;
externalExecutionDetail(input: ExternalExecutionReference):
  Promise<ExternalExecutionDetail>;
externalExecutionImport(input: ImportExternalExecutionInput):
  Promise<BoardBootstrap>;
openExecutionSession(input: OpenExecutionSessionInput):
  Promise<OpenExecutionSessionResult>;
```

`BridgeEvent` 增加：

```ts
| {
    readonly source: "execution-backend";
    readonly payload: ExecutionBackendCatalogSnapshot;
  }
| {
    readonly source: "external-execution";
    readonly payload: ExternalExecutionSnapshot;
  }
```

`openTaskSession(taskId, sessionPath)` 废弃。新的输入只传持久化 owner 引用：

```ts
type OpenExecutionSessionInput =
  | { readonly taskId: string; readonly kind: "task-source" }
  | { readonly taskId: string; readonly kind: "agent-task"; readonly agentTaskId: string }
  | { readonly taskId: string; readonly kind: "workflow-step"; readonly runId: string; readonly stepId: string }
  | { readonly taskId: string; readonly kind: "external-origin" };
```

Main 从 Board 解析真正的 Session Reference 并核对 Task/执行关系。External card 自身的打开动作使用 Source ID + externalId，由 Catalog 解析当前 session。

## 13. Renderer 设计

### 13.1 TaskEditorDialog

表单顺序调整为：

1. 标题、说明、验收标准、优先级。
2. **推进方式**：自己推进 / 固定流程 / 单 Agent / 动态 Squad。
3. 具体 Workflow、Agent 或 Squad 选择。
4. **执行环境**：只在自动推进时出现，并按当前具体目标展示兼容 Profile 卡片。

Profile 卡片显示 CLI 名称、命令模式、版本和状态。不可用项仍可见但禁用，并显示一行真实原因，例如“未找到 Codex CLI”或“该 Workflow 需要 Pi Skills”。切换 Target 后如果当前 Profile 不兼容，自动选择第一个可用 Profile；没有可用 Profile 时禁止提交。

编辑历史 Task 时，若其 Profile 当前不可用，原值仍显示，用户可以保存其他字段；只有分发或改成另一不兼容组合时拒绝。

### 13.2 看板视图

Kanban header 增加一级范围：

- `Stella 任务`
- `外部执行`
- `全部`

外部执行不塞进现有六条 Task lane；采用独立的活动区，按 `执行中 / 等待 / 空闲与结束 / 失败与停止` 分组。原因是外部 state 不具备 Stella 的 planned、review、blocked、completed 业务语义。

`全部` 视图在 Task lanes 上方显示紧凑外部活动带，避免用户误拖外部卡片。外部卡片：

- 有 Claude/Codex 来源徽标和原始 source kind。
- 无拖拽、编辑、评论、分发、验收按钮。
- 支持刷新、查看详情、复制/打开继续命令、导入为 Task。
- 父子 Thread 用缩进或关系标记展示；不画成 Stella AgentExecutionGraph。
- stale 来源显示最后刷新时间和错误，不把旧卡片伪装成实时状态。
- 匹配 Board session 的卡片显示“由 Stella 管理”并链接原 Task；`全部`视图不再重复展示该外部卡片，纯`外部执行`视图仍保留它用于核对原始状态。
- 匹配 `externalOrigin` 的卡片显示“已导入”，但不把导入 Task 误标为该外部进程的管理者。

### 13.3 TaskCard 与 TaskDetailPanel

- 自动 Task 卡片增加 Profile badge，例如 `Codex · Exec`。
- Detail 显示 Task 当前 Profile、每次历史执行的 Profile snapshot 与实际 CLI 版本。
- session action 改为统一的“继续会话”；Pi 返回工作台，Codex/Claude 复制命令并打开命令抽屉。
- imported Task 显示 `externalOrigin`，但其 Task stage 只受 Stella 操作影响。
- Timeline、WorkflowDag、ArtifactDetails 使用 `ExecutionSessionReference`，不再把所有 session 都显示为“Pi 会话文件”。

### 13.4 Hooks

新增 `use-execution-backends.ts` 和 `use-external-executions.ts`：

- 两者分别维护 request epoch；旧 promise 和旧 BridgeEvent 均不覆盖新 scope。
- `use-external-executions` 只在视图激活、document visible 时轮询。
- Board mutation pending 逻辑仍留在 `use-kanban`，外部 refresh pending 不阻塞 Task 操作。
- 切换项目时先显示新 scope loading，不短暂展示上一项目外部卡片。

## 14. 文件级改动清单

### 14.1 新增

| 文件 | 责任 |
|---|---|
| `src/shared/execution-profile.ts` | 后端/Profile/健康状态与兼容性纯函数 |
| `src/shared/execution-session.ts` | 跨后端 session 值对象与 parser |
| `src/shared/external-execution.ts` | 外部投影、状态、IPC 输入输出 |
| `src/main/execution-backend.ts` | `ExecutionBackend` Interface 和统一请求/结果 |
| `src/main/execution-backend-registry.ts` | Profile 解析、能力探测与 Adapter 选择 |
| `src/main/cli-process.ts` | 子进程、JSONL、abort、限长的深 Module |
| `src/main/execution-adapters/pi-rpc-execution-adapter.ts` | 现有 Pi Runtime Implementation |
| `src/main/execution-adapters/codex-exec-execution-adapter.ts` | Codex exec/review Implementation |
| `src/main/execution-adapters/codex-exec-protocol.ts` | Codex JSONL 纯 Reducer |
| `src/main/execution-adapters/claude-print-execution-adapter.ts` | Claude print Implementation |
| `src/main/execution-adapters/claude-stream-protocol.ts` | Claude stream-json 纯 Reducer |
| `src/main/external-execution-source.ts` | 外部来源 Interface |
| `src/main/external-execution-catalog.ts` | 多来源并发刷新、epoch、stale cache |
| `src/main/external-execution-sources/claude-agent-source-adapter.ts` | Claude agents JSON Adapter |
| `src/main/external-execution-sources/codex-thread-source-adapter.ts` | Codex Thread Adapter |
| `src/main/codex-app-server-client.ts` | JSON-RPC、分页、通知和进程生命周期 |
| `src/renderer/src/hooks/use-execution-backends.ts` | 后端状态与设置动作 |
| `src/renderer/src/hooks/use-external-executions.ts` | 外部快照、轮询、scope epoch |
| `src/renderer/src/features/kanban/ExecutionProfilePicker.tsx` | Profile 选择控件 |
| `src/renderer/src/features/kanban/ExternalActivityBoard.tsx` | 外部活动分组 |
| `src/renderer/src/features/kanban/ExternalExecutionCard.tsx` | 只读卡片 |
| `src/renderer/src/features/kanban/ExternalExecutionDetail.tsx` | 按需详情和导入入口 |

### 14.2 修改

| 文件 | 改动 |
|---|---|
| `src/shared/kanban.ts` | schema v8、Profile、session、origin、migration/parser |
| `src/shared/contracts.ts` | 新 API、事件、统一 session open |
| `src/shared/execution-state.ts` | TaskSpec/Profile snapshot |
| `src/shared/task-session-bridge.ts` | 改为 backend-neutral owner lookup |
| `src/shared/task-timeline.ts` / `workflow-dag.ts` | 传递 session 与 Profile 元数据 |
| `src/main/index.ts` | 组装 Registry/Catalog、IPC 校验、按 Profile dispatch |
| `src/main/state-store.ts` | 外部 CLI executable 配置与原子写 |
| `src/main/agent-task-runner.ts` | 改用 ExecutionBackend，删除 Pi RPC 控制细节 |
| `src/main/workflow-orchestrator.ts` | 每步改用 ExecutionBackend |
| `src/main/agent-task-service.ts` | Profile snapshot、继承和兼容性校验 |
| `src/main/board-service.ts` | 创建/更新 Profile 与 external origin |
| `src/main/autopilot-service.ts` | Profile 持久化和触发前检查 |
| `src/preload/index.ts` | 暴露新增 IPC |
| `src/renderer/src/features/kanban/TaskEditorDialog.tsx` | Profile 独立选择 |
| `KanbanWorkspace.tsx` | Stella/外部/全部视图与过滤 |
| `TaskCard.tsx` / `TaskDetailPanel.tsx` | Profile、来源、统一 session action |
| `WorkflowDag.tsx` / `ArtifactDetails.tsx` | 非 Pi session 展示 |
| `src/renderer/src/features/kanban/pi-task-draft.ts` | Pi 草稿来源改为 `sourceSession` |
| `src/renderer/src/App.tsx` | 组装两个新 hook 与统一 session open 结果 |
| `src/renderer/src/hooks/use-pi-runtime.ts` | 只在 open 结果为 `interactive-pi` 时接收新 RuntimeBootstrap |
| `src/renderer/src/components/SettingsDialog.tsx` | Codex/Claude 路径、探测与版本 |
| `CONTEXT.md` | 增加本设计的新领域词汇和边界 |
| `README.md` | v0.5.0 功能、安装前提和界面说明 |

## 15. 测试设计

### 15.1 Interface 测试

用 `FakeExecutionAdapter` 跑同一组 Runner contract：成功、失败、协议无终止结果、中止、shutdown、迟到事件、旧 runtimeToken、session、usage、workspace lease。Pi/Codex/Claude Adapter 只额外测试自己的协议映射，避免给每个后端复制整个 Runner 状态机测试。

用 `FakeExternalExecutionSource` 跑 Catalog contract：并发来源、一个失败、last-good stale、超时、scope 切换、旧 epoch、重复 externalId、父子关系和关闭。

### 15.2 协议 fixture

- Pi：复用现有 RPC fixture。
- Codex：由当前安装版本的 `codex app-server generate-json-schema` 生成开发 fixture；测试 `thread/list` 分页、`thread/status/changed`、Thread/Turn 状态和未知字段向前兼容。
- Codex exec：fixture 覆盖 thread.started、工具事件、最终 Agent message、turn.failed、非零退出和截断行。
- Claude：fixture 覆盖 `agents --json` 五种官方状态、缺字段、坏单项；stream-json 覆盖 session、assistant、result、usage、error 和 stderr。
- fixture 必须匿名化路径与内容；不依赖开发机真实 session。

### 15.3 领域与迁移

- v7 → v8 对 manual、agent、workflow、squad、Autopilot、AgentTask、WorkflowRun 和三种 Pi sessionPath 的迁移。
- Profile 改动递增 specRevision，评论/状态/健康刷新不递增。
- Root snapshot 与子 AgentTask 继承一致。
- 不兼容 Profile/Target、requiredSkills + 外部 Profile、codex.review + Workflow 全部在创建记录前拒绝。
- 外部 `finished` 不改变 imported Task stage。

### 15.4 Renderer

- TaskEditor 切换 Target 后的 Profile 过滤、自动回退、禁用原因和提交 payload。
- 外部卡片只读、无拖拽/验收/评论控件。
- Stella 管理 session 与 external origin 的派生关联、全部视图去重和纯外部视图保留。
- 当前/全部项目 scope、来源/状态过滤、stale 提示、父子显示。
- 导入 Task 的编辑流程和重复来源提示。
- session action 对 Pi/Codex/Claude 展示正确文案。
- `use-external-executions` 在隐藏页面停止轮询，旧 snapshot 不覆盖新 scope。

### 15.5 集成与 E2E

- 用测试可执行文件 shim 模拟 `codex` 和 `claude`，保证 CI 不要求登录或消耗额度。
- Electron E2E：探测到/未探测到 CLI、创建三种后端 Task、执行成功/失败/中止、查看外部执行、导入。
- 原生可选 smoke：本机已安装时验证 `codex --version`、App Server initialize、`claude --version`、`claude agents --json`，不发模型请求。
- packaged smoke：Pi 可用；未安装 Codex/Claude 时应用正常启动并只禁用对应项；配置绝对路径后可重新探测。
- 全量验收：`npm run check`、Electron native E2E、macOS arm64 未打包与打包 smoke。

## 16. 实现顺序

### Phase A：领域与 Pi 等价重构

- Shared 类型、Profile Catalog、schema v8 migration。
- ExecutionBackend Interface/Registry、Fake Adapter、Pi Adapter。
- AgentTaskRunner 和 WorkflowOrchestrator 切换到新 Interface。
- 所有现有 Pi 行为和测试保持通过。

### Phase B：能力探测与外部视图

- StateStore executable 配置。
- ClaudeAgentSourceAdapter、Codex App Server Client/Source。
- External Catalog、IPC、hooks、外部活动 UI、导入 Task。
- 此阶段不允许外部 Adapter 修改 Board execution 状态。

### Phase C：受管 Codex / Claude 执行

- CliProcess Module。
- Codex exec/review、Claude print Adapter。
- Profile picker、dispatch、session、Timeline、Artifact。
- Workflow step 和普通 mention 复用同一 Runner contract。

### Phase D：打包与发布

- Settings、不可用状态、shim E2E、原生协议 smoke。
- CONTEXT/README/发布说明。
- 最后统一将应用版本和 lockfile 升到 `0.5.0`，执行发布验收。

每个 Phase 都必须保持 `npm run check` 通过；Phase A 未完成 Pi 等价验证前，不并行改写 Runner 与外部 CLI 细节。

## 17. v0.5.0 验收标准

1. 用户能在当前项目和全部项目范围查看 Claude、Codex 外部执行，来源失败不会影响 Stella Task。
2. 外部卡片不会被误当 Task 拖动或改变 Stella 生命周期；可显式导入为新的手工 Task。
3. TaskEditor 能独立选择推进方式和可兼容的 Pi/Codex/Claude Profile。
4. Pi 全功能无回归；Codex exec/review 与 Claude print 的成功、失败、中止、session 和最终输出都能正确进入 AgentTask/Artifact。
5. Codex/Claude 不可用时，只禁用相关 Profile，现有看板与 Pi 仍可用。
6. Board v7 数据迁移后所有历史执行归属 `pi.rpc`，session 和验收引用不丢失。
7. 任意迟到 CLI 事件都不能覆盖新 runtimeToken 或较新的外部 snapshot。
8. 跨后端写执行遵守同一 WorkspaceAdmission FIFO。
9. Squad、LEAD、Coordinator 只允许 Pi；UI 和 Main 错误一致且不隐式降级。
10. `npm run check`、确定性 Electron E2E、原生探测 smoke 和打包 smoke 全部通过后，才发布 `v0.5.0`。
