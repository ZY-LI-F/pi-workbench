# Android Companion Mock APK 验收记录

- 版本：`0.5.0`（Android `versionCode 5`）
- 包名：`ai.stably.stella.companion`
- 构建命令：`npm run companion:apk:debug`
- Artifact：`apps/companion/android/app/build/outputs/apk/debug/app-debug.apk`
- 大小：约 4.0 MB
- SHA-256：`a63096fe350c41d84819e300754a646b976b58cb16bd66de23fbb0ea84c1ea22`
- 构建环境：macOS arm64、Android Studio JBR、Android SDK 36、Gradle 8.14.3

## 设备门禁

2026-08-28 在本机 AOSP Android 15 / API 35 ARM64 模拟器 `stella_companion_api35` 完成：

1. `adb install -r` 返回 `Success`；
2. 冷启动 `ai.stably.stella.companion/.MainActivity` 返回 `Status: ok`；
3. `topResumedActivity` 指向 Companion MainActivity；
4. 应用进程保持运行；
5. 截屏人工核验 Host 在线状态、Attention/全部切换、任务摘要和底部导航均正常显示。

该 artifact 是 #7 的 Mock Host 可行性产物，不连接真实 Stella Board。后续 Companion Control Plane 与 WebSocket 切片会重新构建并产生新的校验和。
