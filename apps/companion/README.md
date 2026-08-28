# Stella Companion 0.5.0

独立于 Electron 桌面应用的 Capacitor Android workspace。App 通过 Companion Protocol `1` 与桌面 Stella 配对，读取真实 Agent Projection，并在断线时保留带 stale 标记的 last-good snapshot。桌面仍是 Board 和执行状态的唯一事实源；Android versionCode 独立于产品版本，首个发布候选为 `6`。

## 开发与 debug APK

```bash
npm ci --prefix apps/companion
npm run companion:test
npm run companion:build
npm run companion:sync
npm run companion:apk:debug
```

Debug APK 输出到 `apps/companion/android/app/build/outputs/apk/debug/app-debug.apk`。构建脚本优先使用 `JAVA_HOME`，并在 macOS 上回退到 Android Studio JBR；Android SDK 使用 `ANDROID_HOME`、`ANDROID_SDK_ROOT` 或标准用户目录。

## 签名 release APK

Release signing material 不进入源码。为每次对外发布递增 `STELLA_ANDROID_VERSION_CODE`，保持当前产品 `versionName` 为 `0.5.0`：

```bash
export STELLA_ANDROID_KEYSTORE=/absolute/path/to/release.jks
export STELLA_ANDROID_KEYSTORE_PASSWORD='...'
export STELLA_ANDROID_KEY_ALIAS='...'
export STELLA_ANDROID_KEY_PASSWORD='...'
export STELLA_ANDROID_VERSION_CODE=6
npm run companion:apk:release
```

脚本会执行 Capacitor sync、`assembleRelease`、`apksigner verify`，并生成：

```text
release/Stella-Companion-0.5.0-android-vc6.apk
release/SHA256SUMS-android.txt
```

缺少任意 signing 变量或 keystore 文件时构建会直接失败。Tag 发布由 `.github/workflows/release.yml` 使用 `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS` 与 `ANDROID_KEY_PASSWORD` 四个 GitHub Secrets 重新签名；本地验收证书不能代替正式发布证书。

## 本地实时验收

先启动真实 Companion Gateway 的验收主机：

```bash
npm run companion:host:mock
```

该命令使用真实协议、配对存储、幂等命令回执和 WebSocket Gateway，只把 Board 数据源替换为可预测的验收快照。它会打印一个 `stella://pair?...` 配对链接；在 Android App 中粘贴链接，或使用桌面 Stella 设置页生成的二维码完成配对。Android 模拟器默认通过 `10.0.2.2:43822` 连接宿主机；可用 `STELLA_COMPANION_ACCEPTANCE_ADDRESS` 和 `STELLA_COMPANION_ACCEPTANCE_PORT` 覆盖。

Agent 卡片可打开 Task Room。消息必须先查看效果预览再提交；普通消息、Agent mention 和等待中的 Coordinator 回复都交给桌面既有规则处理。人工关卡、执行验收与精确 execution 中止同样通过 typed command 执行，破坏性决定会再次确认。连接中断前未收到结果的命令会显示“结果未知”，并可使用同一 idempotency key 查询或重试。

底部 `External` 页面复用桌面的 External Execution Source 和统一 Agent Projection，可按来源、项目、状态查看 Claude/Codex 原生活动。每个 Source 独立显示 ready、unavailable 或 last-good/stale；Codex 结构化详情只在用户点击时有界读取。关联到现有 managed execution 的重复 Source 记录不会再生成第二张卡。该页面只提供状态、关联 Task 跳转和真实可用的只读详情，不在 Android 上运行 Provider CLI，也不提供没有真实发送能力的回复/continue 按钮。

桌面正式 Gateway 默认监听 `43821`，可通过 `STELLA_COMPANION_PORT` 修改。首个预览 APK 面向同一局域网或既有私有网络路径，Android 使用明确配置的 cleartext LAN transport；桌面关闭后 App 会显示离线快照并自动重连，不会在手机端接管 Agent Runtime。

## API 35 AVD 自动验收

先安装 APK、启动 App，并与 `npm run companion:host:mock` 打印的 offer 完成首次配对。为 WebView 调试端口建立 ADB 转发后运行全场景脚本：

```bash
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof ai.stably.stella.companion)
npm run companion:avd:acceptance
```

脚本验收在线状态、Coordinator 回复只产生一个 review、gate、report review、确认后的精确 abort、外部 Source stale/last-good、managed 去重和按需只读详情。随后强制停止并重新启动 App、重新建立端口转发，再验收持久配对和 authoritative snapshot 替换：

```bash
STELLA_COMPANION_AVD_MODE=reconnect npm run companion:avd:acceptance
```

该脚本通过 Android WebView CDP 驱动实际安装的 APK，不替代共享协议、Gateway 和移动端单元测试。
