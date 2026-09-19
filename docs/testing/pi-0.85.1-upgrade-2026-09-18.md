# Pi 0.85.1 升级验收

日期：2026-09-18。环境：Windows x64、Node.js 22.23.2、Electron 43.1.1。当前主代理执行，未启动子代理。

## 结果与范围

Stella 当前源码内置的官方 Pi 从 **0.84.2 升级到 0.85.1**。核对时 npm `latest` 与 [GitHub 最新稳定发布](https://github.com/earendil-works/pi/releases/tag/v0.85.1)一致，Node 要求仍为 `>=22.19.0`。

项目继续使用官方公开 SDK 和 RPC 入口；没有 fork Pi、修改 Pi 包内代码、安装第二套核心或改变本机全局 `pi`。SoL 只做隔离研究，未接入应用，结论见[可行性评估](../research/sol-pi-single-core-feasibility-2026-09-18.md)。

本轮不包含 GitHub 推送、Tag、Release 或新安装程序。应用源码版本仍为 0.7.1；下次实际推送时按仓库约定重新核对远端并自增应用版本。Pi 版本和 Stella 应用版本不是同一个版本号。

## 实际修改

1. 根 `package.json` 精确锁定 `@earendil-works/pi-coding-agent: 0.85.1`，同步 npm lockfile，完成原生依赖安装。
2. 修复版本读取对 RPC 入口目录深度的依赖。新版公开 `rpc-entry` 解析为 `dist/bundle/rpc-entry.js`，旧 `dirname(entry)/../package.json` 会指向不存在的文件。现在直接使用 Pi 公开导出的 `VERSION`，用于初始化快照、执行后端元数据和诊断导出。
3. 接入新增公开 RPC `clear_queue` 的边界校验，仅转发合法字段，不把 renderer 指定的请求 ID 或其他字段送入 Pi。
4. 诊断与打包冒烟测试按项目包元数据核对当前版本，移除已过期的 Stella 0.6.0 / Pi 0.84.2 固定断言；没有降低版本一致性断言。
5. 新增 4 项升级回归 E2E，并纳入 `test:e2e:native`。协议夹具支持有意省略 usage，以验证真实 Pi 的无用量压缩路径。
6. 更新中英文 README 的当前内置版本与验证说明，历史版本验收记录和旧安装包名称保持原样。

## 通过的检查

| 检查 | 结果 |
| --- | --- |
| `npm view @earendil-works/pi-coding-agent version dist-tags engines` | latest = 0.85.1 |
| 根 package / lockfile 一致性 | 精确版本均为 0.85.1 |
| `npm ls` Pi coding-agent / agent-core / ai / tui | 同为 0.85.1，只有一套依赖树 |
| `npm run check` | 类型检查、Lint 通过；126 个测试文件、582 项单元测试通过 |
| `npm run build` | 主进程、preload、renderer 生产构建通过 |
| `npm run test:e2e:native` | 16/16 通过 |
| Windows x64 `electron-builder --dir` | 成功，独立验证目录，不覆盖原有 release 目录中的应用 |
| 打包态冒烟 + 4 项升级回归 | 5/5 通过 |
| ASAR Pi 元数据核对 | 四个 Pi 组件各一份，版本均为 0.85.1 |
| ASAR 路径检查 | 未发现 `test-results/`、`.pi/`、`.codex/`、`auth.json` 条目 |
| `git diff --check` | 通过 |

### 4 项新增运行回归

- **工具结果触发压缩再续跑**：真实 Pi `read` 读取隔离文件；响应提供的用量尚未越过阈值，新增工具结果使上下文越界。验证请求顺序是前序会话、读文件、无工具的摘要请求、继续回答；事件顺序是工具完成、压缩开始、压缩结束、最终 `agent_settled`。原始 JSONL 留存工具证据和最终回答。
- **手动压缩取消**：挂起本地摘要 HTTP 请求，经应用 IPC 发送真实 RPC `abort`；验证压缩实际取消、没有生成成功压缩记录、不再忙碌，随后 Enter 可正常发送新回合。
- **Provider 没有 usage**：本地响应不含 usage 字段；验证 Pi 按消息尺寸触发自动压缩，GUI 不把“没有用量”当作永远不需要压缩。
- **清空消息队列**：保持一个真实 Pi 回合等待响应，分别入队 steering / follow-up；`clear_queue` 返回并清空两类消息，不取消正在执行的回合，也不执行或重放被清除消息。

既有 E2E 另外覆盖 Skill 文件夹热加载、键盘选择与 Enter 发送、会话和附件草稿恢复、模型发现/增删/连接验证、多工具文件生成与预览、断连后恢复原 Session、原生提交回执及诊断导出。

测试启动真实 Electron、preload、IPC 和未修改的 Pi；文件工具真实读写。模型响应和用量由 loopback HTTP 协议夹具控制，不是远程模型推理、真实性能或费用验证，也不是生产 fallback。模型配置、认证与会话使用隔离目录；Pi 仍可能发现用户级 Skills，所以按技能身份断言，不依赖候选顺序。

## 调试中发现并处理的失败

- 升级审查发现旧版路径计算与新 RPC bundle 目录不兼容，已通过公开 `VERSION` 修复；类型检查还捕获了一个遗漏的旧函数引用，修正后完整检查通过。
- 新增压缩夹具最初只设置 1-token 保留尾部，且末条消息是一个较大的工具结果。Pi 不能从工具结果内部切分，公开切分计算没有找到可压缩前缀，因此该测试的预期不成立。夹具改为带前序会话并保留完整工具对，最终按真实合法消息边界验证；未修改 Pi 切分算法、未把无压缩场景冒充压缩成功。
- 旧打包冒烟最后仍断言界面版本为 0.84.2，在显示真实 0.85.1 时失败。改为读取根包锁定版本后，5 项打包态检查全部重跑通过。

上游变更依据：[官方 coding-agent changelog](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/CHANGELOG.md)。重点涉及工具后压缩、缺失 usage、压缩取消、会话分支、Skill 发现和公开 RPC；并非所有新增模型与第三方 Provider 都已做真实联网测试。

## 打包验证记录

生成目录：`release/pi-0.85.1-verification/win-unpacked/`，由 Git 忽略，仅作本轮验证。

```powershell
npm exec -- electron-builder --config electron-builder.config.mjs --dir --win --x64 --config.directories.output=release/pi-0.85.1-verification --publish never
$env:STELLA_PACKAGED_EXECUTABLE = (Resolve-Path 'release/pi-0.85.1-verification/win-unpacked/Stella Pi Workbench.exe').Path
npm exec -- playwright test tests/e2e/packaged.spec.ts tests/e2e/pi-upgrade.spec.ts --output=test-results/pi-0851-packaged
```

打包冒烟将 `PATH` 指向空目录，验证启动不依赖全局 Pi/Codex/Claude。其余升级回归针对同一打包可执行文件，使用各自隔离数据。

Electron Builder 输出的 duplicate dependency references 是依赖图的多处引用；实际 ASAR 扫描中 Pi coding-agent / agent-core / ai / tui 各只有一份。打包日志列出未纳入其他平台/架构的 optional binaries，不视为已完成那些平台的验证。

可执行文件 Authenticode 状态为 `NotSigned`，没有生成 NSIS 安装程序。未运行 macOS、Windows ARM64、签名/公证、在线真实模型对照和完整 Team 多模型任务验收。已安装的旧版应用、旧安装包及用户全局 CLI 均未被替换。
