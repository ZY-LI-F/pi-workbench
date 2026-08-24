# 11 — v0.5.0 发布集成

**What to build:** 用户获得一个版本一致、可打包的 Stella v0.5.0；安装或未安装 Codex/Claude 时都能正常启动，Pi 无回归，三种受管后端和两种外部来源经过确定性与原生 smoke 验证。

**Blocked by:** 03 — WorkflowOrchestrator 接入 ExecutionBackend；07 — 跨后端固定 Workflow；08 — Mention、Autopilot 与 Coordinator 兼容规则；10 — Codex Thread 视图、详情与去重。

**Status:** ready-for-agent

- [ ] CONTEXT、README 和发布说明与实际 v0.5.0 行为一致。
- [ ] package 与 lockfile 在全部功能验收后统一升级为 `0.5.0`。
- [ ] `npm run check` 和确定性 Electron E2E 全部通过。
- [ ] 本机 Codex/Claude 探测 smoke 不发送模型请求且结果明确。
- [ ] macOS arm64 未打包与打包 smoke 通过，缺少外部 CLI 时仅对应能力降级。
- [ ] 所有 tickets 的验收项和最终 Git 差异完成复核。
