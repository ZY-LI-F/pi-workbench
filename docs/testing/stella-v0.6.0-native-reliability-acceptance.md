# Stella v0.6.0 · Pi 原生可靠性验收

日期：2026-09-12。开发、研究取舍、实现和审查均由当前主代理完成，未开启开发子代理。保留进入本轮时的工作区改动，没有提交、推送、创建 PR 或发布云端版本。

范围依据：[Spec](../specs/stella-v0.6.0-native-reliability.md)、[Tickets](../specs/stella-v0.6.0-tickets.md)、[Orca 固定源码研究](../research/orca-native-gui-deep-review-2026-09-12.md)。版本由 0.5.0 升至 **0.6.0**；官方 Pi 保持 **0.84.2**，未 fork 或修改 Pi。Team 不新增调度框架、数据库或执行事实源。

## 业务结果

| Ticket | 实现与验收要点 |
| --- | --- |
| N01 | 每个 RPC 进程独立拥有 UTF-8 解码器、缓冲区、pending 请求与 generation；处理末行无换行、CRLF、截断字节、错误 JSON 和迟到进程事件。`close` 前排空 stdout，不在 `exit` 时丢弃末次响应。协议失败的终止 Promise 与后续 stop/start 共用，旧进程退出前不启动替代进程。 |
| N02 | 实时消息按出现次序标识，历史按官方活动分支 entry ID 标识。重复时间戳/正文不再覆盖独立消息。快照按实际读取序号合并未结束消息；导航、配置重载与 Skill 安装有明确会话边界。 |
| N03 | 发给 Pi 前先落盘提交意图；同 ID 的重复 IPC 不重复调用模型。接收、拒绝、未知分开；未知不会自动重发。重启遗留 pending 转为 unknown；明确拒绝后，用户可使用新 ID 重试相同输入。 |
| N04 | 检查器导出结构化诊断，保留 request/session/generation 关联，默认没有对话正文、原始错误、stderr、环境变量或密钥。系统保存对话框授权的精确文件由 Main 定位，不放宽 renderer 的通用路径权限。 |
| N05 | 事件保持顺序、完整折叠、批量发布。1,000 条独立消息/2,002 个事件的批处理结果与逐条处理一致；80 条历史 Markdown 加 1 条实时消息，40 次更新仅增加 40 次当前消息解析，历史不重复解析。 |
| N06 | 会话查看元数据保存阅读锚点、选中文件与未读/待输入/错误提示；损坏或未来格式不静默覆盖。跨会话与重载 renderer 后阅读位置保留；保存的运行中状态不冒充重启后的实时执行。 |
| N07 | 预览读取实际文件字节并显示 SHA-256 版本。路径/选区追加到草稿，引用前再次核对版本；磁盘变化要求刷新。修复“参考文件：路径”识别及窄聊天栏文件名被操作按钮挤没的问题。 |

Pi 子进程意外终止后，点击“重试连接”恢复原 Session，而不是悄悄创建空会话；草稿保留，不重放上一条模型请求。模型配置/Skill 重载继续使用既有的“已落盘路径或尚未落盘的精确 Session ID”恢复规则。

## 已执行检查

| 检查 | 实际结果 |
| --- | --- |
| `npm run check` | 最终通过：node/web TypeScript、renderer ESLint、**120 个文件 / 553 项 Vitest 测试**。 |
| `npm run build` | 通过：main、preload、renderer 生产构建。 |
| `npm audit --omit=dev --json` | 本次返回 **0 个已知生产依赖漏洞**；不等于不存在安全风险。 |
| `git diff --check` | 通过。 |
| `npm run test:e2e:native -- --output test-results/native-v060-termination-final` | 最后终止竞态修复后的整组结果：**12/12 通过**，约 2.2 分钟。 |
| DeepSeek V4 Flash 真实模型长测 | **1/1 通过**，两轮同 Session、多步真实文件工具与命令执行。 |
| 模型生成的 `verify.mjs` | 主代理先读取代码，再独立执行：**71 项检查 / 0 失败**，退出码 0。 |
| 主代理独立 PowerShell 复算 | **45 项 / 0 失败**：总体、场景、事件、P95、tokens、重试、判定与 5 个交付物 SHA-256。 |

`test-results/native-v060-offline` 的 2 项补测通过，确认断连导出保留原 Session/回执，明确 `runtimeConnected: false`。真实模型长测之后的最后终止竞态修复，又经过上述单测、整组 Electron 回归与文末打包态验证；未把前一份安装包的检查结果当成最终产物结果。

### Electron 端到端覆盖

1. 缺失可选 Codex/Claude CLI 不阻断原生 Pi 与本地看板。
2. 只接受 Skill 文件夹，真实安装并热加载，保持 Session 身份。
3. 原生会话、新建/分支、弹窗、命令面板、终端。
4. 输入框持续可见、附件/草稿、Session 地址复制、侧栏与窄窗口操作。
5. 整个桌面应用重启后恢复会话草稿与附件。
6. 从 URL/Key 发现、添加、移除、测试模型，不产生聊天任务。
7. 官方 Pi 自动压缩、追加式 JSONL 保留和 GUI 压缩显示。
8. Skill 上下键/Tab/Enter 选择，消息默认折叠，复制用户调用而不是展开指令。
9. 真实 Pi read/write 生成 Markdown/HTML，文件切换，跨会话与 renderer 重载后的阅读位置。
10. 重复中文/emoji 输入保留两个 entry；同 submission ID 不重复调用模型；文件版本引用、已有草稿保护、诊断隐私与导出成功/取消/失败。
11. 注入上次崩溃的 pending 回执，真实启动后显示 unknown；取消确认不执行，明确发送新输入仅执行一次。
12. 精确终止隔离测试应用的 Pi 子进程，页面重连恢复原历史/Session/草稿，不自动重放。

协议夹具启动的仍然是真实 Electron、preload、IPC 和未修改的官方 Pi，文件工具也真实运行；只有模型响应/用量由本机确定性协议服务控制。它不是生产降级路径，也不代表真实云模型推理能力。自动压缩夹具注入高用量并设置测试用 `keepRecentTokens: 1`，没有改动用户或生产压缩设置，没有宣称真实消耗 120k 上下文 tokens。

## 真实模型证据

明确使用 `deepseek/deepseek-v4-flash`，不是把失败的 Qwen 请求静默替换成另一模型。本次没有重新测试 Qwen。使用隔离项目与配置副本，不改变用户默认模型，测试结束删除了临时 `auth.json`、`models.json`、`models-store.json` 副本。

- Session：`01a09532-bb31-7ae7-8b55-90620755a7e6`。
- 两轮实际任务耗时：**104.567 秒**（不含测试应用启动）。
- 第一轮 43 条消息，第二轮结束 60 条；总用量 **497,441 tokens = 0.497441M**。
- **31 个真实工具结果**：read 10、write 4、bash 16、edit 1；工具错误 0。
- 最终 isStreaming / isCompacting 均为 false，pendingMessageCount 为 0；pageErrors 为空。运行中完成模型页往返，采样的输入区均在视口内。
- 产物：`analyze.mjs`、`summary.json`、`stability-report.md`、`dashboard.html`、`verify.mjs`、`verification.md`、`followup-audit.md`。

合成数据的 24 次运行有 22 次成功、nearest-rank P95 为 410 秒、总 tokens 2,001,800；存在 2 个 high 未恢复事件，判定为 **CONDITIONAL**。这些是输入样例的统计指标，**不是 GUI 的成功率、运行时长或本次模型 token 消耗**。

本地证据目录：`test-results/native-v060-live/aliyun-qwen-longrun.live.t-62e4f-ask-stable-across-two-turns/`。脚本历史文件名含 `qwen`，实际模型身份以 `native-longrun-evidence.json` 为准。该目录被 Git 忽略，不打入安装包。

## 验证过程中修正的问题

不把“用例绿色”当作完整质量证明：

- 新标签初版字号低于项目最小值，全量单测抓到后修正。
- “参考文件：绝对路径”最初没有预览按钮；修复路径识别并增加回归。
- 查看截图发现窄栏文件卡片的名字被按钮挤到零宽；加入按卡片实际宽度生效的布局，并断言名字有可用宽度。
- 导出诊断初版落盘成功，却因后续通用路径访问限制又报失败。改成 Main 定位系统对话框授权的精确文件；“导出失败”和“已导出但无法定位”分开反馈，并覆盖两个故障路径。
- 被明确拒绝的输入最初一直复用旧 ID，导致纠正配置后无法重试；加入新 ID 重试与未知状态复用 ID 的对照测试。
- 断连恢复原本会启动新空 Session；现已恢复精确 Session 身份，故障 E2E 检查请求数没有增长。
- 协议失败后 routing 已退役但进程尚未退出时，后续 stop 原本可能提前返回。新增测试先复现失败，再将终止过程与 stop/start 的生命周期统一；最终 RPC 回归 **16/16** 通过。

## 数据与覆盖边界

- `native-submissions.json` 位于 Stella 应用数据目录，只存提交摘要/身份/结果，不复制消息正文。临时文件写入、flush 后 rename；不承诺突然断电时的跨进程 exactly-once 模型执行。
- Main/renderer 断连、超时或回执落盘失败均不能证明“模型未执行”；用户需核对会话，GUI 不自动重发。重新启动整个应用时可从历史会话列表选择原 Session 核对。
- 查看元数据在 renderer 本地存储，未来 schema/损坏数据保留并报错；不是新的 Pi 历史数据库，不改 Team 执行事实。
- 文件版本代表读取时的内容摘要，不是安全背书。选区引用仅用于页面能读取到的选区；隔离 HTML/PDF 内部选区不能读取时提供文件级引用，不移除预览隔离。
- 诊断含 Session 地址等本机路径，默认无正文/密钥/原始错误且不上传。当前进程的诊断计数不冒充跨重启的完整事件 journal。
- 未做 macOS/ARM 实机、Windows 人工 IME 候选操作、无限长度压力、突然断电测试或 Team 全量真实委派验收。本轮保留 Team 能力并运行全仓单测，不宣称覆盖上述未执行路径。

## Windows 交付记录

构建命令：

```powershell
npm run build
npx electron-builder --config electron-builder.config.mjs --win nsis --x64 --publish never --config.directories.output=release/v0.6.0
```

- 最终安装程序：`release/v0.6.0/Stella Pi Workbench-0.6.0-win-x64.exe`。
- 文件大小：**134,540,708 bytes（128.31 MiB）**。
- Installer SHA-256：`69784FA710B4AA72496DC95FEB767DBB525A489C71CC63D9DD9CF3915397D7BE`。
- 校验文件：`release/v0.6.0/SHA256SUMS.txt`。
- `app.asar` SHA-256：`6851EAFA7EFC78BAE82645EDAD897D067F80BEC33AEB6DC07666DE247B62CCD1`。
- 包内版本为 Stella **0.6.0** / Pi **0.84.2**。扫描 **16,908 项 ASAR 条目**，未发现 `test-results/`、`.pi/`、`.codex/` 或 `auth.json`；main/preload/HTML 入口与 32 个 renderer 资源，合计 **35 个文件**与最后一次构建逐字节相同。
- 本轮修复期间曾重新打包，最初安装包与最后改动不一致的中间结果没有作为交付证据；以上哈希只对应最终一致的安装包。
- Windows Authenticode：**NotSigned**。这是可分发的 NSIS 安装程序，不是已签名/公证发布；保留卸载时不删除用户数据的既有配置。
- 不覆盖或安装到用户当前运行的正式应用；实际运行验证使用隔离数据目录中的打包程序。没有宣称完成 Windows 安装向导/卸载或 macOS 实机验证。

最终打包态命令：

```powershell
$env:STELLA_PACKAGED_EXECUTABLE='C:\Users\qq108\Documents\PI-GUI\release\v0.6.0\win-unpacked\Stella Pi Workbench.exe'
npx playwright test tests/e2e/packaged.spec.ts tests/e2e/native-reliability.spec.ts --output test-results/native-v060-packaged-verified
```

**4/4 通过，33.2 秒**。实际使用 NSIS 对应的打包程序，不是开发态代码。覆盖：

- 清空子进程可执行搜索路径后，内置 Pi 正常启动；缺少外部 CLI 不阻断。
- 输入区高度调整、Session 地址复制、默认隐藏 Team、模型配置重载等原生路径。
- 重复 IPC、提交回执、文件版本引用、诊断的成功/取消/错误反馈。
- 遗留 pending 回执恢复与确认交互。
- 精确终止打包程序的 Pi 子进程，离线导出保留 Session 关联，再通过页面重连，草稿/历史/Session 身份不变，旧输入不重放。

### 保留的剪贴板验收波动

`test-results/native-v060-packaged-final` 首次四项检查为 3 通过、1 失败：复制 UI 提示成功，但测试随后读取系统剪贴板得到空字符串。代码检查确认复制入口经过真实的同步写入/读回校验，没有模拟成功或吞掉异常；该次失败尚不能确认是应用问题还是两次读取之间的桌面剪贴板变化。

增加了只观察、不修改结果的真实剪贴板调用记录，记录时间、长度及是否匹配当前 Session，不记录桌面用户原有内容。没有降低原断言、加入复制重试或绕过系统剪贴板。独立诊断运行 1/1 通过；随后完整打包态 4/4 通过，记录显示写入后约 3ms 的主进程读回和约 39ms 的测试读回均匹配 Session。

原始失败 trace 与新的 `real-clipboard-audit.json` 均保留。当前不声称已定位或根治这个未稳定复现的瞬时空读，也不以最终通过抹掉该次失败。

额外使用未放宽断言的 `packaged.spec.ts --repeat-each=3` 连续复核，**3/3 通过（31.9 秒）**，目录为 `test-results/native-v060-clipboard-repeat/`。逐份核对真实调用记录，每次都有 1 次实际 Session 地址写入、2 次匹配的系统读回；不是仅走“剪贴板不可用则报错”的分支。
