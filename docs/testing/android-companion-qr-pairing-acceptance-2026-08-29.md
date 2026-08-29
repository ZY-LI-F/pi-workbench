# Android Companion 应用内扫码配对验收（2026-08-29）

## 构建对象

- 产品版本：`0.5.0`
- Android versionCode：`7`
- Companion Protocol：`1`
- 最低 Android：API 26（Android 8）
- 扫码 Adapter：`@capacitor/barcode-scanner 3.1.1`，Android ML Kit QR 模式
- Debug APK：`release/Stella-Companion-0.5.0-vc7-qr-debug.apk`
- SHA-256：`46b5f243b68b2776b304fb1f431d58119f8e22daafecc2160ab52960678447c9`

## 自动化结果

```text
npm test --prefix apps/companion
4 files / 18 tests passed

npm run build --prefix apps/companion
passed

npm run companion:apk:debug
BUILD SUCCESSFUL

npm run check
106 files / 462 tests passed

npm run companion:avd:acceptance
PASS paired release APK is online
PASS Coordinator reply created one review round
PASS human gate approved
PASS execution report accepted
PASS exact execution aborted after confirmation
PASS external last-good, de-duplication, and bounded read-only detail
```

扫码单元测试使用可替换 `CompanionPairingCodeReader`，覆盖有效 `stella://pair`、非 Stella 二维码、原生取消错误码和相机拒绝错误码。WebSocket Client 回归覆盖“二维码已通过解析、但桌面 endpoint 不可达”的独立提示。

## API 35 原生验收

在本机 `stella_companion_api35` AVD 安装实际 debug APK 后完成：

1. `adb install -r` 返回 `Success`，冷启动 MainActivity 成功；
2. APK badging 为 `versionName 0.5.0 / versionCode 7 / minSdk 26 / targetSdk 36`；
3. manifest 包含 `android.permission.CAMERA` 和 `android.permission.INTERNET`；
4. 首屏显示“扫码配对”，点击后出现 Android CAMERA 运行时权限对话框；
5. 授权后前台 Activity 为 `com.outsystems.plugins.barcode.view.OSBARCScannerActivity`，扫描说明、取消和闪光灯控件均存在；
6. 点击取消返回 Companion MainActivity，WebView 文本中无“连接提示”；
7. 拒绝权限并关闭原生说明后，Companion 明确提示到 Android 系统设置授予相机权限。
8. 通过同一 `stella://pair` codec 把真实一次性 offer 交给已安装 APK，成功连接本机真实 WebSocket Gateway 并通过完整 Companion AVD 场景，证明本轮没有破坏配对后的控制面。

模拟器没有伪造一次物理摄像头识别作为真实手机证据；二维码内容的接受/拒绝由扫码 Adapter 测试覆盖。Mac、Windows、Android 的实际跨 Wi-Fi Tailscale 连通仍以三端登录同一 tailnet 为前置条件，不由扫码功能替代。
