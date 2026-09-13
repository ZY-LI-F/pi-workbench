# Stella v0.6.0 · Tickets / Todo

状态须由可执行证据更新，不以代码已编译代替验收。规格见 [spec](stella-v0.6.0-native-reliability.md)。

## N01 · RPC 字节流与进程隔离（P0）

- [x] per-process decoder/buffer/pending/generation；处理 EOF 与协议错误。
- [x] 旧子进程不能影响新请求；并发 start/stop 有确定所有权。
- [x] 回归：逐字节中文 emoji、CRLF、EOF、迟到事件、timeout/response/exit。

证据：`pi-rpc-runtime-timeout.test.ts` 16 项通过；包含先失败后修复的“协议退出未结束时 stop/start 不得提前完成”。

## N02 · 稳定消息身份与快照边界（P0）

- [x] 实时 occurrence ID，历史官方 entry ID，准确分支动作。
- [x] scope/sequence 桥接与一致 hydrate；导航/刷新不能污染会话。
- [x] 同毫秒/同正文独立消息、分支切换、迟到快照回归。

证据：`runtime-state.test.ts`、`session-message-identity.test.ts`、`use-pi-runtime.test.tsx`；Electron 重复输入保留两个官方 entry，断连恢复同一 Session。

## N03 · 持久化原生提交回执（P1）

- [x] 原子落盘、幂等 ID/digest、四态回执、重启 pending→unknown。
- [x] 输入发送接入，明确已接受/已拒绝/未知；不自动重发。
- [x] 崩溃边界、重复提交、并发、写盘错误、未来 schema 测试。

证据：`native-submission-service.test.ts`、`native-submissions-hook.test.tsx`；真实 Electron 重启回执与重复 IPC 验收。

## N04 · 本机诊断导出（P1）

- [x] 结构化元数据 trace、请求/session 关联、版本/布局信息。
- [x] 检查器导出与可见反馈；默认不含正文/密钥/原始 stderr。
- [x] 脱敏边界、导出失败、IPC 及 UI 检查。

证据：`native-diagnostics.test.ts`；E2E 覆盖普通/断连导出、取消、写盘失败、文件管理器定位失败；检查导出不含测试提示词与凭据。

## N05 · 有序事件批处理与性能回归（P1）

- [x] 有序折叠、批量提交，settled 后正确刷新，无事件丢弃。
- [x] 逐事件/批处理等价；历史解析次数与长会话阅读稳定性检查。

证据：`ordered-event-batch.test.ts`、`conversation-render-work.test.tsx`；2,002 个有序事件等价，40 次更新不重解析 80 条历史 Markdown。

## N06 · 会话 Attention 与查看状态（P2）

- [x] 原生状态/未读呈现，不影响 Team 执行事实。
- [x] 版本化查看元数据，恢复阅读/文件选择，错误不静默重置。
- [x] 跨会话、重新挂载、未来 schema、阅读不跳动测试。

证据：`native-session-views.test.ts`、`conversation-scroll.test.tsx`；Electron 跨 Session 与 renderer 重载后的历史阅读验收。

## N07 · 文件版本与预览引用（P2）

- [x] 本机验证状态/文件版本；路径和选区引用进入草稿，不覆盖已有输入。
- [x] 文件切换与引用入口可用、版本变化可见，保持预览安全策略。
- [x] 文件服务、引用格式、草稿并发和 UI 回归。

证据：`file-reference.test.ts`、`file-preview-panel.test.tsx`、`local-paths.test.ts`、`session-composer-draft.test.tsx`，及真实文件修改后引用被明确要求刷新。

## N08 · 集成与 v0.6.0 交付（P0）

- [x] 所有专门回归、typecheck、lint、全量单测和生产构建。
- [x] 原生 Electron/Pi E2E 与故障路径；受控夹具和真实模型结果分开。
- [x] 更新版本、中英文说明和验收记录。
- [x] Windows 安装包及产物校验，明确签名/macOS/云端发布限制。

证据：全量 120 个文件 / 553 项单测；最终原生 E2E 12/12、打包态 4/4；DeepSeek V4 Flash 两轮真实任务通过；NSIS 0.6.0 与 35 个构建文件逐字节一致。安装包、哈希、测试命令、未覆盖项及一次未稳定复现的剪贴板空读均见[验收报告](../testing/stella-v0.6.0-native-reliability-acceptance.md)。勾选代表列明交付已完成，不代表没有未知缺陷。
