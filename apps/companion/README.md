# Stella Companion 0.5.0

独立于 Electron 桌面应用的 Capacitor Android workspace。当前切片使用内置 Mock Companion Host，用于验证 Host、Attention、Task 状态和离线快照 UI；它不会读取或修改真实 Board。

```bash
npm ci --prefix apps/companion
npm run companion:build
npm run companion:sync
npm run companion:apk:debug
```

Debug APK 输出到 `apps/companion/android/app/build/outputs/apk/debug/app-debug.apk`。构建脚本会自动优先使用 `JAVA_HOME`，并在 macOS 上回退到 Android Studio JBR；Android SDK 使用 `ANDROID_HOME`、`ANDROID_SDK_ROOT` 或标准用户目录。
