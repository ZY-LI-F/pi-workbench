# 07 — 跨后端固定 Workflow

**What to build:** 用户可让普通固定 Workflow 使用 Pi、Codex Exec 或 Claude Print；每一步都继承根执行的 Profile 快照，结果按原顺序进入 Artifact 和人工验收。

**Blocked by:** 03 — WorkflowOrchestrator 接入 ExecutionBackend；05 — Codex Exec/Review 直接任务；06 — Claude Print 直接任务。

**Status:** IN PROGRESS

- [ ] Workflow 编辑/分发只允许所有 Agent step 都兼容的 Profile。
- [ ] Codex Exec 与 Claude Print step 保存独立 session、version、usage 和 Artifact。
- [ ] 带 requiredSkills 的 Workflow 只允许 Pi，Codex Review 不可作为 Workflow Profile。
- [ ] 后续步骤只读取已持久化的前序 Artifact，不读取 Adapter 临时状态。
- [ ] 成功、步骤失败、中止、人工关卡和应用重启测试通过。
