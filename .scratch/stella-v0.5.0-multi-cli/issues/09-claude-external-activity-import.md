# 09 — Claude 外部执行视图与导入

**What to build:** 用户可在当前项目或全部项目查看 Claude 后台 Agent，按状态筛选、识别等待输入和陈旧数据、继续原 session，并显式导入为新的 Stella 手工 Task。

**Blocked by:** 01 — 建立 Board v8 与 Pi Profile 基线；04 — 外部 CLI 探测、配置与进程基础设施；06 — Claude Print 直接任务。

**Status:** ready-for-agent

- [ ] External Source/Catalog、snapshot epoch、last-good stale 和轮询可见性形成完整契约。
- [ ] Claude 官方五种状态、process shape、cwd、父子和 session identity 正确归一。
- [ ] 外部卡片只读，无拖拽、评论、分发或验收控制。
- [ ] 导入创建手工 Task 和不可变 origin，不跟随外部状态改变生命周期。
- [ ] 已由 Stella 管理或已导入的 session 显示正确关联。
- [ ] Source、Catalog、hook、UI 和导入测试通过。
