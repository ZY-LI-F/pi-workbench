# 04 — 外部 CLI 探测、配置与进程基础设施

**What to build:** 用户能在设置中看到 Codex 和 Claude 的安装、版本与登录状态，可选择明确的 CLI 路径；后续受管执行拥有可靠的 JSON/JSONL transport、输出限长和整棵进程树中止能力。

**Blocked by:** 02 — AgentTaskRunner 接入 ExecutionBackend。

**Status:** IN PROGRESS

- [ ] Codex/Claude 自动发现、版本和登录探测不发起模型请求。
- [ ] 候选路径先探测后原子保存，失败时继续使用旧配置。
- [ ] 项目记录与 Backend 配置共享一个无丢更新的 StateStore 写队列。
- [ ] 设置界面显示独立健康状态、版本、路径来源和真实失败原因。
- [ ] 公共进程 transport 支持固定 argv、stdin、JSONL、stderr、截断、abort 与单次 settle。
- [ ] Fake executable 和状态存储 contract tests 通过。
