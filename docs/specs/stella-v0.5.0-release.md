# Stella Pi Workbench v0.5.0 发布说明

> 应用版本：`0.5.0` · Board schema：`9` · Android versionCode：`6` · Companion Protocol：`1` · 内置 Pi：`@earendil-works/pi-coding-agent@0.84.2`

## 本次交付

### 多 CLI 执行与外部活动

- 自动 Task 在目标、Agent 或 Workflow 之外保存不可变 Execution Profile。`pi.rpc`、`codex.exec`、`codex.review` 与 `claude.print` 共用 AgentTask/Workflow 生命周期、Workspace Admission、人工验收与历史投影。
- Codex 与 Claude 受管进程使用各自的机器协议归一 session、工具事件、最终报告、用量、失败和中止；没有机器终态时不会猜测成功。
- 看板提供 Stella Tasks、CLI Tasks 与 All 视图。Claude Agent View 和 Codex App Server Thread 是只读外部投影，不进入 BoardState；单个 Source 失败时保留带 stale 标记的 last-good，且不影响另一个 Source。
- Codex Thread 详情按需、有界读取。managed 或已导入 session 关联原 Task，不生成第二张状态卡；显式导入创建独立手工 Task，外部状态不会自动移动或验收该 Task。
- Provider 的 managed execution、discovery、live status、details、continue 与 session quality 分开声明。LEAD、Coordinator、Squad 和依赖 Pi Skills 的 Agent 继续使用 Pi RPC。

### Execution Workspace 与并发

- 可写自动 Task 可选择当前项目目录或从显式 base ref 创建的 Stella-owned isolated Git worktree。Backend 只接收最终 cwd，不承担 Git 生命周期。
- 当前目录继续使用 canonical-path FIFO writer lease；不同 isolated worktree 可在全局容量内并发。默认容量为 `3`，可通过 `STELLA_EXECUTION_CONCURRENCY=1..16` 调整。
- worktree 的 branch、路径、ownership 和 lifecycle 在 Backend 启动前持久化。reported、failed 和 interrupted 现场默认保留，Stella 不自动合并、推送或删除用户自己的 worktree。
- Board schema `8→9` 为 Task、WorkflowRun 和 AgentTask 增加 execution workspace preference/placement snapshot；旧记录确定性迁移为 `current-folder`。

### Android Companion

- 新增独立 React/Vite/Capacitor Android App。Electron Main 仍是 Board 和 Agent 运行状态的唯一事实源，手机不运行 Pi/Codex/Claude，也不保存第二套编排状态。
- 支持短期 pairing offer、设备凭据、版本化 WebSocket、authoritative snapshot、增量更新、断线 stale/last-good 与自动重连。
- Attention、Tasks 与 Task Room 支持 Coordinator 回复、允许的 Agent mention、人工 gate、执行 review 和精确 execution abort；所有写命令先预览或确认，并使用幂等 receipt。
- External 页面复用桌面的统一 Agent Projection，按 Source、项目、状态查看 Claude/Codex 活动，并提供有界只读详情；没有虚构的外部 reply、continue 或移动终端入口。
- 签名发布脚本输出 `Stella-Companion-0.5.0-android-vc6.apk` 与 `SHA256SUMS-android.txt`。Tag 构建使用 GitHub Secrets 中的正式 keystore；仓库不包含签名材料。

## Pi session 压缩复核

v0.5.0 没有接管或复制 Pi compaction。手动压缩仍只在当前 Agent reply、steering/follow-up 队列及另一压缩均结束后执行；独立默认超时为 600 秒，设为 `0` 可关闭。自动压缩失败会清除 busy 状态并写入 session notice。多 CLI、worktree 与 Companion 只消费既有 session/Board 投影，不读取 Pi 私有 transcript，也不改变压缩边界。

## 安装、迁移与回滚

- Pi Runtime 随桌面安装包提供；全局 `pi` 不是启动依赖。Codex/Claude 不随 Stella 打包，缺失、路径失效或未登录只会禁用对应 Profile/Source。
- Board 位于 Electron user data 的 `board/board.json`。首次打开旧 schema 时，BoardStore 先创建 `board.json.v<旧版本>.<时间>.<id>.bak`，再执行确定性的 `v1→…→v9` 迁移；失败时原文件不修改。
- 回滚到只支持 schema 8 的桌面版本前，应关闭 Stella、另存当前 `board.json`，再恢复升级时生成的 `.v8.*.bak`。schema 9 文件不能假定可由旧版本读取。
- Android 降级若被 versionCode 阻止，需要卸载当前 APK、安装旧 APK 并重新配对；桌面 Board 不受 Android 卸载影响。
- 回滚不会自动合并或清理 worktree。Stella-owned retained workspace 应先人工检查，用户拥有的外部 worktree 不应由 Stella 删除。

## 验收基线

- 桌面：typecheck、lint、全量 Vitest、生产构建、9 项 Electron/Playwright E2E、macOS arm64 unpacked package 与 bundled-Pi packaged smoke。
- Workspace：真实临时 Git 仓库证明两个 isolated writers 同时进入 Backend；同一 current folder 的两个 writers 按 FIFO 串行进入 Backend。
- Android：typecheck、9 项 Vitest、Vite build、Capacitor sync、debug APK 与签名 release APK 构建。
- API 35 AVD：完成配对、实时状态、Coordinator 回复且只生成一个 review、gate approve、report accept、确认后精确 abort、外部 stale/去重/按需详情、进程重启后持久配对与 authoritative snapshot 替换。
- 本地签名预览 APK：`Stella-Companion-0.5.0-android-vc6.apk`，SHA-256 `6ADE01B64FECD6730366BBD6AABEBBB4B33F8D4BEFBF439F0693791EC9E0D3CC`。该文件使用一次性验收证书，仅用于本机安装验证；正式 GitHub Release 必须由仓库 Secrets 中的发布证书重新签名。

完整命令与证据见 [`../testing/stella-v0.5.0-release-acceptance-2026-08-29.md`](../testing/stella-v0.5.0-release-acceptance-2026-08-29.md)。

## 明确未采用与后续项

- 没有引入 Orca Runtime、Orca 数据库或移动代码，也没有增加 generic shell backend、私有 transcript 扫描、SQLite 第二编排库、SSH/PTY 或手机原始终端。
- 桌面 Main 关闭后 Agent 不会迁移到手机；Companion 进入离线/stale，直到桌面恢复。
- Stella Relay、跨公网连接与 FCM 可靠后台通知保留为独立后续规格，不阻塞首个 LAN/既有私网 APK。

设计依据见 [`stella-v0.5.0-orca-derived-evolution.md`](stella-v0.5.0-orca-derived-evolution.md)、[`stella-v0.5.0-multi-cli-runtime.md`](stella-v0.5.0-multi-cli-runtime.md) 与 [`stella-v0.5.0-android-companion.md`](stella-v0.5.0-android-companion.md)。
