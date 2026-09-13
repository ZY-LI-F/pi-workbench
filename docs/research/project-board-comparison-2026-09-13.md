# Stella 项目看板：跨项目能力比较与实施取舍

研究日期：2026-09-13。研究对象为本仓库已有研究涉及的 Orca、Multica、AgentTeams（原 HiClaw）、Plane、Vikunja、AppFlowy、OpenProject，并用 Buzz、Activepieces 核验协作与人工等待的边界。Stella 基线为 `8d72beb42a9184320deb97c4a1aa353626c97c36`（v0.6.0）；本次实施设计见 [Stella 项目看板设计说明](../specs/stella-project-board.md)。本文仅修改研究文档，不引入任何上游代码或运行依赖。

## 1. 直接影响本次实现的结论

项目看板应同时提供**长期项目清单、人工计划阶段、任务与执行事实的汇总、沿原任务身份处理工作的入口**。独立目录卡片解决了项目遗忘问题，但还不能完整表达“哪些项目待安排、正在推进、暂缓、已经收尾”。本次应增加项目自己的计划阶段及按阶段分列的视图；保留紧凑卡片视图作为同一批项目的另一种展示。

这项判断有两组直接依据。Multica 的 Project 具有独立的计划状态，Issue 统计另算；Plane、Vikunja、AppFlowy 和 OpenProject 则反复呈现“对象持久存在，视图负责筛选与组织”的结构。两者结合，适合 Stella 的对象是已有本地目录对应的长期项目，项目列移动只修改项目的计划阶段。不能从一次 Agent 运行成功推导项目完成，也不能把项目进入“暂缓”解释为调度器暂停。[Multica 项目类型](https://github.com/multica-ai/multica/blob/37f3bb7dd9c0fe665051ce26dadab03b090dc1af/packages/core/types/project.ts)、[Plane 视图模型](https://github.com/makeplane/plane/blob/7cef741c29cf61d3bca18dc892e6af11a1e7becc/apps/api/plane/db/models/view.py)、[OpenProject 官方看板说明](https://www.openproject.org/docs/user-guide/agile-boards/)

本次采用的四个阶段为“待安排 / 进行中 / 暂缓 / 已收尾”。它们是人的计划判断，与任务阶段、运行状态、当前报告验收和归档分别保存。无需移植日期、负责人、优先级、资源编排、任意自定义字段或多租户模型才能成立。归档继续是可逆整理；“已收尾”项目仍可以有待处理事项，界面应如实显示，不创建隐式批量完成或停止任务的业务路径。

另一项必须保留的能力是从项目汇总直接进入现有任务详情。Stella 的 Team 页面已经复用 Kanban 的 `TaskDetailPanel`，其中包含当前执行、报告与人工处理入口。项目页携带项目范围和原 Task ID 进入该面板，就能连接原有执行与验收记录；重新创建一个项目 Room 或复制任务详情会产生额外状态。本次研究没有发现需要改变独立 Pi 工作台或要求先启用 Team 的理由。[本地 TeamWorkspace](../../src/renderer/src/features/team/TeamWorkspace.tsx)、[TaskDetailPanel](../../src/renderer/src/features/kanban/TaskDetailPanel.tsx)、[ADR 0003](../adr/0003-preserve-independent-pi-workbench.md)

## 2. 来源、版本与可信度

已有研究用于发现对象和固定版本，本次重新访问官方仓库的固定源码及必要的官方文档。下表中的旧提交是**沿用既有研究的可复现快照，不代表 2026-09-13 的最新版本**。不使用历史 star 数或 README 的宣传语判断功能已经完整实现。

| 项目 | 本次固定提交 | 沿用依据与核验重点 |
| --- | --- | --- |
| Orca | [`25a1259d28a9650ef4a77a1a0fe8204f06680f24`](https://github.com/stablyai/orca/commit/25a1259d28a9650ef4a77a1a0fe8204f06680f24) | 本轮 [Orca 专项研究](orca-project-board-2026-09-13.md)：项目、Host Setup、worktree 看板、运行观察与外部状态同步 |
| Multica | [`37f3bb7dd9c0fe665051ce26dadab03b090dc1af`](https://github.com/multica-ai/multica/commit/37f3bb7dd9c0fe665051ce26dadab03b090dc1af) | 沿用 [2026-08 Team 研究](team-multica-hiclaw-2026-08.md)：Project.status、任务统计、Issue 与一次运行的边界 |
| AgentTeams / HiClaw | [`2ea027403398dfa06f3fc86445042d59f4684d71`](https://github.com/agentscope-ai/AgentTeams/commit/2ea027403398dfa06f3fc86445042d59f4684d71) | 沿用同一研究：projectflow 的暂停、DAG 就绪、Worker 提交与 Leader 验收 |
| Plane | [`7cef741c29cf61d3bca18dc892e6af11a1e7becc`](https://github.com/makeplane/plane/commit/7cef741c29cf61d3bca18dc892e6af11a1e7becc) | 沿用 [高星项目架构研究](high-star-architecture-references.md)：Project 与 IssueView 的存储边界 |
| Vikunja | [`95b7e673fb5ee407498fa4b13e8b4c57847a4a0b`](https://github.com/go-vikunja/vikunja/commit/95b7e673fb5ee407498fa4b13e8b4c57847a4a0b) | 沿用同一研究：ProjectView、桶归属、完成列修改真实 Task.done |
| AppFlowy | [`5cf3a365dec0d59f64bad1ee4bb1050471a39b93`](https://github.com/AppFlowy-IO/AppFlowy/commit/5cf3a365dec0d59f64bad1ee4bb1050471a39b93) | 沿用同一研究：一个数据库的多个视图编辑器及分组控制器 |
| OpenProject | [`513e62c4a068796b453482ea5602747498d6b80a`](https://github.com/opf/openproject/commit/513e62c4a068796b453482ea5602747498d6b80a) | 沿用同一研究：自由板与属性板；状态移卡不能意外改变任务所属项目 |
| Buzz | [`c2a4ee711e481bb427d6cf8cd08b2c7329d1508c`](https://github.com/block/buzz/commit/c2a4ee711e481bb427d6cf8cd08b2c7329d1508c) | 沿用 [2026-07-26 比较](team-comparators-multica-hiclaw-bozz-2026-07-26.md)：协作事件与 ACP 内存队列的边界 |
| Activepieces | [`6476870ac1ec945308b0fe6bbabde19518bf42ac`](https://github.com/activepieces/activepieces/commit/6476870ac1ec945308b0fe6bbabde19518bf42ac) | 沿用 [高星项目架构研究](high-star-architecture-references.md)：等待记录关联具体执行与步骤 |

本文使用“已验证”表示读到对应实现、类型、SQL 或仓库内测试；“官方契约”表示官方文档或 Agent 指令中声明的行为；“Stella 取舍”表示本次设计判断。阅读上游测试不等于执行过测试，文档声明也不自动证明每一条服务端路径都强制执行。

本次选取能直接回答项目阶段、多视图、运行与验收关系的项目重新核验。旧索引中的 Huly、Leantime、AFFiNE、CrewAI、LangGraph、Temporal 等仍是背景参考，本文没有对它们做新一轮功能审计，也不把它们列作已核验的功能来源。旧文件名中的“bozz”曾有身份不确定性；本文只讨论已核验的 `block/buzz`，不把它与其他相似名称网站认定为同一产品。

## 3. 各项目一手证据与边界

### 3.1 Orca：长期项目、可整理的工作区与运行观察

Orca 把 Project、ProjectHostSetup、worktree 分开。workspace Kanban 的卡片是 worktree，`workspaceStatus` 是工作区整理属性；运行 Dashboard 另用观察模型表达 working、attention、done 等状态。项目身份还存在 repo / git / GitHub 身份升级与继承，因此不能把 Orca 的 projectId 简化为永远不变的随机 ID。Stella 应采用“项目独立于单次工作目录与运行”的思想，继续使用自己的稳定 ID 与 canonical path 规则。[项目类型](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/shared/project-types.ts)、[身份继承](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/shared/project-identity-succession.ts)、[worktree 类型](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/shared/worktree/types.ts)

这里最容易遗漏的是外部写入语义：Orca 有可开关的 Linear 状态同步，工作区移列在该机制启用后可以发起外部工作项状态更新。其状态匹配和错误处理属于明确功能，不宜把所有 Orca 看板移动都描述为仅本地展示。本次没有要求外部服务同步，Stella 的项目阶段应保持本地操作。专项研究已记录固定源码、默认值未追溯的限制及筛选排序细节。[Linear 同步实现](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/renderer/src/components/sidebar/workspace-board-task-status-sync.ts)、[完整研究](orca-project-board-2026-09-13.md)

### 3.2 Multica：项目生命周期独立，工作目标与执行记录独立

**已验证：**`ProjectStatus` 为 planned、in_progress、paused、completed、cancelled；Project 同时有 `issue_count`、`done_count`，`UpdateProjectRequest` 可以单独修改 status。`UpdateProject` SQL 更新 project 表的元数据和计划属性，统计查询独立读取 issue。该更新路径支持“项目处于哪种管理阶段”与“底下多少任务完成”分别表达。[项目类型与更新请求](https://github.com/multica-ai/multica/blob/37f3bb7dd9c0fe665051ce26dadab03b090dc1af/packages/core/types/project.ts)、[项目 SQL](https://github.com/multica-ai/multica/blob/37f3bb7dd9c0fe665051ce26dadab03b090dc1af/server/pkg/db/queries/project.sql)、[项目 Handler](https://github.com/multica-ai/multica/blob/37f3bb7dd9c0fe665051ce26dadab03b090dc1af/server/internal/handler/project.go)

**官方契约：**Issue 保存长期目标、讨论和最终状态；Task 是一次 Agent 运行。重新分配 Issue 或改变其状态不等于停止正在运行的 Task；一次运行 completed 也不说明 Issue 的目标已经满足。这正支持 Stella 保留 Task / AgentTask / WorkflowRun 及当前报告的区分。[Multica 任务文档](https://github.com/multica-ai/multica/blob/37f3bb7dd9c0fe665051ce26dadab03b090dc1af/apps/docs/content/docs/tasks.mdx)

两个细节不能直接照搬。首先，Multica 的 `done_count` 把 done 和 cancelled 都统计进去，属于“终结”口径；Stella 卡片若标为“完成”，应只统计本地 Task 的真实完成阶段。其次，Multica Project 可关联 GitHub 仓库和带 daemon 身份的本地目录，适合它的分布式执行产品；Stella 本次一个本地目录对应一个项目，不必为此引入 daemon/resource 引擎。[统计 SQL](https://github.com/multica-ai/multica/blob/37f3bb7dd9c0fe665051ce26dadab03b090dc1af/server/pkg/db/queries/project.sql)、[ProjectResource 类型](https://github.com/multica-ai/multica/blob/37f3bb7dd9c0fe665051ce26dadab03b090dc1af/packages/core/types/project.ts)

Multica 的子 Issue 完成处理还展示了一种不同于通用 DAG 的顺序 stage barrier：达到一组子任务的终结条件后通知父工作。不能仅因为产品有 Project、子任务和 stage，就推导它与 AgentTeams 的 DAG 具有同一执行语义，更不能因此替换 Stella 已有 Workflow。[子工作完成处理](https://github.com/multica-ai/multica/blob/37f3bb7dd9c0fe665051ce26dadab03b090dc1af/server/internal/handler/issue_child_done.go)

### 3.3 AgentTeams：项目暂停会影响调度，成功提交仍需验收

**已验证：**projectflow 的 `_ready_nodes` 在 `project.status != "active"` 时直接返回空列表。这里的项目状态属于执行控制，暂停有调度意义。其 `_accept_task_result` 将特定结果映射到计划节点的 completed、revision 或 blocked 等状态；项目是持久上下文，节点与 WorkerTask 另有身份。[projectflow 服务实现](https://github.com/agentscope-ai/AgentTeams/blob/2ea027403398dfa06f3fc86445042d59f4684d71/plugins/teamharness/mcp/server.py)

**官方契约：**Team Leader 的协调指令要求 Worker SUCCESS / SUCCESS_WITH_NOTES 先成为候选结果，由 Leader 检查输出和验证后接受；依赖节点以已被接受的结果为前提。暂停项目和停止已经在执行的工作也分为不同动作。这份指令适合作为验收语义证据，但它不是 Stella 的指令文件，不能要求本次用户额外确认每次普通实现选择。[Team 协调契约](https://github.com/agentscope-ai/AgentTeams/blob/2ea027403398dfa06f3fc86445042d59f4684d71/manager/agent/team-leader-agent/skills/team-coordination/SKILL.md)

**限制：**读到“Leader 应先检查”不能证明所有接受请求都由服务端验证同样证据。此次读取的 `_accept_task_result` 辅助函数主要负责结果映射和状态保存，不能据此宣称已经具备 Stella 所需的全部当前执行身份约束。因此本次项目汇总继续认现有 `awaitingReviewExecution`、当前 AgentTask / Run 与受校验的处理动作，不解析聊天里的“完成”来推进状态。[相同固定实现](https://github.com/agentscope-ai/AgentTeams/blob/2ea027403398dfa06f3fc86445042d59f4684d71/plugins/teamharness/mcp/server.py)、[本地任务详情](../../src/renderer/src/features/kanban/TaskDetailPanel.tsx)

### 3.4 Plane 与 AppFlowy：视图复用对象，避免多份任务状态

Plane 的 `Project` 独立存储名称、所属 workspace、identifier 和归档时间；`IssueView` 保存过滤条件、展示属性、排序、所有者等配置。查询与视图是组织同一批工作的方式，无需把每个布局变成第二套 Issue。[Project 模型](https://github.com/makeplane/plane/blob/7cef741c29cf61d3bca18dc892e6af11a1e7becc/apps/api/plane/db/models/project.py)、[IssueView 模型](https://github.com/makeplane/plane/blob/7cef741c29cf61d3bca18dc892e6af11a1e7becc/apps/api/plane/db/models/view.py)

AppFlowy 的 `DatabaseViews` 持有同一个 Database，按 view_id 管理视图编辑器并分发相关变更；分组逻辑通过 controller / delegate 从字段和单元格读取分组信息。这是值得采用的依赖方向：保存项目，派生卡片或阶段列；保存 Task，派生跨项目列表。不是先复制卡片，再把卡片位置反推为另一份执行状态。[DatabaseViews](https://github.com/AppFlowy-IO/AppFlowy/blob/5cf3a365dec0d59f64bad1ee4bb1050471a39b93/frontend/rust-lib/flowy-database2/src/services/database_view/views.rs)、[分组控制器](https://github.com/AppFlowy-IO/AppFlowy/blob/5cf3a365dec0d59f64bad1ee4bb1050471a39b93/frontend/rust-lib/flowy-database2/src/services/database_view/view_group.rs)

**Stella 取舍：**本次采用固定的卡片 / 阶段列展示、明确筛选与排序，以及现有状态偏好存储。暂不实现任意保存查询、自定义字段、公式、通用数据库或 CRDT。这些是上游产品的基础设施，缺少它们不会妨碍本次本地项目管理闭环。

### 3.5 Vikunja 与 OpenProject：移卡的写入对象必须明确

Vikunja 的 `ProjectView` 区分 list、gantt、table、kanban，具有独立 filter、position、bucket configuration、default/done bucket。读取类型之后继续追到 `updateTaskBucket`，确认进入完成桶会写 `task.Done = true`，离开会恢复 false；更新通过数据库执行，并会同步相关完成桶。因而“一个任务有多个视图”不代表“移卡不改变任务”。[ProjectView](https://github.com/go-vikunja/vikunja/blob/95b7e673fb5ee407498fa4b13e8b4c57847a4a0b/pkg/models/project_view.go)、[真实移卡实现](https://github.com/go-vikunja/vikunja/blob/95b7e673fb5ee407498fa4b13e8b4c57847a4a0b/pkg/models/kanban_task_bucket.go)

OpenProject 官方说明直接区分两种板：basic board 允许自由组织，移动不改 WorkPackage 属性；action board 的列由对象属性构成，移卡改变对应属性。固定源码的 Grid 保存项目、查询与板类型，状态板测试还覆盖“按项目筛选后移动状态卡，改变状态但不意外改变原项目”的回归场景。这给 Stella 一个具体验收依据：项目范围是筛选上下文，不能因为下钻或改阶段而重写 Task.projectPath。[官方语义](https://www.openproject.org/docs/user-guide/agile-boards/)、[固定 Grid 模型](https://github.com/opf/openproject/blob/513e62c4a068796b453482ea5602747498d6b80a/modules/boards/app/models/boards/grid.rb)、[状态板回归测试](https://github.com/opf/openproject/blob/513e62c4a068796b453482ea5602747498d6b80a/modules/boards/spec/features/action_boards/status_board_spec.rb)

**Stella 取舍：**项目阶段列属于“修改项目计划属性”的板，任务 Kanban 继续属于“通过现有任务规则修改任务阶段”的板。按钮或下拉菜单应提供与移卡等价的操作。只要不实现自由列内排序，就没有必要引入另一份人工卡片位置；现有置顶 / 最近活动 / 名称排序足以构成确定性排列。未来若实现筛选后的自由拖放，必须映射回完整集合，不能用可见索引覆盖隐藏项目顺序；Orca 专项已验证这一问题。

### 3.6 Buzz 与 Activepieces：协作入口不等于可靠的任务状态

Buzz 的官方架构把人和 Agent 放在共同协作空间，通过 relay 处理事件；适合借鉴的部分是清楚的成员与事件归属。其 ACP `queue.rs` 是进程内队列，默认 Drop 模式会在同频道存在 in-flight 工作时丢弃新事件，容量溢出也有丢弃逻辑。不能据协作体验推断该队列适合作 Stella 的持久 Task 调度器。[Buzz 架构](https://github.com/block/buzz/blob/c2a4ee711e481bb427d6cf8cd08b2c7329d1508c/ARCHITECTURE.md)、[ACP 队列](https://github.com/block/buzz/blob/c2a4ee711e481bb427d6cf8cd08b2c7329d1508c/crates/buzz-acp/src/queue.rs)

Activepieces 的 Waitpoint 是独立实体，关联 projectId、flowRunId、stepName，并保存等待类型、状态与恢复数据；flowRunId + stepName 有唯一索引。可采用的是“等待附着在具体运行和步骤”的原则，而不是项目列上的一个通用暂停标记。本次未执行其恢复服务测试，不能凭实体模型宣称整个恢复协议在全部并发情况下正确。[Waitpoint 实体](https://github.com/activepieces/activepieces/blob/6476870ac1ec945308b0fe6bbabde19518bf42ac/packages/server/api/src/app/flows/flow-run/waitpoint/waitpoint-entity.ts)

## 4. 跨项目采用与拒绝矩阵

| 来源 | 最适合本次采用的能力 | 在 Stella 的落实 | 本次不采用及原因 |
| --- | --- | --- | --- |
| Orca | 长期项目；工作区整理与运行观察分开；项目上下文导航 | 独立 ProjectRegistry；当前工作目录外仍能查看项目；统计派生 | Host / Setup / Relay / PTY 与外部看板同步会改变产品与运行边界 |
| Multica | Project.status 独立于 Issue 完成度；目标与一次执行分别留痕 | 四个人工计划阶段；真实 Task 完成比例；当前执行关联 | 多租户、daemon 与远程资源调度；把 cancelled 算“已完成”的指标口径 |
| AgentTeams | 长期项目上下文；Worker 提交与结果接受分开 | 保留现有报告验收和依赖满足规则；下钻到原 Task | 把项目“暂缓”接成 scheduler pause；以自然语言代替受校验的状态命令；Matrix / 容器基础设施 |
| Plane | 对象、视图配置和用户展示偏好分开 | 同一 Project 切换卡片与阶段列；同一 Task 跨入口展示 | 为看板加入通用 Issue 框架、工作区权限树和任意保存查询引擎 |
| AppFlowy | 多视图共享底层数据；过滤、排序、分组按职责组织 | 纯项目投影；视图不持久化任务统计 | 数据库编辑器、CRDT、公式与自定义字段不是当前需求 |
| Vikunja | ProjectView 与任务归属明确；移卡语义有实体依据 | 项目移列只写项目计划字段；操作必须明确实际改什么 | 自动把项目完成列映射为 Task.done 或批量任务状态 |
| OpenProject | 自由板和属性板的语义区分；筛选不改对象所属项目 | 项目范围只筛选；保留 Task.projectPath；测试跨项目误写 | 通用子项目、版本板、任意属性板会增加本轮未请求的领域能力 |
| Buzz | 协作成员与事件归属清楚 | 继续复用 Task Room 的成员、对话与历史入口 | 进程内 Drop 队列不能承载持久工作意图；不把聊天首页取代 Pi |
| Activepieces | 具体运行 / 步骤拥有自己的等待记录 | 项目需处理来自当前执行、Coordinator 与人工关卡 | 不为项目看板引入第二套流程定义、恢复服务或等待数据库 |

上表的采用是对象边界与交互语义的采用。Stella 当前的 BoardRepository、Task、AgentTask、WorkflowRun、Workspace 与官方 Pi 适配层继续承担原职责；无需把它们重命名成上游术语，或以重建存储为前提重新实现同样功能。

## 5. 真实冲突与本次选择

| 冲突 | 一手证据或本地约束 | 本次选择 | 对实现与验收的影响 |
| --- | --- | --- | --- |
| 项目“暂停”是管理计划还是执行暂停 | Multica 项目更新只改项目字段；AgentTeams 非 active 项目不产出 ready nodes | 使用“计划阶段 / 暂缓”，只表示人的安排 | 修改阶段不停止运行、不取消排队、不变更 Autopilot；界面就近说明 |
| 移列只整理还是改业务对象 | OpenProject 区分 basic/action；Vikunja 完成桶实际写 Task.done | 项目列修改 Project 阶段；任务列继续走原 Task 规则 | 断言 Project 修改前后 Task 与执行字段不变；不以项目字段直接判任务可运行 |
| 运行完成、任务完成、结果接受、项目收尾是否同义 | Multica Issue/Task 分离；AgentTeams 要求接受结果；Stella 有 awaitingReviewExecution | 四层独立，统计只读事实 | Agent completed 或项目已收尾都不能清空待验收报告；旧执行报告不冒充当前报告 |
| cancelled 是否算完成 | Multica done_count 包含 done 与 cancelled | 卡片“完成”只统计本地真正 done 的任务 | 不套用上游百分比；零任务显示尚无任务；不能显示虚构的 100% |
| 项目身份是逻辑资源组还是本地目录 | Multica 支持远程资源；Orca 有 Host Setup 和身份继承；Stella Task 用 projectPath | 本轮一个 canonical 本地目录对应一个稳定项目记录 | 不因名字相同、Git remote 相同或子 worktree 路径相似而合并项目 |
| Room-first 是否变成全应用默认 | 旧 Team 研究建议协作先入 Room；当前 ADR 0003 明确保留独立 Pi | Room-first 仅适用于现有可选 Team 工作流 | Native Pi、Projects、Kanban、Team 并列；浏览项目不换会话，不自动生成 Task |
| Agent 指令是否等同控制面验证 | AgentTeams 契约要求先检查；被读辅助函数不体现所有证据约束 | 使用 Stella 已有类型化状态与当前执行身份 | 不解析“我已完成”文本来写 Task.stage，不把提示词当事务保证 |
| 老研究建议是否等同当前架构事实 | 旧文档有 SQLite、通用 Resource、可配置视图等建议；当前项目已有 JSON 持久层 | 以本次设计与真实源码决定实现范围 | 复用 AtomicJsonFile 和 BoardRepository；旧提案不构成额外迁移要求 |
| 队列接收是否可以丢弃 | Buzz ACP 明确存在 Drop 与容量丢弃；Stella 已持久化执行状态 | 不复制这类队列行为 | 失败显式暴露，项目功能不能靠吞错、模拟成功或重建丢失数据交付 |

这些是不同产品使用同一名词时的语义差异，不是当前用户需求中不可兼容的要求。以上选择均可在现有授权范围内完成，本文不为普通设计取舍创建 `【问题确认】` issue。

## 6. 项目阶段与视图的实施约定

| 计划阶段 | 对用户的含义 | 写入依据 | 不应从该值推断的事实 |
| --- | --- | --- | --- |
| 待安排 | 已登记，尚未排入当前计划 | 新增 / 历史发现的明确初始值；用户可调整 | 不代表任务队列为空，也不代表目录未被使用 |
| 进行中 | 当前计划中正在推进 | 用户调整 | 不代表此刻一定有活跃进程 |
| 暂缓 | 暂不列为当前推进重点 | 用户调整 | 不代表运行已停止、排队取消或自动化禁用 |
| 已收尾 | 用户将这项项目工作整理为收尾状态 | 用户调整 | 不代表所有 Task 已完成或全部报告已被接受 |

字段宜在类型或注释中称为 planning stage，以避免与 Task.stage、Run.status 混淆。历史发现默认登记到待安排，不凭最后访问时间、任务完成率或有无运行自动认定项目阶段；已有用户选择必须保持。四个阶段允许可逆调整，不额外增加“所有任务先完成才能收尾”的新门槛。归档单独保存，并允许恢复到原计划阶段。

阶段列和卡片视图共享同一查询结果与统计。视图切换不写 Project 或 Task，项目移动 / 阶段菜单才写 Project 计划字段。阶段列保留清楚的列名与数量；空列可用于判断哪个阶段没有项目。窄窗口可以横向浏览或改为纵向分组，操作不能只依赖拖放。写盘失败应保留原阶段并展示错误，不把临时位置永久显示为已保存。

项目卡片同时展示计划阶段与真实任务进展，使用不同标签避免两个“完成”的概念相互冒充。“已收尾”列中的运行、阻塞和待人工提示继续显示；归档过滤可以隐藏归档项目，但查看归档项目时仍能读取真实计数和任务。归档或收尾不删除历史、不扫描清理目录，也不替换当前 Pi 工作目录。

视图偏好可以复用项目已有的应用偏好持久化方式，不需要把每个筛选建成领域实体。本轮无跨视图自由排序需求时，优先保持置顶、最近活动或名称排序。这样每个字段都有唯一含义，切换布局不会产生难以解释的另一套顺序。

## 7. Native、Projects、Kanban、Team 的导航与人工处理

| 入口 | 负责的对象 | 与项目看板的连接 | 兼容性约定 |
| --- | --- | --- | --- |
| Native Pi | 当前交互会话及其工作目录 | 明确的“打开工作区”才切换；可从当前目录登记项目 | 浏览、搜索、选项目和查看任务均不调用 Runtime 切换，不丢草稿 |
| Projects | 长期项目记录、计划阶段、统计和目录可用性 | 以项目范围进入任务列表，以 Task ID 进入详情 | 不依赖 Team 开关，不要求 Pi 成功 hydrate 才显示可读项目元数据 |
| Kanban | 唯一 Task 生命周期及当前执行 / 报告 | 接受任意已登记项目范围和指定 Task ID | 项目过滤不回写归属；非当前项目仍遵循现有编辑 / 执行权限 |
| Team | 可选协作任务、成员、消息与协调过程 | 继续访问同一个 TaskDetailPanel 及其持久记录 | 不创建与 Kanban 分叉的任务状态；关闭 Team 不取消 Projects 入口 |

基线中的 `App` 默认 workspaceView 为 chat，Team 隐藏时只处理 Team 导航；`TeamWorkspace` 直接导入 Kanban 的 `TaskDetailPanel`。当前 `deriveTeamTaskAttention` 与项目汇总可共享同一注意规则，按 Task 当前关联的 AgentTask / WorkflowRun 检查 Coordinator 待回复与人工关卡，避免扫描历史失败后永久给项目挂红点。[App](../../src/renderer/src/App.tsx)、[TeamWorkspace](../../src/renderer/src/features/team/TeamWorkspace.tsx)、[统一注意投影](../../src/shared/team-task-attention.ts)

人工处理闭环应是“项目显示需处理 → 按原 Task ID 进入详情 → 读取当前报告或等待 → 使用已有处理动作 → 状态变更后项目汇总刷新”。项目详情不必复制验收表单，但必须让用户到达同一条待处理记录。非当前项目需要先打开工作区才能写入的，沿用既有显式打开与信任流程，不能在只读下钻时顺便切换。

此次阅读还发现一个需要实施时明确的口径：基线注意投影将 `awaitingReviewExecution` 算作报告待验收，但手工 Task 处于 review 且没有 execution 时未必进入“需处理”。如果“需处理”是面向所有任务的通用入口，应包含这种人工审核任务；如果产品只表示执行待人工，就应相应命名，不能让用户误以为 review 列已被完整覆盖。此项已通知实施方，最终以本次本地手工任务规则与测试为准。

## 8. 面向本次交付的验证要求

以下是由研究推导出的验收条件，**不是本研究已执行通过的测试结果**：

1. 登记零任务项目、发现超过最近访问上限的历史项目，并重启恢复；历史发现不覆盖人工名称、说明、计划阶段、置顶与归档。
2. 项目在四个阶段间调整后，只有项目计划属性变化；原 Task.stage、projectPath、当前 execution、排队与自动化状态保持其原有业务含义。
3. 同一项目切换卡片 / 阶段列时 ID、数量、完成比例与注意事项一致；搜索、归档过滤、空列和失败状态有明确展示。
4. 项目“已收尾”但有当前待验收报告时仍显示需处理；一次旧运行失败、一次新运行成功和当前报告分别处理，不能混在同一计数中。
5. Task.stage 为 review 的手工任务具有清楚的审核可见性；不得仅因为不存在 AgentTask 就让人工处理无入口。
6. 从项目进入 TaskDetailPanel 后保留原 Task ID、成员、会话和报告；打开非当前项目任务不切换 Pi、不修改 projectPath。只有显式打开工作区才走信任与切换。
7. 关闭 Team 后项目看板仍可访问；项目状态读取失败不取消独立 Pi 入口；Board 数据读取失败时统计显示不可用，不能伪装成零任务。
8. 阶段更新 / 归档 / 刷新并发和写盘失败时，旧读请求不覆盖新保存；真实错误可见，没有默认数据或模拟成功替代。

本文完成的是固定版本源码阅读、官方文档核验、现有导航与状态边界分析，以及研究文档的本地链接与格式检查。未安装或运行上游系统，未执行上游测试，也未代替实施方的 Stella 单测、类型检查、构建和 Electron 验收。
