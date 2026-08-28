# Android Companion 外部 Execution 验收（2026-08-28）

## 交付范围

Ticket #13 把桌面已有的 Claude/Codex External Execution Sources 接入 Companion Control Plane。桌面和 Android 共用 `projectAgentActivity`，因此 bucket、状态、父子关系、Task association 和 managed session 去重规则只有一套实现。

- Companion snapshot 增加有界的外部 execution 引用和逐 Source 健康摘要；
- Gateway 只在至少一个实时客户端订阅时轮询 Source，桌面 Source 自身刷新也会发布新 snapshot；
- Source 失败保留该 Source 的 last-good 项目并标记 stale，不影响其他 Source；
- Android External 页面支持来源、项目、状态筛选；
- 只有 Source 声明真实 details capability 时才显示“查看只读详情”，详情按需读取并限制为 20 turns、100 items、每项 4,000 字符；
- managed association 已由统一投影去重，imported association 保留并可打开对应 Task Room；
- Android 协议没有 Provider CLI 执行、文件读取、外部回复或 continue frame。

## 自动化证据

- `agent-projection.test.ts`：managed 外部 session 与既有 Stella execution 不产生重复卡片；
- `external-execution-service.test.ts`：逐 Source last-good/stale 和 refresh observer 隔离；
- `companion-control-plane.test.ts`：desktop/mobile projection parity、association、Source health、轮询生命周期和详情上限；
- `companion-gateway.test.ts`：真实 WebSocket 下 Android client 收到外部 snapshot 并懒加载详情；
- `companion-client.test.ts`：`get-external-detail` 请求/响应 round trip。

## API 35 AVD 实测

在 `emulator-5554` 安装 0.5.0 debug APK，并与真实 `CompanionGateway` 验收 Host 配对：

1. Agent Activity 同时显示 managed Agent、Claude needs-input 和 Codex working；Host 提供的 managed duplicate 没有显示为第二张卡；
2. External 页面显示 Claude last-good/stale 提示、Claude 只读卡和 Codex 只读卡；
3. 来源下拉包含全部来源、Claude Agents、Codex Threads，选择 Codex 后列表只保留 Codex 卡，Claude 健康提示随筛选隐藏；
4. Codex 卡展示 project、native session、parent 和更新时间；
5. 点击“查看只读详情”后，通过真实 WebSocket 展示 User/Codex turn items，页面没有回复或 continue 控件；
6. Claude Source 不声明 details capability，因此只显示只读状态，不显示无效详情按钮。

Debug APK SHA-256：`ae92ef61d4523bb7d9aee44fbeaa170370039b45f9d810e538e67869a6eb28da`。
