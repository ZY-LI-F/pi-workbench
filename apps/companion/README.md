# Stella Companion 0.5.0

独立于 Electron 桌面应用的 Capacitor Android workspace。App 通过版本化 Companion WebSocket 与桌面 Stella 配对，读取真实 Agent Projection，并在断线时保留带有 stale 标记的 last-good snapshot。桌面仍是 Board 和执行状态的唯一事实源。

```bash
npm ci --prefix apps/companion
npm run companion:build
npm run companion:sync
npm run companion:apk:debug
```

Debug APK 输出到 `apps/companion/android/app/build/outputs/apk/debug/app-debug.apk`。构建脚本会自动优先使用 `JAVA_HOME`，并在 macOS 上回退到 Android Studio JBR；Android SDK 使用 `ANDROID_HOME`、`ANDROID_SDK_ROOT` 或标准用户目录。

## 本地实时验收

先启动真实 Companion Gateway 的验收主机：

```bash
npm run companion:host:mock
```

该命令使用真实协议、配对存储、幂等命令回执和 WebSocket Gateway，只把 Board 数据源替换为可预测的验收快照。它会打印一个 `stella://pair?...` 配对链接；在 Android App 中粘贴链接，或使用桌面 Stella 设置页生成的二维码完成配对。Android 模拟器默认通过 `10.0.2.2:43822` 连接宿主机；可用 `STELLA_COMPANION_ACCEPTANCE_ADDRESS` 和 `STELLA_COMPANION_ACCEPTANCE_PORT` 覆盖。

Agent 卡片可打开 Task Room。消息必须先查看效果预览再提交；普通消息、Agent mention 和等待中的 Coordinator 回复都交给桌面既有规则处理。人工关卡、执行验收与精确 execution 中止同样通过 typed command 执行，破坏性决定会再次确认。连接中断前未收到结果的命令会显示“结果未知”，并可使用同一 idempotency key 查询或重试。

桌面正式 Gateway 默认监听 `43821`，可通过 `STELLA_COMPANION_PORT` 修改。首个预览 APK 面向同一局域网或既有私有网络路径，Android 使用明确配置的 cleartext LAN transport；桌面关闭后 App 会显示离线快照并自动重连，不会在手机端接管 Agent Runtime。
