# 08 — Mention、Autopilot 与 Coordinator 兼容规则

**What to build:** 普通 Worker mention 和兼容的 Autopilot 按 Task/Profile 选择 Pi、Codex 或 Claude；Squad、LEAD 和所有 Coordinator 回合始终明确要求 Pi，不发生隐式降级。

**Blocked by:** 07 — 跨后端固定 Workflow。

**Status:** ready-for-agent

- [ ] Worker mention 继承当前 Task 的 Profile snapshot，并在创建执行前校验兼容性。
- [ ] Autopilot 保存 Profile，创建 Task 时原样复制并在触发前重新探测。
- [ ] Direct Agent 与 Workflow Autopilot 可使用兼容外部 Profile。
- [ ] Squad、LEAD、Coordinator、Coordinator Review 只允许 `pi.rpc`，UI 与 Main 错误一致。
- [ ] requiredSkills、Profile 编辑与历史快照规则覆盖 mention/Autopilot 测试。
