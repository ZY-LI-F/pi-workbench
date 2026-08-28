# Stella v0.5.0 Android Companion APK 与 Agent 移动控制面规格

> 状态：Phase 0–2 已实现并通过 API 35 AVD 验收；Phase 3 Relay/FCM 后置
>
> 产品版本：桌面端与 Android App 均使用 `0.5.0`；Android `versionCode` 独立递增
>
> Companion Wire Protocol：`1`
>
> 规格日期：2026-08-28；实现验收：2026-08-29（Asia/Shanghai）

## Problem Statement

Stella 当前可以在桌面端运行 Pi、Codex CLI、Claude CLI，展示 Board、Workflow、AgentTask、外部 CLI 活动，并通过 Task Room 完成人工回复、Agent mention、人工关卡和执行验收。但所有实时事件和控制命令都只存在于 Electron Renderer 与 Main 之间的 IPC 通道中。

用户离开电脑后无法在 Android 手机上：

- 查看正在运行、等待输入、等待验收、完成或失败的 Agent；
- 及时发现 Coordinator 的 `waiting_human`、Workflow 人工关卡或执行验收请求；
- 向 Task Room 发送回复，让等待中的 Coordinator 进入下一轮决策；
- 批准或驳回人工关卡、接受或要求修订执行结果；
- 在必要时终止仍由 Stella 管理的任务；
- 查看 Claude/Codex 外部执行的只读状态。

当前桌面项目不能直接生成 Android APK。Electron 官方目标平台是 Windows、macOS 和 Linux，不包含 Android。现有 Renderer 也直接依赖 Electron preload 接口，不能原样放进 Android WebView。APK 可行性的核心不是页面打包，而是建立一个由桌面 Main 持有、供移动端调用的版本化 Companion 控制面。

## Feasibility Verdict

结论是：**可以生成 Android APK，也可以实现 Agent 状态接收和受控通讯，但必须新增独立移动应用和桌面 Companion Gateway；不能把现有 Electron 包直接转换成 APK。**

推荐技术路线是 React、Vite 与 Capacitor：

- Stella Renderer 已使用 React 和 Web 技术，Capacitor 可以复用 TypeScript、React DOM、格式化逻辑和视觉 token；
- Capacitor 官方支持把现有现代 Web 项目加入 Android 平台，并由 Android Studio/Gradle 生成 APK；
- 当前需求是状态看板和受控消息，不需要 Orca 那样的完整 PTY、xterm、文件浏览器和语音终端，因此暂不引入 React Native/Expo 的第二套 UI 体系；
- 如果未来产品范围扩大到高性能原生终端、复杂手势、音视频或大量系统能力，再重新评估 Expo/React Native。

本机工具链检测结果：

| 检测项 | 当前结果 | 对首个 APK 的影响 |
| --- | --- | --- |
| Node.js / npm | Node `24.19.0`、npm `11.17.0` | 满足前端脚手架与 Capacitor 构建需要 |
| Android Studio | 已安装 `2025.3` | 可管理 Android 工程和 SDK |
| Java | Android Studio 内置 OpenJDK `21.0.10` 可用 | 共享环境脚本可发现 `JAVA_HOME` 或 Android Studio JBR |
| Android SDK | 已安装 platform `35`、`36.1` | 可编译 Android 应用 |
| Build Tools | 已安装 `36.0.0`、`36.1.0`、`37.0.0` | `aapt2`、`zipalign`、`apksigner` 可用 |
| SDK License | Android SDK license 已存在 | 不阻塞 Gradle 构建 |
| ADB | SDK 中已安装 | 已用于安装、重启、端口转发与验收 |
| 设备/模拟器 | `stella_companion_api35` / API 35 | 签名 APK 已完成全场景与重连验收 |
| Capacitor 依赖 | 独立 `apps/companion` workspace 已锁定 | Android 工程、Gradle wrapper 与 Web 资源可复现构建 |

因此，这台机器与仓库现在都具备可复现 APK 工具链：`npm run companion:apk:debug` 构建 debug APK，`npm run companion:apk:release` 在显式 signing 变量完整时构建、验证并输出带 SHA-256 的签名 APK。首个发布候选为 `0.5.0 / versionCode 6 / protocol 1`。

## Solution

新增一个轻量的 Stella Android Companion。它是桌面 Stella 的远程控制器，不是新的 Agent Runtime，也不是 Board 的第二个事实源。

```text
Android APK
└── Companion Client Module
    ├── 状态 / Attention / Task Room UI
    ├── 配对与主机列表
    └── WebSocket Transport Adapter
                  ⇅ 版本化 Companion Protocol
Desktop Electron Main
└── Companion Gateway Module
    ├── 配对、设备、连接与协议协商
    ├── WebSocket Transport Adapter
    └── Companion Control Plane Interface
                  ⇅
    现有 Board / AgentTask / Workflow / Review / External Execution Modules

Desktop Renderer
└── Electron IPC Adapter ────────────────┘
```

桌面 Main 继续持有所有 Task、WorkflowRun、AgentTask、Execution Attempt、人工关卡、验收和外部 CLI 状态。Android App 只保存已配对主机、连接状态、最近成功快照和未发送草稿。

首版通讯语义严格复用 Stella 已有行为：

- 普通 Task Room 消息只追加用户消息；
- 当 Coordinator 或 Squad Leader 为 `waiting_human` 时，普通回复会创建下一轮 Coordinator review；
- `@mention` 只有在现有领域规则允许时才创建 AgentTask；
- 人工关卡、执行验收和任务终止调用现有应用命令；
- 不向正在运行的 Pi/Codex/Claude 进程注入任意文本；
- 不向 Stella 未持有 PTY 的外部 Claude/Codex session 伪造“远程聊天”能力。

## User Stories

1. As a Stella user, I want to install an APK directly on my Android phone, so that I can use the Companion without a browser tab.
2. As a Stella user, I want the phone to pair with my desktop through a short-lived QR code, so that I do not need to type host identifiers and tokens manually.
3. As a Stella user, I want to name a paired desktop, so that I can distinguish multiple computers later.
4. As a Stella user, I want to see whether the desktop is online, reconnecting or offline, so that stale Agent state is not mistaken for live state.
5. As a Stella user, I want the latest successful snapshot to remain visible when temporarily offline, so that I can still inspect the last known state.
6. As a Stella user, I want stale data to be visibly marked with its capture time, so that I understand its freshness.
7. As a Stella user, I want an Attention view listing Agents waiting for me, failed executions and pending reviews, so that urgent actions are visible first.
8. As a Stella user, I want to see each managed Agent's name, backend, task, normalized state, current tool or summary and update time, so that I can understand what is running.
9. As a Stella user, I want to distinguish Workflow steps, direct AgentTasks, Coordinators, Squad members and external CLI sessions, so that different status domains are not mixed.
10. As a Stella user, I want to filter by project and status, so that a large Board remains usable on a phone.
11. As a Stella user, I want to open a Task and read its recent timeline, Agent reports and current attention reason, so that I can decide what to do without opening the desktop.
12. As a Stella user, I want to send a normal Task Room message, so that context and decisions can be recorded remotely.
13. As a Stella user, I want a reply to a waiting Coordinator to resume exactly one next decision round, so that a network retry cannot create duplicate work.
14. As a Stella user, I want to use allowed Agent mentions from the Task Room, so that I can dispatch follow-up work from the phone under the same desktop rules.
15. As a Stella user, I want the app to preview whether a message is only a comment, resumes a Coordinator or dispatches AgentTasks, so that its effect is clear before sending.
16. As a Stella user, I want to approve or reject a Workflow human gate, so that an unattended workflow can continue.
17. As a Stella user, I want to accept, request revision or reject a reported execution, so that review remains an explicit human decision.
18. As a Stella user, I want destructive actions such as abort and reject to require confirmation, so that a tap error does not stop work.
19. As a Stella user, I want every submitted command to show accepted, rejected or timed-out state, so that connectivity ambiguity is visible.
20. As a Stella user, I want command retries to be idempotent, so that reconnecting cannot append duplicate replies or settle a gate twice.
21. As a Stella user, I want to view Claude and Codex external execution cards as read-only data, so that tasks launched outside Stella are still visible.
22. As a Stella user, I want external-source failures to preserve the last successful snapshot and identify the failed source, so that one unavailable CLI does not empty the whole mobile view.
23. As a Stella user, I want unsupported external actions to be absent rather than disabled with misleading wording, so that the app does not promise remote control it cannot perform.
24. As a Stella user, I want the app to reconnect automatically when the network returns, so that I do not need to pair again after a short interruption.
25. As a Stella user, I want protocol incompatibility to block commands and explain which side must update, so that old APKs cannot silently send incorrectly interpreted actions.
26. As a Stella user, I want to revoke a lost phone from the desktop, so that it can no longer read status or issue commands.
27. As a Stella user, I want the phone to forget a host and its local credential, so that old pairings can be removed cleanly.
28. As a Stella user, I want the first preview APK to work over the same LAN or an existing private network path such as Tailscale, so that a new Stella cloud service is not required.
29. As a Stella user, I want the app to state that the desktop must remain running, so that I do not expect Agents to survive a closed desktop application.
30. As a Stella maintainer, I want mobile and Electron transports to call the same application commands, so that domain validation is not duplicated.
31. As a Stella maintainer, I want mobile snapshots to be a compact projection rather than serialized BoardState, so that the wire protocol is stable and does not expose storage internals.
32. As a Stella maintainer, I want protocol codecs and compatibility rules shared by desktop and mobile, so that the two apps cannot drift unnoticed.
33. As a Stella maintainer, I want a mock Companion host, so that most mobile work can be tested without running Electron or an Android device.
34. As a Stella maintainer, I want a reproducible Gradle debug APK build, so that local and CI artifacts are generated in the same way.
35. As a Stella maintainer, I want release APK signing isolated from source code and development builds, so that distributable artifacts are reproducible without committing signing material.

## Implementation Decisions

### 1. Product ownership

- Desktop Stella remains the only source of truth for Board, execution lifecycle and Agent processes.
- Android Companion is read-mostly and sends typed application commands; it never edits Board JSON or provider session files.
- Closing desktop Stella makes the host offline. The first release does not add an independently installed daemon and does not claim that Agents continue after desktop shutdown.
- APK version remains `0.5.0`; Android `versionCode` increases for each artifact. Wire compatibility uses a separate integer protocol version.

### 2. Mobile technology

- Create a dedicated React/Vite/Capacitor mobile application inside the repository.
- Use a mobile-specific shell and navigation. Reuse pure TypeScript projections, formatters, schemas and design tokens; do not put Android conditionals into desktop Electron screens.
- Do not use Electron for Android because it has no Android distribution target.
- Do not adopt Orca's full Expo/React Native implementation. Orca needs terminal WebViews, raw PTY input, file browsing, media and broader native features; Stella's initial scope does not justify a second rendering system.
- Keep Expo/React Native as an explicit alternative only if the mobile product later becomes a terminal/editor rather than a status-and-control Companion.

### 3. Shared protocol Module

- Add one dependency-light shared Module containing wire frame codecs, protocol versions, snapshot types, command types and compatibility rules.
- The Module must not depend on Electron, Node filesystem, Android plugins or Renderer state.
- Every frame has a request/event identifier, protocol version and bounded payload.
- Breaking wire changes increase the protocol version or minimum compatible peer version. Additive optional fields do not force a break.
- Unknown additive event types are ignored and trigger a snapshot refresh when required; malformed known frames close only that connection, not the desktop runtime.

### 4. Primary seam: Companion Control Plane

- Define one high-level `Companion Control Plane` interface as the only product seam used by the network gateway.
- Its interface exposes three behaviours: obtain a compact snapshot, execute a typed Companion command, and subscribe to projected changes.
- The implementation owns projection, command authorization, mapping to existing application Modules, idempotency receipts and normalized errors.
- Electron IPC and the mobile Gateway must ultimately call the same existing application commands. Validation rules for comments, mentions, Coordinator replies, gates, reviews and abort must not be reimplemented in the mobile app.
- Tests cross this seam and assert on snapshots, Board outcomes and command results, not internal event-hub state.

### 5. Mobile projection

- Do not transmit raw BoardState. Define a compact `Companion Snapshot` containing host metadata, projects, Task summaries, managed Agent summaries, attention items, recent timeline entries and optional external execution summaries.
- Preserve the distinction between Task stage, Workflow/AgentTask execution state and external CLI observation state.
- Mark every snapshot with an ephemeral monotonic sequence, capture time and protocol version.
- On reconnect or sequence gap, the mobile client replaces local live state with a fresh snapshot rather than replaying an unbounded event log.
- Limit long prompts, outputs and tool text. Task detail fetches larger timeline fragments lazily.

### 6. Allowed mobile commands

The first release supports:

- add a Task Room message;
- dispatch allowed Agent mentions through the same parser and compatibility checks as desktop;
- reply to a waiting Coordinator/Squad Leader;
- approve or reject a Workflow human gate;
- accept, request revision or reject an execution report;
- abort a Stella-managed task after confirmation;
- request a fresh snapshot or lazy Task detail.

The first release does not support:

- arbitrary shell commands;
- raw terminal keystrokes;
- direct mutation of files or Git state;
- changing execution backend configuration or credentials;
- sending text into a currently running non-interactive Pi/Codex/Claude backend;
- controlling an external CLI session whose PTY is not owned by Stella.

### 7. Command reliability

- Every mutating command carries a client-generated idempotency key.
- The desktop stores a bounded, expiring command receipt outside BoardState and returns the previous result when the same device retries the same key.
- A command result is one of accepted, rejected with a stable code, or indeterminate due to connection loss. The mobile app refreshes the snapshot before allowing an indeterminate command to be repeated with a new key.
- Domain Modules remain responsible for lifecycle fencing through execution ID, attempt and runtime token.

### 8. Event routing

- Replace the current one-window-only broadcast assumption with a small in-process event hub.
- The Electron IPC Adapter forwards events to the desktop Renderer.
- The Companion Control Plane consumes committed Board changes and produces mobile projections.
- Transient tool/assistant events may be coalesced; committed snapshot changes must never be dropped.
- External CLI polling remains in desktop Main. It runs only when a desktop/mobile view is subscribed or a manual refresh is requested.

### 9. Transport and pairing

- The first production Transport Adapter is a direct WebSocket connection over the same LAN or an existing private network path such as Tailscale.
- Pairing uses a short-lived desktop-generated offer, explicit confirmation, a per-device credential and a pinned desktop identity. The QR code contains connection and pairing material, not Board data.
- Mobile stores its device credential in Android secure storage. Desktop stores paired-device records separately from BoardState and supports revocation.
- The debug feasibility build may use a clearly marked local cleartext connection. A distributable APK must authenticate the device and protect command/status frames before enabling mutating commands.
- The existing loopback Webhook remains unchanged and is not reused as the mobile protocol.
- A future cloud Relay is a second Transport Adapter behind the same Companion protocol. The Relay must not become a Board owner and must not see unencrypted Task content.

### 10. External CLI status

- Mobile reads Claude/Codex external execution snapshots through the desktop External Execution Module; the phone never invokes local provider CLIs.
- External cards remain read-only and preserve last-good/stale source behaviour.
- The existing desktop “continue” action is not exposed when it only copies a local command, because copying on the phone cannot resume the desktop process.
- A future external provider may expose mobile reply only after its Adapter has a real, tested send capability and stable session identity.

### 11. Android lifecycle and notifications

- Foreground real-time status uses WebSocket subscriptions and reconnect with bounded exponential backoff.
- App resume always performs protocol status negotiation and snapshot refresh.
- The first APK does not promise reliable background push. Android may suspend the WebView/network connection while backgrounded.
- Reliable notifications for `needs-input`, gate, review, completed and failed require a later Push Adapter, normally Firebase Cloud Messaging plus a minimal relay capable of sending notifications without embedding server credentials in the APK or desktop app.
- Notification payloads contain identifiers and short summaries; opening the notification refreshes authoritative detail from desktop.

### 12. Build and distribution

- Add reproducible scripts for web build, Capacitor sync, debug APK and signed release APK.
- The Android project and Gradle wrapper are versioned with the mobile application.
- Debug APK is generated with Gradle's debug signing key for device testing.
- Release APK is signed in CI or a controlled local release step; signing keys and passwords are not committed.
- Initial distribution is a GitHub Release APK with checksum. Google Play/AAB distribution is deferred.
- CI runs shared protocol tests, mobile unit tests, web build and Android debug APK assembly. A physical-device or emulator smoke test remains a separate gate.

## Delivery Plan

### Phase 0 — APK feasibility spike

Goal: prove packaging before touching domain behaviour.

- Scaffold the mobile workspace with one mock Attention screen.
- Configure Capacitor Android and a project-local build command that discovers Android Studio JBR/SDK without hard-coded user paths.
- Generate a debug APK with Gradle.
- Create an Android AVD or connect a physical phone and install the APK.
- Connect the app to a mock WebSocket host and prove foreground snapshot/update rendering.

Exit criterion: a reproducible APK installs and displays a mock Agent status update on a real Android runtime.

### Phase 1 — Desktop Companion Control Plane

Goal: expose a small, testable mobile product seam without changing Board ownership.

- Implement shared protocol and compatibility codecs.
- Implement compact snapshot projection and attention derivation.
- Implement typed commands over existing Task Room, gate, review and abort Modules.
- Add idempotency receipts and in-process event routing.
- Add mock/in-memory adapters and interface-level tests.

Exit criterion: a non-network test client can observe Board changes and execute every allowed command with existing lifecycle invariants preserved.

### Phase 2 — Direct pairing and Android MVP

Goal: deliver useful same-LAN/private-network operation.

- Implement desktop WebSocket Gateway and mobile Transport Adapter.
- Add pairing QR, device confirmation, reconnect, host list and device revocation.
- Implement Attention, Task detail, Task Room composer, gate, review and abort screens.
- Add external Claude/Codex read-only projection.
- Produce signed preview APK `0.5.0` and run device-level acceptance tests.

Exit criterion: a paired phone can observe a real Stella Agent transition, answer a `waiting_human` Coordinator exactly once, resolve a gate, review a report and recover cleanly from disconnect.

### Phase 3 — Remote reach and background notifications

Goal: operate away from the same LAN and receive reliable notifications.

- Validate Tailscale/private-network usage without changing the protocol.
- Decide whether a Stella Relay is justified by actual usage.
- Add Push Adapter and FCM only after Relay ownership, delivery and privacy rules are specified.
- Add protocol compatibility upgrade UI and release automation.

Exit criterion: background attention notifications and cross-network reconnect are reliable without moving Board or Agent ownership away from desktop.

## Testing Decisions

- Test external behaviour through the Companion Control Plane interface. Avoid tests that assert private event-hub maps, socket listener counts or internal projection helper calls.
- Reuse existing Board Repository and AgentTask/Workflow test fixtures so mobile commands exercise the same persisted lifecycle as desktop commands.
- Verify that a normal comment creates no AgentTask, an allowed mention creates the expected attempt, and a `waiting_human` reply creates exactly one Coordinator review.
- Verify human gate decisions and execution reviews can settle only the currently active execution and cannot revive superseded attempts.
- Verify duplicate idempotency keys return the original result without duplicating comments, AgentTasks, reviews or aborts.
- Verify snapshot projection keeps Task stage, managed execution state and external state separate.
- Verify one failed external source remains stale while other sources continue to update.
- Verify mobile cannot invoke commands absent from the protocol, including arbitrary shell, credential changes and raw terminal input.
- Verify protocol mismatch blocks mutation but still returns a useful upgrade result.
- Verify sequence gaps, reconnect and app resume cause snapshot replacement without duplicate transient events.
- Verify size caps and lazy detail keep large Agent output out of the initial snapshot.
- Run transport integration tests with a real local WebSocket server and the mock Companion client.
- Run mobile tests against a mock host for online, stale, reconnecting, rejected-command and version-blocked states.
- Build a debug APK in CI and install it in an Android emulator smoke test when CI capacity permits.
- Complete one physical-device acceptance flow before publishing a signed preview APK.

## Out of Scope

- Running Pi, Codex CLI or Claude CLI directly on Android.
- Replacing the Electron desktop application.
- Keeping Agents alive after the desktop Main process exits.
- A full terminal emulator, raw PTY control or arbitrary command execution from the phone.
- Full source editor, filesystem browser, Git staging, diff review or PR creation.
- Copying Orca's relay, SSH, AI Vault, terminal and mobile code wholesale.
- Scanning provider private transcript files on Android or desktop.
- Cloud account system, multi-user collaboration, RBAC or Board synchronization.
- Reliable background push in the first APK.
- Google Play Store publishing and AAB production release.
- iOS packaging in this milestone, although the Companion protocol and Capacitor UI should not deliberately prevent it.

## Further Notes

- Electron's official documentation describes its target platforms as Windows, macOS and Linux; Android must be a separate native container: https://www.electronjs.org/docs/latest/
- Capacitor officially supports adding Android to an existing modern JavaScript project and managing the native project through Android Studio: https://capacitorjs.com/docs/android
- Android's official Gradle flow generates a debug APK through `assembleDebug`; release APKs require a release signing key: https://developer.android.com/build/building-cmdline
- Orca proves the product pattern is real: its companion keeps desktop as source of truth, pairs over LAN/Relay, shows Agent attention and sends replies. It also explicitly states that closing desktop drops the connection: https://www.onorca.dev/docs/mobile
- Orca implements its broader app with Expo/React Native and a versioned WebSocket protocol. Stella should borrow the desktop-owned, versioned, read-mostly model, but not its terminal/file/SSH scope or implementation size.
- Capacitor can later integrate FCM, but reliable push requires Firebase configuration and a sender that does not embed server credentials in the APK: https://capacitorjs.com/docs/guides/push-notifications-firebase
- This plan deliberately preserves Stella's current Board, Execution Attempt, runtime token, Execution Backend and External Execution Source ownership. The new functionality is an Adapter and projection over those Modules, not a second orchestration system.

## Implementation Acceptance

Phase 0–2 已按本规格落地。API 35 AVD 对实际安装的签名 `0.5.0 / versionCode 6` APK 完成配对、在线更新、Coordinator 回复且只生成一个 review、gate approve、report accept、确认后的精确 abort、外部 Source stale/last-good、managed 去重、按需只读详情，以及 App 重启后的持久配对与 authoritative snapshot 替换。

本地验收 APK 的 SHA-256 为 `6ADE01B64FECD6730366BBD6AABEBBB4B33F8D4BEFBF439F0693791EC9E0D3CC`。它使用一次性验收证书；正式 tag 由 GitHub Actions 使用仓库 Secrets 中的发布证书重新签名。完整证据与迁移/回滚步骤见 [`../testing/stella-v0.5.0-release-acceptance-2026-08-29.md`](../testing/stella-v0.5.0-release-acceptance-2026-08-29.md)。
