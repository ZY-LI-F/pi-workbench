# Stella 领域词汇

Stella 是一个本地桌面 Agent 工作台，由完整独立的 Pi 工作台与可选的任务控制台组成。用户既可以直接使用 Pi，也可以把长期工作固化为看板任务，再选择固定工作流、单个 Agent 或动态 Squad 执行。

- **Pi 工作台（Pi Workspace）**：直接使用交互式 Pi 的一等产品界面，完整保留项目、会话、模型、命令、扩展、工具、分支、终端和上下文能力；它不依赖 Task 或 AgentTask 才能存在。
- **任务控制台（Task Control）**：管理 Task、Kanban、Task Room、Squad、Workflow、DAG 和 Autopilot 的可选产品界面。它与 Pi 工作台并列，而不是 Pi 工作台的替代品。
- **任务启动台（Task Launchpad）**：团队协作中始终存在的项目级入口。用户以一个 `@LEAD`、明确目标和必填验收标准原子创建 Task、首条用户消息与 Coordinator 根 AgentTask；它不是持久化 Room，也不保存第二份聊天记录。
- **任务室（Task Room）**：围绕一个正式 Task 展示用户消息、协调消息和结构化执行回执的协作时间线。它是 Task 状态的交互投影，不是新的任务事实来源，也不是外部聊天频道。
- **协调者（Coordinator）**：绑定 Task、可在多个 AgentTask 回合之间恢复的协调策略，负责结构化委派、验收、修订和重规划。每个回合必须以终止型 `coordinator_action` 工具提交受 schema 校验的行动；自然语言和手写 JSON 没有控制权。它不同于只负责首轮委派的一次 Squad Leader AgentTask。

- **任务（Task）**：看板上长期存在的一项业务工作，包含目标、项目、优先级和验收标准。任务不是执行队列项，也不等同于一次 Pi 会话。
- **任务规格修订（Task Spec Revision）**：只在用户实际改变标题、说明、优先级、验收标准或执行目标时单调递增的 Task 版本。评论、状态移动、trust 同步和运行统计不改变它。
- **任务规格快照（Task Spec Snapshot）**：根 Workflow Run 或根 AgentTask 分发时冻结的规格修订、目标、说明、优先级、验收标准和执行目标。运行时提示词与迟到结果只能引用该快照，不能读取后来编辑的 Task 规格。
- **任务评论（Task Comment）**：围绕任务保存的用户或 Agent 消息。用户评论中的有效 `@mention` 可以显式请求某个 Agent 执行；评论本身不是外部聊天频道，也不是任务状态的事实来源。
- **执行角色（Agent Definition）**：固定且带版本的职责配置，例如侦察员、规划师、构建者；它不是正在运行的进程。
- **Agent 任务（AgentTask）**：一次可持久化、可排队的 Agent 执行请求。它记录目标 Agent、父子委派关系、状态、Pi 会话和最终输出。
- **执行尝试（Execution Attempt）**：Task 每次重新分发时递增的执行序号。一项 Task 可以有多个历史 Workflow Run 或根 AgentTask，但同一时刻最多只有一个当前执行引用。
- **待验收执行引用（Awaiting-review Execution Reference）**：Task 在待审核阶段指向的唯一 Workflow Run 或根 AgentTask，由执行 ID、类型和尝试序号共同标识。只有该引用允许改变 Task 的验收生命周期；更早的待验收结果会被明确标记为“已被后续执行取代”。
- **执行计划快照（Execution Plan Snapshot）**：根 AgentTask 分发时冻结的 Coordinator 或 Squad 名称、版本、Leader 指令与成员 Agent Definition。后续委派、汇总和验收只能使用该快照，不能被运行期间修改的 Agent/Squad 配置追溯影响。
- **Runtime Token**：一次 Step Run 或 AgentTask 真实认领时生成的运行身份。完成、失败、中止和恢复写入必须同时匹配执行 ID 与 token，防止旧 Runtime 的迟到事件覆盖新执行。
- **Skill 预检（Skill Preflight）**：在创建执行记录前，使用 Pi Resource Loader 按实时项目 trust 发现接收者所需 Skills；Runtime 启动后再核对 Pi 暴露的命令。缺失 Skill 是显式分发错误，不创建孤儿执行，也不产生模板结果。
- **团队模板（Team Definition）**：固定工作流使用的一组确定性角色席位，表达谁负责哪个预设步骤。
- **动态小队（Squad）**：带版本和 `global / project` 作用域，由一名 Leader 执行角色和若干成员执行角色组成的自适应委派配置。引用项目 Agent 时只能属于一个项目；角色层级体现在 AgentTask 父子关系中，不改变 Agent Definition 本身。
- **Leader 任务（Leader AgentTask）**：动态小队中负责分析并决定首轮成员委派的一次 AgentTask。它不是持续在线、会在成员交付后再次验收和重规划的协调身份。
- **流程模板（Workflow Definition）**：由 Stella 持有的确定性执行定义，当前由顺序 Agent 步骤和人工关卡组成。
- **流程实例（Workflow Run）**：某个任务一次固定流程分发后生成的定义快照与运行记录。
- **步骤实例（Step Run）**：流程实例中一个步骤的状态、时间、会话和结果。
- **产物（Artifact）**：Agent 完成后保留的最终输出和可选会话信息，可供后续角色和人工验收查看。
- **人工关卡（Human Gate）**：只有用户明确批准或驳回后才能继续的固定流程步骤。
- **自动驾驶（Autopilot）**：把一个触发器和“创建并分发任务”的动作绑定起来的本地规则。触发器可以是手动、应用运行期间的周期计划或本机回环 Webhook。
- **自动驾驶运行（Autopilot Run）**：一次触发审计记录，保存触发来源、结果、创建的任务和显式错误；它不是 AgentTask。
- **分发（Dispatch）**：根据任务的执行目标创建固定 Workflow Run，或创建一个根 AgentTask，并开始相应执行。

“看板列”只表达任务所处阶段；“队列状态”只表达 AgentTask 生命周期；“执行尝试”不等于 AgentTask 的队列重试；“会话”特指 Pi 会话；“Chat”不作为“Task Room”的同义词；“Team”不作为“Squad”或“Workflow”的同义词；“Subagent”不作为 Stella 的领域实体，执行层级应表述为父 AgentTask 与子 AgentTask。
