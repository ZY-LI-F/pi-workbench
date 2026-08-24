# Stella Pi Workbench v0.5.0 · 多 CLI 执行与外部任务发布说明

> 应用版本：`0.5.0` · Board schema：`8` · 内置 Pi：`@earendil-works/pi-coding-agent@0.84.2`

## 本次交付

- 自动 Task 在推进目标之外保存不可变 Execution Profile；`pi.rpc`、`codex.exec`、`codex.review` 与 `claude.print` 共用 AgentTask/Workflow 生命周期、Workspace Admission、验收和历史投影。
- Codex 与 Claude 的受管进程使用各自机器协议归一 session、工具、最终报告、用量、失败、中止与 backend version；缺少机器终态不会猜测成功。
- 看板提供 Stella Tasks、CLI Tasks 与全部视图。Claude Agent View 和 Codex App Server Thread 是只读外部投影，不进入 BoardState；单个 Source 失败保留 last-good stale，不影响另一 Source 或普通 Task。
- Codex Thread 详情按需读取并缓存 30 秒；CLI、Exec、App Server 与 Sub-agent 的 cwd、父关系、waiting flag 和可恢复 Thread ID 均保留。Claude 保留 Agent/session/process 的独立形态。
- 显式导入创建独立手工 Task，并保存不可变 external origin；外部状态不自动移动 Task。受管或已导入 session 会链接原 Task。
- LEAD、Coordinator、Squad 与依赖 Pi Skills 的 Agent 继续使用 Pi RPC；外部 Backend 不伪装支持 Pi 专属控制协议。

## Pi session 压缩复核

多 CLI 层没有接管或复制 Pi compaction。手动压缩仍只在 Agent、steering/follow-up 队列和另一压缩全部结束后执行；独立默认超时仍为 600 秒，`0` 可关闭；自动压缩失败会清除 busy 并显示 session notice。对应 Runtime、Router、Reducer 与 Workspace Admission 回归继续通过。

## 安装与降级

- Pi Runtime 随安装包提供；全局 `pi` 不是启动依赖。
- Codex/Claude 不随 Stella 打包。自动发现失败、指定路径失效或未登录时，只禁用对应 Profile/Source；Pi、Board 与另一个 CLI 保持可用。
- Preferences 只探测可执行文件、版本与登录状态，不发送模型请求。用户可指定绝对 CLI 路径并单独重试。

## 验证基线

- 96 个 Vitest 文件、421 项测试。
- `npm run check`、生产构建、确定性 Electron E2E、macOS arm64 未打包应用与 packaged smoke。
- 本机只读 smoke：Pi `0.84.2`；Codex `0.149.0-alpha.4.1` 已登录且 App Server list/read/turns 可用；Claude `2.1.220` 可探测但当前未登录，因此不发送模型请求，受管 Claude Profile 按真实状态降级。

完整设计与参考证据见 [`stella-v0.5.0-multi-cli-runtime.md`](stella-v0.5.0-multi-cli-runtime.md) 和 [`../research/stella-v0.5.0-multi-cli-reference-projects.md`](../research/stella-v0.5.0-multi-cli-reference-projects.md)。
