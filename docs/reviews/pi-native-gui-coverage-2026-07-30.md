# Pi 原生 GUI 能力核验（2026-07-30）

## 结论

当前 GUI 的 **Pi RPC 核心工作流正常**，并且团队层关闭时可以独立使用。项目已于 2026-08-01 升级并精确锁定 `@earendil-works/pi-coding-agent@0.83.0`；本表最初按 `0.82.1` 审查，升级后已重新通过公开 RPC 合同、生产构建和原生 Electron E2E。能力对照以官方 [RPC 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md) 与 [Coding Agent README](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md) 为准。

“全面”需要区分两个口径：

- 以 Pi 0.83.0 的 **RPC 嵌入协议**为口径，GUI 已覆盖日常工作所需的核心能力；少数 RPC 变体由更直观的选择器替代，少数高级参数尚无独立表单。
- 以 Pi 的 **完整交互式 TUI**为口径，当前 GUI 不是 100% 等价复刻；OAuth 登录、包管理、scoped models、导入/分享、文件模糊补全等仍属于 Pi CLI/TUI 能力。

因此，准确表述应是：**原生执行主链正常，RPC 核心覆盖较完整，但不应宣称完整复刻 Pi TUI 的所有管理与编辑器能力。**

## 页面边界

| 能力面 | 默认状态 | 入口与约束 |
| --- | --- | --- |
| Pi 当前会话 | 显示 | 应用默认页；文本/图片、流式消息、停止、steer/follow-up 均走真实 Pi RPC |
| 模型配置 | 显示 | 全局模型、Provider/API Key、自定义端点与真实连通测试 |
| 命令、终端、会话图谱 | 显示 | Pi 原生工作流的一部分，不依赖 Task Control 页面 |
| 团队协作、任务看板、自动化 | 隐藏 | 在“偏好设置 → 功能页面 → 显示团队功能（实验）”显式开启 |
| “固化为任务”与团队命令 | 隐藏 | 只在团队功能开启后出现；关闭不删除 `board.json` 中的已有事实 |

## Pi 0.83.0 RPC 对照

| 协议能力 | GUI 状态 | 说明 |
| --- | --- | --- |
| `prompt` + 图片 | 已支持 | Composer 发送文本与内联图片；真实 Qwen live 测试通过 |
| `steer` / `follow_up` | 已支持 | 流式期间可在“引导 / 排队”间选择，并可设置逐条或全部交付 |
| `abort` | 已支持 | Composer 停止按钮与 `Esc` |
| `new_session` | 已支持 | 新建会话按钮与 `Ctrl/Cmd+N` |
| `get_state` / `get_messages` | 已支持 | 启动、刷新和事件归并的真实状态源 |
| 模型枚举与 `set_model` | 已支持 | 左栏全局模型选择器与独立模型配置页 |
| model cycle | 等价覆盖 | GUI 直接选择目标模型，不单独复制 TUI 的循环快捷键 |
| 思考级别枚举与设置 | 已支持 | 由当前模型的 `get_available_thinking_levels` 动态生成；不再从团队领域常量推断 |
| thinking cycle | 等价覆盖 | GUI 直接选择受当前模型支持的级别 |
| Steering / Follow-up 模式 | 已支持 | 偏好设置直接写入 Pi 会话 |
| `compact` | 核心已支持 | 支持立即压缩和自动压缩；尚无 `customInstructions` 独立输入框 |
| 自动重试 / 停止重试 | 已支持 | 偏好开关、运行状态与停止按钮 |
| `bash` / `abort_bash` | 已支持 | 独立终端抽屉、输出截断信息与停止 |
| session stats | 已支持 | Context、token、费用、消息与工具统计 |
| `export_html` | 已支持 | 导出后在文件管理器中定位；尚无 JSONL/自定义输出路径表单 |
| 会话列表与 `switch_session` | 已支持 | 当前会话立即显示，历史会话可恢复 |
| `fork` / `clone` | 已支持 | 消息分叉、树节点分叉与当前分支克隆 |
| entries / tree | 已支持 | 会话图谱与 leaf 投影 |
| 最后一条助手文本 | 等价覆盖 | 每条助手消息均可直接复制，不依赖单独的 `get_last_assistant_text` 入口 |
| 会话命名 | 已支持 | 检查器中的重命名对话框 |
| 扩展 / prompt / skill 命令 | 已支持 | `/` 补全与命令面板使用 `get_commands` 的真实结果 |
| 扩展 UI | 已支持 | select、confirm、input、editor、notify、status、widget、title、editor injection |

## 仍属于 Pi CLI/TUI 的能力

以下差异不会阻断 GUI 的原生会话主链，但属于“完整 TUI 等价”尚未覆盖的范围：

- OAuth `/login`、`/logout` 的交互式订阅登录；GUI 当前完整支持 API Key/自定义 Provider，但 OAuth 仍由 Pi 交互式流程负责。
- `pi install/remove/update/config`、资源过滤与 scoped model 管理。
- `/import`、`/share`、`/reload`、`/changelog` 等 TUI 管理命令。
- `@` 项目文件模糊搜索、路径 Tab 补全、图片剪贴板粘贴与拖放；GUI 当前提供图片文件选择。
- `/compact <custom instructions>`、导出 JSONL/指定路径等高级变体。
- TUI 自定义 keybindings/themes；GUI 使用自己的快捷键和八套皮肤体系。

## 本次验证证据

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm test`：47 个测试文件、209 项测试全部通过。
- `npm run build`：main、preload、renderer 生产构建通过。
- `npm run test:e2e`：5 项通过、打包冒烟按入口条件跳过；覆盖真实 Pi RPC 冷启动、默认原生页、团队门控及跨重启持久化、从 Team 返回 Pi、会话新建/重命名、命令面板、真实终端成功/失败/取消、字体切换、键盘焦点、响应式侧栏、模型配置、本机 Provider 探测和医药看板流程。
- `npm run test:e2e:qwen:live`：通过；团队功能保持关闭时，真实阿里百炼 Qwen 会话返回指定随机校验串，并通过 provider/model、错误状态、token 与 session stats 断言。

常规 E2E 截图写入 Playwright 隔离输出；只有设置 `STELLA_UPDATE_DOCS_SCREENSHOTS=1` 时才更新 `docs/`，避免测试覆盖或锁住 README 使用的正式截图。
