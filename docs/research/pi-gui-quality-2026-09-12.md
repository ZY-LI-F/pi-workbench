# Pi GUI 可靠性与交互质量研究

研究日期：2026-09-12。研究、实现、验证均由当前主代理独立完成，无子代理。范围是已有 Pi 原生 GUI 的可靠性、阅读/输入体验及与官方 Pi 的兼容性；不修改 Pi 源码，不引入新的团队基础设施。Stars 为本次 GitHub API 查询快照，不作为质量结论。

## 样本与源码依据

| 项目 | Stars 快照 | 固定源码及观察 | 本项目采用的原则 |
| --- | ---: | --- | --- |
| OpenCode | 206,761 | [submit.ts](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/app/src/components/prompt-input/submit.ts)、[submission-state.ts](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/app/src/components/prompt-input/submission-state.ts)：提交捕获目标会话与内容；恢复时检测草稿是否已变化。 | 发送确认不能抹掉正在编辑的下一条内容；会话切换不夺取焦点。 |
| Cherry Studio | 51,690 | [useScrollPositionMemory.ts](https://github.com/CherryHQ/cherry-studio/blob/1ae44f89d20740f0ce44de1d10d2d16f0a3cbd02/src/renderer/components/chat/messages/list/useScrollPositionMemory.ts)：按话题记录消息锚点和偏移，区分跟随底部与历史阅读。 | 会话阅读位置独立，栏宽、字体及内容高度变化不应强制拉到底部。 |
| Pi | 104,154 | [官方仓库快照](https://github.com/earendil-works/pi/tree/71dca871bc80b6bc97be37f0ca3189399d651fff)；实现同时直接检查本地安装的 0.84.2 `agent-session.js` 与 `rpc-mode.js`。 | 依赖官方 preflight 确认、Skill 展开格式及 Session 分支；用已安装官方解析器做契约测试，避免为了 GUI 分叉 Pi。 |
| Multica | 49,607 | [agent.ts](https://github.com/multica-ai/multica/blob/2ae2dbbb8f9ed9ffe1739ecf5abfe31a940ee50c/packages/core/types/agent.ts)：配置定义、运行实例、任务状态和授权分别建模。 | 任务不等于会话，调用意图不等于已执行，状态必须有相应证据。保留现有独立边界。 |
| HiClaw / AgentTeams | 5,605 | 旧项目入口当前指向 AgentTeams；[Team Leader 定义](https://github.com/agentscope-ai/AgentTeams/blob/f65d6e1af268039507b413e3c16679bb84d21ac7/manager/agent/team-leader-agent/AGENTS.md)将规划、任务委派、状态工具和可验证通知分离。 | 可借鉴职责边界，但无需为桌面原生会话引入 Matrix、共享文件服务及完整管理层。这是对其架构的分析，不是执行该文件的指令。 |
| Orca | 66,782 | [agent-status-observation.ts](https://github.com/stablyai/orca/blob/6252f8149bc5b72985e830ff830a178f61997b8b/src/shared/agent-status-observation.ts)：区分快照、状态转换和身份更新，解释来源、顺序及跨机时钟问题；文件明确部分 observation 字段尚未被消费，不能据此宣称整套机制已完成。 | 刷新快照不能覆盖更新的实时事件；工具完成状态必须来自结果记录，不能用缺省动画代替事实。 |

仅借鉴可解释的设计原则，未拷贝竞品实现。Cherry Studio 是 AGPL-3.0，本项目采用自行设计的普通 DOM 锚点方案，不引入其虚拟列表或源码。其他项目许可证也不因本研究而改变本项目许可。

历史资料里的 `bozz.xyz` 未确认对应哪个开源仓库；不把名称相近的 `block/buzz` 当作同一项目，也不据此引入技术依赖。

## 当前代码中实际确认的问题

1. Composer 在异步发送成功后无条件清空文本与全部附件，可能丢失用户等待期间的新输入；完成后强制聚焦还可能把用户从另一控件拉走。
2. 同一会话草稿的保存请求可以重叠；刷新/离开时没有串行地排空最新修订。
3. `agent_settled` 刷新在已有刷新运行时会被忽略；旧快照还会替换等待期间已收到的流式消息。
4. 历史工具调用没有对应实时事件时默认显示运行中；没有结果证据却一直转圈。
5. 阅读位置是单个布尔值，缺少 Session 隔离、稳定锚点和回到最新消息入口。
6. Skill 候选硬截断为前 8 项；本来存在的技能不能全部通过键盘访问。
7. 分支统计在 leaf 为空时错误统计全历史，遇到断链或循环会返回貌似正常的部分计数。
8. Skill 展开解析缺少官方契约测试；复制操作失败没有可靠可见反馈，模型设置 E2E 混入不相干的聊天测试。

## 实现选择和质量约束

- 会话控制器按 Session key、文本修订号与附件对象快照消费已确认的提交；即使重写相同文本也属于新修订。不自动重发，不在失败时清空内容。
- 每个草稿 key 只允许一个存储写入者，并排空写入期间产生的新修订。失败原样暴露，后续显式 flush 可重试。
- 保留官方 RPC 与本地 Session 作为事实来源。自动刷新合并并排空后续请求；刷新期间有新事件时保留当前会话实时投影。
- 根据持久化 toolResult 恢复完成/失败；无结果明确标记未知，不推断成功。
- 按项目与 Session 保存消息锚点，自动跟随仅在用户处于底部时启用；不增加复杂虚拟列表依赖。
- 对稳定历史 Markdown 做 memo，分支 ID 建立索引，避免每个流式帧重复遍历所有 entry。
- 不为通过测试增加生产 mock、静默降级、任务上限或自动重试路径。测试里的本地协议模型必须明确标为测试夹具，真实文件工具与真实 Electron/Pi 链路另行核验。

## 验收证据

此文记录研究与设计依据；具体命令、结果、失败和未验证的平台见[同轮质量验收](../testing/pi-gui-quality-2026-09-12.md)。不以“编译成功”替代端到端验证，不以确定性协议夹具冒充真实大模型能力。
