# Android Companion 多 Host 与 Tailscale 路径验收（2026-08-29）

## 验收范围

- 一部 Android Companion 同时保存并连接 Mac、Windows 两个 Host；
- “全部电脑”聚合、单 Host 切换和单独忘记；
- Task Room 与 external execution 详情按原始 `hostId` 精确路由；
- 旧 revision-1 单 Host 存储自动迁移为 revision 2；
- 桌面新配对 offer 自动优先选择 Tailscale `100.64.0.0/10` 地址，并支持 `STELLA_COMPANION_PUBLIC_ADDRESS`；
- App 冷启动后恢复两个 Host 的独立凭据和连接。

## 自动化与构建结果

```text
npm run check
106 files / 462 tests passed

npm run companion:test
3 files / 13 tests passed

npm run companion:build
passed

npm run companion:apk:debug
BUILD SUCCESSFUL
SHA-256 756059c2b98233475ac61562cbea2c9357fbefabbec2f0d7053cdc365798b131

npm run test:packaged
1 packaged Electron test passed
```

Gateway 单元测试验证了 Tailscale IPv4、LAN 与 loopback 的稳定排序，以及 MagicDNS/IP 显式覆盖和去重。Fleet 单元测试覆盖 v1→v2 迁移、两个 Client 同时启动、精确命令路由、只忘记一个 Host、重复配对拒绝和 React StrictMode 风格的启动/停止竞态。

## API 35 双 Host 验收

在 `stella_companion_api35` 模拟器安装本轮 debug APK，并同时启动两个真实 `CompanionGateway`：

```text
Stella Acceptance Host   ws://10.0.2.2:43822/companion
Windows Acceptance Host ws://10.0.2.2:43823/companion
```

两个 Gateway 使用不同 Host identity、配对存储、WebSocket、Board Repository、命令回执和 Control Plane。验收结果：

```text
PASS paired release APK is online
PASS two simultaneous Hosts, scope switching, aggregation, and exact command routing
```

脚本在 Windows Host 的同名 Task Room 提交唯一消息 `Windows-only multi-host route`，随后切换到 Mac Host 并确认其 Task Room 不包含该消息。强制停止并冷启动 Android App 后再次执行同一验收，两个 Host 均自动认证并恢复为 `2/2 在线`。

既有单 Host 全场景也在同一 APK 上重新通过：Coordinator 回复只创建一次 review、人工关卡批准、执行报告接受、精确 execution 中止、Claude/Codex last-good/de-duplication 和按需只读详情。

## 实际 Tailscale 状态

macOS 已安装官方 standalone `Tailscale.app 1.102.3`；下载 SHA-256 与官方 `.sha256` 一致，并通过 Apple notarization 与 Developer ID 校验。实际 tailnet 登录、macOS Network Extension 批准，以及 Windows/Android 三端互通仍需要用户在各设备完成账号登录，因此本记录不虚构物理 tailnet 已连通。
