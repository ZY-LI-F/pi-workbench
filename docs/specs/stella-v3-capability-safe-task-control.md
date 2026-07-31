# Stella v0.3.0：Capability-safe Pi Workspace 与 Task Control

> 状态：Implemented / Verified on Windows x64
> 日期：2026-07-26
> 目标版本：Stella Pi Workbench v0.3.0 / Board schema v6
> 权威性：本文覆盖 `stella-v2-simple-technical-spec.md` 与 `stella-local-agent-automation.md` 中关于 Board schema、Task 业务阶段、执行终态、Task Room、Coordinator、启动故障和工作区并发的冲突描述；未被本文覆盖的已实现功能继续有效。

## Problem Statement

Stella 已经同时提供完整 Pi 工作台、Kanban、Workflow、AgentTaskQueue、Squad 和 Autopilot，但现有实现仍把它们放在同一个启动故障域和多个互不协调的执行通道中。Board 损坏或 Webhook 端口冲突可以导致整个应用退出；Interactive Pi、Workflow 与 AgentTask 可以同时修改同一个本地工作区；Task 的业务阶段与一次执行的生命周期相互覆盖；Pi 正常返回文本会被误认为成果已经通过验收；后台执行会话还可能自动出现在普通 Pi 会话列表中。

同时，研究文档提出了 Task Room 与持续 Coordinator。如果直接把它们实现为新的持久实体、第二套聊天系统和第三套执行状态机，Stella 会在尚未解决故障隔离、工作区写安全、数据迁移和真状态之前扩大复杂度。用户需要的是简单、可安装、可解释的本地 Agent 工作台，而不是复制外部聊天平台或长期在线的分布式 Agent 基础设施。

## Solution

Stella v3 保留两个并列能力面，但把它们定义为独立状态、运行会话、健康状态和错误边界，而不定义为两个互相竞争的产品：

1. **Pi Workspace** 完整保留当前项目、会话、模型、命令、Prompt、Skill、Extension、工具、分支、上下文、导出和终端能力，不创建 Task 也能使用。
2. **Task Control** 保留 Kanban、Task Detail、Workflow、AgentTask、Squad、Autopilot 和可视化 DAG。Task Room 只是 Task Detail 中由 TaskMessage、Activity、Execution 和 Artifact 组成的时间线投影，不增加 `TaskRoom` 持久实体。
3. Pi 与 Task 之间只有显式桥接：用户主动把当前 Pi 上下文固化为 Task，或主动在 Pi 中打开某次执行会话。普通 Pi 消息不会自动创建 Task 或 AgentTask。
4. Electron 主进程分别维护 Pi、Task、Schedule 和 Webhook 的 Capability Health。非核心 Capability 失败只禁用自己的能力并展示原始错误，不退出整个应用。
5. 所有可能修改工作区的 Interactive Pi、Workflow 和 AgentTask 执行都通过一个应用级 `WorkspaceAdmission`。后台执行按规范化工作区路径获取独占 Lease；冲突必须等待或显式拒绝，不能并发写。
6. Task 的固定业务阶段与 Execution 生命周期分离。运行正常结束只代表 `reported`；成果必须经过用户、Human Gate 或确定性验证后才是 `accepted`。`revision-requested` 与 `rejected` 保留真实验收结论。
7. Board schema v1–v5 均先创建时间戳备份，再确定性迁移为 v6。v6 统一 Task stage、Execution acceptance、`specRevision`、`executionAttempt`、不可变 `TaskSpecSnapshot`、Runtime token 和 Squad 作用域。
8. Coordinator 以持久根 AgentTask 与复核 AgentTask 实现，不新增常驻服务。每个 LEAD 回合必须用终止型 `coordinator_action` 工具提交受 schema 校验的行动；自然语言、手写 JSON 和模型输出中的 mention 都没有控制权。

## User Stories

1. As a Pi user, I want to open Stella and use Pi without creating a Task, so that exploratory work remains immediate and unconstrained.
2. As a Pi user, I want all current Pi pages and interactions to remain available, so that Task Control does not replace my existing workbench.
3. As a Pi user, I want Board corruption to leave Pi usable, so that a task-history problem does not block direct work.
4. As a task user, I want Pi startup failure to leave task history readable, so that I can inspect previous work and errors.
5. As a user, I want a Webhook bind conflict to disable only Webhook triggers, so that Pi, Manual Autopilot and task history remain available.
6. As a user, I want a Schedule startup failure to disable only scheduling, so that the application does not pretend all capabilities failed.
7. As a user, I want every capability to expose loading, ready, degraded or error health, so that failures are visible and attributable.
8. As a user, I want capability errors to preserve their original message, so that local installation and configuration problems are debuggable.
9. As a Pi user, I want ordinary prompts to change only my Pi session, so that exploration never creates hidden task records.
10. As a Pi user, I want an explicit “固化为任务” action, so that I control when conversational context becomes durable work.
11. As a Pi user, I want the created Task to retain the source Pi session identity, so that provenance is not lost.
12. As a task user, I want an explicit “在 Pi 中继续” action, so that I can inspect or continue a chosen execution session.
13. As a task user, I want background execution sessions hidden from the normal Pi history until I explicitly open them, so that automated work does not pollute personal session navigation.
14. As a user, I want Task creation from Pi to prefill useful context without copying the entire conversation silently, so that I can review the exact durable content.
15. As a task user, I want Task business stage to remain independent from queue and runtime states, so that workflow machinery does not unexpectedly move my Kanban card.
16. As a task user, I want to move a Task through fixed Kanban stages explicitly, so that the board remains a business view.
17. As a task user, I want each execution to show queued, running, waiting, reported, failed, interrupted or cancelled independently, so that runtime truth is visible.
18. As a reviewer, I want a reported result to remain pending acceptance, so that a fluent model response is not mistaken for completed work.
19. As a reviewer, I want to accept, request revision or reject a reported execution, so that the acceptance decision is explicit and audited.
20. As a reviewer, I want my acceptance comment stored with the execution, so that later users know why the decision was made.
21. As a reviewer, I want accepting an execution not to silently move the Task card, so that execution truth and business workflow remain separate.
22. As a user, I want failed, interrupted and cancelled executions never to become accepted, so that terminal truth cannot be overwritten.
23. As a user, I want late Runtime callbacks rejected by a persisted token or terminal-state check, so that abort races cannot fabricate success.
24. As a user, I want Workflow and AgentTask execution to obey the same workspace admission policy, so that two engines cannot edit the same directory concurrently.
25. As a Pi user, I want a background writer to block a new write-capable Pi turn with a clear owner message, so that I do not unknowingly race an automated edit.
26. As an automation user, I want background execution to wait visibly while an Interactive Pi turn owns the workspace, so that work is serialized without fake failure.
27. As a user, I want workspace identity based on a normalized real path, so that aliases and path spelling do not bypass the Lease.
28. As a user, I want queued Lease requests to be cancellable when I abort a Task, so that cancelled work never starts later.
29. As a user, I want read-only execution to be treated as read-only only when its actual tools cannot write, so that a label is not mistaken for a security boundary.
30. As a user, I want Agent tool access violations to fail explicitly before launch, so that unsafe definitions do not degrade silently.
31. As a task user, I want Task Detail to show goal, acceptance criteria, comments, dispatch receipts, execution state, artifacts and review decisions in one chronological timeline, so that I do not search across several panels.
32. As a task user, I want Task Room to be this timeline projection rather than another database, so that the Task remains the single source of truth.
33. As a task user, I want timeline entries to preserve stable links to their Run, Step or AgentTask, so that provenance remains inspectable.
34. As a task user, I want user comments and system execution receipts visually distinct, so that a message is not confused with a machine state transition.
35. As a task user, I want user-entered mentions to show that they will create a real AgentTask, so that delegation side effects are explicit.
36. As a task user, I want Agent natural-language mentions and handwritten JSON to remain plain output unless a validated built-in control tool produced them, so that prose is not an implicit command channel.
37. As a Workflow user, I want a read-only DAG generated from the persisted execution snapshot, so that I can understand dependencies without introducing a second execution engine.
38. As a Workflow user, I want DAG nodes to show pending, running, waiting, reported/succeeded, failed and interrupted states, so that the graph reflects runtime truth.
39. As a Workflow user, I want selecting a DAG node to reveal its agent, objective, artifact and error, so that the graph remains actionable.
40. As a user of any bundled skin, I want capability errors, Lease waits, timeline entries, acceptance controls and DAG states fully styled, so that the architecture is understandable in every visual theme.
41. As a keyboard user, I want all new actions reachable and focus-visible, so that the feature remains usable without a mouse.
42. As a narrow-window user, I want the timeline and DAG to remain readable, so that desktop resizing does not hide controls.
43. As a recipient of a Windows or macOS installer, I want Stella to launch its bundled Pi, so that my local Pi installation path is irrelevant.
44. As a recipient of an installer, I want paths containing spaces and Chinese characters to work, so that installation and workspace location are not constrained.
45. As a recipient of an installer, I want every supported v1–v5 Board migrated with a backup and without history loss, so that upgrading is safe.
46. As a recipient of an installer, I want migration failure to preserve the original Board and keep Pi available, so that recovery is possible.
47. As a maintainer, I want release CI to run typecheck, unit tests, production build and packaged smoke tests, so that installers are not published from source-only evidence.
48. As a maintainer, I want fault-injection tests for Board, Pi, Schedule and Webhook capabilities, so that independence is continuously verified.
49. As a maintainer, I want integration tests that run Workflow and AgentTask against the same workspace admission boundary, so that local class tests cannot miss cross-engine races.
50. As a maintainer, I want Pi compatibility tests to prove normal Pi actions leave Task state unchanged, so that future Task features cannot silently capture Pi usage.

## Implementation Decisions

1. The Electron main process remains the authority for local persistence, Pi child processes, Capability Health, Workspace Admission, scheduling, loopback networking and project trust.
2. Pi Capability, Task Capability, Schedule Capability and Webhook Capability each expose an immutable health record with `loading`, `ready`, `degraded` or `error`, an optional exact error and a last-change timestamp.
3. The desktop shell and IPC boundary are registered before optional Task services initialize. A Task initialization error is retained and returned by Task commands; it does not terminate the desktop shell.
4. Pi initialization and Task initialization are independently retryable. A failed Capability never returns placeholder data or mock success.
5. Board schema version is 6. The parser accepts v1–v5 only for migration; all writes use v6.
6. Before replacing legacy data, BoardStore writes a timestamped backup. Migration is pure, deterministic and preserves Tasks, Workflow Runs, Activities, Comments, AgentTasks, Squads, Autopilots and Autopilot Runs. Legacy executions that cannot be resumed safely terminate with an explicit migration error and activity.
7. Task uses a fixed business `stage`; Execution and AgentTask use separate lifecycle states. Dispatch, Runtime settle, failure, interruption and acceptance never move the Task stage implicitly.
8. Legacy task status migrates to the nearest business stage. Runtime-only values use this mapping: `queued → planned`, `running → planned`, `failed → blocked`, `interrupted → blocked`; existing `planned`, `review`, `blocked` and `completed` retain their matching stage.
9. A root Workflow Run or root AgentTask stores an acceptance state. A successful Runtime report produces `reported` with `pending` acceptance. Failed, interrupted and cancelled executions cannot be reviewed as successful.
10. Acceptance commands require an explicit decision and non-empty comment for revision or rejection. They append immutable Activity and TaskMessage records.
11. A future revision dispatch increments `executionAttempt` and captures the current `specRevision` in an immutable `TaskSpecSnapshot`; historical acceptance is never rewritten to pretend the previous attempt succeeded, and a late old-spec Runtime cannot mutate the new Task lifecycle.
12. Task Room is a derived timeline sorted by timestamp and stable tie-breaker from Task metadata, TaskComment, Activity, Workflow Run/Step, AgentTask and Artifact records. No `TaskRoom` collection is added.
13. The DAG is a derived read-only projection of the snapshotted Workflow definition and Step Runs. Graph layout state is renderer-only and never becomes execution truth.
14. Pi→Task bridge stores explicit source session identity and presents an editable Task draft before persistence. It does not copy hidden tool messages or automatically dispatch.
15. Task→Pi bridge switches only to a user-selected persisted execution session. It never injects background events into the currently active Pi session.
16. Background sessions use a stable Stella task-session marker and are filtered from normal Pi history. Explicit session-path opening remains supported.
17. One injected `WorkspaceAdmission` is shared by Interactive Pi command routing, WorkflowOrchestrator and AgentTaskRunner. Business services never instantiate their own Lease manager.
18. Workspace keys use canonical absolute paths with platform-appropriate case normalization. Canonicalization failure is explicit.
19. Background execution acquires an exclusive Lease before launching a write-capable Pi turn and releases it on settle, failure, abort and shutdown. Waiters are FIFO and cancellable.
20. Interactive `prompt`, `steer`, `follow_up` and `bash` are treated as write-capable because the active Pi configuration can invoke write tools. If a background owner holds the workspace, the command is rejected with the owner and Task identity.
21. Background execution waits while an Interactive Pi turn owns the workspace. The wait is persisted or projected as an explicit execution/activity state; it is not reported as running before the Runtime starts.
22. Read access can skip the exclusive Workspace Lease only when actual tools exclude write-capable tools and Extensions, Skills, Prompt Templates and Context Files are all disabled. Resource discovery therefore participates in the same admission boundary instead of silently expanding read authority.
23. Existing Manual, Schedule and Webhook Autopilots remain. Schedule and Webhook start outside the application-critical path; their health errors are visible without disabling Manual execution.
24. Squad definitions are versioned and explicitly global or project-scoped. A Squad that references a project Agent cannot be used by another project; dispatch freezes its version, instructions and member Agent snapshots.
25. User-entered validated mentions may create AgentTasks. LEAD control actions are accepted only from the built-in terminating `coordinator_action` tool; natural-language output and handwritten JSON are never parsed as a general control protocol.
26. Renderer state for Pi and Task capabilities remains independent. A Pi error can coexist with a usable Task view, and a Task error can coexist with a usable Pi view.
27. New code follows dependency injection and immutable state updates. Errors cross IPC as explicit failures or Capability Health; no silent fallback Board or fake successful execution is introduced.
28. The Task Launchpad requires one `@LEAD`, a concrete goal and explicit acceptance criteria. Task, first message and queued Coordinator are committed atomically after project identity and required-Skill preflight succeed.
29. Required Skills are discovered with Pi's Resource Loader before dispatch and checked again against the started Runtime. A missing Skill prevents queue creation or fails the exact claimed execution explicitly; it never produces a template result.
30. Every running StepRun and AgentTask owns a Runtime token. Settle, fail, abort, shutdown and recovery transitions compare that token inside the same repository transaction.
31. Pi RPC request timeout stops the child Runtime before pending work rejects and the workspace Lease releases; the error states that the execution result is unknown.
32. The app has an explicit first-use project-selection state. A placeholder path is never presented as a user-confirmed project, and global model identity remains visible on Team, Kanban and Pi pages.
33. Modal, command palette, sidebar, Task detail and compact Team Pulse provide focus containment/restoration, Escape semantics, `inert` off-canvas content and responsive access to every action.

## Testing Decisions

1. Tests assert observable behavior at the highest available seam. Unit tests are used for pure migration, state transition and Lease ordering; integration tests exercise services through one shared Workspace Admission; renderer tests exercise user-visible controls; packaged tests verify the installed runtime boundary.
2. BoardStore tests cover v1/v2/v3/v4/v5→v6 migration, backups, preservation of every collection, malformed input, migration failure and startup recovery.
3. Capability startup tests inject Board parse failure, Pi RPC failure, Schedule failure and Webhook bind conflict independently and assert that unrelated capabilities remain usable.
4. WorkspaceAdmission tests cover canonical aliases, FIFO ordering, interactive rejection, background waiting, abort-before-acquire, release on every terminal path and shutdown cleanup.
5. Cross-engine integration tests start a Workflow and AgentTask for the same workspace and prove the second Runtime cannot start until the first Lease releases.
6. Interactive integration tests prove a background writer blocks Pi prompt/bash and an interactive turn delays background launch.
7. Execution tests prove `reported` is not `accepted`, false-success text remains pending review, acceptance decisions are immutable and Task stage does not move automatically.
8. Task timeline tests use the derived projection as the seam and verify stable chronological ordering, provenance links, distinct message/receipt rendering and all acceptance actions.
9. Bridge tests prove ordinary Pi operations do not change Board state, Pi→Task requires explicit confirmation, Task→Pi opens only the chosen session and background sessions remain hidden from normal history.
10. DAG tests verify nodes and edges are derived from the Workflow snapshot, state styling follows Step Runs and selecting a node reveals persisted detail.
11. Existing Pi component and runtime reducer tests remain regression evidence. The packaged suite additionally exercises a real prompt path where credentials are available and always verifies bundled Pi resolution without relying on a global executable.
12. Release CI runs `npm run check`, production build and packaged smoke tests on each target OS before installer upload.

## Implementation Evidence

2026-07-18 的实现与验证结果：

- Board v3、v2→v3 纯迁移、迁移前备份、四类 Capability Health、共享 WorkspaceAdmission、Execution Acceptance、Task Room、Pi↔Task bridge、session 隔离和只读 DAG 均已落入代码与自动化测试。
- `npm run check`：23 个 Vitest 文件、91 个测试通过；覆盖迁移、故障隔离、跨执行器 Lease、false-success、timeline、bridge、history filter、DAG 和原有 Pi/Automation 回归。
- `npm run build`：main、preload、renderer 三个 production bundle 构建通过。
- `tests/e2e/app.spec.ts`：真实 Electron + Pi RPC 冷启动及完整交互通过，并生成 `docs/task-room-stella.png` 等截图。
- `npm run test:packaged`：在清空 `PATH` 后启动新生成的 Windows x64 unpacked 应用，内置 Pi 与 Task capability 均到达 `ready`。
- Windows x64 NSIS：`release/Stella Pi Workbench-0.1.0-win-x64.exe` 已生成；SHA-256 为 `0C52AFF44411A04FAAA65178B6775E7AAD05E761CB4B9C7967187691463C5C82`。
- `.github/workflows/release.yml`：Windows x64、macOS arm64、macOS x64 均在 installer 上传前执行 `check → native unpacked package → packaged smoke → distributable`。macOS 原生执行由对应 GitHub runner 完成，不把 Windows 交叉构建当作验证证据。

2026-07-21 发布验证：应用版本已更新为 `0.2.0`；Windows x64 NSIS 为 `release/Stella Pi Workbench-0.2.0-win-x64.exe`，SHA-256 为 `AE91147C0C7CE633BC1E6E05A4E62055669FA4AD6BE32F3EA0FC3DFC013FA8EF`，打包版 E2E 通过。

2026-07-24 初始 v0.3.0 加固验证：Board schema 升级到 v5，以唯一执行尝试和待验收引用隔离历史结果；Coordinator/Squad 保存分发计划快照；后台执行改用实时项目 trust；Task Room 增加项目边界；Pi RPC 请求具有显式超时；Coordinator 协议错误保留原始产物、会话与 token；全局字号覆盖所有页面。43 个 Vitest 文件、194 个测试全部通过。该同版本安装器已由 2026-07-26 的全量修复构建取代。

2026-07-26 v0.3.0 全量修复验证：Board schema 升级到 v6，以不可变 `TaskSpecSnapshot`、规格修订、执行尝试和 Runtime token 阻止过期执行回写；Coordinator 改用必需的 `coordinator_action` 类型化工具；任务启动台原子创建 Task、首条消息和 LEAD；Pi Resource Loader 在入队与运行前验证 Skills；Squad 增加版本和项目作用域；首启项目选择、全局模型、响应式 Team/Kanban、焦点陷阱、字号和八套原创皮肤完成统一。46 个 Vitest 文件、203 个测试、3 项确定性 Electron E2E 及 1 项打包冒烟全部通过。打包冒烟清空 `PATH` 和 Pi 用户配置后，内置 Pi 0.82.1 与 Task capability 均为 `ready`。Windows x64 NSIS 为 `release/Stella Pi Workbench-0.3.0-win-x64.exe`，大小 `133619447` bytes，SHA-256 为 `F29AA268BB81B38A70D0BA4EDF29E4DFB4BF11F4C67FC0F0EBB3D59B487E7762`。

## Out of Scope

- A separate always-on Coordinator service or shared Coordinator Runtime outside persisted AgentTask execution.
- LLM 自动越过人工最终验收；Coordinator 的委派、修订和重规划只能通过受校验的结构化协议推进。
- A separate persistent TaskRoom entity or second Task message database.
- External Matrix, Slack, Teams or HiClaw-style channel infrastructure.
- PostgreSQL, Redis, a remote backend, an independently installed Daemon or multi-user synchronization.
- Parallel write execution in the same workspace.
- OS-level sandbox claims. WorkspaceAccess is enforced as an application capability policy, not described as an operating-system security boundary.
- A free-form visual DAG editor. The v3 DAG is a read-only projection of persisted execution truth.
- User-defined plugin hosting for Coordinator tools.
- Automatic ingestion of ordinary Pi conversations into the Board.

## Further Notes

- “双平面” describes Capability ownership, health and state boundaries. It does not require two separate application shells.
- “Task Room” is a user-facing name for the Task Detail timeline and is not a domain entity.
- “reported” means a Runtime delivered a result; “accepted” means a reviewer confirmed that result satisfies the Task acceptance criteria.
- Existing v2 user data is part of the supported upgrade path. Destructive reset is never an acceptable migration strategy.
- The visual DAG remains a required user-facing capability, but it reads from the same Workflow/Execution snapshot as the timeline and cannot independently mutate execution.
