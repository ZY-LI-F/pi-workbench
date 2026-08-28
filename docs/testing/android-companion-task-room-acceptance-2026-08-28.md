# Android Companion Task Room 验收（2026-08-28）

## 交付范围

Ticket #12 在 Companion Control Plane 增加四类 typed command：

- `add-task-message`：复用桌面 `AgentTaskService.addComment`，普通文本只追加评论，允许的 Agent mention 按桌面规则分发，waiting Coordinator/Squad Leader 回复只创建下一轮 review；
- `resolve-human-gate`：携带 task、run 和 step fence，支持 approve/reject；
- `review-execution`：携带精确 Workflow/AgentTask execution identity，支持 accept/revision-requested/reject；
- `abort-execution`：只中止命令中指定且仍为 active 的 execution。

每条 mutation 都携带设备作用域的 idempotency key。桌面在 Board 之外持久化有界、会过期的 receipt；同设备同 key 重试返回原结果，不重复执行。桌面在真正调用领域服务前先持久化 `indeterminate` reservation，因此进程在 mutation 附近异常退出时不会把未知结果伪装成未执行。

## 移动端行为

- Task Room 按需读取有上限的任务详情、最近 timeline 和当前可用 actions；
- 消息必须先显示 `comment-only`、`dispatch-agent-tasks` 或 `resume-coordinator` 效果，再允许提交；
- gate、review 和 abort 提交前从桌面重新 preview；reject/abort 要求二次确认；
- accepted、rejected、offline、submitting 和 indeterminate 均有独立状态；
- indeterminate 命令保留原 key，恢复连接后可查询/重试；
- 协议没有 shell、PTY、凭据配置、原始 Board mutation 或外部 CLI 输入 frame。

## 自动化证据

- `companion-command-service.test.ts`：评论/mention/Coordinator 预览、所有 command 路由、持久 receipt、并发串行语义、key 冲突和 stale execution fencing；
- `companion-gateway.test.ts`：真实 WebSocket 配对后由 Android client preview/execute/retry，Board 只出现一条评论；
- `companion-client.test.ts`：typed preview/result round trip，以及连接在结果前断开时进入 indeterminate；
- `workflow-orchestrator.test.ts` 与 `agent-task-runner.test.ts`：领域层 run/step/AgentTask fence，旧移动命令不能作用于新 execution。

桌面主进程把移动命令直接映射到已有 AgentTask、Workflow、ExecutionReview 与 Runner 服务；Android 不实现第二套领域状态机。

## AVD 实测

在 API 35 AVD 上安装 `0.5.0` debug APK，并与真实验收 Gateway 配对：

1. 从 Agent 卡片打开 `Android 实时状态验收` Task Room，成功按需读取任务摘要、当前精确 abort action 和有界 timeline；
2. 输入 `Android test reply` 后，桌面 preview 返回“追加回复并为等待中的 Coordinator 创建一个下一轮 review”；
3. 只有完成 preview 后“按预览提交”才可用；
4. 提交后 App 显示绿色“已接受”状态和相同效果摘要，验收 host 的 Board timeline 出现该用户评论；
5. APK SHA-256：`e86405143fc80705e202111c0d987a7db62d508323ba73c1d589d773ac22a07e`。
