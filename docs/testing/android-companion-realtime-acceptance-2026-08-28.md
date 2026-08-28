# Android Companion 实时配对验收（2026-08-28）

## 范围

本次验收覆盖 ticket #11 的真实 WebSocket 路径，不使用 App 内置 Mock Host：

- 桌面短期配对 offer 与一次性消费；
- Android 保存主机与设备身份；
- 协议版本协商和认证；
- Agent Projection 实时推送；
- 断线后的 last-good/stale 状态和自动重连；
- 设备撤销、异常 frame 隔离和序列缺口全量刷新由自动化集成测试覆盖。

## 环境

- Stella / Android App：`0.5.0`
- Companion Protocol：`1`
- AVD：Android API 35，`stella_companion_api35`
- APK：`apps/companion/android/app/build/outputs/apk/debug/app-debug.apk`
- 验收主机：`npm run companion:host:mock`
- 模拟器连接地址：`ws://10.0.2.2:43822/companion`

## 结果

1. APK 安装并通过 `stella://pair` deep link 完成一次性配对。
2. App 显示 `Stella Acceptance Host` 为在线状态；Host sequence 持续递增。
3. 验收 Board 在 `working` 与 `waiting_human` 之间切换时，App 对应显示“正在执行”和“需要处理”，并出现可打开 Task Room 的 Coordinator 卡片。
4. 主动终止桌面验收主机后，App 进入“重连中”，保留 sequence 59 的最后快照，显示“离线快照”提示，且没有把旧数据误标为实时数据。
5. 自动化测试使用 Android `CompanionWebSocketClient` 对接真实本地 `CompanionGateway`，覆盖配对、认证、推送、序列缺口恢复、重连与撤销。

## 限制

首个 APK 是局域网/既有私有网络预览：桌面 Stella 必须保持运行，尚未引入 Relay 或 FCM。Android 前台 WebSocket 可实时更新；系统挂起 WebView 时不承诺后台通知。
