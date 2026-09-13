# Stella 功能介绍与操作说明

版本：0.7.0。日期：2026-09-13。

## 入口与内容

桌面端从「偏好设置」顶部进入「功能介绍与操作说明」。Android 从首页右上角「设置」进入同名入口。尚未选择项目、尚未配对手机、Pi 尚未就绪时，仍能查阅对应平台的指南。

| 平台 | 主题 |
| --- | --- |
| 桌面 | 整理项目、不选项目也能记任务、找到更多任务、与 Pi 工作、执行与验收、连接 Android |
| Android | 连接你的电脑、查看工作动态、回复与验收、外部活动与断线 |

每个主题包含一句功能介绍、一张操作示意图、三步操作和一条必要提示。文案使用界面上的实际入口名称；桌面任务与手机工作动态分别介绍，手机指南不宣称具备桌面项目创建或手工任务编辑能力。

图示为本项目绘制的 SVG，随程序一起打包，没有外部图片依赖，也不包含用户目录、项目内容、配对码或模型凭据。图片旁标注「操作示意」，不把示意内容作为正在执行的真实任务。主题文字与图示映射集中在 [user-guide.ts](../../src/shared/user-guide.ts)，两端分别使用适合桌面和触屏的阅读布局。

## 交互

- 桌面左侧主题导航支持点击、方向键、Home / End；窄窗口变成可以横向滚动的主题条。
- 阅读区独立滚动，切换主题回到顶部。底部提供「返回设置」和「下一主题／阅读完成」。
- 桌面关闭指南会恢复设置界面及入口焦点，继续按 Escape 才关闭设置。
- Android 使用全屏原生 HTML dialog；主题条横向滚动，内容纵向滚动。返回按钮、Escape 和 Android 系统返回键先返回设置，再返回首页。
- 打开说明不会发送模型请求、生成配对码或修改项目。配图与文字离线可读。

## 构建

桌面与 Android 的应用版本统一为 0.7.0。Android 的 versionName 和默认 versionCode 从 `apps/companion/package.json` 读取，当前 versionCode 为 8；签名及 CI 构建的文件名也从同一来源读取，避免旧版本号残留。

Windows Android 构建脚本为 [build-companion-android.ps1](../../scripts/build-companion-android.ps1)：

```powershell
# JAVA_HOME 指向 JDK 21，ANDROID_HOME 指向已安装的 Android SDK。
./scripts/build-companion-android.ps1 -Configuration Debug

# Release 额外需要 STELLA_ANDROID_KEYSTORE、STELLA_ANDROID_KEYSTORE_PASSWORD、
# STELLA_ANDROID_KEY_ALIAS、STELLA_ANDROID_KEY_PASSWORD 环境变量。
./scripts/build-companion-android.ps1 -Configuration Release
```

脚本执行 Web 构建、Capacitor 同步、Gradle 打包、APK 签名验证和 SHA-256 生成。缺少工具、签名变量或实际 APK 时明确失败，不返回模拟安装结果。原有 Bash 构建入口继续保留。

## 验收

- [桌面指南 E2E](../../tests/e2e/user-guide.spec.ts)：设置入口、六个主题的真实配图加载、断网阅读、键盘切换、窄窗口滚动、返回焦点及无模型请求。
- [Android Web 指南 E2E](../../tests/e2e/companion-guide.spec.ts)：未配对时进入设置，四个主题离线阅读、配图加载、小屏无横向溢出、返回层级与焦点恢复。使用生产 Web 资源，不连接模拟 Host。
- [0.7.0 构建与安装验收](../testing/stella-v0.7.0-installation-acceptance.md)：最终安装包、校验值、Windows 旧数据迁移、Android 模拟器离线阅读与系统返回键实测。

实际截图：[桌面指南](../user-guide-desktop.png)、[桌面窄窗口](../user-guide-narrow.png)、[手机 Web 布局](../user-guide-android-web.png)、[Android 安装后界面](../user-guide-android-native.png)。
