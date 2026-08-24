# 02 — AgentTaskRunner 接入 ExecutionBackend

**What to build:** 所有 Pi AgentTask 经统一 Backend Registry 和 Pi Adapter 启动、输出和结算；用户看到的直接 Agent、Worker、Squad 与 Coordinator 行为不变，同时后续 CLI 可以复用同一 Runner。

**Blocked by:** 01 — 建立 Board v8 与 Pi Profile 基线。

**Status:** IN PROGRESS

- [ ] Backend Interface、Registry、Profile snapshot 与 Fake Adapter 形成稳定契约。
- [ ] Pi Adapter 完整封装现有 RPC、Skill 预检、结构化 Coordinator 和统计读取。
- [ ] Runner 不再解析 Pi RPC 细节，只消费统一事件和结果。
- [ ] runtimeToken、workspace lease、中止、shutdown 与迟到事件语义无回归。
- [ ] 所有 AgentTask kind 的 Pi 路径和 contract tests 通过。
