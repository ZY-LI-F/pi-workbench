# ADR 0004：将任务生命周期绑定到唯一执行尝试

Stella 允许同一 Task 在修订、失败或人工调整后再次分发。历史 Workflow Run 和根 AgentTask 必须保留用于审计，但不能继续拥有改变当前 Task 阶段的权限。v0.3.0 为此给 Task 增加单调递增的 `executionAttempt`，并用 `awaitingReviewExecution` 显式指向当前唯一待验收执行；schema v6 又增加 `specRevision` 与不可变 `TaskSpecSnapshot`，使同一执行尝试也不能跨规格修订写回。

## 决策

- 新分发先把同一 Task 上仍为 `pending` 的历史执行标记为 `superseded`，再递增执行尝试并设置唯一 active 引用。
- 执行报告只能在其 ID 与尝试序号均匹配当前 active 引用时把 Task 推进到待审核。
- 根执行必须冻结分发时的 `TaskSpecSnapshot`；报告还必须匹配 Task 当前 `specRevision`，提示词不得在运行途中重新读取已编辑的 Task 规格。
- 人工验收只能作用于 `awaitingReviewExecution` 指向的执行；历史报告仍可查看，但不能改变当前 Task。
- Coordinator 与 Squad 根 AgentTask 在分发时冻结 `executionPlan`。运行中的 Agent、Squad 或成员版本变化只影响后续分发，不改变当前尝试。
- 旧 schema 迁移时，从历史记录中选择最新的 pending 执行作为待验收引用；其余 pending 执行显式改为 `superseded`。如果数据声称处于待审核却找不到任何可验收执行，迁移直接报错，不猜测或伪造成功状态。

## 不变量

- 每个 Task 同一时刻至多有一个 active Workflow Run 或根 AgentTask。
- `queued` / `running` Task 必须有 active 引用；`review` Task 必须有 active 人工关卡或唯一待验收执行引用。
- `planned` / `blocked` / `completed` Task 不保留 active 或待验收引用。
- 终态执行不能继续作为 active 引用；被取代的执行必须保存原因且不可再次验收。
- `specRevision` 只随可执行需求的真实变化递增；评论、阶段、trust 和统计更新不构成规格修订。

## 影响

Board 文件先在 v5 引入唯一执行尝试，并在 v6 绑定任务规格、Runtime token 和 Squad 作用域。这些变化增加少量持久字段，但避免引入独立的事件溯源系统或第二套任务状态机，继续保持本地单文件 Board 的简单部署方式。历史结果仍完整可见，当前状态修改权则变成显式、可验证的单一引用。
