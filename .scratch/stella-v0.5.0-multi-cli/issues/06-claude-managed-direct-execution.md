# 06 — Claude Print 直接任务

**What to build:** 用户可为兼容的单 Agent 任务选择 Claude Print；Stella 消费 stream-json，保存报告、usage 与 session，并在工具需要未授权交互时明确失败而不长期占用租约。

**Blocked by:** 02 — AgentTaskRunner 接入 ExecutionBackend；04 — 外部 CLI 探测、配置与进程基础设施。

**Status:** DONE

- [x] Profile picker 展示 Claude 健康状态与兼容性原因。
- [x] stream-json reducer 处理 system/session、assistant、tool、result、usage、错误和未知事件。
- [x] workspaceAccess、effort、model 与允许工具按固定映射生成 argv。
- [x] 成功、失败、缺少终态、中止、session 和 backend version 正确持久化。
- [x] 任务历史与 Artifact 使用统一跨后端展示。
- [x] Adapter、Runner、UI 和 shim E2E 测试通过。
