# Stella v0.5.0 多 CLI 看板参考项目研究

> 检索日期：2026-08-24（Asia/Shanghai）
>
> 数据口径：Star、Fork、License 与 `updated_at` 均为检索时的 GitHub Repository REST API 快照；Star 会继续变化，本文不把它当成恒定值。
>
> 来源范围：只使用项目 GitHub 仓库、README、固定提交源码路径及 Claude Code / Codex 官方文档；不使用博客、聚合榜单或二手解读。

## 结论先行

Stella v0.5.0 值得做的是“多 CLI 控制面”，不是再造一个终端复用器。最有迁移价值的三组证据是：

1. **Multica** 给出最完整的“外部 Issue/Task → Runtime Adapter → 结构化事件 → 可恢复 Session”链路，并把 Pi、Codex、Claude、OpenCode 等放进统一 Backend；
2. **Vibe Kanban** 把 Task、Workspace、Session、Execution Process 分层，并以 typed profile/capability 管理不同 CLI；
3. **Paperclip** 把 Adapter registry、session codec、heartbeat run、日志存储和工作区调度做成显式契约。

由此得出的关键边界是：**外部 Claude/Codex 会话只投影成 `ExternalExecutionProjection`，不自动成为或推进 Stella `Task`；Stella 发起的受管执行才产生 AgentTask / StepRun 并可回写 Task。** Claude 官方 `claude agents --json` 提供稳定的发现与状态字段，但官方字段表没有最终输出字段，因此只能作为外部投影输入；Stella 自己发起的 Claude 执行使用另一条 `claude -p --output-format stream-json` 机器接口。Codex 外部观察走 app-server 的 `thread/list`、`thread/read` 与通知，Stella 受管执行走 `codex exec --json` 的 JSONL 事件流。

## 1. 广搜与筛选

入选标准不是单纯 Star 高，而是源码至少覆盖以下两项，并能迁移到 Stella：外部会话发现、Adapter/registry、结构化事件、进程与恢复、worktree/互斥、命令 Profile、任务看板。

### 1.1 深挖项目 API 快照

| 项目 | Stars（快照） | Forks | License | `updated_at`（UTC） | 入选原因 |
| --- | ---: | ---: | --- | --- | --- |
| [OpenCode](https://github.com/anomalyco/opencode) | 200,761 | 25,964 | MIT | 2026-08-24T06:17:09Z | Session identity、typed event 与 UI projection 很完整。[API 快照](https://api.github.com/repos/anomalyco/opencode) |
| [OpenHands](https://github.com/OpenHands/OpenHands) | 84,901 | 11,085 | MIT | 2026-08-24T06:10:01Z | 多 Agent Server backend registry 与会话控制面。[API 快照](https://api.github.com/repos/OpenHands/OpenHands) |
| [Paperclip](https://github.com/paperclipai/paperclip) | 79,260 | 14,531 | MIT | 2026-08-24T06:12:19Z | Adapter、run、日志、工作区调度和任务板贯通。[API 快照](https://api.github.com/repos/paperclipai/paperclip) |
| [Orca](https://github.com/stablyai/orca) | 52,175 | 3,610 | MIT | 2026-08-24T06:18:40Z | Claude/Codex/OpenCode/Pi 并排、外部 Session 扫描与状态归一。[API 快照](https://api.github.com/repos/stablyai/orca) |
| [Multica](https://github.com/multica-ai/multica) | 47,408 | 6,084 | GitHub API 为 `NOASSERTION`；仓库为自定义 Multica License | 2026-08-24T06:06:25Z | 与 Stella 目标最接近：Issue/Task、23 个 CLI runtime、事件与 daemon。[API 快照](https://api.github.com/repos/multica-ai/multica)；[License](https://github.com/multica-ai/multica/blob/9ecc6787b06872a18aefb2232fcaf1603a26ad81/LICENSE) |
| [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) | 27,901 | 2,985 | Apache-2.0 | 2026-08-24T06:15:57Z | Kanban、agent profile、session/process 与 worktree 分层。[API 快照](https://api.github.com/repos/BloopAI/vibe-kanban) |
| [Claude Squad](https://github.com/smtg-ai/claude-squad) | 8,359 | 611 | AGPL-3.0 | 2026-08-24T05:55:45Z | 最小化多 CLI TUI、Profile、tmux 恢复与 worktree。[API 快照](https://api.github.com/repos/smtg-ai/claude-squad) |
| [Claude Code Bridge / CCB](https://github.com/SeemSeam/claude_codex_bridge) | 3,442 | 338 | GitHub API 为 `NOASSERTION`；仓库声明 AGPL-3.0 | 2026-08-24T05:56:57Z | Provider capability、会话绑定及“结构化 carrier 优先”。[API 快照](https://api.github.com/repos/SeemSeam/claude_codex_bridge)；[License](https://github.com/SeemSeam/claude_codex_bridge/blob/01d5b1c158d3aa3b28fcdb798dcd592d8707697b/LICENSE) |
| [Agent Deck](https://github.com/asheshgoplani/agent-deck) | 783 | 134 | MIT | 2026-08-24T01:15:18Z | Star 较低但命中度高：Pi/Codex/Claude/OpenCode 会话、状态、Profile 与恢复。[API 快照](https://api.github.com/repos/asheshgoplani/agent-deck) |

### 1.2 已核验但未进入深挖的项目

| 项目 | Stars（同日快照） | 筛除理由 |
| --- | ---: | --- |
| [CC Switch](https://github.com/farion1231/cc-switch) ([API](https://api.github.com/repos/farion1231/cc-switch)) | 129,054 | 很强的供应商/配置切换器，但核心是改写上游配置，不是任务、进程和恢复控制面。 |
| [Cline](https://github.com/cline/cline) ([API](https://api.github.com/repos/cline/cline)) | 66,735 | 自身 IDE/CLI Agent 的完整产品，不负责统一投影其他 CLI 会话。 |
| [Goose](https://github.com/aaif-goose/goose) ([API](https://api.github.com/repos/aaif-goose/goose)) | 53,339 | Provider/extension 架构值得参考，但它本身是一个 Agent runtime，不是外部多 CLI 看板。 |
| [Aider](https://github.com/Aider-AI/aider) ([API](https://api.github.com/repos/Aider-AI/aider)) | 48,441 | CLI 配置、Git 集成成熟，但属于单 CLI pair programmer。 |
| [cmux](https://github.com/manaflow-ai/cmux) ([API](https://api.github.com/repos/manaflow-ai/cmux)) | 26,386 | 多终端窗口与通知体验相关，但终端 pane 不是任务/会话真相源。 |
| [Roo Code](https://github.com/RooCodeInc/Roo-Code) ([API](https://api.github.com/repos/RooCodeInc/Roo-Code)) | 24,328 | 自身 VS Code Agent 与 modes 很强，但不是外部 CLI session registry。 |
| [Crystal](https://github.com/stravu/crystal) ([API](https://api.github.com/repos/stravu/crystal)) | 3,106 | 与多会话/worktree 很相关，但 README 已标为 deprecated，主要作历史参考。 |
| [Overstory](https://github.com/jayminwest/overstory) ([API](https://api.github.com/repos/jayminwest/overstory)) | 1,329 | `AgentRuntime` 接口很贴题，但仓库已归档且声明不再维护，不宜作为 v0.5.0 主基线。 |

这组筛选也说明：Cline、Roo、Goose、Aider 的高 Star 证明各自 runtime 的成熟度，却不能替代“统一查看外部会话”所需的控制面契约。

## 2. 九个项目的可迁移设计

### 2.1 Multica — 最接近 Stella 的端到端参照（47,408 Stars）

**定位。** README 把它定义为“Agents that show up on a board”，可把 Issue 分派给 Claude Code、Codex、OpenCode、Pi 等众多 CLI，并展示命令、工具、错误和结果日志；任务由 daemon 通过 WebSocket 接收与回传。[README](https://github.com/multica-ai/multica/blob/9ecc6787b06872a18aefb2232fcaf1603a26ad81/README.md)

**相关实现。** 统一 `Backend.Execute` 返回流式 `Session.Messages` 与单次 `Session.Result`，消息被归一为 text/thinking/tool-use/tool-result/status/error/log，结果则区分 completed/failed/aborted/timeout/cancelled，并携带 `SessionID`。[`server/pkg/agent/agent.go`](https://github.com/multica-ai/multica/blob/9ecc6787b06872a18aefb2232fcaf1603a26ad81/server/pkg/agent/agent.go) WebSocket 类型把 Issue 事件与 task queued/dispatch/running/progress/completed/failed/cancelled 分开。[`packages/core/types/events.ts`](https://github.com/multica-ai/multica/blob/9ecc6787b06872a18aefb2232fcaf1603a26ad81/packages/core/types/events.ts) Git worktree 管理在 Git common dir 上使用跨进程 advisory lock，而不误以为进程内 mutex 足够。[`server/internal/daemon/execenv/gitroot_lock.go`](https://github.com/multica-ai/multica/blob/9ecc6787b06872a18aefb2232fcaf1603a26ad81/server/internal/daemon/execenv/gitroot_lock.go)

**值得借鉴。** `Task` 与 runtime `Session/Result` 分层；Adapter 统一输出结构化事件；resume rejection 被显式建模；同一仓库的 worktree 管理按 Git common dir 串行化。

**不能照搬。** 多租户服务端、daemon/渠道集成和 20 多种 runtime 会把 v0.5.0 范围拉得过大；自定义 License 也意味着只应借鉴设计而非复制实现。Stella 应先只做 Pi/Codex/Claude 三个 typed adapter。

### 2.2 Vibe Kanban — Task / Workspace / Session / Process 分层（27,901 Stars）

**定位。** 项目以 Kanban issue 为入口，每个任务可创建 agent workspace、分支、终端和 dev server，并支持 Claude、Codex、OpenCode 等多种 coding agent；README 同时说明项目正在 sunsetting，因此适合作架构证据而不是产品依赖。[README](https://github.com/BloopAI/vibe-kanban/blob/4deb7eca8f381f7cbc1f9d15515a9ab8f8009053/README.md)

**相关实现。** `CodingAgent` 枚举和 `StandardCodingAgentExecutor` 把 spawn/follow-up/review/日志归一化放进统一 executor，并以 capability 表示 session fork 等差异。[`crates/executors/src/executors/mod.rs`](https://github.com/BloopAI/vibe-kanban/blob/4deb7eca8f381f7cbc1f9d15515a9ab8f8009053/crates/executors/src/executors/mod.rs) `ExecutorConfig` 把 agent、variant、model、reasoning、permission policy 组合成 typed profile，而不是直接暴露 shell 字符串。[`crates/executors/src/profile.rs`](https://github.com/BloopAI/vibe-kanban/blob/4deb7eca8f381f7cbc1f9d15515a9ab8f8009053/crates/executors/src/profile.rs) Execution Process 单独记录 running/completed/failed/killed、退出码和 run reason。[`crates/db/src/models/execution_process.rs`](https://github.com/BloopAI/vibe-kanban/blob/4deb7eca8f381f7cbc1f9d15515a9ab8f8009053/crates/db/src/models/execution_process.rs)

**值得借鉴。** Stella 可采用 `Task → Execution → AdapterSession → ProcessAttempt` 的层次边界；在 v0.5.0 中由现有 AgentTask/StepRun、session reference、runtimeToken 和 Adapter 进程组承载，不必照搬新表。Profile 只组合受支持字段；能力差异由 Adapter 声明。

**不能照搬。** 每个 CLI 的文本 normalizer 数量很大且脆弱；项目 sunsetting 也不适合作运行时依赖。Stella 应优先消费官方 JSON/RPC，终端文本只作 fallback 日志。

### 2.3 Paperclip — Adapter registry 与 run/log 契约（79,260 Stars）

**定位。** Paperclip 是以任务板驱动多种本地/远端 Agent 的控制面；官方 Adapter 文档明确描述 heartbeat 查找 `adapterType`/config、调用 `execute()`、捕获输出并返回结构化结果，同时列出 Claude、Codex、OpenCode、Pi 等内建适配器。[Adapter overview](https://github.com/paperclipai/paperclip/blob/a14e51d592dd22e2e830e01f94e6783d55df9963/docs/adapters/overview.md)

**相关实现。** server registry 为每类 Adapter 组合 execute、环境测试、session codec、session management、模型、配置 schema 与 runtime command spec。[`server/src/adapters/registry.ts`](https://github.com/paperclipai/paperclip/blob/a14e51d592dd22e2e830e01f94e6783d55df9963/server/src/adapters/registry.ts) 公共包定义跨 Adapter 的执行/会话契约。[`packages/adapter-utils/src/types.ts`](https://github.com/paperclipai/paperclip/blob/a14e51d592dd22e2e830e01f94e6783d55df9963/packages/adapter-utils/src/types.ts) 工作区 Git 调度器提供有限并发、队列容量、deadline、single-flight 与按 workspace/repository 的公平性维度。[`server/src/services/workspace-git-operation-scheduler.ts`](https://github.com/paperclipai/paperclip/blob/a14e51d592dd22e2e830e01f94e6783d55df9963/server/src/services/workspace-git-operation-scheduler.ts)

**值得借鉴。** Registry 不只是 `execute()` 映射，还应登记 session codec、能力、配置 schema、事件质量等级和可用命令；任务状态与 heartbeat/run 状态分开。

**不能照搬。** Paperclip 允许 generic process/http Adapter，且带组织、预算、多运行目标等企业控制面。Stella v0.5.0 不应开放任意 shell command；新增运行方式必须通过代码内注册的 Profile + Adapter。

### 2.4 Orca — 外部 Session 投影与多 CLI 归一（52,175 Stars）

**定位。** Orca README 明确支持 Codex、Claude Code、OpenCode、Pi 并排运行，每个任务可用 worktree，并提供 GitHub/Linear、SSH、通知和移动端查看。[README](https://github.com/stablyai/orca/blob/95633a78834ce6182a503a079aeafe7e15feba8b/README.md)

**相关实现。** managed-agent hook registry 统一登记不同 agent hook。[`src/main/agent-hooks/managed-agent-hook-registry.ts`](https://github.com/stablyai/orca/blob/95633a78834ce6182a503a079aeafe7e15feba8b/src/main/agent-hooks/managed-agent-hook-registry.ts) Codex 使用原生 app-server 会话桥，而不是只抓 TUI 文本。[`src/main/codex/codex-app-server-session.ts`](https://github.com/stablyai/orca/blob/95633a78834ce6182a503a079aeafe7e15feba8b/src/main/codex/codex-app-server-session.ts) 外部会话扫描先归一成共享 Session 类型，再交给 UI。[`src/main/ai-vault/session-scanner-types.ts`](https://github.com/stablyai/orca/blob/95633a78834ce6182a503a079aeafe7e15feba8b/src/main/ai-vault/session-scanner-types.ts)

**值得借鉴。** 把“发现已经存在的外部会话”作为独立 read model；provider hook/app-server/历史扫描都落到统一 projection；UI 突出 unread、needs-attention 和快速接管。

**不能照搬。** Orca 为许多 CLI 维护本地 transcript 扫描器，这依赖未承诺稳定的文件格式。Stella 对 Claude/Codex 应先用官方接口，文件扫描只能标成低置信度 fallback。

### 2.5 OpenHands Agent Canvas — Backend registry 与控制面分离（84,901 Stars）

**定位。** 当前 README 将仓库定位为 Agent Canvas：一个可运行 OpenHands、Claude、Codex、Gemini 与 ACP agent、连接本地/Docker/VM/云端 Agent Server 的控制中心；它也明确说明 SDK/Agent Server 与前端分仓。[README](https://github.com/OpenHands/OpenHands/blob/861e9ef501730e3b194cb0345a1ae2b04cfe68f1/README.md)

**相关实现。** Backend registry 类型保存 backend identity/config。[`src/api/backend-registry/types.ts`](https://github.com/OpenHands/OpenHands/blob/861e9ef501730e3b194cb0345a1ae2b04cfe68f1/src/api/backend-registry/types.ts) Agent Server adapter 把具体服务协议隔离在 UI API 边界后。[`src/api/agent-server-adapter.ts`](https://github.com/OpenHands/OpenHands/blob/861e9ef501730e3b194cb0345a1ae2b04cfe68f1/src/api/agent-server-adapter.ts) Event service 使用显式事件类型供会话 UI 消费。[`src/api/event-service/event-service.types.ts`](https://github.com/OpenHands/OpenHands/blob/861e9ef501730e3b194cb0345a1ae2b04cfe68f1/src/api/event-service/event-service.types.ts)

**值得借鉴。** Backend registry、health/active backend 和 conversation service 都不应耦合到看板组件；Adapter 只向上暴露稳定领域对象。

**不能照搬。** 多 Agent Server 部署、云 sandbox、automation 和账号体系超出本地 Stella v0.5.0；该仓库的总 Star 也不能被误读成某个具体 Adapter API 的稳定性保证。

### 2.6 OpenCode — Session identity、状态与 UI reducer（200,761 Stars）

**定位。** OpenCode 是独立的开源 coding agent（TUI/desktop），不是外部多 CLI 看板；它入选是因为其 Session 与事件投影边界非常清楚。[README](https://github.com/anomalyco/opencode/blob/f2a1d547f1760babcfe1ba15e368df06125517d5/README.md)

**相关实现。** Session schema 同时包含 `id`、project/workspace、directory、parent、agent/model、created/updated/archived，并提供 list/fork 输入。[`packages/opencode/src/session/session.ts`](https://github.com/anomalyco/opencode/blob/f2a1d547f1760babcfe1ba15e368df06125517d5/packages/opencode/src/session/session.ts) Session status 通过 typed event 发布状态变化与 idle。[`packages/opencode/src/session/status.ts`](https://github.com/anomalyco/opencode/blob/f2a1d547f1760babcfe1ba15e368df06125517d5/packages/opencode/src/session/status.ts) App 的 reducer 统一处理 session/message/part/diff/status/permission/question 事件。[`packages/app/src/context/global-sync/event-reducer.ts`](https://github.com/anomalyco/opencode/blob/f2a1d547f1760babcfe1ba15e368df06125517d5/packages/app/src/context/global-sync/event-reducer.ts)

**值得借鉴。** 原始 Provider event、归一领域事件和 UI projection/reducer 三层分开；parent/fork identity 不靠标题或 cwd 猜测。

**不能照搬。** OpenCode 自身就是 runtime，不能承担 Stella 的多后端 control plane；应把它当一个 Adapter 输入，以及事件模型参考。

### 2.7 Agent Deck — 最贴近本地会话管理 UX（783 Stars）

**定位。** README 将其称为 coding-agent session 的 mission control，支持 Pi、Claude、Codex、OpenCode 等，展示 running/waiting/done，并提供 fork、worktree、分组、Web UI 和 profiles。[README](https://github.com/asheshgoplani/agent-deck/blob/bf50689893053c6dd33a29b21e12eb36e251d94b/README.md)

**相关实现。** built-in registry 是工具识别和默认命令的单一来源。[`internal/session/builtins.go`](https://github.com/asheshgoplani/agent-deck/blob/bf50689893053c6dd33a29b21e12eb36e251d94b/internal/session/builtins.go) Profile 可分隔配置和 SQLite state root。[`internal/session/config.go`](https://github.com/asheshgoplani/agent-deck/blob/bf50689893053c6dd33a29b21e12eb36e251d94b/internal/session/config.go) CLI 状态刷新会综合 hook status 文件与 tmux 缓存。[`internal/session/cli_status_refresh.go`](https://github.com/asheshgoplani/agent-deck/blob/bf50689893053c6dd33a29b21e12eb36e251d94b/internal/session/cli_status_refresh.go)

**值得借鉴。** 一个本地 registry 驱动 CLI 识别、状态展示和可用动作；Profile 是命名配置，而不是让每张卡携带一段命令；attach/detach/fork 的交互很贴近 Stella。

**不能照搬。** 命令 token/substring、tmux pane 和完成 sentinel 都是启发式证据，不能成为状态真相源；Profile 中也不应允许任意 program 字符串。

### 2.8 Claude Squad — 极简 Profile、暂停与恢复（8,359 Stars）

**定位。** Claude Squad 用一个 TUI 管理 Claude Code、Codex、Gemini、Aider 等，并在独立 worktree/tmux session 中运行；Profile 是 `name + program`。[README](https://github.com/smtg-ai/claude-squad/blob/ce1ffb4392b01f38e2c4599c7c84d2a93973b138/README.md)

**相关实现。** 配置层定义默认 program 与 Profile picker。[`config/config.go`](https://github.com/smtg-ai/claude-squad/blob/ce1ffb4392b01f38e2c4599c7c84d2a93973b138/config/config.go) Instance 把 Running/Ready/Loading/Paused 与 path/branch/program/tmux/worktree 一起持久化，tmux 缺失时可降为 Paused 而不是丢失实例。[`session/instance.go`](https://github.com/smtg-ai/claude-squad/blob/ce1ffb4392b01f38e2c4599c7c84d2a93973b138/session/instance.go) tmux 封装提供持久 pane carrier。[`session/tmux/tmux.go`](https://github.com/smtg-ai/claude-squad/blob/ce1ffb4392b01f38e2c4599c7c84d2a93973b138/session/tmux/tmux.go)

**值得借鉴。** “进程不在 ≠ 会话消失”；暂停实例仍可恢复。Profile UI 应很小，只暴露用户理解的 runtime/model/effort/permission/workspace 策略。

**不能照搬。** 四状态过粗；终端 prompt 文本与 tmux 存活不能证明 turn 成功。Stella 应将 session state、process state 与 Task state 分开。

### 2.9 Claude Code Bridge — Provider capability 与结构化完成权威（3,442 Stars）

**定位。** CCB 是多 Agent TUI/daemon，覆盖 Claude、Codex、OpenCode、Pi 等，并支持原生终端接管；README 特别强调 service-backed provider 的 prompt、reply、completion、restore 不依赖终端启发式。[README](https://github.com/SeemSeam/claude_codex_bridge/blob/01d5b1c158d3aa3b28fcdb798dcd592d8707697b/README.md)

**相关实现。** `ProviderBackendRegistry` 分别暴露 manifest、execution adapter、session binding 与 runtime launcher，并拒绝重复 provider key。[`lib/provider_core/registry.py`](https://github.com/SeemSeam/claude_codex_bridge/blob/01d5b1c158d3aa3b28fcdb798dcd592d8707697b/lib/provider_core/registry.py) 内建 registry 明确列出 core/optional provider，包括 OpenCode 与 Pi。[`lib/provider_core/registry_runtime/builtin_backends.py`](https://github.com/SeemSeam/claude_codex_bridge/blob/01d5b1c158d3aa3b28fcdb798dcd592d8707697b/lib/provider_core/registry_runtime/builtin_backends.py) DSH 官方 contract 把 pane 限定为进程/日志 carrier，规定只有绑定到同一 request/session/turn 的原生终态才有完成权威。[`docs/dsh-service-provider-contract.md`](https://github.com/SeemSeam/claude_codex_bridge/blob/01d5b1c158d3aa3b28fcdb798dcd592d8707697b/docs/dsh-service-provider-contract.md)

**值得借鉴。** Adapter manifest 应声明 `discover/list/read/launch/resume/logs/stop/structuredEvents` 等 capability；session binding 和 runtime launcher 是两套能力；完成判定要绑定稳定 request/session/turn identity。

**不能照搬。** Python + tmux/WezTerm + daemon 的跨 Agent 协作拓扑过重；v0.5.0 不应实现跨 Agent 消息编排，只借鉴 registry 与完成权威边界。

## 3. 官方 Claude / Codex 接口核验

### 3.1 Claude Code：`claude agents --json` 适合外部投影，不是受管结果协议

Claude Code 官方 Agent View 将后台会话按 Needs input、Working、Completed 等分组，并明确把“会话状态”和“底层进程是否仍活着”分开：进程已退出的会话仍可 peek、reply 或 attach 后续接。[Agent View：状态与进程形态](https://code.claude.com/docs/en/agent-view#read-session-state)

官方 `claude agents --json` 文档定义：

- `cwd`、`kind`、`startedAt` 始终存在；
- 后台会话有短 `id` 和 `state`，其中 state 为 `working | blocked | done | failed | stopped`；
- 活进程可有 `pid`、`status`；等待时 `waitingFor` 可区分 permission prompt、input needed、sandbox request、worker request、dialog open；
- 可选 `sessionId` 是可供 `claude --resume` 使用的完整 UUID；`--all` 纳入完成会话，`--cwd` 可限定目录。[官方 JSON 字段表](https://code.claude.com/docs/en/agent-view#list-sessions-as-json) [CLI reference](https://code.claude.com/docs/en/cli-reference#cli-commands)

**关键推论。** 官方 JSON 字段表没有 `finalOutput`、`result` 或结构化 transcript 字段；`claude logs <id>` 也只被定义为打印 recent output。[官方 shell commands](https://code.claude.com/docs/en/agent-view#manage-sessions-from-the-shell) 因此截至检索日，Stella 可用它发现、去重、显示状态和提供固定 `attach/logs` 动作，但不应据此认定“最终输出已稳定回传”或自动完成 Task。这是从已公布 schema 得出的接口边界判断，不是对 Claude 内部实现的猜测。

此外，Claude 后台会话在编辑前会进入 `.claude/worktrees/`，但非 Git、已在 worktree、关闭 isolation 等情形会例外；这进一步说明 Stella 应读取实际 `cwd`，不能只按启动目录推断写入位置。[官方 worktree 说明](https://code.claude.com/docs/en/agent-view#how-file-edits-are-isolated)

### 3.2 Codex：外部 thread source 与 Stella 受管 execution 使用不同入口

**外部会话投影。** Codex 官方 app-server `thread/list` 可分页列出已存储 thread，并按 provider、source kind、archived、cwd、search 等过滤；结果包含稳定 thread id 与 status。[`thread/list`](https://github.com/openai/codex/blob/068c49f075cf287a1fe7d1ee36cf005efac922e7/codex-rs/app-server/README.md#example-list-threads-with-pagination--filters) `thread/read` 可按 id 读取而不 resume，并可选择载入 turns。[`thread/read`](https://github.com/openai/codex/blob/068c49f075cf287a1fe7d1ee36cf005efac922e7/codex-rs/app-server/README.md#example-read-a-thread) `thread/status/changed` 提供 `notLoaded | idle | systemError | active` 的状态通知；`notLoaded` 表示未载入而非任务完成。[状态通知](https://github.com/openai/codex/blob/068c49f075cf287a1fe7d1ee36cf005efac922e7/codex-rs/app-server/README.md#example-track-thread-status-changes)

**实时结构化事件。** app-server 对每个 turn 发 `turn/started` 与 `turn/completed`，item 生命周期固定为 `item/started → deltas → item/completed`，并有 typed diff、plan、command、file-change、MCP 等通知。[Turn events](https://github.com/openai/codex/blob/068c49f075cf287a1fe7d1ee36cf005efac922e7/codex-rs/app-server/README.md#turn-events)

**Stella 受管执行。** 官方非交互文档明确将 `codex exec` 用于脚本/CI；`--json` 把 stdout 变为 JSONL，事件含 `thread.started`、`turn.started/completed/failed`、`item.*` 与 `error`，item 可表达 agent message、reasoning、command、file change、MCP、web search、plan，且可用 `--output-last-message` 获取最终消息。[Codex 非交互模式：machine-readable output](https://developers.openai.com/codex/noninteractive#make-output-machine-readable)

所以 v0.5.0 应做两个 Adapter 面：`CodexThreadSourceAdapter` 通过 app-server 观察已有 thread；`CodexManagedExecutionAdapter` 通过固定 Profile 生成 `codex exec --json` argv、消费 JSONL 并掌握退出码/最终消息。两者可共享事件归一器，但不能共享 Task 完成权威。

### 3.3 为什么优于终端文本解析

官方 JSON/RPC 直接提供 session/thread/turn/item identity、枚举状态和有序事件；终端抓取只能看到渲染后的字符串，无法可靠区分 pane 静默、等待输入、进程退出、会话可恢复和 turn 成功。Agent Deck、Claude Squad 的 tmux/prompt 启发式与 Orca 的 transcript scanner 可作为兼容性 fallback，却不应覆盖原生 Adapter 证据。Stella 应保存原始 provider payload 供诊断，同时只让经过 schema 校验的归一事件改变 projection。

## 4. 横向设计归纳

参考项目经常拥有独立数据库、daemon、终端 carrier 或远程 Agent Server；Stella 是已有可靠 Task/AgentTask/StepRun 状态机的本地 Electron 应用，因此借鉴边界而不复制全部实体。最终实现基线以[完整代码设计](../specs/stella-v0.5.0-multi-cli-runtime.md)为准。

| 轴 | 参考证据 | Stella v0.5.0 的最终取舍 |
| --- | --- | --- |
| 外部任务/会话投影 | Orca scanner read model；Claude `agents --json`；Codex `thread/list/read` | 使用不进入 BoardState 的 `ExternalExecutionProjection` 内存快照与 epoch；只观察，显式导入才创建手工 Task。 |
| Adapter / registry | Multica Backend、Vibe executor、Paperclip registry、CCB manifest | 分为 `ExternalExecutionSource` 与 `ExecutionBackend` 两个 Interface；稳定 Profile key 在代码中注册。 |
| 结构化事件 | Multica Message/Result、OpenCode reducer、Codex turn/item events | 每个 Adapter 用纯 `ProtocolReducer` 归一事件；Runner 和 UI 不消费 provider raw event。raw 只作有界运行诊断，不写第二份 Board 历史。 |
| 进程生命周期 | Vibe Execution Process；Claude 将 session state 与 process shape 分开 | 不新增 `ProcessAttempt` 表；继续用 AgentTask/StepRun、runtimeToken、backendVersion 和 Adapter 持有的精确进程组表达一次运行。进程退出仍不等于 Task 验收。 |
| 会话 identity | Claude `id + sessionId + cwd + kind`；Codex thread id；OpenCode parent/fork | 唯一键使用 `sourceId + externalId`；与 Stella 历史关联使用 `backendId + 可恢复 sessionId`，cwd/title 只用于展示。 |
| 状态映射 | Claude working/blocked/done/failed/stopped；Codex active/idle/notLoaded | 保留 `providerState`、可选 `processState` 和 `state`；归一为 `running / waiting / idle / finished / failed / stopped / unknown`。 |
| worktree / 工作区互斥 | Claude 背景 worktree；Multica common-dir 锁；Vibe workspace | Source 信任 CLI 返回的实际 cwd 且不抢 lease；Stella 受管写执行继续共用现有 `WorkspaceAdmission`。v0.5.0 不管理 worktree add/remove，因此不额外引入 Git common-dir 锁。 |
| 命令 Profile | Vibe typed ExecutorConfig；Agent Deck/Claude Squad profiles | 只提供 `pi.rpc / codex.exec / codex.review / claude.print`；允许为注册 backend 配置 executable path，不允许 Task 保存任意 program、pipeline 或 flags。 |
| UI 看板 | Vibe/Paperclip Task board；Claude Needs input/Working/Completed | Stella Task lanes 与外部活动区分离；外部卡片只读，并显示 provider、实际 cwd、状态、waiting reason、last activity。 |

最终最小关系如下：

```text
Task ──0..n── AgentTask / WorkflowRun.StepRun ── ExecutionSessionReference
  │
  │ explicit import origin / derived session association
  ▼
ExternalExecutionProjection ← ExternalExecutionSource

ExecutionProfile ──selects──> ExecutionBackend
```

只有带 Stella execution identity、runtimeToken 且由受管 Adapter 返回结构化成功终态的执行，才可进入现有验收链路；外部 `done` 只改变外部卡片状态。

## 5. 对 Stella v0.5.0 的可执行设计结论

1. **外部执行是只读 Projection，不是新事实表。** 快照包含 source/external identity、实际 cwd、title、provider/process/display state、waiting reason 和时间；刷新失败保留 last-good 内存数据并标 stale。
2. **Source 与 Managed Execution 是两条独立能力。** Codex Source 使用 app-server，Codex 受管执行使用 `exec --json`；Claude Source 使用 `agents --json`，Claude 受管执行使用 `-p --output-format stream-json`。
3. **Claude `agents --json --all [--cwd]` 不拥有 Task 完成权威。** 它可发现、显示并提供 resume 动作；`done` 不等于 Stella Task 完成，也不能伪造最终报告。
4. **Codex Source 通过 app-server 对账。** `thread/list` 分页发现，`thread/read` 延迟载入详情，`thread/status/changed` 更新已有卡片，断线后重新 list/read。
5. **受管 Adapter 只接受机器终态。** Codex 捕获 thread/turn/item/exit/final message；Claude 捕获 session/assistant/result/usage/exit；缺少必需终止结果时标记 `protocol-invalid`，不猜成功。
6. **Session identity 不依赖标题、cwd 或 pid。** 外部 key 为 `sourceId + externalId`；Codex 用可恢复 Thread ID，Claude 用 session ID；PID 只属于 Adapter 当前持有的进程组。
7. **归一状态保留未知。** provider 新增状态或事件时显示 `unknown` 并保留诊断，不默认为 idle、finished 或 success。
8. **保持现有执行所有权。** AgentTask/StepRun 保存 Profile snapshot、backendVersion、session reference 和 runtimeToken；无需复制 Vibe/Paperclip 的 ProcessAttempt/heartbeat 数据模型。
9. **所有 Stella 写执行共用 WorkspaceAdmission。** 外部扫描不占 lease；v0.5.0 不主动创建或清理 Claude/Codex worktree，只展示实际 cwd。
10. **Profile 和 argv 白名单化。** Adapter 在代码中构造 argv；设置只允许覆盖已注册 Codex/Claude executable path，Task 不能提供 shell pipeline、任意 executable 或 flags。
11. **UI 不混淆两套状态。** Task 仍使用 planned/queued/running/review/blocked/completed；外部活动使用 running/waiting/idle/finished/failed/stopped/unknown，并以显式导入建立 origin。
12. **每个 Interface 使用 contract fixture。** 覆盖发现去重、未知状态、进程退出但 session 可恢复、blocked/waiting、重连补账、resume identity、结构化成功/失败、abort 和迟到 runtimeToken。

这 12 条形成 v0.5.0 的窄切片：可靠地看见外部 Claude/Codex 会话，并让 Stella 以受控 Profile 启动 Pi/Codex/Claude；不把 shell、tmux、私有 transcript 或外部 `done` 升格为 Task 真相源。
