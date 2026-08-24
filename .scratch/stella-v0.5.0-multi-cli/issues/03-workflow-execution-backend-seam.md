# 03 — WorkflowOrchestrator 接入 ExecutionBackend

**What to build:** 固定 Workflow 的每个 Pi Agent step 通过同一 Backend Registry 执行，人工关卡、产物传递、验收与并发运行保持不变，并删除已经没有调用者的旧 Runtime Factory 接口。

**Blocked by:** 02 — AgentTaskRunner 接入 ExecutionBackend。

**Status:** ready-for-agent

- [ ] Workflow Run 冻结 Profile snapshot，每个 Step 记录实际 backend version 与 session。
- [ ] Agent step 通过 Backend Interface 运行，human gate 不调用后端。
- [ ] step runtimeToken、租约、中止和迟到事件保持当前可靠性约束。
- [ ] 已持久化 Artifact 继续作为后续步骤输入。
- [ ] 旧 Pi 专用 Workflow Factory 契约完成收缩，Workflow 全量测试通过。
