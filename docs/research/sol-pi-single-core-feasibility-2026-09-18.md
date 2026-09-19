# NVIDIA SoL-Pi：单 Pi 核心的可选模式可行性评估

研究日期：2026-09-18。由当前主代理完成，无子代理。本文是研究结论与建议，不代表已安装或启用 SoL。

## 结论

**可行，适合做成当前 Pi 的可选扩展配置，不应该做第二套 Pi、第二个聊天后端或另一份模型配置。** 但不建议把上游四项机制直接全部打开，尤其不能在 Windows 上未经适配就启用 ObservationPack。

本轮按照后续用户要求，将 Stella 唯一的官方 Pi 依赖从 0.84.2 升级到最新稳定版 0.85.1；升级及 GUI 验证另见[升级验收](../testing/pi-0.85.1-upgrade-2026-09-18.md)。SoL 仅在临时目录研究，未加入 Stella 的依赖、资源或启动参数。

建议决策：

- 保留官方 Pi 0.85.1，精确锁定依赖；不 fork、不修改 `node_modules` 中的核心实现。
- 将来提供默认关闭的「Sol 模式」。它只控制同一个 Pi 进程加载哪些扩展，不增加第二种执行引擎。
- 第一阶段限于原生会话，优先 Action Fusion；ObservationPack 完成 Windows 文件安全与分支计数修复后再加入基础模式。
- Evidence-Preserving Reducer、Online Context Compact 单独列为进阶实验项，明确额外模型调用、费用与自动续跑行为。
- 暂不向 Team Worker、Leader、只读 Agent 或已有托管执行默认注入 SoL；不让 Sol 计划代替任务看板的状态与人工验收。

## 研究基线与来源

用户提到的项目确认为 [NVlabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi)，不是一个需要另装 NVIDIA 推理服务的模型包。

| 对象 | 本轮核对的版本 |
| --- | --- |
| SoL-Pi | `bd005888b9b8a3fcdb511feb91fc27d3dfa8f2b1`，包版本 0.1.0，MIT |
| Stella | 源码 0.7.1，研究开始时 HEAD `b34cb6d9e8d9b82d0b15a858bd2a7064c515afde`；本轮未提交 |
| Pi | 先测试原有 0.84.2，再复用升级后的官方 0.85.1 |
| 环境 | Windows x64、Node.js 22.23.2、Electron 43.1.1 |

固定源码：[入口](https://github.com/NVlabs/SoL-Pi/blob/bd005888b9b8a3fcdb511feb91fc27d3dfa8f2b1/src/sol-pi/index.ts)、[包元数据](https://github.com/NVlabs/SoL-Pi/blob/bd005888b9b8a3fcdb511feb91fc27d3dfa8f2b1/package.json)、[兼容说明](https://github.com/NVlabs/SoL-Pi/blob/bd005888b9b8a3fcdb511feb91fc27d3dfa8f2b1/docs/compatibility.md)、[配置说明](https://github.com/NVlabs/SoL-Pi/blob/bd005888b9b8a3fcdb511feb91fc27d3dfa8f2b1/docs/configuration.md)、[安全说明](https://github.com/NVlabs/SoL-Pi/blob/bd005888b9b8a3fcdb511feb91fc27d3dfa8f2b1/SECURITY.md)。

上游当前实现已经从早期 fork 思路转为公开 Pi 扩展。`pi.extensions` 指向 TypeScript 入口，Pi 包是 peer dependencies，没有另一份运行时核心。开发依赖里存在 Pi 不等于必须把它再次打包；Stella 不应复制上游的 `node_modules`。兼容文档明确覆盖 0.85.1 与 0.84.2，但 `*` peer 范围不应被当作所有未来 Pi 版本都兼容。

## 四项机制究竟改变什么

| 机制 | 实际作用 | 对 Stella 的价值 | 引入判断 |
| --- | --- | --- | --- |
| Action Fusion | 将 `edit/write` 与可选 `then_run` 命令合并为一次工具调用 | 减少“写脚本→运行/检查”的模型往返；适合代码、报告生成脚本 | 优先；必须呈现文件变更与命令执行两个结果 |
| ObservationPack | 大型纯文本工具结果先完整发送，后续请求改为可召回的引用与首尾片段 | 减少长任务重复携带同一份日志/文件内容 | 有价值，但 Windows 与分支状态问题先解决 |
| Evidence-Preserving Reducer（EPR） | 辅助模型提炼特定诊断日志，并核验引用、哈希和状态 | 构建、测试、命令错误分析；不是通用医药资料摘要器 | 进阶可选，必须单独配置模型和统计费用 |
| Online Context Compact（OCC） | 在 `update_plan` 阶段完成点判断是否调用 Pi 原生压缩，随后自动续跑 | 长程工具任务的上下文管理 | 暂不作为默认；先验证成本估算和完整生命周期 |

### Action Fusion：减少往返，不是事务

[融合实现](https://github.com/NVlabs/SoL-Pi/blob/bd005888b9b8a3fcdb511feb91fc27d3dfa8f2b1/src/sol-pi/extensions/action-fusion/index.ts)通过公开的工具定义工厂包装原生 `edit/write`。它没有新的 Agent 主循环。

其 per-file queue 和哈希检查降低融合操作之间的竞争，但不锁住所有外部程序。文件修改失败则不执行后续命令；命令失败会报告失败，**已完成的文件修改不自动回滚**。

`then_run` 内部直接调用 bash 工具实现。只观察最外层 `write/edit` 的权限和审计逻辑，可能看不到独立的 bash 调用。因此不能仅凭“Agent 有写文件权限”就让它获得命令执行能力，也不能把融合后的单个卡片直接标为全部成功。

### ObservationPack：减少重复发送，不删除原始会话

[上下文投影](https://github.com/NVlabs/SoL-Pi/blob/bd005888b9b8a3fcdb511feb91fc27d3dfa8f2b1/src/sol-pi/extensions/observation-pack/index.ts)只作用于发往模型的上下文；原始 JSONL 历史保留。原文及索引另外写入会话派生目录，并通过 `obs_recall` 分页读取。

当前默认对超过 10 KiB 的合格工具纯文本结果处理，前两次完整发送，之后使用引用和首尾摘录。它不是压缩 PDF/Office 文件的预览方案，也不为资料正确性背书。保存空间与发给模型的 token 流量是不同指标；归档本身仍占磁盘。

### EPR：核验摘录，不等于保证总结没有遗漏

[Reducer 实现](https://github.com/NVlabs/SoL-Pi/blob/bd005888b9b8a3fcdb511feb91fc27d3dfa8f2b1/src/sol-pi/extensions/evidence-preserving-reducer/index.ts)优先针对较长的构建、测试等诊断输出，检查结构、来源哈希、精确引文及成功/失败状态。它不能证明摘要完整，也不能验证医药科学结论。

默认辅助路由是 `openai-codex / gpt-5.6-luna`，不等于用户当前选中的 Qwen/DeepSeek。凭据仍由 Pi 管理，但会产生额外请求，不能在 GUI 中只统计主模型用量。

与 ObservationPack 不同，EPR 修改 `tool_result`，保存到 JSONL 的结果可能已是摘要回执；完整原文保存在旁路归档。后续会话导出、移动、备份必须考虑这些文件，不能只复制 JSONL 就宣称证据完整。

上游遇到不适用、模型不可用或校验失败时保留原始结果，并写入原因记录。若引入 Stella，必须将“未应用及原因”显示出来，不能仅显示一个绿色 Sol 标记，让用户误以为优化和降费已经发生。

### OCC：复用原生压缩，但确实会影响运行生命周期

[阶段压缩实现](https://github.com/NVlabs/SoL-Pi/blob/bd005888b9b8a3fcdb511feb91fc27d3dfa8f2b1/src/sol-pi/extensions/online-context-compact/extension.ts)的流程是：保存阶段状态、停止当前运行、等待 `agent_settled`、调用 `ctx.compact()`，成功后用隐藏提醒触发继续运行，并等待其结算。

因此不能把中途的停止误认为任务完成，也不能在压缩失败或用户取消时无条件继续。Stella 现有托管执行已经以 `agent_settled` 而不是单次 `agent_end` 判定完成，这是可复用的基础，不需要另建执行状态机。

它的 `update_plan` 是会话内部计划，不是项目 Issue/任务验收协议。GUI 可以显示它，但不能据此自动把看板任务标记为验收通过。

## 已发现的实际风险

### 1. Windows 文件安全不能只凭跨平台 API 名称判断

本机 Node 的 `fs.constants.O_NOFOLLOW` 为 `undefined`。固定源码中归档文件读取仍使用 `O_RDONLY | O_NOFOLLOW`，在 Windows 上不能提供它在 POSIX 上的拒绝符号链接语义。

[上游 Issue #16](https://github.com/NVlabs/SoL-Pi/issues/16)报告了同一问题；[PR #57](https://github.com/NVlabs/SoL-Pi/pull/57)在核对时仍未合并。不能把打开的 PR 当作已发布修复。本机两项符号链接测试先在创建链接时遇到 `EPERM`，因此本轮没有声称完成链接替换攻击的运行复现；已确认的是平台常量与源代码保护差异。

这是本地归档路径被替换时的防御边界问题，不应描述成已经证实的远程攻击漏洞。引入前需要真正的 Windows 文件句柄/路径一致性验证与负向测试，不是简单跳过失败用例。

### 2. 会话分支切换存在状态继承问题

`sentCounts` 按扩展实例保存，键不包含分支；固定源码未在 `session_tree` 后重建计数。回到旧分支时，历史大型输出可能直接变成摘录，而不是先重新完整发送。见[Issue #12](https://github.com/NVlabs/SoL-Pi/issues/12)。

Stella 已有会话树、恢复和分支能力，因此这是接入回归项，不是可以忽略的终端细节。

### 3. 压缩收益模型不能当作真实省钱账单

OCC 默认使用固定 cache write/read ratio（12.5）和保留尾部估计；模型切换不会自动把该比例同步成新 Provider 的价格。固定实现还按总上下文减保留预算估计可压缩前缀，而 Pi 只能在合法消息边界切分。[Issue #5](https://github.com/NVlabs/SoL-Pi/issues/5)记录了由此高估收益的情况，当前源码仍保留该计算方式。

对 Qwen、DeepSeek、不同缓存计费规则，以及用户自定义 `keepRecentTokens`，应按实际模型与 Pi 切分结果验证。未知价格显示“不可估算”，而不是推断一个漂亮的节省金额。

### 4. TUI 的状态与渲染不会自动变成 GUI

[上游 TUI 处理](https://github.com/NVlabs/SoL-Pi/blob/bd005888b9b8a3fcdb511feb91fc27d3dfa8f2b1/src/sol-pi/tui.ts)明确在非 `tui` 模式跳过节省提示。Stella 使用 RPC/React，所以必须自己接入生效状态、融合结果、归档召回、Reducer 用量、压缩进度与错误。

### 5. 兼容文档、Issue 与当前源码测试应分开看

[Issue #20](https://github.com/NVlabs/SoL-Pi/issues/20)报告过 Pi 0.85.1 的融合命令不执行。本轮使用当前固定源码、现有 Pi 0.85.1、真实文件与 shell 工具，分别验证 `write + then_run` 和 `edit + then_run`，两项均通过，**未在该测试条件复现**。这不等于所有平台、模型参数格式和第三方扩展组合都已验证。

## 只保留一套 Pi 的接入方案（建议，未实施）

```text
Stella 原生聊天 / 当前模型 / 当前 Session
              │
      Sol 配置与生效状态
              │
    现有 PiRpcRuntime（同一官方依赖）
              │
    --extension Stella 的轻量适配入口
              │
        上游 SoL 四项可选机制
```

### 核心归属

- Pi 继续拥有 Agent loop、模型注册、认证、Skills、工具执行、会话文件和原生压缩。
- SoL 只提供公开 Extension API 上的工具包装、上下文投影和生命周期策略。
- Stella 只提供配置、开关、运行状态映射与产品权限适配。
- Team 继续拥有分发、工作区权限、任务状态和人工验收；本阶段不变。

本项目已经通过公开 `@earendil-works/pi-coding-agent/rpc-entry` 启动 Pi；[启动选项](../../src/main/pi-rpc-runtime.ts)已有显式扩展参数，[原生维护窗口](../../src/main/interactive-command-router.ts)和[保持 Session 的重启路径](../../src/main/index.ts)也已存在。无需加一个 Sol daemon、单独 CLI 发现逻辑或另一份 Provider 数据库。

同一套 Pi 依赖用于多个现有托管执行进程，不等于维护多个核心分支。不得为了模式切换新增“Pi 后端 / Sol 后端”两套等价适配器。

### 开关与配置

建议在设置中增加一个默认关闭的「Sol 模式」，展开后显示具体机制。基础模式只包含已经验收的无辅助模型优化；高级开关分别控制 EPR 与 OCC，不把额外模型费用藏在总开关里。

上游入口只在首次 `session_start` 注册功能；简单修改 JSON 不能保证已注册的工具被卸载。因此切换应在空闲时通过现有维护窗口保留 Session 重启，保留草稿、附件与阅读位置；运行中明确显示“当前任务结束后可应用”，不打断正在写文件的任务。

区分“用户选择”“下次启动配置”“当前实际生效”。薄适配入口可使用上游 `createSolPiExtension(loadConfig)` 注入已验证配置，并通过 Pi 公开扩展 UI 事件向 GUI 回报状态；不能在没有加载确认时显示已启用。

Stella 的配置是自己启动实例的配置，不覆盖用户 `~/.pi/agent` 中的全局 SoL 配置。已有全局 SoL 或同名工具替换扩展需要识别冲突并明确报告，不重复注册，也不通过关闭全部用户扩展来掩盖冲突。

### 分发与数据

优先固定上游提交/经过验证的发行版，将插件及 MIT/NVIDIA 版权说明作为扩展资源分发。上游包目前标为 private，不能假定 npm 同名包就是这个实现。不复制其开发依赖；Pi peers 由现有核心满足。

打包后验证 TypeScript 入口加载路径及 ASAR 解包规则；不要用开发目录成功代替 Windows/macOS 安装态测试。模型凭据始终走 Pi，Sol 配置不放 key。

ObservationPack/EPR 的归档跟随 Session 关联。引用召回失败、文件缺失、迁移不完整、写入失败要显示真实错误或未应用原因；不伪造召回内容，不把失败变成成功回执。

## 本轮验证与边界

在临时源码目录通过目录链接复用项目现有 Pi 和测试工具，没有为 SoL 再安装一套 Pi，也未读写真实会话。上游原有源码与测试未修改；另加研究专用探针文件验证融合行为。

| 检查 | 结果 |
| --- | --- |
| 项目 `npm ls` | coding-agent、agent-core、ai、tui 同为 0.85.1，单一依赖树 |
| SoL 公开 API 兼容脚本 | 0.84.2、0.85.1 均通过 |
| 上游原有 19 文件 / 140 测试，Pi 0.84.2 | 133 通过、4 失败、3 因 suite setup 失败未执行 |
| 同一套上游测试，Pi 0.85.1 | 133 通过、4 失败、3 因 suite setup 失败未执行 |
| 原生 SDK 的一次/连续两次 OCC 压缩续跑测试 | 两版 Pi 均通过；摘要/模型响应为确定性测试夹具 |
| 新增研究探针：实际入口、真实文件与 bash、write/edit 融合 | Pi 0.85.1 下 2/2 通过；使用 Pi faux provider，无远程模型调用 |

4 项失败分别为 POSIX 文件 mode 断言、两项创建 symlink 被 Windows 权限拒绝、入口路径测试硬编码 `/`。另有 package suite 用 `spawnSync('npm')` 在 Windows 得到 `ENOENT`，其 3 项测试没有执行。路径断言失败发生在实际融合执行前，所以原始 suite 不能单独证明融合通过；上面的独立探针补测了它，但没有把原始失败改报为通过。

测试工具复用项目的 Vitest 4.1.11，而上游开发依赖为 4.1.9；这是验证环境差异。完整 JSON 结果保存在本机临时研究目录，不提交用户路径或测试产物到仓库。

[论文](https://arxiv.org/abs/2609.20519)报告的是特定模型和 51 项 EdgeBench 任务上的效率结果。本轮没有复现论文性能、真实 Provider 费用，也没有验证医药早研或 Office 生成的质量提升，不能承诺用户任务节省固定比例。

## 引入前的必要验收

1. Windows/macOS 上插件加载成功且依赖仍唯一；关闭模式恢复原生工具，不修改 Pi。
2. 开关在运行、压缩、排队、断连恢复时不丢会话、草稿或附件，错误状态明确。
3. 融合命令成功、失败、取消分别真实呈现；只读/限制工具策略不被扩大。
4. Windows 文件替换、符号链接、归档损坏与缺失的负向验证通过；分支/恢复的发送计数正确。
5. EPR 模型不可用、引文不匹配时明确呈现未应用原因；辅助请求用量单独记录。
6. OCC 以原生合法切分和实际模型参数计算；取消不自动重启，压缩续跑前不把任务结算为完成。
7. 再用用户常用的 Qwen/DeepSeek 与同一真实多步任务做启用/关闭对照，分别比较完成质量、往返次数、用量、时间与金额，不以模拟测试代替效果评测。

最终建议：**采用“单官方 Pi + 默认关闭的可选优化扩展”，不要做双核心。当前可以认可架构可行性，但不能把整个上游插件包标为已适配、已验收或直接默认启用。**
