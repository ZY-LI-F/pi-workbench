# Paper2Any 本轮执行状态

日期：2026-09-19。

## 结论

尚未生成本轮新的 PPTX。没有调用任何 DeepSeek 模型；没有把上一轮独立制版的 PPTX 冒充为本轮 Paper2Any 原生成品。

用户要求使用 Paper2Any 生成 MoleculeNet 复现说明演示文稿，并不再使用 DeepSeek。本轮先验证 Pi 已配置的非 DeepSeek 接口，但以下实际探测均未成功，因此尚未进入原生大纲、页面模型生成阶段。

## 实际接口结果

所有持久化回执位于同目录 `build/`，密钥未写入回执或源码。

| Pi Provider | 实际测试模型 | 结果 |
| --- | --- | --- |
| aliyun-maas | qwen3.8-max-preview、qwen3.8-max、qwen3.7-plus、qwen3.6-plus | HTTP 403，AccessDenied.Unpurchased |
| aliyun-maas | glm-5.3、kimi-k2.7-code | HTTP 403，AccessDenied.Unpurchased |
| fosunpharma-qwen | qwen3.7-plus | HTTP 403，nginx HTML 响应 |
| fosunpharma | gpt-5.5-zhangxiuya | HTTP 403，nginx HTML 响应 |
| fosunpharma-kimi | Kimi-K2.6 | HTTP 403，nginx HTML 响应 |
| kimi-local | kimi-k3 | 连接中断，UND_ERR_SOCKET；该首次探测仅保留在本次命令输出中，未生成 JSON 回执 |

百炼 `/models` 查询返回 HTTP 200，模型列表已保存，但列表可见不表示当前凭证拥有生成权限。错误不能证明所有未测试的接口或模型均不可用，也不能单凭这些响应断言公司网关的具体拒绝原因。

## 已核实的 Paper2Any 实现

隔离源码目录：`C:/Users/qq108/AppData/Local/Temp/stella-paper2any-20260918`。

上游提交：`b538531e25798d9b9d41afd5fa93c9222949b5a5`。

当前页面使用 `ppt_canvas_schema_v1`，`render_engine: canvas`。实际 Web UI 调用 `frontend-workflow/src/components/paper2ppt/canvasPptxExporter.ts` 中的 `buildCanvasSlidesPptxBlob`，导出可编辑 PPTX。

此前测试中使用的 `run_paper2ppt_structured_export_cli.ts` 属于旧结构化导出路径，不支持完整的新 Canvas 树，不能作为本轮导出替代。

原生页面服务会在模型请求失败时生成默认模板。因此，后续真实生成必须检查模型响应和每页生成记录，不可仅凭顶层 `success: true` 就宣布原生模型链路成功。

## 等待选择

已通过本次对话询问用户：

1. 使用当前 Codex 生成 Paper2Any 页面结构，然后由 Paper2Any 当前 Canvas 导出器本地导出。该路线不调用外部模型接口，必须明确标注其未执行 Paper2Any 原生模型生成链路。
2. 更新 Pi 中可用的百炼配置后，再执行 Paper2Any 原生模型生成。
3. 指定另一个可用的非 DeepSeek 模型接口，再执行原生模型生成。

尚未收到选择；没有将界面预选选项当成用户同意。

本轮工作仅新增任务输出与探测辅助脚本，未修改 Pi 用户配置、密钥或 PI-GUI 业务代码，未覆盖上一轮科研结果。继续使用现有 48 次局部实验时，仍须明确标注为局部复现，不得称为整篇论文全量复现。
