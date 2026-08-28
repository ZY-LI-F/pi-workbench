# stablyai/orca 深度分析与 Stella Pi Workbench v0.5.0 借鉴建议

> 研究日期：2026-08-28（Asia/Shanghai）
>
> Orca 源码快照：[`65dd06a8701d7104340f9774d6f6ff6039488cfe`](https://github.com/stablyai/orca/commit/65dd06a8701d7104340f9774d6f6ff6039488cfe)
>
> Stella 对照快照：[`cb75738dfc440e4309e80598160f720473703b34`](https://github.com/ZY-LI-F/pi-workbench/commit/cb75738dfc440e4309e80598160f720473703b34)
> 来源范围：仅 Orca 仓库 README、源码、配置、测试、发布页、GitHub 官方仓库元数据，以及 Stella 当前源码。没有使用第三方评测或二手文章。

## 结论先行

Orca 有可借鉴之处，但不适合成为 Stella 的运行时依赖，也不适合整体移植。

最值得借鉴的是三个设计事实：

1. **“能在终端里运行”与“一级集成”必须分层。** Orca 的通用终端确实能承载任意 CLI，但安装探测、启动参数、Prompt 注入、实时状态、历史扫描和恢复命令分别维护独立的、数量不同的适配矩阵。它没有一个真正通吃所有 CLI 的统一协议。
2. **外部状态应先归一化，再投影到看板。** Orca 将 provider hook、session 文件和 worktree 元数据分别归一化，然后生成只用于展示的 Dashboard/Kanban snapshot；看板不是原始运行状态的所有者。
3. **并行写入依靠独立 worktree，而不是放松同目录并发约束。** 这对 Stella 有长期价值，但它应是一个可选的 Workspace Strategy，不能塞进 Pi/Codex/Claude 的 Execution Profile，也不应在 v0.5.0 中仓促加入。

Stella v0.5.0 当前的 `ExecutionBackend`、`ExternalExecutionSource`、Board 与 `WorkspaceAdmission` 分层是正确的。基于 Orca，没有事实依据支持把它们改造成一个“任意 CLI 通用后端”，也没有必要引入 Orca 的 PTY、SSH、移动端或 SQLite 编排子系统。

## 1. 项目状态与研究口径

截至本次取证时，GitHub 官方仓库元数据显示 Orca：

- 创建于 2026-03-17，默认分支为 `main`，未归档，主语言 TypeScript，MIT 许可；
- 约 55,700 stars、3,799 forks；这些数字只表示当时的关注度，不证明实现质量；
- 最新非预发布版本为 [`v1.4.190`](https://github.com/stablyai/orca/releases/tag/v1.4.190)，发布于 2026-08-26，包含 20 个发布资产；tag 最终指向 [`6e4f817`](https://github.com/stablyai/orca/commit/6e4f817101daa18d82824b69243d9079baa9c416)；
- 本文固定分析的 `main` 快照 `65dd06a` 提交于 2026-08-28。仓库在研究期间仍继续推送，因此所有源码判断均使用固定 permalink，而不是可漂移的 `main` 链接。

动态元数据可由 [GitHub Repository API](https://api.github.com/repos/stablyai/orca) 和 [Latest Release API](https://api.github.com/repos/stablyai/orca/releases/latest) 复核。源码快照中的 `package.json` 仍写着 `1.4.178-rc.2`，与最新 release tag 不一致，所以本文用 commit SHA 标识源码，而不把该 package 字段当作发布版本证据（[`package.json#L1-L11`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/package.json#L1-L11)）。

Orca 的实际产品边界是“Agent-oriented IDE/runtime”：README 明确列出并行 worktree、终端分屏、内嵌浏览器、GitHub/Linear、SSH、Diff review、CLI 与移动端（[`README.md#L29-L167`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/README.md#L29-L167)）。这比 Stella 的任务看板与可控执行后端范围大得多；功能相似不等于架构职责相同。

## 2. Orca 的真实能力分层

README 同时写了“Codex、ClaudeCode、OpenCode、Pi 并排运行”和“任何 CLI agent，只要能在终端运行就能在 Orca 运行”（[`README.md#L18-L23`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/README.md#L18-L23)、[`README.md#L171-L205`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/README.md#L171-L205)）。源码显示这句话只在“终端承载”层面成立。

| 层级 | Orca 的真实实现 | 快照覆盖 | 不能据此推导的能力 |
| --- | --- | ---: | --- |
| 通用终端承载 | PTY 中可以手工运行任意命令 | 开放 | 不代表可探测、可注入 Prompt、可观测或可恢复 |
| 已知 Agent 启动 | `TuiAgent` 闭合集合 + `TUI_AGENT_CONFIG` | 36 个启动 ID | 集合外 CLI 没有自动 launch contract |
| 安装/启动协议 | 每个 Agent 定义 detect command、launch command、进程名、Prompt 注入与平台特例 | 每 Agent 单独定义 | 不能用一条通用 argv 模板替代 |
| Managed hook 安装 | `AGENT_HOOK_TARGETS` | 14 个 target | 不等于历史扫描或 resume 覆盖 |
| Hook 状态路由 | loopback endpoint + provider normalizer | 18 个 source route | Orca 外部普通终端中的任务不会自动进入实时看板 |
| Agent Session History / AI Vault | 扫描各 provider 本地文件、SQLite 或特定目录 | 18 个 Agent | 不是稳定的跨 provider 官方 API |
| 精确 resume | provider session metadata + provider-specific argv | 14 个 Agent | 不支持用统一 `resume <id>` 拼接 |

覆盖数量来自以下固定源码：启动集合见 [`tui-agent.ts#L1-L39`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/tui-agent.ts#L1-L39)，managed hook targets 见 [`agent-hook-types.ts#L6-L23`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/agent-hook-types.ts#L6-L23)，hook routes 见 [`source-routing.ts#L5-L27`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/agent-hook-listener/source-routing.ts#L5-L27)，AI Vault agents 见 [`ai-vault-types.ts#L4-L23`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/ai-vault-types.ts#L4-L23)，resume 集合见 [`agent-session-resume.ts#L5-L20`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/agent-session-resume.ts#L5-L20)。这些集合不同，本身就是“能力应显式建模”的证据。

### 2.1 Agent 启动不是简单的命令字符串

`TUI_AGENT_CONFIG` 集中维护：

- PATH 探测命令、别名、依赖命令和不支持的平台；
- 启动命令与预期进程名；
- 六类 Prompt 注入方式；
- `--` 参数分隔、prefill flag/env、composer ready signal、超时和 Windows 输入编码。

契约定义见 [`tui-agent-config.ts#L4-L53`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/tui-agent-config.ts#L4-L53)。Claude 与 Codex 已有不同的 ready/trust 行为（[`tui-agent-config.ts#L55-L97`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/tui-agent-config.ts#L55-L97)）；Pi 又依赖 `ORCA_PI_PREFILL` 与自己的 Windows 输入编码（[`tui-agent-config.ts#L139-L148`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/tui-agent-config.ts#L139-L148)）。

可借鉴点不是这些字段本身，而是“**探测与启动由同一份 provider manifest 驱动**”。Stella 当前已经把执行 profile 与 backend registry 分开，不应把 Orca 的终端输入细节复制进 `ExecutionProfile`。

### 2.2 实时状态来自 provider hook，而非通用进程猜测

Orca 的“显式 Agent 状态”类型声明其主要来源是 Claude、Codex 等原生 hook，不从 terminal title 推断；只有窄化的中断兜底例外（[`agent-status-types.ts#L1-L3`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/agent-status-types.ts#L1-L3)）。更广的 observation facet 仍承认 title-derived row，但明确把它标为 Orca 会采用的最弱证据。成熟的一级路径仍是：每个 provider 先进入自己的 normalizer，再输出共享状态；入口在 [`provider-dispatch.ts#L10-L24`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/agent-hook-listener/provider-dispatch.ts#L10-L24)，穷举路由在 [`provider-dispatch.ts#L33-L153`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/agent-hook-listener/provider-dispatch.ts#L33-L153)。

归一化后的状态不是只有 `working/done`：条目包含 pane、worktree、host、状态历史、当前 tool、交互问题、最近 assistant message、subagents、orchestration context 与 provider session identity（[`agent-status-types.ts#L100-L163`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/agent-status-types.ts#L100-L163)），并对字段长度、subagent 数量和 freshness 做边界控制（[`agent-status-types.ts#L230-L272`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/agent-status-types.ts#L230-L272)）。

但“实时看板可看到任何地方启动的 CLI”并不成立。Orca 将 managed hooks 写入用户的 agent 配置，所以它们也会在普通终端触发；官方测试明确要求在没有 Orca 环境变量或 endpoint 时完全静默、不写数据（[`hook-script-outside-orca.test.ts#L9-L69`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/main/agent-hooks/hook-script-outside-orca.test.ts#L9-L69)）。hook post 依赖 `ORCA_PANE_KEY`、`ORCA_TAB_ID`、launch token、worktree id 和 loopback endpoint（[`hook-post-command.ts#L4-L35`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/main/agent-hooks/hook-post-command.ts#L4-L35)）。因此：

- Orca 管理的 terminal：对已适配且启用 hook 的 provider，可获得实时、可归属到 pane/worktree 的状态；
- Orca 外的普通 terminal：managed hook 故意不回传实时状态；
- 历史发现：由 AI Vault 的磁盘扫描另行完成。

### 2.3 Observation provenance 是有价值但尚未完成的设计

Orca 定义了 `hook / osc / title / process / launch / orchestration` 等 evidence origin，以及 authority、incarnation、revision、observedAt 与 observation kind（[`agent-status-observation.ts#L10-L56`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/agent-status-observation.ts#L10-L56)）。这解决的是多个证据源竞争覆盖状态时的可解释性问题。

但源码在文件头和类型注释中两次写明“NOTHING READS IT YET / read by nothing yet”（[`agent-status-observation.ts#L1-L8`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/agent-status-observation.ts#L1-L8)、[`agent-status-observation.ts#L58-L63`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/agent-status-observation.ts#L58-L63)）。同一文件还明确记录跨 authority 时钟不可比较、远端 clock skew 会使状态永久新鲜或到达即过期，并声明当前 PR 未修复（[`agent-status-observation.ts#L76-L96`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/agent-status-observation.ts#L76-L96)）。

所以它可以作为未来多证据模型的设计参考，但不能当作一套已经验证完成、可直接复制的冲突仲裁方案。

### 2.4 Session History 是多格式解析系统，不是通用 API

AI Vault 将不同 provider 的记录归一成 `AiVaultSession`，统一保存 host、agent、session id、cwd、branch、model、文件路径、时间、消息预览、resume command 与 subagent 信息（[`ai-vault-types.ts#L85-L123`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/ai-vault-types.ts#L85-L123)）。它还区分“有对话可恢复”与“零 turn 但仍有 queued/subagent 信号”的 session（[`ai-vault-types.ts#L153-L185`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/ai-vault-types.ts#L153-L185)）。这是合理的读模型。

代价也很清楚：

- scanner options 为 Claude、Codex、Gemini、Cursor、OpenCode、Pi、OMP 等分别暴露目录，并支持 scope、limit 与 cancellation（[`session-scanner-types.ts#L9-L49`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/main/ai-vault/session-scanner-types.ts#L9-L49)）；
- source table 硬编码各 provider 的 home/env 路径、扩展名、过滤器和目录裁剪；OpenCode 与 Antigravity 还需要形态专用 scanner（[`session-scanner-agent-sources.ts#L18-L81`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/main/ai-vault/session-scanner-agent-sources.ts#L18-L81)）；
- Pi/OMP/Prime/OpenClaw/Droid/Cline/Kimi 都有不同路径或筛选规则（[`session-scanner-agent-sources.ts#L169-L257`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/main/ai-vault/session-scanner-agent-sources.ts#L169-L257)）；
- 为避免每次扫描重读大量 JSONL，Orca 实现 4,096 条 LRU cache、增量 line fold、持久化 seed 与后台 service process（[`session-scanner-parse-cache.ts#L20-L84`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/main/ai-vault/session-scanner-parse-cache.ts#L20-L84)、[`session-scanner-parse-cache.ts#L167-L175`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/main/ai-vault/session-scanner-parse-cache.ts#L167-L175)、[`session-scanner-background.ts#L29-L78`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/main/ai-vault/session-scanner-background.ts#L29-L78)）。

其增量解析仍是显式接受的 heuristic：如果文件发生一种恰好保留边界换行的“增长式重写”，最坏情况会显示陈旧记录，直到文件截断或应用重启（[`session-scanner-parse-cache.ts#L247-L312`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/main/ai-vault/session-scanner-parse-cache.ts#L247-L312)）。

这说明私有 transcript 扫描不是低成本兼容层。Stella 当前有官方结构化接口时，不应为了扩大 provider 数量而优先采用这条路径。

### 2.5 Resume 必须由 adapter 拥有

Orca 的 provider session metadata 同时允许 provider id 和权威 transcript path，因为 Claude、Codex 与 Pi 的定位方式不同（[`agent-session-resume.ts#L24-L35`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/agent-session-resume.ts#L24-L35)）。实际恢复 argv 是逐 provider switch：Claude 使用 `--resume`，Codex 使用 `resume`，Pi 使用 `--session <transcriptPath>`，其他 Agent 还有自己的 flag（[`agent-session-resume.ts#L249-L294`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/agent-session-resume.ts#L249-L294)）。

Stella 应继续让 source/backend adapter 负责 continue/resume，renderer 只提交稳定 identity；不能由看板组件拼命令。

## 3. Orca 的看板并不是一个统一任务域

Orca 至少有三套彼此区分的状态域：

1. **Agent Dashboard**：由 live status 生成 `attention / working / done / idle` 四个展示 bucket。`DashboardSnapshot` 明确是 structured-clone-safe 的 presentation contract（[`dashboard-snapshot.ts#L6-L22`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/dashboard-snapshot.ts#L6-L22)），card 承载 pane、workspace、host、review、subagent、时间、unseen 与 terminal input 等展示字段（[`dashboard-snapshot.ts#L82-L151`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/dashboard-snapshot.ts#L82-L151)）。Renderer 只做过滤、分桶、排序与交互（[`AgentKanbanBoard.tsx#L38-L67`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/renderer/src/components/dashboard-popout/AgentKanbanBoard.tsx#L38-L67)、[`AgentKanbanBoard.tsx#L115-L175`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/renderer/src/components/dashboard-popout/AgentKanbanBoard.tsx#L115-L175)）。
2. **Workspace Kanban**：把 worktree/folder 的手工 `workspaceStatus`、排序、搜索和 host-qualified identity 投影成 lanes；分组函数只读 worktree 元数据并排序（[`workspace-kanban-worktree-groups.ts#L22-L47`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/renderer/src/components/sidebar/workspace-kanban-worktree-groups.ts#L22-L47)）。`Worktree` 自己保存 host、创建 provenance、初始 Agent、status 与 ownership（[`worktree/types.ts#L61-L140`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/worktree/types.ts#L61-L140)、[`worktree/types.ts#L142-L170`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/worktree/types.ts#L142-L170)、[`worktree/types.ts#L201-L220`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/worktree/types.ts#L201-L220)）。
3. **Orchestration Task/Dispatch**：另有 SQLite task、dispatch、message、delivery、decision gate 与 worker resource 表。Task status 和 Dispatch status 是不同类型，并显式处理 duplicate、stale 与 unknown settlement（[`orchestration/types.ts#L20-L37`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/main/runtime/orchestration/types.ts#L20-L37)）；核心 schema 还包含 delivery receipt、mutation receipt 与 terminal resource ownership（[`create-core-tables-sql.ts#L5-L40`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/main/runtime/orchestration/db/schema/create-core-tables-sql.ts#L5-L40)、[`create-core-tables-sql.ts#L78-L175`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/main/runtime/orchestration/db/schema/create-core-tables-sql.ts#L78-L175)）。

这三套状态没有被强行压成一个 enum，是值得保留的事实。对 Stella 来说，外部 CLI 的 `working/needs-input/completed` 只能作为观察事实，不能自动改写业务 Task 的 `planned/running/review/done`；导入或人工操作才改变 Board 所有权。

## 4. 与 Stella v0.5.0 当前实现的直接对照

### 4.1 Stella 已经具备正确的两平面结构

Stella 的执行平面是显式、版本化的：

- backend 仅为 Pi、Codex、Claude；profile 为 `pi.rpc`、`codex.exec`、`codex.review`、`claude.print`（[`execution-profile.ts#L3-L13`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/src/shared/execution-profile.ts#L3-L13)）；
- profile 声明 direct agent、workflow step、worker mention、coordinator、squad、structured result、open session 等能力（[`execution-profile.ts#L15-L40`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/src/shared/execution-profile.ts#L15-L40)）；
- 内置 profile 的能力和约束集中定义，并保存 revision snapshot（[`execution-profile.ts#L93-L181`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/src/shared/execution-profile.ts#L93-L181)）；
- Registry 负责 probe、配置激活、resolve 与 use-case compatibility，而不是 renderer 直接启动命令（[`execution-backend-registry.ts#L23-L31`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/src/main/execution-backend-registry.ts#L23-L31)、[`execution-backend-registry.ts#L47-L153`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/src/main/execution-backend-registry.ts#L47-L153)）。

外部观察平面则是独立 contract：目前只接受 Claude、Codex 两个 source，定义标准 scope、状态、session identity、process、association、source health、stale snapshot 与 lazy details（[`external-execution.ts#L3-L85`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/src/shared/external-execution.ts#L3-L85)、[`external-execution.ts#L107-L135`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/src/shared/external-execution.ts#L107-L135)）。

这两平面对应 Orca 暴露出的真实复杂度，当前不应合并。

### 4.2 Stella 的外部投影比直接 transcript 扫描更适合当前范围

Stella 当前：

- Claude Source 调用结构化的 `claude agents --json --all`，支持 project scope、10 秒 timeout、4 MiB 输出上限和 5,000 条记录上限（[`claude-external-execution-source.ts#L121-L176`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/src/main/claude-external-execution-source.ts#L121-L176)）；
- Codex Source 使用 App Server list/read/turn/notification contract，列表限制 100，详情只按需读取并短期缓存（[`codex-external-execution-source.ts#L209-L278`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/src/main/codex-external-execution-source.ts#L209-L278)）；
- Source 自己拥有 continue 行为：Claude 根据存活状态选择 attach/resume，Codex 生成自己的 resume 命令（[`claude-external-execution-source.ts#L179-L186`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/src/main/claude-external-execution-source.ts#L179-L186)、[`codex-external-execution-source.ts#L281-L285`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/src/main/codex-external-execution-source.ts#L281-L285)）。

相较 Orca AI Vault，这个范围更窄，但依赖的是 provider 的结构化输出，而不是十几种私有存储格式。当前没有事实支持为了“看起来支持更多 Agent”而退回全盘 transcript 扫描。

### 4.3 Stella 已有关键的一致性与降级机制

`ExternalExecutionService` 并行刷新 sources，按 scope 保存 last-good snapshot；refresh 失败时保留旧数据并标记 stale；generation 阻止较早请求覆盖较新结果（[`external-execution-service.ts#L104-L146`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/src/main/external-execution-service.ts#L104-L146)）。它还通过完整 session id/path 将外部执行关联到受管 Task，只在显式 import 时创建独立 manual Task，并保持外部 origin 去重（[`external-execution-service.ts#L149-L208`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/src/main/external-execution-service.ts#L149-L208)）。

Renderer 每 10 秒轮询，只在页面可见且该视图启用时工作；request sequence 和 scope key 阻止迟到结果污染当前 scope（[`use-external-executions.ts#L15-L92`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/src/renderer/src/hooks/use-external-executions.ts#L15-L92)）。UI 清楚声明外部卡片只读、显式导入才创建 Stella Task，并在合并视图隐藏已经 managed 的重复 session（[`ExternalExecutionBoard.tsx#L43-L80`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/src/renderer/src/features/kanban/ExternalExecutionBoard.tsx#L43-L80)、[`KanbanWorkspace.tsx#L276-L332`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/src/renderer/src/features/kanban/KanbanWorkspace.tsx#L276-L332)）。

这些并不是需要被 Orca 替代的缺口。现有单元测试还覆盖 last-good/stale、并发 import 去重、managed association、provider 状态归一化、lazy details、迟到 scope 响应和 visibility polling（[`external-execution-service.test.ts#L93-L197`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/tests/unit/external-execution-service.test.ts#L93-L197)、[`use-external-executions.test.tsx#L44-L99`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/tests/unit/use-external-executions.test.tsx#L44-L99)）。

### 4.4 Stella 与 Orca 在并行写入上的本质差异

Stella 当前用 canonical project path 作为 Workspace Admission key；交互执行冲突会直接失败，后台执行按 FIFO 排队，可取消并在完成后释放 lease（[`workspace-admission.ts#L69-L98`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/src/main/workspace-admission.ts#L69-L98)、[`workspace-admission.ts#L120-L229`](https://github.com/ZY-LI-F/pi-workbench/blob/cb75738dfc440e4309e80598160f720473703b34/src/main/workspace-admission.ts#L120-L229)）。这是“同一目录只有一个写 owner”的模型。

Orca 则把并行工作建立在独立 Git worktree 上。官方 CLI guide 推荐 `worktree create --agent <id> --prompt ...`，每个 worktree 有完整 `<repoId>::<path>` identity（[`orca-cli.md#L93-L120`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/skill-guides/orca-cli.md#L93-L120)、[`orca-cli.md#L138-L155`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/skill-guides/orca-cli.md#L138-L155)）。这能提高并行写吞吐，但同时引入 branch/base ref、setup、ownership、cleanup、review/merge 与外部 worktree 发现等新生命周期；Orca 自己也专门区分 `orca-managed / external / unknown-legacy / agent-scratch` ownership（[`worktree/types.ts#L201-L220`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/src/shared/worktree/types.ts#L201-L220)）。

因此 worktree 不是给现有 lease 加一个 boolean 就能完成的优化。

## 5. 借鉴、改造与不引入清单

| 结论 | Orca 事实 | 对 Stella 的处理 |
| --- | --- | --- |
| **保留并强化：显式能力矩阵** | launch、hook、history、resume 覆盖集合不同 | 继续分开 `ExecutionProfile` 与 `ExternalExecutionSource`。新增第三个 provider 时，先声明 discover/list/details/continue/live/managed-execute 能力，不提供“generic CLI”假能力 |
| **借鉴：provider raw event → normalizer → shared item** | 每个 hook provider 独立 normalizer，再进入共同状态 | Stella 现有 Claude/Codex adapter 已遵循。新增 source 时沿用，不让 renderer 读取 provider 原始字段 |
| **借鉴：Board 是纯投影** | DashboardSnapshot 与 Workspace Kanban 都从状态/store 派生 | 当当前 `ExternalExecutionBoard` 的过滤、分组或层级继续增长时，再抽取纯 `ExternalExecutionCardProjection` builder；不要新增第二个可写 store |
| **借鉴但有条件：状态 evidence metadata** | Orca 已定义 observation origin/authority/revision，但尚无 consumer，远端时钟问题未解决 | 只有 Stella 引入 hook、push notification 与 polling 等多个相互竞争的实时来源时再增加 `evidenceKind/observedAt`，且同一版本必须实际用于仲裁；现在不复制空字段 |
| **借鉴但后置：isolated worktree strategy** | Orca 用 worktree 隔离并行写任务 | 作为独立 Workspace Strategy 设计；Task/Execution Attempt 拥有临时 workspace resource，Execution Profile 不拥有 worktree。先解决创建、base ref、cleanup、人工接管与 merge/review |
| **按规模采用：后台扫描、增量 cache、取消** | AI Vault 为高频、多格式文件扫描付出 service process 与 parser cache | 只有结构化 provider API 无法满足明确需求、且数据规模经测量达到阈值时采用。不要预先引入 18-provider 扫描框架 |
| **不引入：Orca 作为 Stella 运行时依赖** | Orca CLI 管理的是 Orca 自己的 worktree、terminal、runtime 与 UI state | 不让 Stella shell out 到 `orca`，否则产生两套 workspace owner、两套看板与两套恢复语义。Orca 只作独立对照工具 |
| **不引入：通用 PTY/xterm 主机** | `node-pty`、xterm、terminal splits 是 Orca IDE 的核心 | Stella 已有受控 backend invocation；为看板引入完整 terminal emulator 会显著扩大职责且不能自动获得 provider 状态 |
| **不引入：私有 transcript 全盘扫描** | 每 provider 路径、格式、parser 和恢复规则均不同，并存在 stale heuristic | 优先使用 Claude 结构化 CLI 与 Codex App Server。只有新增 provider 没有官方结构化面时，才以实验性、低置信 source 单独实现 |
| **不引入：Orca SQLite orchestration/mailbox/federation** | Orca 有独立 run/message/delivery/task/dispatch/gate/worker resource 系统 | Stella 已有 Board、AgentTask、StepRun、workflow gate 与 runtime token；复制会造成双写与状态竞争。只有持久化跨进程 dispatch 成为真实需求时再补最小模型 |
| **暂缓：SSH/headless/mobile runtime** | Orca 定义 local/ssh/runtime host 与混合版本 wire contract | 当前 Stella v0.5.0 没有该产品边界，不为未来可能性引入 host/wire 复杂度 |

### 5.1 推荐的最小后续代码设计

本轮分析不建议立即重构。等到新增第三个 CLI source 时，再把当前三个 boolean 扩展为能表达来源质量与更新机制的能力对象，例如：

```ts
interface ExternalExecutionSourceCapabilities {
  readonly discovery: "official-api" | "cli-json" | "filesystem";
  readonly updates: "poll" | "notification" | "hook";
  readonly details: boolean;
  readonly import: boolean;
  readonly continue: boolean;
}
```

这属于 `ExternalExecutionSourceDefinition`，不属于 `ExecutionProfileDefinition`。执行 profile 继续回答“Stella 能否用这个 backend 执行某类任务”；external source 回答“Stella 能以何种证据看到外部 session，并能对它执行哪些只读/显式动作”。

如果未来实现 worktree 隔离，建议新建独立 contract：

```ts
type WorkspaceStrategy =
  | { readonly kind: "current-folder" }
  | { readonly kind: "isolated-worktree"; readonly baseRef?: string };
```

由 `WorkspaceProvisioner` 在一次 execution attempt 开始前产生 workspace resource，现有 backend 只接收最终 cwd。相同 canonical path 仍受 `WorkspaceAdmission` 保护；不同 worktree path 天然拥有不同 lease key。Task 完成后是否清理必须由 ownership 与人工接管状态决定，不能由 backend 无条件删除。

## 6. 如何实际使用 Orca，而不污染 Stella 架构

推荐把 Orca 当作独立的并行执行 UX/行为基准，不作为 Stella 内部组件。

### 6.1 安装与启动

官方 README 提供 Release 安装包和 macOS Homebrew：`brew install --cask stablyai/orca/orca`（[`README.md#L210-L226`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/README.md#L210-L226)）。安装后先运行：

```text
orca open --json
orca status --json
orca repo add --path /absolute/path/to/pi-workbench --json
```

Linux 在 Orca 管理终端以外应使用 `orca-ide`，因为裸 `orca` 通常是 GNOME Orca screen reader；这是官方 CLI guide 的明确说明（[`orca-cli.md#L17-L38`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/skill-guides/orca-cli.md#L17-L38)）。

### 6.2 用独立 worktree 比较 Pi、Codex、Claude

分别创建三个隔离 checkout，给它们同一份任务说明：

```text
orca worktree create --name compare-pi --no-parent --agent pi --prompt "<同一任务说明>" --json
orca worktree create --name compare-codex --no-parent --agent codex --prompt "<同一任务说明>" --json
orca worktree create --name compare-claude --no-parent --agent claude --prompt "<同一任务说明>" --json
orca worktree ps --json
```

官方 guide 说明 `--agent` 将 Agent 放入第一个 terminal，`--prompt` 发送初始任务，`--no-parent` 只控制 Orca lineage 而不等同于选择 Git base（[`orca-cli.md#L64-L85`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/skill-guides/orca-cli.md#L64-L85)、[`orca-cli.md#L131-L155`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/skill-guides/orca-cli.md#L131-L155)）。观察与输入可用：

```text
orca terminal list --json
orca terminal read --terminal <handle> --json
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 300000 --json
orca terminal send --terminal <handle> --text "<follow-up>" --enter --json
orca worktree set --worktree <selector> --workspace-status in-review --json
```

这些命令及 terminal handle 的 runtime-scoped 限制见 [`orca-cli.md#L169-L207`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/skill-guides/orca-cli.md#L169-L207)。

适合对照的指标是：首次启动成功率、Prompt 到首个状态的延迟、等待人工输入是否准确、重启后 session/worktree 恢复、并行修改隔离、Diff review 与人工接管路径。不要用 stars、README 功能数或单次演示替代这些行为验证。

### 6.3 不建议的使用方式

- 不在 Stella 的 backend 中调用 `orca worktree create` 或 `orca terminal send`；
- 不把 Orca Workspace Kanban 当作 Stella Board 的数据库；
- 不从 Orca 的 AI Vault 数据库/缓存读取 Stella 的 external executions；
- 不复制 Orca 的用户级 managed hook 安装机制，只为填充 Stella 当前的只读 CLI 看板。

如果未来确实需要跨应用联动，应先定义一套稳定、只读、带版本的外部协议，再决定双方谁拥有 Task、Workspace 与 Execution Attempt。Orca 虽然有 CLI，但官方 guide 将“Orca 正在运行的 editor/runtime”定义为 source of truth（[`orca-cli.md#L17-L23`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/skill-guides/orca-cli.md#L17-L23)）；当前没有证据表明它提供了可由 Stella 共同拥有 Task/Workspace 的跨应用协议。

## 7. 依赖与维护成本判断

Orca 与 Stella 同属 Electron/React/TypeScript 技术族，但 Orca 还依赖 `node-pty`、xterm、`ssh2`、WebSocket、native modules 等终端与远端运行时基础设施（[`package.json#L148-L171`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/package.json#L148-L171)、[`package.json#L173-L273`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/package.json#L173-L273)）。其 scripts 还包含分平台 typecheck、native rebuild、大量 terminal/SSH/E2E/performance gates（[`package.json#L12-L56`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/package.json#L12-L56)、[`package.json#L76-L146`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/package.json#L76-L146)）。

可以借鉴其“复用已有模块、具体领域命名、按平台隔离行为、对远端 wire 变化显式协商”的工程约束（[`AGENTS.md#L9-L26`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/AGENTS.md#L9-L26)、[`AGENTS.md#L42-L69`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/AGENTS.md#L42-L69)），但没有理由把同样的依赖和 CI 规模搬进 Stella。

特别是远端模型会带来混合版本协议、capability negotiation、字段 absent/null 语义和时钟归属；Orca 官方文档也明确列出跨版本测试未覆盖的通道与已知 JSON-RPC error debt（[`remote-wire-compatibility.md#L12-L101`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/docs/reference/remote-wire-compatibility.md#L12-L101)、[`remote-wire-compatibility.md#L103-L140`](https://github.com/stablyai/orca/blob/65dd06a8701d7104340f9774d6f6ff6039488cfe/docs/reference/remote-wire-compatibility.md#L103-L140)）。这进一步支持 v0.5.0 不扩张到 SSH/mobile runtime。

## 8. 最终建议优先级

### 保持 v0.5.0，不做架构重写

1. 保持 Pi/Codex/Claude 的显式 Execution Profile 与 adapter-owned invocation。
2. 保持 Claude/Codex external source 使用结构化接口、只读投影、显式 import、managed session 去重。
3. 保持业务 Task stage、external execution state 与 workflow run/step state 分离。
4. 不引入 Orca CLI、PTY、AI Vault scanner 或 SQLite orchestration 作为依赖。

### 下一次增加 CLI provider 时再做

1. 先写 provider capability matrix，再决定它只支持执行、只支持外部发现，还是二者都支持。
2. 复用现有 backend/source registry；由 adapter 负责 probe、normalize、details 与 continue。
3. 只有 Board projection 逻辑明显增长时，抽纯 projection builder，而不是新增状态库。
4. 先用 provider 官方结构化接口；文件扫描必须是单 provider、可取消、有上限且明确标注证据等级的降级方案。

### 独立规格后才考虑

1. `isolated-worktree` Workspace Strategy；
2. 多 evidence 实时状态仲裁；
3. 远端 execution host；
4. 跨进程持久化 dispatch/worker ownership。

## 9. 研究限制

- 本文做了固定 commit 的源码、测试、配置、官方发布与元数据核验，没有安装或运行 Orca 的 release binary，因此不声称验证其运行时性能、UI 稳定性或跨平台体验。
- Orca 开发活跃，`main` 在研究期间继续前进；本文只保证固定 SHA 上的源码事实。
- README 中的性能与体验宣传没有被当作事实；只有能由源码、测试或官方协议文档直接支持的部分进入结论。
- 对 Stella 的建议只覆盖当前 Pi/Codex/Claude backends、external execution projection、Kanban/workflow 与 workspace 并发边界，不扩展到本轮无关的安全审计或教学性改造。
