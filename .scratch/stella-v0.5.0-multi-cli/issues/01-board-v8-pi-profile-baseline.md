# 01 — 建立 Board v8 与 Pi Profile 基线

**What to build:** 用户升级 Stella 后，既有手工和自动任务、Workflow、AgentTask、Autopilot 与 Pi session 历史被无损迁移；自动任务显式归属 `pi.rpc`，任务编辑器和详情能展示执行环境，同时所有 Pi 功能保持原行为。

**Blocked by:** None — can start immediately.

**Status:** DONE

- [x] Board schema v8 成为唯一写入版本，v7 只作为迁移输入且迁移幂等。
- [x] 手工任务无 Profile，所有既有自动任务及执行快照迁移为 `pi.rpc` revision 1。
- [x] Pi 来源与执行 session 迁移到统一 session reference，历史继续入口不丢失。
- [x] 创建、编辑、Autopilot 和 parser 共同执行 Profile/Target 不变量。
- [x] 看板任务编辑器、卡片和详情显示 Pi Profile，现有操作语义不变。
- [x] 迁移、领域、UI 与现有 Pi 相关测试通过。
