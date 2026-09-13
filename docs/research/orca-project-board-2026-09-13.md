# Orca 项目与看板能力研究：Stella 项目看板的采用边界

研究日期：2026-09-13，Asia/Shanghai。

## 1. 结论

Stella 应增加可持久保存的项目目录和项目级看板，让用户先查看多个项目的进展与待处理事项，再进入现有任务看板处理具体工作。项目自身的管理状态、任务交付阶段、执行实例状态应分别保存或投影。项目卡片可以汇总后两者，但不能成为第二套执行状态来源。

Orca 的参考价值主要是这些对象之间的边界，以及从项目、工作目录、关联事项到执行现场的导航。它的 Workspace Kanban 移动的是工作目录；Agent Dashboard 展示的是 Agent 观察状态；GitHub Projects 和 Linear 项目又有各自的数据模型。它没有提供一套可直接替代 Stella Board 的通用项目任务域。[Workspace 模型](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/shared/worktree/types.ts)、[Dashboard 契约](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/shared/dashboard-snapshot.ts)、[GitHub Project 类型](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/shared/github/project-types.ts)、[Linear Project 类型](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/shared/linear/project-types.ts)。

本次建议采用独立项目元数据、纯函数聚合、稳定目录归属、空项目可见和明确的操作回执。拒绝引入 Orca 作为运行依赖，也不复制其远端主机目录、外部平台状态或编排数据库。

## 2. 取证范围与限制

- **Orca 固定源码**：[`25a1259d28a9650ef4a77a1a0fe8204f06680f24`](https://github.com/stablyai/orca/commit/25a1259d28a9650ef4a77a1a0fe8204f06680f24)，Git 提交时间为 2026-09-12 18:36:57 -07:00，即 2026-09-13 01:36:57 UTC。所有本文源码链接固定于此提交，不以持续变化的 `main` 作为证据。
- **取得方式**：直接从 `stablyai/orca` 官方 Git 仓库浅克隆至忽略目录 `.scratch/orca-project-board-source`，使用 `git show` 读取指定源码；没有安装 Orca 或其依赖。通过浏览器工具复核了官方仓库、固定提交源码，以及 [Worktrees 官方文档](https://www.onorca.dev/docs/model/worktrees)和 [Linear 官方文档](https://www.onorca.dev/docs/review/linear)。在线文档没有固定版本，访问日期为 2026-09-13。
- **Stella 对照基线**：研究开始时的 Git HEAD 为 `8d72beb42a9184320deb97c4a1aa353626c97c36`，工作区当时干净。本文“现有实现”指该基线；后续实现完成后，相对链接可能显示新内容。
- **证据等级**：源码事实表示读到了实际类型、实现或测试；官方文档事实表示官方宣称的产品行为；“建议”表示为 Stella 作出的设计判断，不能反向解读为 Orca 已实现该建议。
- **未验证范围**：没有运行 Orca 测试，没有登录 GitHub/Linear 账号，没有验证安装包、远端主机、多端并发或真实 Agent 工作流。阅读测试只能证明仓库声明了这些回归要求，不等于本轮测试已通过。

已有两份报告用于定位研究方向：[2026-08-28 总体研究](./stablyai-orca-analysis-2026-08-28.md)、[2026-09-12 原生 GUI 研究](./orca-native-gui-deep-review-2026-09-12.md)。本轮重新核验项目、看板与目录相关源码；没有把旧报告当作当前能力的一手依据。

## 3. Orca 已验证的能力

### 3.1 项目、所在目录、工作空间分别建模

`Project` 保存 `id`、显示名称、颜色、来源 repo ID、Git/provider identity 和项目偏好；`ProjectHostSetup` 单独保存项目在某个主机上的 `path`、repo ID、准备状态与创建方式。工作空间保存 `projectId`、`hostId`、`projectHostSetupId`，同时保留实际 worktree 路径、分支、归档、排序及关联事项。[Project 与 ProjectHostSetup](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/shared/project-types.ts)、[Worktree](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/shared/worktree/types.ts)。

这证明“项目是什么”和“当前在哪里执行”可以分离。它并不要求 Stella 立刻支持同一项目的多主机 checkout。Stella 现有单机路径语义足以承载本轮项目看板；执行目录仍由已有 `ExecutionWorkspacePlacementSnapshot` 记录。[Stella 执行目录快照](../../src/shared/kanban.ts)、[工作空间管理](../../src/main/execution-workspace.ts)。

**需要避免的误读：Orca 的 Project ID 不是永不变化的 UUID。** 身份推导可能从 `repo:` 晋升为 `git:` 或 `github:`。`carryProjectStateThroughIdentityChange` 根据 `sourceRepoIds` 重叠迁移偏好与引用，并为多个旧项目竞争继承者定义了排序规则。它的存在本身说明依赖远端探测生成身份会引入合并和迁移成本。[身份继承实现](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/shared/project-identity-succession.ts)、[对应测试](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/shared/project-identity-succession.test.ts)。

**对 Stella 的判断**：项目元数据可以拥有自己的持久身份，但与旧任务的归属应继续通过已规范化的 `projectPath` 对接。不得因为两个目录有同一个 Git remote、名称相同或互为父子目录而自动合并。修改展示名称也不应移动目录或重写历史执行位置。

### 3.2 Workspace Kanban 的卡片是工作目录

Orca 的工作空间看板根据每个 worktree 的 `workspaceStatus` 分列，支持手工顺序，以及置顶后按最近活动排序。可见集合、分列、搜索后的集合与完整拖放集合分别计算。默认列为 Todo、In progress、In review、Done，列的名称、颜色、图标、顺序可编辑。[分列函数](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/renderer/src/components/sidebar/workspace-kanban-worktree-groups.ts)、[看板投影](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/renderer/src/components/sidebar/use-workspace-kanban-board-projection.ts)、[默认列](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/shared/workspace-status-defaults.ts)、[列编辑动作](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/renderer/src/components/sidebar/use-workspace-kanban-status-actions.ts)。

主机参与工作空间身份比较。测试明确要求：即使两个主机的 worktree ID 相同，显示其中一个也不能把另一个带入。过滤后的拖放位置也必须映射回完整列，否则搜索会改变隐藏卡片的排序含义。[身份与排序测试](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/renderer/src/components/sidebar/workspace-kanban-worktree-groups.test.ts)、[过滤后的位置映射](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/renderer/src/components/sidebar/workspace-kanban-filtered-drop-index.ts)。

**对 Stella 的判断**：可以采用项目卡片、清晰列标题、卡片数量、搜索和置顶。不能把 Orca 的“目录移到 Done”解释成 Stella 所有任务已验收。若加入排序，排序必须作用于持久全量项目集合，不能用当前搜索结果的数组下标直接覆盖全量顺序。

### 3.3 Agent Dashboard 是观察状态的展示快照

`DashboardSnapshot` 明确是可跨进程复制的展示契约，内容由主 renderer 的实时 store 派生。Agent 卡片按 `attention / working / done / idle` 分桶，保留精确状态、未读、当前问题、workspace、pane、tab 与执行主机，用于跳转回现场；`done` 被阅读后还可显示为 `idle`。这是一种关注度表达，不能直接解释为业务任务阶段变化。[Dashboard 契约与显示状态](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/shared/dashboard-snapshot.ts)、[Agent 看板消费逻辑](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/renderer/src/components/dashboard-popout/AgentKanbanBoard.tsx)。

筛选项从活跃工作空间集合生成，因此没有 Agent 卡片但仍有工作空间的项目可继续出现在筛选器中。不能扩大为“所有没有工作空间的已登记项目也始终出现”；该函数读取的是 `activeWorkspaces`。[筛选项生产函数](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/renderer/src/components/dashboard/dashboard-snapshot-filter-options.ts)。

**对 Stella 的判断**：项目统计和“需要处理”提示应派生自持久 Task/Run/AgentTask；项目列表必须来自独立项目目录。先创建但尚无任务的项目也需要卡片，这一点应由 Stella 的数据设计直接保证。

### 3.4 外部项目管理有专属模型和操作链

Orca 的 GitHub Projects 类型包含 ProjectV2 字段、视图布局、分组、排序以及 issue/PR/draft/redacted 行；Linear 项目类型包含项目状态、负责人、团队、日期、进度和里程碑等字段。二者与 Orca 本机 `Project` 分属不同模块。[GitHub ProjectV2 类型](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/shared/github/project-types.ts)、[Linear 项目类型](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/shared/linear/project-types.ts)。

GitHub Project 页面拥有加载、失败、缺少本地 repo 和启动工作等不同路径；读取到 `BOARD_LAYOUT` 类型不能证明所有 GitHub 原生 board 行为已完整复刻。当前 wrapper 对 Roadmap 走专属组件，其他情况使用 `ProjectViewList`。[ProjectViewWrapper](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/renderer/src/components/github-project/ProjectViewWrapper.tsx)。

官方 Linear 文档说明可浏览、创建、更新 issue，按是否已有工作空间筛选，并从 issue 打开或新建工作空间；创建表单可预填事项名称与关联。来源平台仍拥有 issue 内容与状态。[Linear 官方文档](https://www.onorca.dev/docs/review/linear)。

**对 Stella 的判断**：此轮本地项目看板无需接入 GitHub Projects 或 Linear。用户授权把确实矛盾的设计问题推送到 issue，是本次交付的沟通规则；它不等于授权在产品中增加全面外部同步，也不要求应用依赖外部账号。

### 3.5 工作空间状态与 Linear 状态存在可选同步

不能沿用“Orca 的所有看板永远只读外部任务状态”这一绝对结论。Workspace Kanban 的设置开关允许把工作空间移列同步到 Linear；实现按列显示名称匹配 Linear workflow state，只有唯一匹配才更新。缺少匹配、多个匹配、读取失败和写入失败有分别记录；同一 worktree 的同步串行，写入前重新检查最新本地状态，避免较早拖动晚到后覆盖新状态。[设置界面](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/renderer/src/components/sidebar/WorkspaceKanbanSettingsMenu.tsx)、[同步实现](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/renderer/src/components/sidebar/workspace-board-task-status-sync.ts)。

对应测试覆盖关闭开关时不调用同步、只改排序时不写外部状态、状态歧义、较早请求过期以及 provider 失败提示。本次只读了这些测试，没有执行。[同步测试](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/renderer/src/components/sidebar/workspace-board-task-status-sync.test.ts)、[界面接线测试](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/renderer/src/components/sidebar/WorkspaceKanbanDrawer.task-status-sync.test.tsx)。

这证明“同步是一项显式业务操作，需要独立配置和失败语义”，并不能证明标签匹配是一种适合 Stella 的通用状态映射。本轮不采用这条同步路径。

### 3.6 工作目录与执行资源有独立生命周期

官方说明将 worktree 创建、执行、review、提交、归档或删除作为工作目录生命周期；创建可在后台进行，失败显示错误和重试。文件夹工作空间与多 repo 项目组也有单独模型。工作空间还记录 `orca-managed / external / unknown-legacy / agent-scratch` 所有权；这些字段用于解释资源来源，不能仅凭目录出现在 UI 就假设应用有权回收。[Worktrees 官方文档](https://www.onorca.dev/docs/model/worktrees)、[ProjectGroup 类型](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/shared/project-group-types.ts)、[Worktree 所有权类型](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/shared/worktree/types.ts)。

Orca 的编排域又有独立 `TaskStatus`、`DispatchStatus` 和 worker dispatch 状态，并拒绝 stale dispatch 等无效执行回报。项目、目录和 Agent 的展示状态不能取代这些身份检查。[编排类型与回报结算](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/main/runtime/orchestration/types.ts)。

**对 Stella 的判断**：项目归档应管理项目卡片的日常可见性，并保留任务、会话和历史。目录清理继续走现有工作空间生命周期服务。项目归档、项目计划暂停、某次执行中止是三种不同操作，界面动作与实际效果应一致。

## 4. Stella 基线已有能力和实际缺口

| 基线事实 | 直接依据 | 对项目看板的影响 |
| --- | --- | --- |
| 全局 `BoardState` 保存 Task、Run、AgentTask、消息、活动、Agent、Squad 和 Autopilot，没有项目集合 | [kanban.ts](../../src/shared/kanban.ts) | 新增项目目录，继续复用既有 Task ID 和执行引用 |
| `KanbanTask` 已有 `projectPath`、`projectName` 和信任快照 | [KanbanTask](../../src/shared/kanban.ts) | 旧任务可以归入项目；展示名称不必反写全部历史快照 |
| `ProjectMeta` 是当前打开目录的运行上下文；`RecentProject` 只有 path/trusted/lastOpened | [contracts.ts](../../src/shared/contracts.ts) | 二者都不足以表示有独立说明、状态和归档行为的长期项目 |
| `StateStore.recordProject` 把最近项目截为 12 个 | [state-store.ts](../../src/main/state-store.ts) | 最近记录只能作为发现来源，不能成为长期项目目录；否则无任务的旧项目会消失 |
| 当前任务页已支持当前/全部项目、任务搜索、执行方式筛选和任务阶段列 | [KanbanWorkspace.tsx](../../src/renderer/src/features/kanban/KanbanWorkspace.tsx) | 新功能应提供上一级项目总览与下钻，不再复制一套任务页 |
| 自动执行有执行 attempt、规格快照、等待验收执行引用 | [kanban.ts](../../src/shared/kanban.ts)、[execution-state.ts](../../src/shared/execution-state.ts) | 统计任务数量按 Task 去重；不能把重试、子任务或历史 run 当新增任务 |
| 已有 current-folder / isolated-worktree 策略及资源准入 | [execution-workspace.ts](../../src/main/execution-workspace.ts)、[workspace-admission.ts](../../src/main/workspace-admission.ts) | 项目看板不负责启动或回收第二套 worktree |
| 已有人工关注投影，读取 blocked、等待验收、Coordinator 等待回复与人工关卡 | [team-task-attention.ts](../../src/shared/team-task-attention.ts) | 优先复用其原因语义；若项目页覆盖手工 review，也应显式补充相应口径 |
| 持久化串行执行 transform，解析成功并完成写盘后更新内存；迁移前备份，损坏文件报错 | [board-store.ts](../../src/main/board-store.ts) | 项目操作继续走唯一写入服务与可追踪的持久化回执，不能失败时返回空项目列表 |
| 主进程有真实路径规范化和平台相关 comparison key；renderer 又有展示用 `sameProjectPath` | [path-security.ts](../../src/main/path-security.ts)、[KanbanWorkspace.tsx](../../src/renderer/src/features/kanban/KanbanWorkspace.tsx) | IPC 边界使用主进程身份规则，纯投影共享一致比较规则，避免 Windows 大小写、分隔符、尾斜线重复项目 |

从这些事实可以作出一个有限但明确的架构判断：当前任务域已经有可复用的持久化和执行生命周期，项目功能的缺口主要位于它的上方。没有证据要求在加入项目看板前整体重写 Task、编排或 Pi 会话系统。

现有复杂度集中在 `kanban.ts` 同时承载多种实体、校验、克隆与多代迁移，renderer 任务页同时处理过滤、详情、编辑和外部执行视图。这是模块职责过多的代码事实，不等于这些代码已全部存在功能缺陷。项目模型、项目投影、项目服务和项目页面宜各自成模块；共享已有 repository 和生命周期服务。[共享任务模块](../../src/shared/kanban.ts)、[任务页](../../src/renderer/src/features/kanban/KanbanWorkspace.tsx)、[BoardService](../../src/main/board-service.ts)。

## 5. 采用清单

| 采用内容 | Stella 的具体落点 | 决策理由 |
| --- | --- | --- |
| 项目与执行位置分开 | 独立项目元数据关联规范目录；每次执行继续保存自身 placement | 保持历史执行可追溯，不让切换当前目录改变任务归属 |
| 项目上层入口与任务下钻 | 项目总览 → 项目任务范围 → 已有详情/执行现场 | 当前已有完整任务闭环，补上导航层即可 |
| 聚合视图由事实派生 | Task 阶段计数、人工关注数、运行数、最近活动与验收进度 | 不保存一份很快与 Task 不一致的统计值 |
| 空项目可见 | 独立保存已登记项目，不依赖当前 task、agent 或 recent 列表 | 项目规划本来可以早于首个任务 |
| 管理状态独立 | 手动变更项目计划状态，任务统计保持事实 | 项目暂停不自动杀进程；卡片完成状态不伪造任务验收 |
| 身份明确 | 跨目录操作提交明确 project/task 身份，主进程重新校验 | 防止当前 UI 项目切换造成写错归属 |
| 操作有真实回执 | 写入成功后展示新状态；错误显示并可再次操作 | 避免拖动视觉成功但重启后恢复旧值 |
| 归档保留证据 | 保留项目元数据、任务、会话和工作目录 | 归档具有可逆的管理含义，不承担资源删除职责 |

这些是基于前述源码作出的 Stella 设计决定，不声称 Orca 的每一条界面操作都实现了相同的持久化保证。

## 6. 拒绝清单

1. **Orca 作为运行依赖或整体移植。** 它已有 provider、host setup、workspace、native session 和编排状态，接入会产生多个所有者。本轮不需要这些额外运行域。
2. **照搬 WorkspaceStatus 到 Stella TaskStage。** 工作目录是否“Done”与任务是否通过某次执行的验收不是同一事实；Stella 已有自己的 lifecycle 与 attempt 约束。
3. **按 Agent 是否完成自动完成项目。** Agent 已读状态甚至会把显示从 done 变为 idle，无法用作项目交付状态。[Dashboard 显示状态](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/shared/dashboard-snapshot.ts)。
4. **按 Git remote 自动归并本地项目。** Orca 为身份晋升维护专门继承算法，Stella 当前没有跨主机逻辑项目的需求。相同远端的两个 checkout 应保持其当前独立目录语义。
5. **复制外部同步或 provider 私有历史扫描。** 本地项目卡片无需第三方账号，外部执行观察也不应偷偷成为业务任务写入者。
6. **自由配置项目列的同时隐含重新配置任务阶段。** Orca 的列编辑可直接改变 worktree 元数据，Stella 的任务阶段关联调度和验收。若项目列可调整，也只能影响项目层。
7. **照搬静默归一化、截断和回退。** Orca 的 workspace status 解析会生成缺省列、替换重复 ID 并忽略某些无效元素；这些兼容选择不能代替 Stella 对持久项目数据的明确校验和迁移错误。[状态归一化实现](https://github.com/stablyai/orca/blob/25a1259d28a9650ef4a77a1a0fe8204f06680f24/src/shared/workspace-statuses.ts)。
8. **为外观相似增加远端主机、多 repo 项目组和任意目录自动扫描。** 这些是 Orca 已验证但范围更大的功能；本轮目录登记和历史数据迁移即可形成完整项目看板。

## 7. 直接影响实现的建议口径

以下口径可由实现者按当前任务直接决定，不需要人工确认；它们不存在与既有授权的实质冲突。

1. **项目目录是持久数据。** 通过显式选择本地目录登记；名称、说明、管理阶段、置顶和归档属于项目元数据。登记本身不等于信任执行，也不自动启动 Agent。
2. **首次发现完整合并旧数据来源。** 从已保存项目、旧任务、项目 Agent、项目 Squad、Autopilot、最近目录，以及当前已显式选择目录补齐项目。以规范目录去重；不把 `requiresSelection` 占位目录变成真实项目。已登记项目不会因最近列表淘汰而消失。
3. **迁移不伪造计划。** 可以继承明确的名称与时间；不能因为某项目旧任务都完成就自动宣布整个项目完成，也不能根据某个历史 task 的 `trusted` 快照给当前目录新增执行信任。
4. **任务数量与执行数量分开。** 任务完成率按当前 Task 的 `done / total` 计算；零任务用明确空态或 0/0 表达，不宣称 100%。运行数、等待处理数是补充提示，不改变分母。
5. **项目管理阶段与任务健康度并列。** 用户把项目列改为暂停后，如仍有执行运行，卡片继续显示实际运行数。将归档解释为隐藏日常视图；如果 UI 承诺“停止执行”，必须显式调用现有停止操作并报告结果，不能仅改项目字段。
6. **下钻范围与当前执行目录区分。** 查看另一个项目的任务不应偷偷重启 Pi。确需打开目录或继续该项目会话时，再走已有项目切换与信任流程；界面明确当前查看的是哪个项目。
7. **统计只读、写入集中。** 项目投影用纯函数消费 Board 和项目目录；项目新增/编辑/状态变更经 IPC → 主进程服务 → repository。不要让卡片组件写本地 JSON，也不要为了聚合结果永久修改 Task。
8. **数据错误显式反馈。** 无效阶段、重复身份、缺少项目、写盘失败和目录不可用应有实际错误。离线或被移动的历史项目仍可查看已有任务，不应被自动从目录删除；实际打开和执行使用已有真实路径检查。
9. **验收保留真实业务闭环。** 至少验证项目登记与重启保存、旧数据补齐、空项目、名称编辑、跨列变更、归档恢复、过滤下钻、任务变化驱动统计刷新、旧执行回报不会完成新 attempt，以及 Windows 路径别名不重复计数。
10. **外部写入按真实矛盾处理。** 本研究没有发现需要用户裁决的不可兼容要求，因此未创建【问题确认】issue；研究建议不是尚待批准的占位方案。

## 8. 本轮研究产物与核验记录

交付文件为本文。研究只新增此 Markdown 文档；Orca 源码克隆留在 `.scratch/orca-project-board-source`，通过本地 `.git/info/exclude` 中的精确目录规则忽略，没有修改 `.gitignore`、产品依赖或实现文件。

已完成：固定官方 Git commit、核对官方产品文档与指定源码、阅读项目身份/看板分组/外部同步相关测试、核对 Stella 现有 Board、任务、路径与最近目录结构。未执行：Orca 测试、真实外部平台写入、真实 Agent 调用、安装包体验。本项目最终实现和测试结果应记录在对应设计与验收文件中；本文保持研究证据与采用理由。
