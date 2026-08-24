# 05 — Codex Exec/Review 直接任务

**What to build:** 用户可为单 Agent 任务选择 Codex Exec 或只读 Review；Stella 能可靠启动、显示过程、保存最终报告和 Thread identity，并正确处理失败与中止。

**Blocked by:** 02 — AgentTaskRunner 接入 ExecutionBackend；04 — 外部 CLI 探测、配置与进程基础设施。

**Status:** ready-for-agent

- [ ] Profile picker 只展示健康且与所选 Agent 兼容的 Codex Profile。
- [ ] Codex JSONL reducer 处理 Thread、Turn、工具、最终消息、错误和未知事件。
- [ ] `codex.exec` 支持读写 Agent；`codex.review` 只支持 Git 项目的只读直接 Agent。
- [ ] 成功、失败、协议无终态、中止、session 和 backend version 正确持久化。
- [ ] 任务卡、详情、Timeline 与 Artifact 显示 Codex Profile 和结果。
- [ ] Adapter、Runner、UI 和 shim E2E 测试通过。
