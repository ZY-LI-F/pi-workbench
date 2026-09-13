# Stella Companion

独立于 Electron 桌面应用的 Capacitor Android workspace。App 通过 Companion Protocol `1` 与桌面 Stella 配对，读取真实 Agent Projection，并在断线时保留带 stale 标记的 last-good snapshot。桌面仍是 Board 和执行状态的唯一事实源；产品版本和 Android versionCode 由本目录 `package.json` 管理，最低支持 Android 8（API 26）。

## 开发与 debug APK

```bash
npm ci --prefix apps/companion
npm run companion:test
npm run companion:build
npm run companion:sync
npm run companion:apk:debug
```

Debug APK 输出到 `apps/companion/android/app/build/outputs/apk/debug/app-debug.apk`。构建脚本优先使用 `JAVA_HOME`，并在 macOS 上回退到 Android Studio JBR；Android SDK 使用 `ANDROID_HOME`、`ANDROID_SDK_ROOT` 或标准用户目录。

## 一部手机连接 Mac 与 Windows

Companion 可以保存多台桌面 Host，并为每台 Host 同时维护独立 WebSocket、凭据和 last-good snapshot。顶部可选择“全部电脑”聚合查看，也可切换到单台电脑；Task Room、外部 execution 详情和所有 typed command 都携带明确的 `hostId`，不会因为切换看板范围而发往另一台电脑。旧版单 Host 存储会在首次启动时自动迁移到本机 storage revision `2`，不改变 Wire Protocol `1`。

跨 Wi-Fi 推荐直接使用同一个免费 Tailscale tailnet：

1. 在 Android、Mac、Windows 上安装 Tailscale，并登录同一个 tailnet。
2. 在 Mac 与 Windows 分别启动 Stella；两台桌面都必须保持运行。
3. 在每台桌面的“偏好设置 → Android Companion”检查“首选地址”，Tailscale 的 `100.64.0.0/10` 地址会自动排在 LAN 地址之前。
4. 依次为 Mac、Windows 生成一次性配对码，在 Companion 点击“扫码配对”并允许相机权限。

扫码器只接受完整的 `stella://pair` offer。取消扫码不会显示错误；相机权限被拒、二维码内容无效、二维码有效但桌面 endpoint 不可达会分别提示。后两种情况不是同一个问题：跨 Wi-Fi 时先确认三台设备都出现在同一个 [Tailscale Machines](https://login.tailscale.com/admin/machines) 列表，且桌面配对页的首选地址为 `100.x` 或 MagicDNS。

如果需要固定使用 Tailscale MagicDNS 名称或指定地址，可在启动 Stella 前设置：

```bash
export STELLA_COMPANION_PUBLIC_ADDRESS=studio-mac.example-tailnet.ts.net
```

Windows 可使用等价的环境变量配置。`STELLA_COMPANION_PUBLIC_ADDRESS` 只决定新配对链接中的首选 Host；已配对记录继续使用原 endpoint，如需更换 endpoint，请在手机上只忘记对应电脑后重新配对。GitHub 不参与实时连接或中继。

## 签名 release APK

Release signing material 不进入源码。Gradle、Bash、PowerShell 和 CI 从本目录 `package.json` 读取产品 `version` 与默认 `androidVersionCode`；发布前同步产品版本并递增 Android 构建编号。需要覆盖构建编号时，可显式设置 `STELLA_ANDROID_VERSION_CODE`：

```bash
export STELLA_ANDROID_KEYSTORE=/absolute/path/to/release.jks
export STELLA_ANDROID_KEYSTORE_PASSWORD='...'
export STELLA_ANDROID_KEY_ALIAS='...'
export STELLA_ANDROID_KEY_PASSWORD='...'
npm run companion:apk:release
```

脚本会执行 Capacitor sync、`assembleRelease`、`apksigner verify`，并生成：

```text
release/Stella-Companion-{version}-android-vc{versionCode}.apk
release/SHA256SUMS-android.txt
```

缺少任意 signing 变量或 keystore 文件时构建会直接失败。Tag 发布由 `.github/workflows/release.yml` 使用 `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS` 与 `ANDROID_KEY_PASSWORD` 四个 GitHub Secrets 重新签名；本地验收证书不能代替正式发布证书。

## 本地实时验收

先启动真实 Companion Gateway 的验收主机：

```bash
npm run companion:host:mock
```

该命令使用真实协议、配对存储、幂等命令回执和 WebSocket Gateway，只把 Board 数据源替换为可预测的验收快照。它会打印一个 `stella://pair?...` 配对链接；在 Android App 中粘贴链接，或点击“扫码配对”扫描桌面 Stella 设置页生成的二维码。Android 模拟器默认通过 `10.0.2.2:43822` 连接宿主机；可用 `STELLA_COMPANION_ACCEPTANCE_ADDRESS` 和 `STELLA_COMPANION_ACCEPTANCE_PORT` 覆盖。

Agent 卡片可打开 Task Room。消息必须先查看效果预览再提交；普通消息、Agent mention 和等待中的 Coordinator 回复都交给桌面既有规则处理。人工关卡、执行验收与精确 execution 中止同样通过 typed command 执行，破坏性决定会再次确认。连接中断前未收到结果的命令会显示“结果未知”，并可使用同一 idempotency key 查询或重试。

底部 `External` 页面复用桌面的 External Execution Source 和统一 Agent Projection，可按来源、项目、状态查看 Claude/Codex 原生活动。每个 Source 独立显示 ready、unavailable 或 last-good/stale；Codex 结构化详情只在用户点击时有界读取。关联到现有 managed execution 的重复 Source 记录不会再生成第二张卡。该页面只提供状态、关联 Task 跳转和真实可用的只读详情，不在 Android 上运行 Provider CLI，也不提供没有真实发送能力的回复/continue 按钮。

桌面正式 Gateway 默认监听 `43821`，可通过 `STELLA_COMPANION_PORT` 修改。Gateway 监听所有 IPv4 网卡，并优先把检测到的 Tailscale IPv4 放入新配对链接；Android 使用明确配置的 cleartext private-network transport。桌面关闭后 App 会按 Host 显示离线快照并自动重连，不会在手机端接管 Agent Runtime。

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

双 Host 验收可在 `43822` 运行默认验收主机，并在 `43823` 以 `STELLA_COMPANION_ACCEPTANCE_HOST_NAME='Windows Acceptance Host'` 启动第二个实例；两次配对完成后运行：

```bash
STELLA_COMPANION_AVD_MODE=multi-host npm run companion:avd:acceptance
```

该模式验证两个 Host 同时在线、全部/单机切换，并在 Windows Task Room 提交唯一消息后确认 Mac 的同名 Task Room 不包含该消息。脚本通过 Android WebView CDP 驱动实际安装的 APK，不替代共享协议、Gateway 和移动端单元测试。
