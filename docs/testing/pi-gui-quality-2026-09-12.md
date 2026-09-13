# Pi 原生 GUI 质量验收 · 2026-09-12

本轮基于 v0.5.0 工作区（HEAD `633494c`）继续改进，保留进入任务时已有的未提交改动。研究、设计、实现、审查均由当前主代理完成，没有启用开发子代理；真实模型仅用于隔离样例验收。版本号没有变更，没有提交、推送或发布远端。

设计依据见[高 Star 项目源码研究](../research/pi-gui-quality-2026-09-12.md)。不分叉 Pi，不把原生会话改造成团队任务，不引入新的数据库、调度框架或 UI 虚拟化依赖。

## 已实现的行为

| 问题 | 修复与验证边界 |
| --- | --- |
| 发送确认清空新草稿 | 会话控制器捕获 key、文本修订号和附件快照。确认只消费该提交；等待期间改写、重新输入相同文字、切出再返回、添加新附件均保留新内容。失败不清空、不自动重发。 |
| 草稿保存竞态 | 每个 key 单写入者，排空保存期间的新修订；失败可见，flush 能显式重试。 |
| 发送后夺取焦点 | 不从用户已经选择的其他控件夺回焦点；Composer 随 Session 重建临时状态。 |
| 扩展旧文本反复覆盖 | 注入应用后按 ID 消费；旧确认不能清除更新的注入，返回页面不会再次应用已消费的内容。 |
| Skill 列表与消息 | 不再只取前 8 项；完整键盘上下选择与 Tab/Enter 确认。消息默认折叠指令，复制用户调用，默认 Session 标题显示调用而非 Markdown。用户明确设置的标题原样保留。 |
| 旧刷新覆盖流 | 有更新 Pi 事件时保留当前会话实时投影；`agent_settled` 刷新合并并排空，导航期间延迟自动刷新，过时初始化失败不覆盖新会话。 |
| 历史工具一直转圈 | 从持久化 toolResult 恢复成功/失败；没有结果明确显示“未记录结果”，不推断运行或成功。 |
| 长会话阅读跳动 | 按项目和 Session 保存消息锚点与偏移；底部跟随和历史阅读分离，提供“回到最新消息”，支持栏宽与内容高度变化。 |
| 窄窗口新会话遮挡 | 成功新建后收起抽屉并聚焦输入区，宽屏常驻侧栏保持原行为。 |
| 压缩状态误读 | 仅统计当前分支，空分支为 0；断链/循环显示未知与原因。区分活动上下文、追加历史和累计 Tokens；压缩后用量等待下一次响应的官方语义直接解释。 |
| 复制失败无反馈 | 消息复制接入已有的主进程剪贴板验证服务，失败显示原因，不伪造“已复制”；Markdown 外链打开失败也有反馈。 |
| 用量与渲染 | 原生用量统一为 M，悬停显示精确 tokens；稳定 Markdown memo，Session entry 查找建索引，避免每帧重复全量查找。 |

## 检查记录

- `npm run check`：通过，112 个 Vitest 文件、509 项测试；包含 node/web 类型检查与 renderer lint。
- `npm run build`：通过，生产 renderer/main/preload 构建成功。
- `npm audit --omit=dev --json`：本次返回 0 个已知漏洞。这不是无漏洞或无安全风险的保证。
- 原生能力、模型设置及聊天 E2E：最终整组结果见本文件末尾追加的终验记录。
- Windows 打包态：最终结果见终验记录。macOS、Windows ARM64 与 Android/AVD 本轮未执行。

测试夹具启动真实 Electron、preload、IPC 和官方 Pi 0.84.2，并在隔离项目中实际执行文件工具。本地协议服务只用于控制响应、时序及用量；它不是生产 fallback，也不证明大模型推理质量。Skill 仍可能包含 Pi 自动发现的用户级目录，因此测试按技能身份选择，不依赖候选顺序。

自动压缩夹具明确设置 `keepRecentTokens: 1` 并注入 120,000 输入 tokens 的协议用量，验证 Pi 的完整阈值、摘要、持久化、状态和 GUI 路径；没有改动生产压缩配置，也没有宣称向真实模型发送了 120k tokens。

## 真实模型验证

已执行的模型请求结果分别记账，没有模型自动替换：

| Provider / Model | 结果 |
| --- | --- |
| `aliyun-maas/qwen3.8-max-preview` | 服务端 403 `AccessDenied.Unpurchased`；本次没有获得推理权限，未通过。 |
| `aliyun-maas/qwen3.7-plus` | 同样返回 403 `AccessDenied.Unpurchased`；未通过。 |
| `deepseek/deepseek-v4-flash` | 两轮隔离多步任务通过：同一 Session、48 条消息、25 个真实工具结果（read 10、write 4、bash 11）、0.382673M 累计 tokens、118.835 秒。 |

DeepSeek 第一轮读取合成 CSV/JSON 与验收标准，生成并运行分析/复核程序，产出 `summary.json`、`stability-report.md`、`dashboard.html`、`verification.md`；第二轮在相同 Session 生成 `followup-audit.md`。运行时完成模型页往返，输入区没有离开视口，最终无 pending 消息、无 page error。

当前主代理另行运行已检查的 `verify.mjs`（退出码 0），并用 PowerShell 独立复算运行数、输入/输出/总 tokens、nearest-rank P95、重试次数与重试后成功数，全部一致。合成数据的 24 次运行中 22 次成功，P95 为 410 秒；这些是样例数据指标，**不是 GUI 的成功率或响应耗时**。

隔离模型目录使用临时配置副本，不改变用户默认模型；测试结束清除了复制的 `auth.json`、`models.json` 和模型配置缓存。输出、JSONL 与检查记录保留在本机 `test-results/quality-live-deepseek/`（Git 忽略）。历史脚本产物名含 `qwen-3.8`，实际运行身份以证据 JSON 的 `provider`/`model` 为准；脚本已改为通用的 `native-longrun-*` 输出名。

## 发现并纠正的验证问题

1. 首版 Skill E2E 假定候选只有一个，碰到本机自动发现的其他 Skills；改为按完整身份搜索再键盘确认。
2. 窄窗口 E2E 暴露新建会话后抽屉仍遮挡输入区；修复应用行为并断言收起与焦点，而非强制点击穿透遮挡。
3. 自动压缩初版只注入高用量，但真实内容未超过 Pi 最近消息保留条件，正确地没有压缩。补齐夹具条件后验证成功，没有修改 Pi。
4. 真实模型拒绝访问时，旧长测先报“没有完成导航”；改为先读取官方消息中的原始模型错误，避免错误归因。

## 未声称的覆盖

本轮没有声称达到数学意义的“绝对上限”或不存在任何缺陷。已验证的是上述行为及命令覆盖的本地 Windows x64 路径。未进行 macOS/ARM/Android 实机回归、人工 Windows IME 输入法候选操作、无限长度会话压力测试或 Team 全量真实多 Agent 工作流；键盘组合输入覆盖为自动化事件测试。Qwen 权限限制仍存在，没有购买或修改账户权限。

## 终验记录

- `npm run test:e2e:native -- --output=test-results/quality-acceptance`：最终整组 **9/9 通过**，约 1.4 分钟。包括 5 条既有原生能力路径、独立模型配置、自动压缩、Skill 消息、真实多工具与文件预览/阅读位置路径。
- 最终 `electron-builder --dir --win --x64 --publish never`：通过，产物位于 `release/quality-2026-09-12/win-unpacked/`，未覆盖既有正式发布目录中的安装包。
- `STELLA_PACKAGED_EXECUTABLE=<该目录>/Stella Pi Workbench.exe` 下运行 `tests/e2e/packaged.spec.ts`：**1/1 通过**（约 12.5 秒）。启动子进程时清空可执行文件搜索路径，Pi 内置运行时就绪，缺失 Codex/Claude 不阻断；验证输入区、Session 地址复制、默认隐藏 Team、模型凭据管理及侧栏路径。
- Windows 可执行文件为 **NotSigned**，本轮生成的是未安装测试目录，不是已签名正式安装程序；应保留整个目录，不能只分发其中的 EXE。
- 包内容复核：16,908 项 ASAR 条目中未发现 `test-results/`、`.pi/`、`.codex/` 私有工作区路径或 `auth.json`；main/preload/HTML 入口及 32 个 renderer 资源逐字节匹配本轮最终构建。
- SHA-256：`app.asar` 为 `3CB68B1BE401D72C08A43ABE5916EF6B8F86E37C1631B446EA2D047ECD0C4B94`；主 EXE 为 `D19F20700FEB3E65D684E6BF9B3AD60AB66CA5BAB821342E2C0188DAA9C5C542`。
