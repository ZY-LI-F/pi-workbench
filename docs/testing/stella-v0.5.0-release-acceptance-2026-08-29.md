# Stella v0.5.0 全链路发布验收（2026-08-29）

## 验收对象

- 桌面版本：`0.5.0`
- Board schema：`9`
- Android applicationId：`ai.stably.stella.companion`
- Android versionName / versionCode：`0.5.0 / 6`
- Companion Protocol：`1`
- AVD：`stella_companion_api35`，Android API 35

## 桌面质量门

| 命令 | 结果 |
| --- | --- |
| `npm run check` | typecheck、ESLint、106 个 Vitest 文件、460 项测试全部通过 |
| `npm run build && npm run test:e2e` | production build 通过；9 项 Electron/Playwright 场景通过，1 项按正常配置跳过 |
| `npm run package:dir && npm run test:packaged` | macOS arm64 unpacked package 完成；bundled Pi packaged smoke 1 项通过 |
| `npx vitest run tests/unit/worktree-concurrency-integration.test.ts tests/unit/workspace-admission-integration.test.ts tests/unit/board-v8-migration.test.ts tests/unit/board-store.test.ts` | 4 个文件、23 项迁移/准入/真实 Git 集成测试通过 |

真实临时 Git 仓库覆盖两条关键路径：两个 Stella-owned isolated worktree writer 可同时进入 Backend；两个指向同一 canonical current folder 的 writer 按 durable queue/FIFO 先后进入 Backend，没有重叠写入。

## Companion 与 Android 构建

| 命令 | 结果 |
| --- | --- |
| `npm run companion:test` | 2 个 Vitest 文件、9 项测试通过 |
| `npm run companion:build` | TypeScript 与 Vite production build 通过 |
| `npm run companion:sync` | Web assets 与两个 Capacitor plugin 同步到 Android 工程 |
| `npm run companion:apk:debug` | Gradle `assembleDebug` 通过；debug APK SHA-256 `AC82D8565A06AF3A827F04A7E3C0F044B89E79A1A70C9970A67AE0EEBFA984E3` |
| `npm run companion:apk:release` | 使用完整 signing 变量完成 `assembleRelease`、签名验证、发布物复制与 checksum；缺少 signing 变量时会在 Gradle 前失败 |

本地签名预览发布物：

```text
release/Stella-Companion-0.5.0-android-vc6.apk
SHA-256: 6ADE01B64FECD6730366BBD6AABEBBB4B33F8D4BEFBF439F0693791EC9E0D3CC
size: 3,248,347 bytes
```

`aapt dump badging` 确认 applicationId、`versionName=0.5.0`、`versionCode=6`、`minSdk=24`、`targetSdk=36` 与 `compileSdk=36`。`apksigner verify --verbose --print-certs` 确认 APK 使用 v2 scheme、一个 RSA 2048 signer 且签名有效。

该本地 APK 使用一次性 `Stella Acceptance` 证书，只用于安装和流程验收，不是正式分发身份。Tag workflow 必须从 GitHub Secrets 读取 `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS` 与 `ANDROID_KEY_PASSWORD`，重新生成正式签名 APK 和 `SHA256SUMS-android.txt`；仓库及提交历史不包含 keystore 或密码。

## API 35 AVD 场景

签名 release APK 安装到 `emulator-5554`，通过真实 Companion WebSocket Gateway 和 Android WebView 完成：

1. pairing offer、设备凭据保存与在线 authoritative snapshot；
2. Coordinator `waiting_human` 回复经过效果预览提交，并且只创建一个 Coordinator review；
3. Workflow human gate approve；
4. AgentTask reported result accept；
5. 二次确认后只 abort 指定 active execution；
6. Claude Source last-good/stale、Codex 正常 Source、managed session 去重；
7. Codex 有界按需详情可读，External 页面没有虚构的 reply/continue 控件；
8. 强制停止并重启 App 后，持久 pairing 自动重连并用 authoritative snapshot 替换缓存。

自动化入口为 `npm run companion:avd:acceptance`；重连入口为 `STELLA_COMPANION_AVD_MODE=reconnect npm run companion:avd:acceptance`。

## schema 9 迁移与回滚

BoardStore 读取 schema 1–8 时先在 `board.json` 同目录创建 `board.json.v<旧版本>.<时间>.<id>.bak`，然后执行完整迁移。v8→v9 为 Task 加入 execution workspace preference，为历史 WorkflowRun/AgentTask 加入不可变 workspace placement，并把缺失值映射为 `current-folder`。迁移失败时原文件不修改，错误包含备份路径。

回滚到只支持 schema 8 的版本：

1. 完全退出 Stella；
2. 另存当前 schema 9 `board/board.json`；
3. 恢复升级时生成的 `.v8.*.bak` 为 `board.json`；
4. 检查 retained Stella worktree，按需要人工保留、合并或清理；不要删除用户拥有的外部 worktree；
5. Android 若因 versionCode 拒绝降级，卸载当前 APK、安装旧 APK 并重新配对。Android 卸载不会修改桌面 Board。

## 架构边界与剩余项

- 未引入 Orca Runtime、Orca 数据库或 Orca 移动源码。
- 未增加 generic shell backend、Provider 私有 transcript 扫描、SQLite 第二编排库、移动 SSH/PTY、文件浏览器或原始终端。
- 桌面 Main 关闭后 Companion 显示 offline/stale；Agent 不会迁移到手机继续运行。
- 首版范围是同 LAN 或用户已有私网。Stella Relay、跨公网连接和 FCM 可靠后台通知作为独立后续项，不阻塞 v0.5.0 APK。
