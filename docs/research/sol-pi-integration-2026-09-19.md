# Sol-Pi 接入依据核对

2026-09-19 主代理重新读取官方 README、配置、兼容与安全说明，并重新克隆官方仓库。HEAD 仍为 `bd005888b9b8a3fcdb511feb91fc27d3dfa8f2b1`，与既有评估相同；没有把未合并的 PR 当成已发布修复。

- [包元数据](https://github.com/NVlabs/SoL-Pi/blob/bd005888b9b8a3fcdb511feb91fc27d3dfa8f2b1/package.json)将 Pi 声明为 peer dependency；接入只分发扩展源码，不复制其开发依赖。
- [兼容说明](https://github.com/NVlabs/SoL-Pi/blob/bd005888b9b8a3fcdb511feb91fc27d3dfa8f2b1/docs/compatibility.md)覆盖 Pi 0.85.1；其 TUI 展示在 RPC 中不会自动出现，需 Stella 自己提供状态与用量视图。
- [配置说明](https://github.com/NVlabs/SoL-Pi/blob/bd005888b9b8a3fcdb511feb91fc27d3dfa8f2b1/docs/configuration.md)支持独立四项机制，EPR 认证复用 Pi；Stella 使用进程专属配置适配，避免改写用户全局配置。
- [安全说明](https://github.com/NVlabs/SoL-Pi/blob/bd005888b9b8a3fcdb511feb91fc27d3dfa8f2b1/SECURITY.md)明确扩展不是沙箱，EPR 可把诊断日志发给辅助模型，OCC 会压缩后继续任务。设置中必须明示，不能以总开关暗中全部启用。

实现与验收范围见 [Spec](../specs/sol-mode.md)。上游安装文档的“全部启用”是其特定验收流程，不是本项目默认开启高级机制的用户授权。
