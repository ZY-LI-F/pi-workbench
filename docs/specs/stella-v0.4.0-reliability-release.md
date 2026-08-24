# Stella Pi Workbench v0.4.0 · 功能可靠性发布说明

> 状态：本轮实现与发布验收基线  
> 应用版本：`0.4.0`  
> 内置 Pi：`@earendil-works/pi-coding-agent@0.84.2`（精确版本）

## 目标

本轮只处理真实功能、状态一致性和代码执行路径，不扩展安全研究或教学材料。v0.4.0 保持现有 Pi、Team、Kanban、Workflow 与 Autopilot 产品边界，并修复会造成用户操作失败、状态回滚或历史 Runtime 污染当前执行的问题。

## 功能要求

1. Workflow 的 Pi 事件、退出信号和结算必须绑定当前 `runtimeToken`；旧步骤的迟到事件不得停止、结算或推进新步骤。
2. 模型配置保存、Runtime 重载和快照刷新组成可回滚事务；部分文件写入失败也必须恢复，空 session 必须按精确 session ID 续接，生成/压缩/队列处理中不得重载。
3. Pi Runtime 切换项目或 session 后，上一 session 的工具活动、队列、扩展 UI、标题、重试与 stderr 不得残留；迟到的 initialize/refresh 结果不得覆盖较新的 session。
4. Team 评论分发必须在 Pi 执行能力不可用时原子拒绝；旧 `squad-leader` 的人工等待可以恢复；串行 Worker 必须收到前序 Worker 的已持久化产物；LEAD 的前端预览与主进程校验保持一致。
5. “所有项目”视图中的外部项目 Task 只读，用户必须先打开对应项目才能编辑、评论、移动、分发、验收或继续 Pi session。
6. Board 操作不得用迟到响应覆盖较新的 snapshot；同一操作键的并发 pending 状态在全部请求结束前必须保持。

## Session 压缩要求

1. 手动 `compact` 仅在 Interactive Pi 完全空闲、无 steering/follow-up 队列且没有另一次压缩时允许执行。该限制对应 Pi `AgentSession.compact()` 会先 `abort()` 当前 Agent 操作的真实语义。
2. 普通 RPC 命令维持 120 秒默认超时；手动压缩使用独立的 600 秒默认超时，可通过 `STELLA_PI_COMPACTION_TIMEOUT_MS` 配置，`0` 表示关闭。
3. 手动压缩成功后显示 `tokensBefore → estimatedTokensAfter`；自动压缩失败必须清除 busy 状态并显示 `errorMessage`。
4. 压缩不创建第二份摘要存储，仍以 Pi session JSONL 中的 compaction entry 为唯一事实。

## 发布验收

- TypeScript、ESLint 与全部 Vitest 通过。
- 内置与本机安装的 Pi CLI 均报告 `0.84.2`，真实 RPC 冷启动和 `get_state` 成功。
- 原生 Electron E2E、Apple Silicon 未打包应用、打包后 capability smoke 通过。
- `package.json` 与 lockfile 版本均为 `0.4.0`，变更提交并推送到 GitHub 的 `codex/v0.4.0-reliability` 分支。
