# Stella 0.7.0 图文指南与本机安装验收

日期：2026-09-13。源码基线：`8d72beb`，本地分支 `codex/pi-input-session-fixes`。本次包包含此前的项目看板、无项目任务、长列表滚动，以及本次新增的设置内图文指南。设计见 [图文指南说明](../specs/stella-user-guide.md) 与 [项目看板设计](../specs/stella-project-board.md)。

## 交付与安装结果

| 平台 | 产物 | 实际安装结果 |
| --- | --- | --- |
| Windows x64 | `release/v0.7.0/Stella Pi Workbench-0.7.0-win-x64.exe`，134,557,789 字节 | NSIS 静默安装退出码 0；本机旧 0.3.0 升级到 0.7.0；注册表、程序文件及运行时版本一致 |
| Android | `release/v0.7.0/Stella-Companion-0.7.0-android-vc8.apk`，32,188,797 字节 | `adb install -r` 返回 Success；冷启动返回 ok；实际 versionName 为 0.7.0，versionCode 为 8 |

Windows 安装位置为 `%LOCALAPPDATA%\Programs\Stella Pi Workbench\Stella Pi Workbench.exe`。桌面入口为「Stella Pi Workbench」。Android 安装在这台 Windows 电脑上的 `Stella_Companion_API_35` 模拟器中，设备序列号 `emulator-5554`，Android 15 / API 35 / x86_64。桌面另建「Stella Companion Android」快捷方式，用于打开该模拟器，应用已安装在其中。此次没有连接实体 Android 手机，不能将模拟器安装记作手机真机安装。

Android 包的 applicationId 为 `ai.stably.stella.companion`，minSdk 26、targetSdk 36，包含 arm64-v8a、armeabi-v7a、x86、x86_64 库；本次实际运行验证仅覆盖 x86_64 模拟器。

校验文件为 `release/v0.7.0/SHA256SUMS.txt`：

```text
DC0ED26C7C5DAF0EAA0532A587556627D051BC09EE24B0C616B5AEA8864C4014  Stella Pi Workbench-0.7.0-win-x64.exe
DCB82BC3113E4496AC87F3E5A803029786B0842279632523E92257C407623F80  Stella Pi Workbench-0.7.0-win-x64.exe.blockmap
36FCBBACB3AC637C63A015601D00330B9AE7063B3CA97D3203FB60C4A60FFCF0  Stella-Companion-0.7.0-android-vc8.apk
```

Windows 安装包的 Authenticode 检查结果为 `NotSigned`。Android 使用本机持久保存的 Release 签名证书，`apksigner verify --verbose` 通过，v2 签名有效；它不是项目线上发布证书。本地签名材料位于 `%USERPROFILE%\.stella\signing`，密码以当前 Windows 用户的 DPAPI 凭据文件保存，未写入仓库或安装包。本次没有执行 GitHub Release 发布。

## 数据迁移

安装前确认旧版 Stella 没有运行，备份其应用数据至：

```text
%USERPROFILE%\.stella\backups\before-0.7.0-20260913-152941
```

随后通过实际安装目录启动程序，使用原 `%APPDATA%\Stella Pi Workbench` 配置完成初始化。Board 从 schema 7 迁移至 10，并生成原始 v7 文件备份。逐条比对以下数据：

| 数据 | 升级前 | 升级后 |
| --- | --- | --- |
| 手工任务 | 5 | 5 |
| 活动记录 | 591 | 591 |
| 评论 | 15 | 15 |
| Agent 执行记录 | 16 | 16 |

五个 Task 的 ID、标题、说明、验收标准、优先级、项目路径与名称、信任状态、执行目标、阶段、创建时间、阻塞原因、执行次数和规格版本均保持不变。上述历史记录的 ID 均保留。验收读取真实数据，没有创建、分发或删除用户任务。

## 检查记录

| 检查 | 实际结果与范围 |
| --- | --- |
| `npm run check` | Main / Renderer 类型检查、Renderer ESLint 通过；126 个测试文件、581 项单测通过；本次全量检查始于本地时间 15:03:12 |
| `npm run companion:build` | TypeScript 与生产 Web 构建通过；最终焦点修正后重新执行 |
| `npm run companion:test` | 4 个测试文件、18 项单测通过 |
| 桌面指南源码 E2E | 1 / 1 通过，六个主题、离线图片、键盘导航、窄窗口滚动、关闭后的焦点恢复 |
| 最终 Windows 打包程序 E2E | 5 / 5 通过，58.3 秒；包含 bundled Pi smoke、3 项项目看板场景和图文指南 |
| 最终 Companion 生产 Web E2E | 1 / 1 通过，4.2 秒；390 × 844、未配对入口、四个主题、离线配图、内容滚动及返回层级 |
| Windows 安装后检查 | 实际运行版本 0.7.0、原用户数据迁移、六个指南主题、配图加载、无页面脚本异常 |
| 安装产物一致性 | Windows 安装后的 ASAR 与打包目录相同；其中 35 个生产构建文件逐字节相同；APK 内 7 个生产 Web 文件与最终 dist 相同 |
| Android 原生安装验收 | 实际 Release APK 安装、冷启动、进入设置、断网查看四个主题、触屏滚动、系统返回键逐层返回设置与首页，均通过 |

打包程序检查命令：

```powershell
$env:STELLA_PACKAGED_EXECUTABLE = "$env:USERPROFILE\.cache\stella-package\v0.7.0\win-unpacked\Stella Pi Workbench.exe"
npx playwright test tests/e2e/packaged.spec.ts tests/e2e/project-board.spec.ts tests/e2e/user-guide.spec.ts --output test-results/v070-packaged
npx playwright test tests/e2e/companion-guide.spec.ts --output test-results/companion-guide-web-final
```

项目 E2E 包含真实存储的 120 个任务、未选择项目时创建、绑定后身份保持、项目列表末项可达及窄窗口横向滚动。其用例与前次验收有重叠，不能相加宣称为更多独立用例。桌面协议夹具沿用仓库的明确标识，指南测试断言没有模型 POST；此次未执行新的真实云模型推理验收。

Android 原生验收通过 ADB 操作最终 Release 包，使用 UI Automator 检查页面文本和返回结果、screencap 检查配图。关闭模拟器 Wi-Fi 和移动数据后，`dumpsys connectivity` 显示 `Active default network: none`；四个主题仍有真实配图和三步文字。滚动使“下一主题”完整可达，切换主题回到正文顶部。`KEYCODE_BACK` 首次返回设置，第二次返回首页。检查后恢复了模拟器网络，没有操作本机其他设备的网络。

原生日志没有发现应用崩溃；Release 进程有一条无法加载 JDWP 调试代理的启动信息。验收没有打开生产包的 WebView 调试或替换原生执行路径。图片与页面记录位于忽略提交的 `test-results/v070-artifacts`；可分享的无用户数据截图见 [Android 实际安装界面](../user-guide-android-native.png)、[桌面指南](../user-guide-desktop.png) 和 [桌面窄窗口](../user-guide-narrow.png)。

## 构建环境与修正记录

Windows 使用 Node.js 22.23.2、Electron 43.1.1、官方 Pi 0.84.2。Android 使用本机新增的 JDK 21、SDK 36 构建工具及支持 WHPX 的 API 35 模拟器；原有系统 JAVA_HOME 未被覆盖。

Windows 最初在仓库 release 目录打包遇到 EPERM / EBUSY。Windows Restart Manager 定位到 Orca 进程持有临时 Electron 文件句柄，因此将构建输出设为 `%USERPROFILE%\.cache\stella-package\v0.7.0`，成功打包后校验并复制最终安装器到 release。没有终止 Orca 或修改产品代码绕过文件错误。

Android Web 检查发现关闭设置后没有恢复首页入口焦点，已修正并重新构建、测试、签名打包。Windows 安装检查第一次早于 Task Control 就绪，明确返回 loading；检查改为等待能力状态 ready 后读取 Board，后续通过。初始化错误没有被吞掉，也没有加入产品重试或模拟成功路径。

构建脚本见 [Windows PowerShell 入口](../../scripts/build-companion-android.ps1)。它执行生产 Web 构建、Capacitor 同步、真实 Gradle 构建、APK 签名验证和校验文件生成；原有 Bash 与 CI 入口也从 Companion package.json 读取版本。

收尾时，包含重复下载缓存删除的命令被自动审批以 `blocked by policy` 拒绝，未提供更具体原因。缓存保留在用户 `.cache` 目录；后续单独完成了快捷方式创建和已安装 Windows 应用启动。此拦截不影响安装包、SDK、模拟器或验收结果。
