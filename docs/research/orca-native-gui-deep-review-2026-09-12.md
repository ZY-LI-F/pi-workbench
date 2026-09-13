# Orca 对 Pi GUI 的进一步借鉴价值

## 核心判断

Orca 最值得借鉴的是会话软件在异常、并发和长时间使用下的正确性设计，而不是更多 Agent、终端分屏或云端服务。对 Stella Pi Workbench，优先价值依次是：文本与消息身份完整性、发送结果恢复、运行实例隔离、可诊断性、长会话性能，以及围绕产出文件的人机反馈。

源码对照已经产生两项可复现的本地发现：Pi RPC 按 Buffer 分块直接解码可能损坏中文；实时消息用角色与时间戳作为身份可能合并两条不同消息。这两项都不需要修改 Pi 源码才能解决。其他建议则需区分现有能力、未验证风险和新增体验，不能全部算成已发现的缺陷。

## 1. 对照范围与证据等级

Orca 固定于提交 [`113e58f34e53d7496b0473346dbc209ff0a805be`](https://github.com/stablyai/orca/commit/113e58f34e53d7496b0473346dbc209ff0a805be)，提交时间为 2026-09-12 01:27 UTC。2026-09-12 的 GitHub API 查询返回 66,821 stars、MIT 许可证；这些是取证快照，不是质量评分。以下外部源码链接均指向该提交。仓库基本信息来自 [GitHub 官方元数据](https://api.github.com/repos/stablyai/orca)。

Stella 对照对象为本地 `0.5.0` 工作区：Git HEAD `633494c`，包含上一轮尚未提交的质量改进；官方 Pi 依赖为 `@earendil-works/pi-coding-agent@0.84.2`。不能用远端 HEAD 的源码链接替代这些本地改动，因此本项目证据采用相对文件链接。

证据分为三种：

- **源码事实**：能定位到实际实现及相关测试；测试存在不等于本次运行通过。
- **本地复现**：直接执行当前 Stella 模块，在确定输入条件下观察到错误。
- **设计建议**：由上述事实推导的改进方向，不声称已经实现或完成性能验证。

未安装、启动或跑完 Orca 的整套测试，也没有验证其公开安装包、远端连接或移动端实际体验。本次执行了两个 Stella 内存诊断；不涉及真实模型调用、真实用户会话修改或外部服务写入。

### 1.1 已有能力不是待补功能

当前 Stella 已有的基础包括：

| 已有基础 | 本地依据 | 本次判断 |
| --- | --- | --- |
| Pi 官方 RPC 与分开的执行 profile | [pi-rpc-runtime.ts](../../src/main/pi-rpc-runtime.ts)、[execution-profile.ts](../../src/shared/execution-profile.ts) | 保留；不改为向终端模拟敲字 |
| 会话草稿版本、串行保存、发送快照 | [use-session-composer-draft.ts](../../src/renderer/src/hooks/use-session-composer-draft.ts) | 已解决运行中编辑与旧确认冲突，不等于已经解决进程崩溃后的发送确认 |
| 阅读锚点、跳到最新、稳定 Markdown 缓存 | [Conversation.tsx](../../src/renderer/src/components/Conversation.tsx)、[use-conversation-scroll.ts](../../src/renderer/src/hooks/use-conversation-scroll.ts)、[MessageCard.tsx](../../src/renderer/src/components/MessageCard.tsx) | 保留，在数据量基准基础上增强 |
| 工作目录写入准入、隔离 worktree | [workspace-admission.ts](../../src/main/workspace-admission.ts)、[execution-workspace.ts](../../src/main/execution-workspace.ts) | 不再作为“尚未实现”的 Orca 新功能建议 |
| Companion 幂等命令与持久回执 | [companion-command-service.ts](../../src/main/companion-command-service.ts)、[companion-command-receipt-store.ts](../../src/main/companion-command-receipt-store.ts) | 原理可用于原生提交，但不能把原生会话反向依赖到 Team 域 |
| Team 的人工关注投影 | [team-task-attention.ts](../../src/shared/team-task-attention.ts) | 不重复引入第二套 Team 状态系统 |
| 原生文件预览、模型管理、Skills 管理 | [FilePreviewPanel.tsx](../../src/renderer/src/components/FilePreviewPanel.tsx)、[contracts.ts](../../src/shared/contracts.ts) | 重点完善闭环与正确性，不按竞品功能数量扩张 |

8 月 28 日的[既有 Orca 报告](./stablyai-orca-analysis-2026-08-28.md)仍可解释当时的架构选择，但其中“worktree 后置”“移动端尚非当前范围”等判断不能直接代表今天的本地实现。

## 2. Orca 的产品范围与 Pi 原生 GUI 不同

Orca 的终端 Agent 配置包含 `pi`，但原生聊天展示支持表列的是 `claude`、`openclaude`、`codex`、`grok`、`omp`；结构化会话的 provider handle 只列 Claude 和 Codex。OMP 是独立的标识，不能把它当成官方 Pi 原生聊天的等价支持。因此“可以启动 Pi”“可以解析某 Agent 的 transcript”“可以结构化控制某 Agent”是三项不同能力。[1]、[2]、[3]

Stella 的 Pi RPC、模型/Skills 配置、扩展交互与会话树有独立价值。把 Orca 的终端、transcript scanner 或 journal 整套移进来，会同时增加两种会话事实来源、不同的恢复语义及更多平台适配路径。

适合保留的领域划分是：

| 对象 | 回答的问题 | 不应混同 |
| --- | --- | --- |
| Session | 哪段持久会话、哪个分支、哪个运行目录？ | 当前选中的 UI Tab |
| Runtime / owner | 目前哪个执行实例有权写入？ | 进程是否刚刚启动成功 |
| Submission | 这一次用户输入是否被接收？ | 模型是否已完成任务 |
| View / attention | 用户看到哪里，哪些结果还需要处理？ | Agent 的事实执行状态 |

Orca 在 durable session record 中将身份与 writer lease 分离，在 journal 中记录 submission，并有独立的未读标记。Stella 可以采纳这些边界，不必采纳相同的存储栈。[4]、[5]、[6]

## 3. 第一优先级：文本与消息身份完整性

### 3.1 已复现：UTF-8 分块解码损坏中文

Orca 的 `decodeTranscriptStream` 使用 `StringDecoder('utf8')`，保留跨 Buffer 的未完整字符，并测试 emoji 被拆到两个 Buffer、CRLF 和未完成 JSONL 行的情况。这是协议输入边界的正确处理，不是 UI 文案问题。[7]、[8]

Stella 的 [pi-rpc-runtime.ts](../../src/main/pi-rpc-runtime.ts) 第 133 行对每个 stdout chunk 单独调用 `toString('utf8')`；stderr 使用同样方式。一次数据块不保证对应一个完整 UTF-8 字符。相比之下，同仓库 [cli-process.ts](../../src/main/cli-process.ts) 已经使用有状态的 `StringDecoder`，说明本项目内部存在可复用的正确原理。

**本地复现结果：** 将当前 `PiRpcRuntime` 用现有 esbuild 在内存中编译，注入可控 stdout 的进程夹具；启动握手仍经过真实类的 `start/send` 路径。将 JSON 事件里的“中”在第一个 UTF-8 字节后切开，两次写入 stdout。

| 项目 | 结果 |
| --- | --- |
| 输入文本 | `中文😀路径` |
| PiRpcRuntime 实际转发文本 | `���文😀路径` |
| 是否保持原文 | 否 |
| `protocol_error` 数量 | 0 |
| 有状态解码器对照 | `中文😀路径`，完全一致 |

影响是 GUI 收到的中文内容、诊断文本以及路径展示可能已经变化，而 JSON 仍有效，所以常规“没有异常”检查抓不到。该复现没有证明官方 Pi 写出的 JSONL 被破坏，也没有证明 Pi 内部工具实际使用了损坏参数；边界发生在 Stella 接收与转发 stdout 这一侧。

**建议**：解码器与 Buffer 必须归属于单个 child 实例；完整处理 end/close 时的剩余数据，不能跨进程复用未完成字符。测试应枚举中文、emoji、重音字符所有字节切分点，以及多个记录/半行/CRLF/退出尾部。不应通过替换乱码、过滤字符或吞掉解析错误修复。

### 3.2 已复现：时间戳不是消息身份

Orca 将 provider 的逻辑消息身份映射为稳定 journal key，更新同一条消息与新增另一条消息有不同语义；相关测试覆盖恢复后原始编号变化与键分隔符冲突。借鉴点是身份规则，不是照抄各 provider 的私有编号规则。[9]、[10]

Stella 的 [runtime-state.ts](../../src/renderer/src/lib/runtime-state.ts) 第 96–109 行对非工具结果消息使用 `role:timestamp` 作为 upsert key；[Conversation.tsx](../../src/renderer/src/components/Conversation.tsx) 也用角色与时间戳关联 entry。毫秒时间既不是唯一约束，也不是分支身份。

**本地复现结果：** 直接在内存中执行当前 `runtimeReducer`，按顺序输入两条内容不同、角色为 user、时间戳同为 `123456789` 的完整 `message_start → message_end` 生命周期。

| 项目 | 结果 |
| --- | --- |
| 独立输入消息数 | 2 |
| 投影中的消息数 | 1 |
| 保留下来的内容 | 第二条 |

这确认了输入条件成立时的合并问题，没有测量真实 Pi 触发相同时间戳的频率；随后的完整刷新可能重新带回历史，仍不应允许实时投影暂时覆盖内容。

**建议**：持久历史使用官方 Session entry ID，并限定 Session/分支；尚未持久化的实时消息按生命周期分配临时身份，再与官方条目对账。不能用正文去重，也不能仅改成更高精度时间戳。若当前 RPC 未提供足够的关联身份，应明确保留歧义，而不是伪造精确映射。两次相同文字的输入仍应是两次独立意图。

## 4. 发送回执与崩溃恢复

Orca 在发给 provider 前持久化 submission；重启后将未结算提交标为 unknown，再按可靠身份与历史核对。它区分历史边界不一致、仍有回合执行、匹配歧义等情况；这条 reconciliation 路径不替用户自动重发。源码和 crash-boundary 测试同时覆盖该语义。[5]、[11]、[12]

对 Stella，上一轮 `prepareSend` 保护的是仍在运行的应用内，发送确认与新编辑之间的竞争。它不是跨进程的提交账本。[PiRpcRuntime](../../src/main/pi-rpc-runtime.ts) 的 pending map 和随机 RPC ID 都在内存中，当前原生提交没有与之对应的持久 UI 回执。这与已经存在的 Companion 命令回执是不同路径。

最小模型可以只记录提交身份、目标 Session、草稿修订/附件引用和交付结论，不复制完整对话数据库：

| 提交状态 | 可以告诉用户什么 | 不能推导什么 |
| --- | --- | --- |
| pending | 已记录发送意图，等待确认 | 模型已收到 |
| accepted | 已获得本次提交被接收的证据 | 任务已成功完成 |
| rejected | 有明确拒绝或未交付证据 | 所有历史副作用都不存在 |
| unknown | 进程/连接中断，交付结论不确定 | 可以安全地无条件重发 |

在缺少官方端到端幂等支持时，GUI 本地生成一个 ID 不会自动获得 exactly-once 执行。Pi 记录可能经过 Skill 展开、分支或压缩，也不能照搬 Orca 对其他 provider 的 fingerprint 关联假设。最重要的用户体验是把“不确定”明确展示，并保留检查会话、显式再次发送或舍弃的选择。

回执与正文只应有明确的一方负责：Pi JSONL 继续拥有会话事实，Stella sidecar 拥有 GUI 提交/查看元数据。可复用已有持久化模式和校验方式，但不得使原生会话依赖 Team 或 Companion 的业务类型。

## 5. 运行实例、观察顺序与恢复证据

Orca 的 session record 分开保存执行位置、provider handle、owner 进程身份、fence 和恢复阶段。恢复逻辑将“请求停止”与“已经证明原 owner 不存在”分开；lease 过期本身不授予第二个 writer。测试覆盖孤儿进程、无法确认身份以及停止请求后进程依然存在的情形。[4]、[13]、[14]

这套完整实现主要服务多进程、原生/TUI 切换和远端，不适合整体搬进当前 Pi 单运行时。适合 Stella 的最小部分是：

1. 每次 Pi 实例启动有新的 generation；stdout/stderr 缓存、pending requests、退出回调都绑定这一代实例。
2. 主进程转发的 Pi 事件带稳定 Session scope、generation 和该代内的 sequence，不能由 renderer 猜来源。
3. 页面拒收不属于当前目标或已经退休实例的事件；刷新以该 scope 与 sequence 对账。

当前 [BridgeEvent](../../src/shared/contracts.ts) 的 Pi 分支只有 `source/payload`；[use-pi-runtime.ts](../../src/renderer/src/hooks/use-pi-runtime.ts) 已有刷新 epoch 与 liveRevision，但它解决的是当前 renderer 中的请求先后，并不是完整的跨实例归属。这是需要故障注入确认的结构风险，**本次没有声称已复现串会话事故**。

另外，8 月报告记载的 Orca 远端时钟问题已有局部进展：本次源码对镜像状态保存本机接收时间，并在重复快照时沿用旧接收时刻，避免靠重复快照让旧状态永远新鲜。观察类型文件头仍提示逐步迁移，不能据此宣称所有 authority/revision 冲突都已经统一仲裁。[15]、[16]

对当前本机 Pi，不需要引入 authority 联邦模型。采用实例代次和有序事件已经能处理最直接的问题；未来若扩展跨设备观察，再区分远端发生时间与本机收到时间。

## 6. 原生会话的“需要处理”与“未读”

Orca 有独立的 terminal/agent completion unread 标记与确认动作；completion tracking 不单纯等于操作系统通知。测试覆盖通知设置改变、重放完成快照不重复提醒、permission request 等待输入但任务未完成、关闭 pane 后不再提醒等情形。[6]、[17]、[18]

Stella 已有 Team 的 `requiresHuman/reasons`，也有原生扩展对话框、错误通知和运行状态，但尚没有同等完整的原生 Session 关注/已读模型。只把所有任务按“运行/完成”排序，会把需要用户回答的问题和已经完成但未查看的报告混在一起。

建议保持两个正交维度：

- 执行事实：运行中、压缩中、等待交互、已停止、失败等；继续来自 Pi。
- 用户关注：需要回复、失败待处理、新结果未读、已查看；由 GUI 对事实和查看行为作投影。

无需新建复杂通知中心。可以利用现有左侧任务列表，在当前 Session 项中显示明确徽标，提供“需要处理”筛选；点击直接定位对应问题、错误或结果。关注项用事件/结果身份去重，页面切换和初始化快照不能再次制造未读。关闭系统通知也不能让应用内待处理事项消失。

这不是让 GUI 自动把业务任务标记为验收通过，也不是把自然语言输出解析为权威完成状态。Team 仍可使用自己的既有 attention projection，两者仅共享展示原则。

## 7. 长会话性能：分层优化并证明语义等价

### 7.1 合并发布，不丢掉中间状态

Orca 的 agent-status transaction 顺序执行每一次更新，最后提交一次状态，并在提交后运行关联效果。测试比较批处理与逐条更新的结果，覆盖重复 pane、重入以及发布次数；这比“只保留每个 Agent 最后一条状态”更可靠。[19]、[20]

对 Stella，[use-pi-runtime.ts](../../src/renderer/src/hooks/use-pi-runtime.ts) 目前每个 Pi event 都 dispatch；[runtime-state.ts](../../src/renderer/src/lib/runtime-state.ts) 的 message upsert 需要查找并复制数组。React 自身可能合并部分渲染，因此不能直接用 IPC 数量推算实际渲染次数。但高频独立 IPC、长工具输出下，仍值得测量 reducer、内容解析和绘制各自的成本。

可采用的算法约束是：对同一个初始状态和有序事件序列，批量 fold 与逐条 reduce 必须得到相同的消息、工具状态、通知和完成边界。不能为了流畅丢弃 `tool start/end`、人工交互、压缩失败等事件；低频关键交互可以立即处理，高频内容更新才参与渲染发布合并。

### 7.2 增量数据、稳定行与 DOM 窗口是不同层

Orca 的增量 assembler 将罕见的全量重读与频繁 append 分开，并用差分测试要求结果等价于完整重建。实现避免无条件全量重排，但仍有数组复制；不能把注释里的快路径描述扩展为整个更新链严格 O(k)。[21]

其聊天列表另有 DOM windowing、被定位行和最后一行的固定挂载，以及独立于行组件生命周期的展开状态。固定最后一行不只是视觉设计，还避免运行工具的 `aria-live` 随虚拟行卸载失效。相关测试覆盖历史定位、长行增高、阅读锚点和重新挂载后工具展开状态。[22]、[23]、[24]、[25]

当前 Stella 已对稳定 Markdown 做 memo，但 [Conversation.tsx](../../src/renderer/src/components/Conversation.tsx) 仍遍历并挂载全部可见消息。因此下一步不能只继续加 memo，也不应立即把所有聊天改为复杂虚拟列表：

1. 先测 1,000、5,000、10,000 条消息等规模，以及单条很长的工具/Markdown 输出；这些是测试规模，不是运行时消息上限。
2. 如果瓶颈是 reducer，用稳定身份索引和有序批处理；如果是 Markdown/Diff，惰性解析重内容；如果是 DOM/布局，再做窗口化。
3. 窗口化之前，把工具/Skill 展开、选中引用和定位目标移出会随滚动卸载的局部 state。
4. 保留完整历史的可访问性；渲染窗口不能等于删除或截断会话。搜索、选择复制、键盘导航、辅助技术、字体变化和预览拖拽需要相应验收。

Orca 的性能测试直接统计 Markdown 与 patch 的实际解析次数，不只统计组件 render 次数。其性能说明文档同时保留基线、原型目标及分阶段状态，数字有明确环境限制；本项目不能据此宣称会得到同样的倍率提升。[26]、[27]

## 8. 文件预览应形成“查看—引用—修订—复核”闭环

### 8.1 直接借鉴文档批注，不引入完整 IDE

Orca 的 DiffComment 支持文件、行范围、选中文字、diff identity 与 sentAt；批注提交等待持久化成功后才关闭编辑。Markdown 批注将可见选区映射回文档范围。浏览器标注则把目标元素、样式等整理为可审阅上下文。[28]、[29]、[30]、[31]

对 Stella，最有用的移植方向不是 Monaco 或整个浏览器设计模式，而是右侧预览里的轻量动作：

- 选择 Markdown 中一段文字，添加“这段结论补充来源，并核对证据日期”。
- 输入框出现明确的引用卡，包含文件、选区、引用内容及文件版本，而非悄悄拼接整份文件。
- 发送成功只消费本次引用，期间新增的批注继续保留。
- 文件更新后提示原批注依据的版本已变化；新结果仍可在检查器中查看和复核。

这是针对本项目的设计建议，**不代表 Orca 已经提供我们要求的全部 Office 预览交互**。DOCX/PPTX/PDF/Excel 的位置映射应按已有渲染器能可靠提供的页、幻灯片、sheet/cell 能力分阶段做；无法稳定定位时就明确是文件级引用，不假装支持精确段落。无需 Office 插件，也不为交互放开现有 HTML 预览 CSP。

### 8.2 文件状态与版本必须可解释

Orca 的 transcript read/watch contract 区分尚未落盘、初始快照、追加、替换和错误；读取缓存会检查文件版本及真实路径，测试覆盖同 Session ID 对应不同文件、取消后不再发事件和文件尚未刷出。它的边界指纹是工程手段，不是对任意文件改写的数学保证。[32]、[33]、[34]、[42]、[43]

Stella 的 [session-files.ts](../../src/renderer/src/lib/session-files.ts) 当前从 assistant 文本提取路径，而 [local-file-preview-service.ts](../../src/main/local-file-preview-service.ts) 在读取时进行真实文件检查；[FilePreviewPanel.tsx](../../src/renderer/src/components/FilePreviewPanel.tsx) 已有失效请求保护。不能把它描述为完全没有检查，也不能把“正文提到一个路径”当作“文件成功生成”。

建议分开“提到的文件”和“已验证存在的产物”；由实际工具结果、明确文件检查和用户选择提升证据等级。预览记录版本，更新时说明是重新载入还是仍显示旧快照，读取失败不能无标记地展示过期内容。来源不明确的 bash 产物不应靠扫描整个磁盘猜测。Office ZIP 文件正在写入时也不能将一次临时解析失败永久标成坏文件。

## 9. 诊断能力：从复制 Session 路径到可复现证据

Orca 将本地诊断 trace 与产品 telemetry 拆开，在本地 sink 和导出 bundle 路径清理敏感字段，并有模块互相不得导入的架构测试。崩溃报告明确区分诊断包附加、上传及失败，且允许不包含诊断日志。[35]、[36]、[37]、[38]

Stella 已有 Session 地址复制、stderr 缓冲和可见错误，能定位 JSONL；但 Session 文件通常无法回答 GUI 在何时发送了哪条 RPC、哪次刷新覆盖了什么、哪个进程退出以及当时视口如何。当前 [diagnostics.ts](../../src/shared/diagnostics.ts) 主要负责界面诊断文本缓存，并非完整的跨层追踪记录。

建议原生 GUI 增加本机诊断导出，而非先建设云端 telemetry：

| 层 | 适合记录的最小证据 |
| --- | --- |
| 版本 | Stella、Pi、Electron、系统与架构 |
| 目标 | Session 标识、分支/entry、运行实例 generation |
| 命令 | request/submission ID、命令类型、开始/确认/错误、耗时 |
| 事件 | 顺序号、事件类型、归属、接受或忽略原因 |
| 布局 | 窗口/中间栏/检查器尺寸、字体缩放、当前页面 |
| 产物 | 用户选择的文件与预览错误，不默认收集整个项目 |

避免默认记录请求正文、完整模型响应、环境变量或凭据。导出应可预览内容，外传必须是独立明确动作；保留用户原始标题，不把诊断导出的敏感字段处理扩大成标题脱敏。上面的两种本地复现可以成为诊断包设计的验收样本：前者没有 JSON error，后者没有程序崩溃，单靠错误堆栈都不足以解释。

## 10. 持久化与升级兼容性的额外启发

Orca 的 journal database 在写入 pragma 或 DDL 前检查 schema version，遇到新版本只读打开；schema 建立与版本提升在一个事务中。提交日志使用更强的同步要求，以匹配“先持久化再 dispatch”的承诺。[39]

可借鉴的是先定义承诺、再选存储，而不是默认复制 SQLite。Stella 的草稿已有版本字段，状态与模型配置已有串行写入/原子替换路径；原子 rename 并不自动等于所有平台断电持久性。新增回执之前应说明保证的是 renderer 崩溃、主进程崩溃还是操作系统掉电；不同级别不能靠一个“已保存”文案混同。

应用读取未来格式时不应自动清空用户数据；需要保留原文件，明确不兼容，并根据格式能力提供只读或明确报错。这里的只读是显式兼容状态，不是静默走另一条业务成功路径。Pi JSONL 仍由官方 Pi 负责，Stella 不应为自己的 schema 迁移去改写 Pi 历史。

## 11. 推荐顺序与验收条件

优先级来自数据完整性、问题可诊断性和现有复杂度，不来自 Orca 功能数量。P0 表示首先处理的完整性风险，不表示已测得线上发生率。

| 优先级 | 改进项 | 当前证据 | 必须验证的结果 |
| --- | --- | --- | --- |
| P0 | Pi stdout/stderr 有状态解码 | 当前类已复现乱码 | 任意合法字节切分结果相同；退出、CRLF、半行都明确处理 |
| P0 | 消息稳定身份与 snapshot 对账 | 当前 reducer 已复现覆盖 | 同时戳不同消息均保留，同消息更新不重复，分支不混合 |
| P1 | Runtime 代次与事件归属 | 结构风险，未复现真实事故 | 旧实例 stdout/exit/失败不能更新或终结新实例 |
| P1 | 原生 submission 回执与崩溃恢复 | 存在应用内保护，缺跨进程原生回执 | 发送前、接收后确认前、确认后分别崩溃；不丢意图、不自动重复执行 |
| P1 | 本地诊断与故障矩阵 | 现有诊断主要是缓存/错误 | 能关联命令、事件、Session、布局；导出无凭据、不自动上传 |
| P1 | 长会话基准与按瓶颈优化 | memo 已有，全量列表仍在 | 批量/顺序等价、解析次数、键入延迟、锚点与内存有可比证据 |
| P2 | 原生 Session 待处理/未读 | Team 已有部分原则，原生需扩展 | 新结果不漏、重放不重提醒、等待人工不冒充完成 |
| P2 | 预览引用、批注与文件版本 | 文件预览和请求失效保护已有 | 批注目标/版本明确、发送失败保留、旧内容明确标记 |
| P2 | 跨重启视图元数据与 schema 兼容 | 项目/草稿已有持久化，视图部分为内存 | 不自动重新执行；恢复阅读/选中文件；未来格式不被旧版覆盖 |

所有新增状态应拥有明确写入方，不把同一个状态同时保存在 Runtime、Board、Renderer 三个可写位置。对原生 GUI，合理的最小链路是：

```text
官方 Pi RPC / Session JSONL
            │
            ▼
主进程：字节解码、实例归属、提交回执
            │
            ▼
纯投影：消息 / 工具 / 交互 / 关注项
            │
            ▼
现有 GUI：输入区、会话、任务列表、检查器

本机 sidecar 仅记录 GUI 提交和查看元数据，不另建会话事实库。
```

## 12. 不建议照搬的部分

1. **Orca 整体作为运行时依赖**：会带来第二套 workspace/session owner，与官方 Pi RPC 重叠。
2. **完整 PTY 与多 provider transcript 扫描**：其适配深度有差异，且原生 Pi 不在本次 native-chat 支持表；不是升级 Pi 兼容性的捷径。
3. **全套 SQLite journal、跨进程 handoff、SSH/relay/federation**：适配 Orca 的多端目标，当前原生质量问题可以通过更小的本机边界修复。
4. **所有异常都重试或返回空视图**：Orca 的某些 transport 路径会把未知首帧结算为空 snapshot，增量 reader 对超大记录有跳过逻辑。它们不能不经产品判断直接移入 Stella；协议形态错误与不完整内容应明确可见，而不是被“页面不再 loading”掩盖。[40]、[41]
5. **将性能宣传当成本机收益**：先测量，保持语义等价；不能为了证明优化而丢历史、静默截断输出或掩盖失败。

结论是增强现有 Pi 原生 GUI 的可靠性骨架与产出反馈闭环，而不是把 Stella 扩张为另一套通用 Agent IDE。

## 13. 本地验证记录与限制

两项诊断均使用当前模块、现有 esbuild 和内存夹具，没有生成或修改业务源码文件。第一项执行真实 `PiRpcRuntime` 的字节接收/JSON 分派链路，第二项执行真实 `runtimeReducer` 的事件生命周期。它们分别确认字节切分与身份冲突条件下的失败，不是完整 Electron E2E，不证明历史用户会话已经发生相同问题。

本次未运行 Orca 全量单元测试，未重复上一轮 Stella 的 509 项检查或真实模型长测，未提交、推送、改版本或生成新安装包。建议表不是已实现清单；业务代码保持本轮研究开始时的状态。

## 来源

以下源码均由 stablyai/orca 提供，快照为 `113e58f34e53d7496b0473346dbc209ff0a805be`，访问日期 2026-09-12。本项目的相对链接对应当日本地未提交工作区。

[1]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/shared/native-chat-agent-support.ts
[2]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/shared/tui-agent-config.ts
[3]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/shared/agent-session-provider-handle.ts
[4]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/shared/agent-session-record.ts
[5]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/main/native-chat/agent-session-journal/journal-submission-reconciler.ts
[6]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/renderer/src/store/terminals/terminal-tab-attention.ts
[7]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/main/native-chat/transcript-stream-lines.ts
[8]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/main/native-chat/transcript-stream-lines.test.ts
[9]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/shared/agent-session-journal-item-key.ts
[10]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/main/native-chat/agent-session-journal/journal-item-identity.test.ts
[11]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/main/native-chat/agent-session-journal/journal-pending-submission-recovery.ts
[12]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/main/native-chat/agent-session-journal/journal-crash-boundary.test.ts
[13]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/shared/agent-session-lease-adjudication.ts
[14]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/main/native-chat/agent-session-wire/structured-agent-session-recovery-resolution.test.ts
[15]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/shared/agent-status-observation.ts
[16]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/renderer/src/runtime/web-session-tabs-sync/agent-status-patch.ts
[17]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/renderer/src/hooks/agent-hook-completion-notifications.ts
[18]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/renderer/src/hooks/agent-hook-completion-notifications.test.ts
[19]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/renderer/src/store/slices/agent-status-runtime.ts
[20]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/renderer/src/store/slices/agent-status-batch.test.ts
[21]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/renderer/src/components/native-chat/native-chat-incremental-assembler.ts
[22]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/renderer/src/components/native-chat/use-native-chat-transcript-window.ts
[23]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/renderer/src/components/native-chat/native-chat-pinned-rows.ts
[24]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/renderer/src/components/native-chat/native-chat-disclosure-store.ts
[25]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/renderer/src/components/native-chat/NativeChatMessageList.windowing.test.tsx
[26]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/renderer/src/components/native-chat/NativeChatMessageList.stream-render.perf.test.tsx
[27]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/docs/reference/renderer-agent-status-performance.md
[28]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/shared/diff-comment-types.ts
[29]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/renderer/src/components/editor/diff-section-comment-submit.ts
[30]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/renderer/src/components/editor/rich-markdown-review-annotations.ts
[31]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/renderer/src/components/browser-pane/annotate/browser-annotation-output.ts
[32]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/main/native-chat/transcript-watch-contract.ts
[33]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/main/native-chat/transcript-file-version.ts
[34]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/main/native-chat/transcript-read-cache.test.ts
[35]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/main/observability/index.ts
[36]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/main/observability/redactor.ts
[37]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/main/observability/architecture.test.ts
[38]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/main/crash-reporting/crash-feedback-diagnostic-bundle.ts
[39]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/main/native-chat/agent-session-journal/journal-database.ts
[40]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/renderer/src/components/native-chat/native-chat-session-transport.ts
[41]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/main/native-chat/transcript-incremental-reader.ts
[42]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/main/native-chat/transcript-watch-unsubscribe-race.test.ts
[43]: https://github.com/stablyai/orca/blob/113e58f34e53d7496b0473346dbc209ff0a805be/src/main/native-chat/transcript-watch-unflushed-settle.test.ts

1. [Native chat 支持表][1]、[TUI 启动配置][2]、[结构化 provider handle][3]。
2. [Session record 与 lease][4]、[提交对账][5]、[未读状态][6]。
3. [字节流解码][7]、[字节分块测试][8]、[稳定消息键][9]、[身份测试][10]。
4. [待定提交恢复][11]、[崩溃边界测试][12]、[lease 裁决][13]、[恢复证据测试][14]。
5. [Observation 模型][15]、[镜像状态本地接收时钟][16]、[完成通知][17]、[通知测试][18]。
6. [有序状态事务][19]、[顺序等价测试][20]、[增量 assembler][21]。
7. [聊天窗口化][22]、[固定挂载行][23]、[展开状态][24]、[窗口化测试][25]、[解析工作量测试][26]、[性能记录][27]。
8. [批注类型][28]、[批注持久化][29]、[Markdown 选区][30]、[浏览器标注上下文][31]。
9. [读取订阅契约][32]、[文件版本][33]、[读取缓存测试][34]、[取消订阅竞态][42]、[未落盘等待][43]。
10. [本地诊断入口][35]、[敏感字段处理][36]、[诊断架构测试][37]、[崩溃报告][38]。
11. [Journal 数据库兼容和同步][39]、[原生聊天 transport][40]、[增量记录读取][41]。
