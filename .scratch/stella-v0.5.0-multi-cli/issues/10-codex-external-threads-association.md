# 10 — Codex Thread 视图、详情与去重

**What to build:** 用户可通过 Codex App Server 查看 CLI、Exec、App Server 与 Sub-agent Thread，按需读取 Turn 详情，并与 Stella 管理的 Codex session 建立稳定关联而不重复展示。

**Blocked by:** 05 — Codex Exec/Review 直接任务；09 — Claude 外部执行视图与导入。

**Status:** ready-for-agent

- [ ] App Server Client 完成 initialize、JSON-RPC、分页、通知、超时、重启和 shutdown。
- [ ] Thread/Turn 状态、waiting flags、父子 identity 与 cwd 正确归一。
- [ ] 详情只在用户打开时读取并短期缓存，列表刷新不逐项 read。
- [ ] 全部视图去除 Stella 管理 session 的重复卡片，外部视图保留并链接原 Task。
- [ ] 一个 Source 失败不会清空另一 Source 或较新的 scope snapshot。
- [ ] 协议 fixture、关联、详情和 UI 测试通过。
