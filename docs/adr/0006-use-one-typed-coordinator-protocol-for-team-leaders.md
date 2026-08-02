# ADR 0006：LEAD 与 Squad Leader 共用结构化协调协议

新的 LEAD 与 Squad 分发都使用 `coordinator_action` 提交委派、修订、重规划、询问用户或完成行动，普通文本、手写 JSON 和文本 `@mention` 不再拥有控制权；Squad 只限制可委派成员与固定指令，不再维护第二套 Leader 状态机。Worker 失败按委派轮次进入 Coordinator 验收上下文，由 Leader 明确决策而非立即取消全组；旧 `squad-leader` 记录仅为持久数据兼容继续可读和可按同一协议执行。
