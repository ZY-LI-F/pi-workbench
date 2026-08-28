# Stella v0.5.0 · Orca 借鉴能力统一规格

> 状态：Track A–C 已实现并通过 v0.5.0 全链路验收；Relay/FCM 后置
>
> 产品版本：`0.5.0`
>
> 目标 Board schema：`9`
>
> Companion Wire Protocol：`1`
>
> Orca 研究快照：`65dd06a8701d7104340f9774d6f6ff6039488cfe`
>
> Stella 基线快照：`cb75738dfc440e4309e80598160f720473703b34`

> 实现结果：Provider 能力真实性、统一 Agent Projection、schema 9 execution workspace、受限并发和 Android Companion 均已交付。验收记录见 [`../testing/stella-v0.5.0-release-acceptance-2026-08-29.md`](../testing/stella-v0.5.0-release-acceptance-2026-08-29.md)。

## Problem Statement

Stella v0.5.0 已经具备 Pi、Codex CLI、Claude CLI 执行 Profile，Claude/Codex 外部执行视图，持久化 Board、Workflow、AgentTask、人工关卡、验收、运行时 token 和同目录写入准入。它解决了“由哪个 CLI 执行”和“如何查看外部 CLI 活动”的基础问题。

经过对 Orca 固定提交的 README、源码、测试、协议和移动端实现进行核验，Stella 仍有四个可以从事实出发继续提升的方向：

1. CLI 的“可启动、可受管执行、可发现、可观测、可读取详情、可继续”是不同能力。当前 Stella 已有两个正确的 seam，但产品层还缺一份明确、可展示、可测试的能力矩阵，未来增加 Provider 时容易再次把“命令能启动”误写成“完整支持”。
2. Stella 目前以 canonical project path 做写入准入，并由单一 AgentTask Runner 串行执行。它能保护当前目录，却无法让多个写 Agent 在同一 Git 仓库中真正并行。Orca 的独立 worktree 模型提供了有事实依据的解决思路。
3. Stella 已有外部执行卡片和 Task timeline，但桌面看板、未来 Attention Feed 和 Android Companion 需要共享一套纯投影，不能各自重写状态归一化和排序逻辑，也不能创建第二份运行状态。
4. 用户离开电脑后无法查看 Agent attention、回复等待中的 Coordinator、处理人工关卡或验收。Orca 的移动 Companion 证明“桌面为事实源、手机为 read-mostly 控制器”的产品模型可行，但 Stella 必须按自身 Board/Execution 语义实现，不能复制 Orca 的 PTY、终端、SSH 和 Relay 子系统。

本规格的目标不是把 Stella 改造成 Orca，也不是按 Orca 的功能清单扩张。目标是只采纳经源码验证、与 Stella 当前职责一致、能够保持 Module 清晰和代码整洁的设计。

## Solution

在保留现有 Board、Execution Backend 和 External Execution Source 所有权的前提下，交付三个相互配合、职责独立的能力轨道：

### Track A — 诚实的 Agent Integration 能力与统一投影

- 保留 `Execution Backend` 和 `External Execution Source` 两个现有 seam。
- 为 Provider/Profile/Source 建立显式能力描述，准确区分 managed execution、discovery、live status、details、continue 和 session quality。
- 所有 Provider 原始数据必须由 Adapter 归一化，Renderer 和 Android 不读取 Provider 私有字段。
- 建立一个纯 `Agent Projection` Module，把 Board、Workflow/AgentTask 和 External Execution 投影为桌面与移动端可复用的 Attention/Working/Recent/Idle 读模型。
- 投影不是数据库，不拥有状态，不反向改变 Task 生命周期。

### Track B — 可选 Git worktree 执行工作区

- 新增一个独立的 `Execution Workspace` Module，在 Backend 执行前取得最终 cwd。
- 支持 `current-folder` 与 `isolated-worktree` 两种策略。
- 当前目录继续使用既有 Workspace Admission；独立 worktree 使用独立 cwd lease，并在仓库级序列化 worktree 创建和移除。
- Execution Backend 只接收最终 cwd，不了解 branch、worktree 创建、清理和人工接管。
- Runner 从全局单执行升级为有上限的并发执行集合；只有获得不同写工作区的任务才能并行。
- Worktree 的保留、验收、合并和清理形成显式生命周期，失败或未验收执行不得自动删除现场。

### Track C — Android Companion APK

- 新增独立 React/Vite/Capacitor Android App。
- 桌面 Main 保持唯一事实源，通过版本化 Companion Control Plane 向手机提供 compact snapshot、typed command 和 projected event。
- 首版支持 Agent 状态、Attention、Task timeline、Task Room 回复、Agent mention、Coordinator 回复、人工关卡、执行验收、任务终止和外部 CLI 只读状态。
- 首版连接范围为同一 LAN 或用户已有的私有网络路径；可靠后台推送和 Stella Relay 后置。
- Android 子规格继续约束 APK 工具链、配对、协议、移动 UI 和发布流程。

```text
Provider / CLI raw facts
        │
        ▼
Execution Backend Adapters ──────► Managed Execution
External Source Adapters ────────► External Observation
        │                                │
        └──────── normalized facts ──────┘
                         │
                         ▼
               Agent Projection Module
                 │                 │
                 ▼                 ▼
          Desktop Kanban      Companion Snapshot
                                      │
                                      ▼
                              Android Companion APK

Task / Workflow / Agent dispatch
                │
                ▼
       Execution Workspace Module
        ├── current-folder
        └── isolated-worktree
                │ final cwd
                ▼
          Existing Backend
```

Orca 只作为参考实现和独立测试工具，不成为 Stella 的依赖、数据库、终端宿主或状态来源。

## User Stories

### Agent Integration 与能力真实性

1. As a Stella user, I want every CLI integration to state exactly which capabilities it supports, so that “installed” is not confused with “fully managed.”
2. As a Stella user, I want to distinguish a CLI that can run Stella tasks from one that can only be observed externally, so that task creation does not offer unsupported execution choices.
3. As a Stella user, I want unavailable capabilities to show a concrete reason, so that I know whether the CLI, version, authentication or protocol is missing.
4. As a Stella user, I want a Provider failure to disable only its own Profile or Source, so that Pi, Codex, Claude and the Board do not fail together.
5. As a Stella user, I want session continuation to appear only when the Adapter has a tested continuation contract, so that the UI never constructs speculative commands.
6. As a Stella user, I want external discovery quality to be visible when it uses official structured output, polling or a weaker fallback, so that status confidence is understandable.
7. As a Stella user, I want Provider version and last successful probe time to be visible, so that stale compatibility assumptions can be diagnosed.
8. As a Stella user, I want adding a future CLI to require an explicit capability declaration, so that a generic shell command cannot silently bypass product rules.
9. As a Stella user, I want Provider-specific raw states to be normalized consistently, so that working, needs-input, completed and failed mean the same thing in the UI.
10. As a Stella user, I want Task stage and external CLI state to remain separate, so that an external session finishing cannot automatically complete a Stella Task.
11. As a Stella maintainer, I want execution and external discovery to remain separate seams, so that machine-protocol execution does not inherit transcript scanning complexity.
12. As a Stella maintainer, I want each Adapter to own invocation, parsing, resume and error translation, so that Provider details stay local.
13. As a Stella maintainer, I want capabilities to be derived from definitions rather than duplicated across settings and task editors, so that one change updates every caller.
14. As a Stella maintainer, I want tests to reject capability claims without a real Adapter path, so that README/UI support matrices cannot drift from implementation.

### Agent Projection 与 Attention

15. As a Stella user, I want one Attention view containing managed Agents that need input, human gates and pending reviews, so that I can find required actions quickly.
16. As a Stella user, I want working Agents ordered by meaningful recent activity, so that the busiest task is visible without opening every card.
17. As a Stella user, I want completed and failed Agent activity to remain visible for a bounded recent period, so that I can see what changed while I was away.
18. As a Stella user, I want idle external sessions separated from active work, so that old CLI history does not overwhelm current tasks.
19. As a Stella user, I want parent/child Agent relationships represented in the projection, so that Coordinator, delegated workers and sub-agents remain understandable.
20. As a Stella user, I want current tool, short assistant summary and update time shown when the source provides them, so that cards contain actionable context.
21. As a Stella user, I want missing optional evidence omitted rather than guessed, so that the UI does not invent tools, prompts or waiting reasons.
22. As a Stella user, I want stale external source snapshots clearly marked, so that cached observations are not mistaken for live facts.
23. As a Stella user, I want imported external executions associated with their Stella Task without creating duplicate state ownership, so that one activity is not shown twice.
24. As a Stella user, I want desktop and Android to use the same status buckets and attention reasons, so that switching devices does not change meaning.
25. As a Stella maintainer, I want projection functions to be pure and storage-free, so that they are easy to test and cannot mutate Board state.
26. As a Stella maintainer, I want presentation seen/unseen markers stored outside BoardState, so that device-specific UI preferences do not alter domain data.
27. As a Stella maintainer, I want one projection implementation shared by desktop and Companion protocol, so that sorting and attention logic do not diverge.

### Isolated worktree 执行

28. As a Stella user, I want to choose current-folder or isolated-worktree execution for a writable automated task, so that I can balance simplicity and parallelism.
29. As a Stella user, I want read-only Agents to avoid unnecessary worktree creation, so that cheap analysis tasks stay fast.
30. As a Stella user, I want a non-Git project to continue using the current folder, so that worktree support does not break ordinary directories.
31. As a Stella user, I want each isolated execution to start from an explicit base ref, so that the resulting diff has a known baseline.
32. As a Stella user, I want each isolated execution to have a stable branch and workspace identity, so that its files and result can be reviewed later.
33. As a Stella user, I want multiple writable Agents to run concurrently only when they have distinct workspaces, so that parallelism cannot corrupt one checkout.
34. As a Stella user, I want tasks targeting the same current folder to retain FIFO writer admission, so that the existing safe behaviour remains intact.
35. As a Stella user, I want worktree creation or setup failure to fail only that execution attempt, so that unrelated queued tasks continue.
36. As a Stella user, I want setup progress and failure recorded in the Task timeline, so that an Agent is not shown as working before its workspace exists.
37. As a Stella user, I want an interrupted execution to preserve its worktree by default, so that partial work is recoverable.
38. As a Stella user, I want reported worktrees preserved through review, so that I can inspect the exact code that produced the report.
39. As a Stella user, I want accepted work to offer an explicit retain, merge-ready or cleanup decision, so that branches are not deleted implicitly.
40. As a Stella user, I want rejected or revision-requested work to keep a traceable relationship to the next attempt, so that history remains explainable.
41. As a Stella user, I want external or manually created worktrees left untouched unless explicitly adopted, so that Stella does not delete user-owned directories.
42. As a Stella user, I want the concurrency limit configurable at application level, so that the machine is not overloaded by too many CLI processes.
43. As a Stella user, I want shutdown to interrupt active executions and retain their workspace records consistently, so that restart reconciliation is deterministic.
44. As a Stella maintainer, I want Backend Adapters to receive only final cwd, so that Git lifecycle does not spread into Pi, Codex and Claude implementations.
45. As a Stella maintainer, I want worktree provisioning tested against real temporary Git repositories, so that command behaviour is not hidden behind mocks.
46. As a Stella maintainer, I want current-folder and isolated-worktree implementations behind one small interface, so that Runner logic does not branch on Git commands.

### Android Companion

47. As a Stella user, I want to install a versioned APK on Android, so that I can monitor Stella away from the desk.
48. As a Stella user, I want to pair a phone with a desktop through a short-lived QR offer, so that host setup is simple.
49. As a Stella user, I want to see whether the desktop is online, reconnecting or offline, so that cached data is not mistaken for live state.
50. As a Stella user, I want the last successful mobile snapshot to remain visible with a stale timestamp, so that temporary disconnects do not erase context.
51. As a Stella user, I want mobile Attention to prioritize waiting-human, gate, review and failed states, so that I can act on the phone quickly.
52. As a Stella user, I want to open a Task and read recent timeline and Agent summaries, so that I can understand the request without the desktop.
53. As a Stella user, I want to send a Task Room message, so that decisions and context can be recorded remotely.
54. As a Stella user, I want a mobile reply to resume a waiting Coordinator exactly once, so that network retries do not create duplicate rounds.
55. As a Stella user, I want allowed `@mention` dispatch from mobile to use the same preview and validation as desktop, so that its effect is predictable.
56. As a Stella user, I want to approve or reject a human gate from mobile, so that a Workflow can continue while I am away.
57. As a Stella user, I want to accept, reject or request revision on a report from mobile, so that review remains explicitly human-owned.
58. As a Stella user, I want to abort a Stella-managed task after confirmation, so that a runaway execution can be stopped remotely.
59. As a Stella user, I want Claude/Codex external sessions visible as read-only cards, so that externally launched work is not invisible.
60. As a Stella user, I want unsupported external reply actions absent, so that the phone does not imply Stella owns an external PTY.
61. As a Stella user, I want mutating mobile commands to be idempotent, so that reconnects cannot duplicate comments or decisions.
62. As a Stella user, I want a protocol mismatch to block mutations and explain which peer must update, so that old APKs fail clearly.
63. As a Stella user, I want to revoke a lost phone from desktop, so that its credential stops working.
64. As a Stella user, I want the first release to work on LAN or an existing private network path, so that Stella does not require a new cloud account.
65. As a Stella user, I want the app to state that desktop must remain running, so that mobile monitoring does not promise a daemon that does not exist.
66. As a Stella maintainer, I want Android to consume compact projections and typed commands, so that it never imports Electron code or raw Board storage.
67. As a Stella maintainer, I want a mock Companion host, so that mobile behaviour can be developed without an Android device or running desktop.
68. As a Stella maintainer, I want reproducible debug and signed release APK builds, so that artifacts can be verified and distributed consistently.

## Implementation Decisions

### 1. Preserve existing ownership

- Board Repository remains the only persistent owner of Stella Tasks, WorkflowRuns, AgentTasks, comments, activities, gates and acceptance.
- Execution Backend remains the owner of Stella-launched process protocol and final execution result.
- External Execution Source remains the owner of provider-specific external discovery, details and continuation.
- Execution Workspace owns temporary checkout lifecycle but does not own Task state or process protocol.
- Agent Projection derives read models and owns no persisted domain state.
- Companion Control Plane exposes a remote view over existing application behaviour and owns no second Board.
- No implementation may let an external observation automatically complete or approve a Stella Task.

### 2. Provider capability model

- Keep Execution Profile capabilities focused on managed execution use cases such as direct Agent, workflow step, worker mention, Coordinator, Squad, structured result and session opening.
- Extend External Source definition from three feature booleans into an explicit capability object that states discovery mechanism, update mechanism, details, import, continuation, hierarchy and evidence quality.
- Settings and Task editors derive availability from the same definitions and health snapshots used by Main validation.
- A CLI is advertised as a managed backend only when its Adapter can provide deterministic completion, normalized errors and cancellation for the declared use cases.
- A CLI is advertised as an external source only when it has a bounded, tested discovery path.
- Launchability alone is not a managed-execution capability.
- Arbitrary user-provided shell command strings remain prohibited as task Profile definitions.
- Provider-specific options stay inside the Adapter and catalog definition; the Board stores only stable Profile identity and immutable execution snapshot.
- Do not add Orca as an Execution Backend. Orca is an aggregator/runtime product, not a provider machine protocol.
- Do not add an Orca External Source in this milestone. Revisit only if a real user workflow requires cross-application observation and Orca exposes a stable, versioned, read-only contract that does not create shared ownership.

### 3. Provider normalization

- Every Adapter transforms raw provider records/events into shared Execution Event or External Execution values before other Modules see them.
- Renderer and Android never parse provider JSON, CLI text, transcript files, terminal titles or resume flags.
- Continuation remains Adapter-owned; clients submit stable identity and receive a normalized outcome.
- Official structured interfaces remain preferred over private filesystem scanning.
- Private transcript scanning is not introduced as a generic fallback. A future provider-specific scanner requires its own bounded scope, cancellation, record limits, freshness semantics and explicit evidence quality.
- Do not copy Orca's unused observation provenance fields. Add evidence authority/revision only when at least two real status sources compete and the same release implements actual arbitration.

### 4. Agent Projection Module

- Introduce one pure Module that consumes normalized Board and external execution inputs and returns presentation-ready cards/buckets.
- The interface accepts immutable snapshots and view options; it returns immutable projections with no callbacks or storage handles.
- Presentation buckets are `attention`, `working`, `recent` and `idle`. They do not become Board enums and do not overwrite Task stages.
- Attention includes waiting Coordinator/Squad Leader, Workflow human gate, pending execution review, managed execution failure and provider-reported needs-input.
- Cards preserve provenance, project, parent identity, managed/imported association, current tool, short message, timestamps and source freshness when available.
- Missing optional facts remain absent. The Module never invents prompt, tool, waiting reason, session or completion.
- Desktop external activity and Android Companion use the same projection implementation.
- Device-specific seen/unseen state is stored as UI preference keyed by stable projection identity, outside BoardState.
- Extract this Module when implementing Companion or when desktop projection logic changes; do not create an unused abstraction in isolation.

### 5. Execution Workspace seam

- Add a deep `Execution Workspace` Module with a small interface: acquire a workspace for an immutable execution attempt and release/finalize that exact resource.
- Two real implementations justify the seam: current-folder and isolated-worktree. Tests use the same interface with temporary repositories.
- The Module returns a resource containing stable identity, strategy, repository root when applicable, actual cwd, branch/base ref when applicable, ownership and lifecycle state.
- Execution Backend receives only actual cwd and existing trust/profile/agent inputs.
- Current-folder implementation preserves existing canonical path admission and FIFO semantics.
- Isolated-worktree implementation creates a Stella-owned worktree and branch from an explicit base ref. Default base selection is resolved once at dispatch and persisted in the execution snapshot.
- Repository-level provisioning is serialized because multiple worktrees share Git administrative state even when their working directories differ.
- Project setup is an owned workspace lifecycle phase. An Agent process starts only after required setup succeeds or an explicit no-setup policy is recorded.
- Non-Git repositories, read-only tasks and unsupported Profile combinations fall back to current-folder or are rejected with a clear compatibility reason according to saved strategy.
- User-owned and externally discovered worktrees are never removed automatically.

### 6. Persisted execution placement

- Board schema increases from `8` to `9` because new executions persist an immutable workspace placement snapshot.
- Workflow root execution and root AgentTask store placement strategy and resolved resource identity. Child steps/tasks inherit the root placement unless an explicit future design says otherwise.
- Existing schema-8 records migrate to `current-folder` placement without changing historical cwd semantics.
- Runtime settlement continues to require execution ID and runtime token; placement identity is an additional ownership check, not a replacement.
- Restart reconciliation marks an execution interrupted when its process is gone. A retained worktree remains inspectable and is not inferred to be successfully completed.
- Placement history remains visible after cleanup; cleanup removes the resource, not the audit record.

### 7. Runner concurrency

- Replace the single global active AgentTask slot with a bounded set keyed by execution identity.
- The scheduler may claim another task only when capacity exists and the required workspace can be admitted or provisioned.
- Same current-folder writers remain FIFO and cannot run concurrently.
- Distinct Stella-owned worktrees may run concurrently up to the configured application limit.
- Workflow orchestration and direct AgentTask execution use the same workspace ownership rules.
- Abort, shutdown and completion target the exact execution and runtime token; one task cannot cancel another active entry.
- A provisioning failure releases only its own reservations and records a terminal failure on that attempt.
- Fairness prevents a stream of isolated tasks from permanently starving a queued current-folder task.

### 8. Worktree review and cleanup

- Worktree lifecycle states include provisioning, ready, active, retained-for-review, retained-after-interrupt, cleanup-eligible, cleaned and cleanup-failed.
- Reported work remains retained until explicit acceptance/rejection handling has run.
- Accepting a report marks the workspace cleanup-eligible but does not delete it in the same transaction.
- Cleanup is an explicit idempotent operation that first verifies Stella ownership, exact path, worktree registration and branch state.
- Rejected and revision-requested results retain the worktree by default. A new attempt receives a new placement unless the user explicitly chooses to continue the prior workspace in a later specification.
- The first release does not automatically merge branches. Reviewers can inspect the worktree/branch and use existing Git tooling.
- Cleanup failures are visible and retryable; they do not roll back Task acceptance.

### 9. Companion Control Plane

- Android implementation follows the detailed Android Companion sub-spec.
- Define one high-level Companion Control Plane interface exposing compact snapshot, typed command and projected subscription.
- The implementation maps mobile commands to the same application Modules used by Electron IPC; it does not copy validation rules into transport handlers.
- Mutating commands carry client-generated idempotency keys and use a bounded persisted receipt store outside BoardState.
- The mobile snapshot includes the shared Agent Projection plus Task detail fragments and command affordances derived from current domain state.
- The first Transport Adapter is direct WebSocket over LAN or an existing private network path. A mock/in-memory Adapter is used for tests.
- Pairing establishes a revocable per-device identity and protocol compatibility state.
- Closing desktop makes the host offline. No daemon is introduced in this milestone.

### 10. Android packaging

- Implement Android as a dedicated React/Vite/Capacitor application, not an Electron target and not a copy of the desktop layout.
- Share only dependency-light protocol, projection, schema, formatting and visual-token Modules.
- Keep native Android project and Gradle wrapper versioned and provide reproducible debug and signed release APK commands.
- Desktop and APK display version `0.5.0`; Android `versionCode` and Companion protocol version evolve independently.
- Initial distribution is a checksumed GitHub Release APK.
- Reliable background notifications and a Stella-hosted Relay remain later milestones because FCM needs a trusted sender and the desktop cannot embed server credentials.

### 11. Delivery order

#### Milestone 0 — Baseline and contract fixtures

- Freeze current v0.5.0 managed execution, external source, Board migration and workspace admission tests as regression gates.
- Add capability-catalog consistency tests without changing product behaviour.
- Confirm Android debug toolchain with a mock-status APK.

#### Milestone 1 — Integration capability truth and shared projection

- Extend Source capability definitions and derive UI availability from definitions/health.
- Extract the Agent Projection Module and switch the existing desktop external activity surface to it.
- No new Provider and no new persistence schema in this milestone.

#### Milestone 2 — Execution Workspace and schema 9

- Implement current-folder Adapter through the new seam first and prove no behaviour change.
- Add schema-8 to schema-9 placement migration.
- Implement isolated-worktree provisioning, persistence, review retention and cleanup.
- Keep Runner concurrency at one until workspace lifecycle tests pass.

#### Milestone 3 — Bounded parallel execution

- Upgrade AgentTask and Workflow scheduling to bounded active sets.
- Prove same-folder serialization, distinct-worktree parallelism, abort isolation and restart reconciliation.
- Add visible workspace/branch information to execution review.

#### Milestone 4 — Companion Control Plane and Android MVP

- Implement Companion protocol, snapshot, typed commands, direct pairing and device management.
- Reuse Agent Projection in the Android Attention UI.
- Deliver Task Room, Coordinator reply, gate, review, abort and external read-only status.
- Produce signed preview APK `0.5.0`.

#### Milestone 5 — Evidence-driven follow-ups

- Measure whether users need a chronological Agent feed beyond the shared Attention projection.
- Measure whether LAN/private-network access is sufficient before designing Stella Relay.
- Add FCM/background notification only after Relay ownership is specified.
- Evaluate additional CLI Provider adapters individually through the explicit capability matrix.

## Testing Decisions

### General strategy

- Tests assert observable behaviour through the highest stable interface.
- Existing Execution Backend and External Execution Source seams remain primary protocol test surfaces.
- New workspace tests cross the Execution Workspace interface; new remote tests cross the Companion Control Plane interface.
- Pure projection tests assert complete input-to-output mappings and never mount UI unless testing interaction/accessibility.
- Replace lower-level tests that merely mirror a deep Module's implementation once equivalent interface-level coverage exists.

### Provider capability and normalization

- Verify each built-in Profile capability has a registered Backend and compatible execution path.
- Verify each Source capability matches the methods its Adapter actually implements.
- Verify unavailable Provider health disables only dependent choices.
- Verify unknown provider fields are ignored, invalid required fields fail that source, and raw provider state never enters Board persistence.
- Preserve current last-good/stale, generation ordering, association and import de-duplication tests.
- Verify Renderer and Android consume normalized values only.

### Agent Projection

- Cover every managed Task/Workflow/AgentTask status and every external execution state.
- Verify attention precedence, hierarchy, stable identity, source freshness and deterministic ordering.
- Verify missing optional facts stay missing and no Task stage is inferred from external completion.
- Verify managed/imported associations hide duplicates consistently on desktop and mobile.
- Verify large messages are truncated deterministically at the projection seam.

### Execution Workspace

- Use real temporary Git repositories to test base selection, branch creation, worktree registration, cleanup and failure recovery.
- Verify paths containing spaces and non-ASCII characters.
- Verify current-folder Adapter preserves existing canonicalization and FIFO admission.
- Verify repository provisioning lock serializes concurrent add/remove operations.
- Verify worktree setup failure never launches a Backend.
- Verify Backend receives the provisioned cwd without observing Git implementation details.
- Verify schema migration maps every historical execution to current-folder placement without losing results or sessions.
- Verify interrupted, reported, accepted, rejected and cleanup-failed resources transition correctly.
- Verify user-owned/external worktrees cannot be cleaned by Stella.

### Parallel scheduling

- Verify two writers to the same current folder never overlap.
- Verify two writers in distinct Stella worktrees can overlap up to the concurrency limit.
- Verify read-only execution does not consume a write lease unnecessarily.
- Verify aborting one active execution leaves other active executions running.
- Verify shutdown interrupts every active runtime exactly once and retains required workspace records.
- Verify a stale completion with an old runtime token or execution attempt cannot settle current Task state.
- Verify queue fairness and capacity release after success, failure, abort and provisioning error.

### Companion and Android

- Reuse existing Task Room, mention, Coordinator, gate, review and abort fixtures through the Companion Control Plane.
- Verify duplicate idempotency keys cannot duplicate comments, AgentTasks or decisions.
- Verify reconnect and sequence gaps trigger authoritative snapshot replacement.
- Verify protocol mismatch blocks mutation with an explicit upgrade result.
- Verify external status remains read-only and unsupported continuation is absent.
- Run a real local WebSocket integration test, Android mock-host tests, Gradle debug APK build and one physical-device or emulator acceptance flow.
- Verify desktop offline/stale state and revoked-device behaviour.

### End-to-end acceptance scenarios

1. Dispatch two writable tasks in isolated worktrees, observe concurrent execution, review both branches and retain one failed workspace.
2. Dispatch two writable tasks to current folder, prove FIFO execution and no overlapping Backend run.
3. Observe a managed Coordinator enter `waiting_human` on desktop and Android, reply from Android, and prove exactly one new review round is created.
4. Observe a Workflow human gate on Android, approve it, and prove the same Workflow continues on desktop.
5. Observe Claude/Codex external activity on Android as read-only, then take the source offline and prove last-good/stale behaviour.
6. Disconnect/reconnect the phone while sending a command and prove idempotent outcome reconciliation.

## Out of Scope

- Embedding Orca or calling Orca CLI from Stella production execution paths.
- Importing Orca's source code, database schema, Relay, terminal daemon or mobile app implementation.
- A generic arbitrary-shell Execution Backend.
- Full PTY/xterm terminal hosting in Stella.
- Parsing every CLI's private transcript/history directory.
- Duplicating Orca Run/Task/Dispatch/Message/Decision Gate orchestration in SQLite.
- SSH execution hosts, headless remote server, cross-host worktree federation or mobile-hosted Agents.
- Automatically merging or pushing worktree branches.
- Adopting or deleting user-owned external worktrees.
- Reliable background push, Stella cloud Relay, cloud accounts or multi-user authorization in the first Android APK.
- Full mobile terminal, file browser, source editor, Git staging or PR management.
- Running Pi, Codex CLI or Claude CLI directly on Android.
- Changing Pi session compaction semantics as part of this work.
- Adding unused observation provenance fields without a real multi-source arbitration implementation.

## Further Notes

- Full factual research and fixed Orca source permalinks are documented in [stablyai/orca 深度分析](../research/stablyai-orca-analysis-2026-08-28.md).
- Detailed APK, Companion protocol and local Android toolchain decisions are documented in [Android Companion 子规格](./stella-v0.5.0-android-companion.md).
- Orca's “any CLI” claim is true only at terminal-hosting level. Its launch, hook, history and resume support are different explicit sets; Stella therefore keeps managed execution and external observation separate.
- Orca's provider normalizers and presentation snapshots support Stella's existing Adapter → normalized model → UI direction.
- Orca's worktree lifecycle supports adding optional isolated execution placement, but its ownership, setup, review and cleanup complexity is why this capability is a dedicated Module and schema migration rather than a Profile flag.
- Orca's mobile Companion supports the product model of a read-mostly phone client with desktop as source of truth. Stella adopts that model but limits commands to existing Board semantics instead of exposing raw terminal input.
- Orca's observation provenance implementation explicitly has no consumer at the researched commit and documents unresolved remote clock-skew concerns. It is not copied.
- Orca's AI Vault demonstrates that multi-provider private transcript scanning is a substantial parser/cache/background-process subsystem with stale heuristics. Stella continues to prefer official structured Provider interfaces.
- This specification intentionally creates only two new behavioural seams: Execution Workspace and Companion Control Plane. Agent Projection is a pure Module; Provider capability work deepens existing Backend/Profile/Source definitions rather than adding another runtime registry.
