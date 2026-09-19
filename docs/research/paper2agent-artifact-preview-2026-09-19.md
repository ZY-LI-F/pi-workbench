# Paper2Agent 产物的右侧栏预览建议

日期：2026-09-19。范围：建议与依据核查，不实现功能、不安装插件、不启动产物中的程序。遵守用户要求，由主代理完成，不启动子代理。

## 结论

不需要再引入一套 Agent 核心、Office 插件或完整 Jupyter 服务。优先复用现有文件检查器，增加阅读包导航、学术 Markdown、CSV/TSV 表格和验证证据视图；只读 Notebook 与 MCP 源码/说明视图用于后续完整 Paper2MCP 工作流。以下优先级是基于实际产物和当前源码的设计建议，不是已实现功能。

## 产物范围与证据

本地前次测试完成的是 Paper2Skill 阅读包，未覆盖完整 Paper2MCP。科学实验与说明 PPT 是独立的复现交付，不能统称为 Paper2Agent 自动产生的结果。依据：本地 `output/moleculenet-reproduction-20260918/REPORT.zh-CN.md`。本文提及的 `output/` 实测材料未上传到公开仓库；这些路径是本机证据索引，不是 GitHub 下载入口。

官方路由也区分论文转 Skill、代码转 MCP；组合交付保留两个组件。Paper2Skill 将正文、补充材料、图表组成阅读包，原文、审阅与验证材料另存于工作目录。依据：[路由约定](https://github.com/jmiao24/Paper2Agent/blob/8c2d059165ef8cdcb70dbea76655b9c2b55b38e6/skills/paper2agent/SKILL.md)、[阅读包结构](https://github.com/jmiao24/Paper2Agent/blob/8c2d059165ef8cdcb70dbea76655b9c2b55b38e6/skills/paper2agent/paper2skill/SKILL.md)。检索索引仍含旧版 README，产物判断以实测固定提交及当前原始 README 为准，不混用旧版目录约定。

本地查看样本：

- `output/moleculenet-reproduction-20260918/gui-test/paper2agent/moleculenet-paper/`：正文、导航、补充材料与图表。
- 同级 `moleculenet-review/`：原始 PDF、`inventory.json`、`bundle.json`、`verification.json`、逐页证据等。
- `output/moleculenet-reproduction-20260918/verification/summary.csv`：本次独立科学实验汇总，并非 Paper2Skill 的标准输出契约。

## 当前应用的实际缺口

| 能力 | 当前源码行为 | 证据 |
| --- | --- | --- |
| PDF、PPTX、Word、Excel、图片、SVG | 已有专用只读预览，不需重复建设 | [文件类型映射](../../src/shared/file-preview.ts) |
| CSV、TSV | 被归类为 text，显示原始文本，不是可筛选表格 | 同上及 [TextPreview](../../src/renderer/src/components/FilePreviewPanel.tsx) |
| JSON、YAML、日志 | 文本预览；JSON 可格式化，但没有树形浏览或验证状态语义 | 同上 |
| 学术 Markdown | 仅 GFM；相对链接不能跳转，非 data 图片被隔离，没有公式插件 | [MarkdownPreview](../../src/renderer/src/components/FilePreviewPanel.tsx) |
| 会话产物索引 | 仅提取助手正文提及的路径，按最后提及时间排序，不是目录扫描或磁盘修改时间 | [sessionFileReferences](../../src/renderer/src/lib/session-files.ts) |
| Notebook、Python 源文件 | 扩展名未注册，没有专用阅读器 | [文件类型映射](../../src/shared/file-preview.ts) |
| HTML 报告 | iframe 沙箱禁止脚本和联网，未解析相邻本地资源 | [HTML 安全封装](../../src/renderer/src/lib/html-preview.ts) |

本地阅读包的 `references/paper.md` 使用 `../assets/figure/...jpg`、`../assets/table/...csv` 普通相对链接，现有预览不能沿链接继续阅读。对应的 `references/index.md` 又链接 `paper.md` 和 `supplement.md`；因此首先需要打通阅读路径，而不是增加一个更重的文件渲染器。

## 建议优先级

### 第一优先：查看现有阅读包

1. **阅读包导航**：在文件选择弹层中打开一个产物目录，按正文、补充材料、图、表、原始 PDF、验证记录组织入口。阅读包和外部审阅目录分别绑定，不假定报告都在交付包内。保留现有下拉框；不用在窄右栏再常驻一列文件树。明确区分最后提及时间和磁盘修改时间。
2. **学术 Markdown 增强**：目录、公式、脚注、相对图片与文件链接；图表进入现有图片/CSV 查看器，再返回原文原位置。有可靠源文件与页码映射时才能跳原 PDF，不从文件名猜测出处。相对路径经主进程规范化、授权目录校验后读取，不开放任意 `file://` 或脚本执行。复用 [现有本地路径授权服务](../../src/main/local-path-service.ts)。
3. **CSV/TSV 表格**：搜索、可选表头、筛选、排序、冻结列、虚拟滚动或显式分页，保留查看原始文本。正确处理引号、逗号、换行、空行、编码、前导零与长标识符；不将公式样式文本执行为公式。论文转出的表格可能含标题或多层表头，不能把每份 CSV 的第一行强制当唯一表头。复用既有表格交互；转换器关于空行、隐藏内容与缓存值的约定见 [Paper2Skill](https://github.com/jmiao24/Paper2Agent/blob/8c2d059165ef8cdcb70dbea76655b9c2b55b38e6/skills/paper2agent/paper2skill/SKILL.md)。
4. **结构化验证报告**：通用 JSON 树 + 小型 Paper2Skill 适配器。显示实际状态、机械校验结果、未解决问题、已复核页与限制说明，跳转对应证据；不把 `mechanical_ok: true` 翻译成“科学复现成功”。本地 `verification.json` 的状态为 `reviewed_with_limitations`，应展示“已复核（存在限制）”。状态语义来源：[官方验证状态](https://github.com/jmiao24/Paper2Agent/blob/8c2d059165ef8cdcb70dbea76655b9c2b55b38e6/skills/paper2agent/paper2skill/SKILL.md)。

### 第二优先：查看完整 Paper2MCP 与复现实验

5. **只读 Notebook**：渲染 `.ipynb` 中已经保存的 Markdown、代码、stdout/stderr、错误堆栈、表格与图片。代码默认可折叠；无输出应显示未保存输出，不自动重算。不支持的输出 MIME 明确显示，不伪造完成状态。Notebook 原本包含单元与保存的输出，不必启动 Python/Jupyter Kernel 才能阅读。[Jupyter nbformat](https://nbformat.readthedocs.io/en/latest/format_description.html)。Paper2MCP 要保留完整执行 Notebook 作为科学核查证据：[工作流说明](https://github.com/jmiao24/Paper2Agent/blob/8c2d059165ef8cdcb70dbea76655b9c2b55b38e6/skills/paper2agent/paper2mcp/SKILL.md)。
6. **代码与交付说明**：为 `.py`、`.r`、`.sh` 等增加只读语法高亮、行号、搜索；展示 `USAGE.md` 和已有工具参数/验收描述。阅读不应 import Python 模块或启动 MCP server。MCP ZIP 默认不含 Notebook、测试报告、环境或中间结果，不能因为 ZIP 中缺少这些材料就判断交付损坏；证据入口应指向另行关联的工作目录。[官方交付约定](https://github.com/jmiao24/Paper2Agent/blob/8c2d059165ef8cdcb70dbea76655b9c2b55b38e6/skills/paper2agent/paper2mcp/references/output-delivery.md)。

### 条件能力：按实际科学产物加入

- **分子可视化**：若经常查看 SMILES 或结构文件，2D 结构可评估 [RDKit.js](https://github.com/rdkit/rdkit-js)，SDF/PDB 等三维结构可评估 [3Dmol.js](https://github.com/3dmol/3Dmol.js)。仅对实际坐标展示三维结构，不因看到 SMILES 就伪造实验构象。独立按需加载，非所有 Paper2Agent 产物的必需项。
- **结果曲线与指标对比**：读取实际 CSV/JSON 后由用户选列和单位，生成训练曲线、预测散点或分组指标表。沿用真实数据来源，不能把不同单位或不同实验划分自动合并比较。
- **交互 HTML、H5AD、Parquet、模型权重**：当前样本不构成优先需求。HTML 先支持隔离的本地静态资源；可信脚本交互属于单独的信任与执行设计，不应为了图表直接放开沙箱。科学二进制可先提供明确的元数据/外部工具入口，不能通过反序列化任意模型文件实现“预览”。

## 保持简单的实现边界

- 使用现有「检查器 → 文件」，保留单一预览画布、下拉切换、拖宽、关闭、引用到聊天和返回阅读位置。
- 采用内置的按需加载预览组件和薄格式适配器，不建设第三方插件市场，也不把 Python、Jupyter 或 Office 运行环境塞进 GUI 安装包。
- 查看已有产物与执行产物严格区分；打开报告不启动模型、安装依赖或注册 MCP。
- 本次按 research 技能将依据归档为这一份研究记录。没有改动应用功能、依赖、Pi 核心或安装配置，也没有执行新功能测试。
