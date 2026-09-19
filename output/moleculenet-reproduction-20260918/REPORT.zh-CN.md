# MoleculeNet 局部复现与 Pi GUI 工具实测

日期：2026-09-18。语言模型：DeepSeek V4.1 Flash（`deepseek/deepseek-flash`）。数值训练由本机 CPU 上的原生 DeepChem 执行，语言模型负责阅读、调用工具和说明，不生成模拟实验数据。

## 1. 结论与范围

已完成 48 次真实训练/评估：3 个完整数据集 × 4 个模型 × 3 个随机种子共 36 次，加 ESOL 骨架划分的 12 次诊断。逐分子预测、分区索引、指标、训练曲线和数据哈希均保存，并通过独立计算核对。

**总体结论：测试已执行，但不能判为全部通过。** Paper2Agent 阅读包与 Paper2Any 大纲/修订通过；Paper2Any 原生结构化制片失败；Pi GUI 多项交互可用，但长会话状态刷新稳定性未通过。最终说明 PPTX 是独立制版产物，不是 Paper2Any 原生导出。

这属于**现代环境下的局部复现**。没有复刻完整论文的 17 个数据集、全部模型、2017 年软件环境、原始种子/分区或超参数优化。没有湿实验、靶点验证、分子设计或临床有效性证据。

## 2. 论文与分区依据

- Wu et al. *MoleculeNet: a benchmark for molecular machine learning*. Chemical Science 9, 513–530 (2018)，在线发表 2017-10-31。
- [PubMed，PMID 29629118](https://pubmed.ncbi.nlm.nih.gov/29629118/)。[DOI](https://doi.org/10.1039/C7SC02664A)。
- 一区按 [RSC 官方期刊指标](https://www.rsc.org/publishing/journals/journal-metrics)的 JCR Q1（Chemistry, Multidisciplinary）口径核验。不是中科院一区声明，也不是发表当年的历史分区声明。
- 期刊全文使用 PMC XML。PDF 使用合法开放的 [arXiv v3 作者稿](https://arxiv.org/abs/1703.00564v3)，65 页。数字参考来自作者稿 Table 8 / p.51，理化性质主图为作者稿 Fig.13，对应期刊 Fig.12。不同版本不能混用图号。

## 3. 真实实验结果

测试 RMSE，均值 ± 样本标准差（ddof=1），n=3。每个数据集单位独立，不能跨数据集直接比较数值大小。

| 数据集 | N | 单位 | 均值基线 | RF | KRR | GraphConv |
|---|---:|---|---:|---:|---:|---:|
| ESOL | 1128 | log10(mol/L) | 2.137 ± 0.016 | 1.190 ± 0.159 | 1.485 ± 0.119 | 1.046 ± 0.106 |
| FreeSolv | 642 | kcal/mol | 3.963 ± 0.473 | 2.061 ± 0.664 | 1.999 ± 0.410 | 2.151 ± 0.232 |
| Lipophilicity | 4200 | logD | 1.169 ± 0.014 | 0.838 ± 0.011 | 0.835 ± 0.016 | 0.704 ± 0.016 |

### 与论文相同模型的描述性比较

| 数据集 | 模型 | 本次测试 RMSE | 论文测试 RMSE | 相对论文均值差 |
|---|---|---:|---:|---:|
| ESOL | RF | 1.190 ± 0.159 | 1.070 ± 0.190 | +11.2% |
| ESOL | KRR | 1.485 ± 0.119 | 1.530 ± 0.060 | -3.0% |
| ESOL | GraphConv | 1.046 ± 0.106 | 0.970 ± 0.010 | +7.9% |
| FreeSolv | RF | 2.061 ± 0.664 | 2.030 ± 0.220 | +1.5% |
| FreeSolv | KRR | 1.999 ± 0.410 | 2.110 ± 0.070 | -5.3% |
| FreeSolv | GraphConv | 2.151 ± 0.232 | 1.400 ± 0.160 | +53.7% |
| Lipophilicity | RF | 0.838 ± 0.011 | 0.876 ± 0.040 | -4.3% |
| Lipophilicity | KRR | 0.835 ± 0.016 | 0.899 ± 0.043 | -7.1% |
| Lipophilicity | GraphConv | 0.704 ± 0.016 | 0.655 ± 0.036 | +7.5% |

比较中的正号表示本次误差更大。原论文与本次超参数、软件、划分不同，因此这些差异不能作算法优劣或统计显著性的因果解释。没有按结果重新调参或挑选好看的种子。

### ESOL 骨架划分扩展

| 模型 | 随机划分 | 骨架划分 |
|---|---:|---:|
| 训练均值基线 | 2.137 ± 0.016 | 2.315 ± 0.000 |
| RF | 1.190 ± 0.159 | 1.691 ± 0.018 |
| KRR | 1.485 ± 0.119 | 2.472 ± 0.000 |
| GraphConv | 1.046 ± 0.106 | 1.370 ± 0.036 |

DeepChem ScaffoldSplitter 是确定性的：三个种子使用同一骨架划分，仅学习器随机性改变。不是三折交叉验证。KRR 在这一测试集上的误差高于训练均值基线，保留该负结果。

### 重复结构与外推限制

- ESOL：1128 条记录，1117 个唯一规范结构，重复结构行 11；三个随机划分的训练/测试相同结构交集数为 [2, 2, 0]。
- FreeSolv：642 条记录，642 个唯一规范结构，重复结构行 0；三个随机划分的训练/测试相同结构交集数为 [0, 0, 0]。
- Lipophilicity：4200 条记录，4200 个唯一规范结构，重复结构行 0；三个随机划分的训练/测试相同结构交集数为 [0, 0, 0]。

未删除原始重复记录，以保持预先确定的全量数据协议。因此随机划分结果不等同于严格新结构外推性能，不能宣称完全没有结构泄漏。骨架扩展单独审计。

## 4. 数据单位错误与纠正

本轮真实测试发现 DeepChem 2.8 的 `load_freesolv` 默认下载 `freesolv.csv.gz`，其 y 已是全数据集 z-score。与原始 `SAMPL.csv` 的 642 行按顺序核对，标准化关系最大偏差仅 2.66e-15，原始总体标准差为 3.8448222046 kcal/mol。把该 y 的 RMSE 标成 kcal/mol，会虚假改善约 3.845 倍。

已停止并排除 `results-remaining` 错误批次。使用原始 `SAMPL.csv` 的 `expt` 列，通过原生 DeepChem CSVLoader 读入，只在训练集拟合标准化。纠正后的实验完整重跑到 `results-corrected`，没有缩小数据或改变模型参数。原日志、原压缩文件和数据纠正说明均保留。详见 `data/freesolv/SOURCE-CORRECTION.md`。

另一个早期错误是元数据读取旧文件名 SAMPL.csv，而原生 2.8 下载文件名已改变。后续对数值本身的交叉检查进一步发现了上述单位问题。两者不能混为同一个错误。

## 5. 固定实验协议与独立审计

- 模型：训练均值基线、ECFP4/RF 500 棵树、ECFP4/KRR（RBF，alpha=0.001，gamma=1/1024）、原生 GraphConv。
- 图模型：75 维原子特征，图卷积 [128,128]，稠密层 256，batch 128，学习率 0.0005，100 epochs，dropout 0，batch normalization。
- 主实验 random 80/10/10，种子 123、456、789。GraphConv 固定最后一个 epoch，不按测试集选点。不做原论文高斯过程超参数搜索。
- DeepChem 2.8.0 / TensorFlow 2.15.1 / Python 3.10.11 / RDKit 2023.9.6。CPU 4 线程，启用 TensorFlow 确定性选项。没有声称使用 GPU。
- `verify_results.py` 不导入训练脚本或其指标函数，从原始 CSV 和每个 predictions.csv 独立重算 RMSE、MAE、R²，检查数据哈希、标签/SMILES 对齐、分区完整性、训练集标准化、有限数值与 100 epoch。
- 26 项专项单元测试通过，覆盖科学协议边界、独立指标计算、FreeSolv 单位交叉核对和大纲 schema。它们不等于 PI-GUI 全仓库测试，亦不能替代失败的真实集成链路。
- 汇总的模型 fit 时长 52.25 分钟；此值包含 GC 的周期验证开销，不含环境安装、所有最终预测、模型/API思考或主代理审阅，不等于任务端到端时长。
- ESOL seed 123 重跑：mean、KRR、GC 逐行预测完全一致；RF 的171行有浮点末位差异，最大绝对差1.78e-15（1128行），不是有实质大小的性能偏移。符合并行浮点求和次序差异的表现，但未独立追踪底层线程求和顺序。不能据此保证跨硬件和跨库版本逐位重现。见 verification/diagnostics.json。

## 6. 两个工具实际测到了什么

| 维度 | Paper2Agent | Paper2Any |
|---|---|---|
| 项目 | jmiao24/Paper2Agent | OpenDCAI/Paper2Any |
| 固定提交 | 8c2d059165ef8cdcb70dbea76655b9c2b55b38e6 | b538531e25798d9b9d41afd5fa93c9222949b5a5 |
| 实测路线 | Paper2Skill：prepare / extract / reuse-review / build / strict verify / 检索 | 原生 outline_agent 与 outline_refine_agent 的 simple mode |
| 输入 | 65页作者稿与已完成的逐页审查记录 | 阅读包正文、真实实验审计结果 |
| 实际输出 | 35文件阅读包，30图片、1个结果CSV | 10页结构化大纲及修订版本 |
| 模型 | Pi 中 DeepSeek V4.1 Flash | DeepSeek V4.1 Flash 真实API，顺序调用 |
| 通过条件 | strict verify，机械完整性、所有页审查、无issues、0过期裁定 | 真实响应、10页schema、无虚构图片引用、修订产生实际变化 |
| 未覆盖 | 完整 Paper2MCP 多代理代码转MCP | MinerU、SAM、图片模型、完整Web UI；原生制片已尝试但失败、未进入导出 |

Paper2Any 回执复测的大纲阶段用时 29.19 秒，修订 14.73 秒。API 模型与 token 回执在 `gui-test/paper2any/outline-observed/api-receipts.json`。首轮观测器挂在未使用的 TextLLMCaller.call，导致回执数组为空；修正到真实调用的 ChatOpenAI.ainvoke 后独立重跑，未覆盖首轮。两轮均保留。组件通过并不自动证明内容科学正确。

另外实际调用了原生 `Paper2PPTFrontendService` 的无图片结构化路线，顺序逐页执行。实际状态：**failed**，处理页数 10，原生导出是否完成：False。完整回执与未修改的模型输出保存在 `gui-test/paper2any/frontend`。检测到默认模板、API失败或截断会明确判为未通过，不把上游返回的 success 单独当作成功依据。

具体失败：20次请求均HTTP 200，10次主题请求的1400 token上限全部耗尽；页面2/4/9的3400 token上限也耗尽，缺失/不完整JSON被上游捕获后替换为默认模板。上游没有按 finish_reason 判失败。测试器原先预期主题缓存只调用一次，实际重复调用10次，因此额外产生请求数不符；即使去掉该计数断言，13次截断与3页模板回退也足以判失败。未通过加大上限、关闭思考或换模型掩盖该默认兼容问题。

主代理核对两轮大纲的关键实验数字均与审计汇总相符；首轮“趋势大体一致”不够严谨，FreeSolv 的GC排序实际劣于RF/KRR。第二轮一页塞入过多要点且保留汇报人XXX占位，不能直接视为最终成稿。这些未修改的上游输出作为测试证据保留，独立说明稿采用经核验的精简叙事。

测试副本的明确补丁：Paper2Agent 的 Windows 包内路径比对使用 `.as_posix()`，修复反斜杠误报；Paper2Any 的 text.py 与 base_agent.py 移除两处明文 key 日志。未向上游提交。仓库 README 将当前开源 Paper2Any 标为 legacy snapshot，本测试不代表其商业托管版本。

主交付 PPTX 使用可编辑原生图表和表格据核验结果制作；没有把该说明稿冒充 Paper2Any 原生导出结果。新增结构化路线的成功/失败独立记录，仍未覆盖 Web UI、MinerU 或图像模型。

## 7. Pi GUI 可视化验收

- **通过**：模型配置与真实连通。模型路由显示 DeepSeek V4.1 Flash；GUI 最小真实请求返回连通已验证，deepseek-flash，9373 ms。截图01。
- **通过**：技能快捷补全。输入 /skill:paper2agent 出现真实技能选项，Tab 确认并保留参数输入位置。
- **通过**：Enter 发送与技能正文折叠。按 Enter 发出实际任务，技能显示为可展开摘要，没有铺满正文。
- **通过**：运行中任务和工具回执。左侧任务在回合结束前可见，read/bash 调用持续显示；输入框与停止按钮始终保留。截图02。
- **通过**：Paper2Agent 阅读包运行。Pi 在GUI内执行原生转换流程；35文件，strict verify 为 reviewed_with_limitations，mechanical_ok=true、issues=[]、0过期裁定。
- **通过**：侧栏开合与分栏拖拽。关闭并重新展开左栏；将检查器左界从约1127px拖至923px，右栏实际变宽。宽布局存在单独记录的顶部重叠问题。
- **通过**：窄中栏更多菜单。约650px中栏下控件收进更多；菜单含新建会话、Session复制、准确模型配置、思考级别与检查器。截图04。
- **通过**：Session地址复制入口。在更多菜单点击复制，界面明确提示 Session 地址已复制 · 01a0b4a4；未另行读取系统剪贴板。
- **通过**：输入区拖高与恢复。拖动输入区上沿将高度从约112px增至258px，双击手柄恢复自动高度。截图05。
- **通过**：Paper2Any真实大纲生成与修订。Pi 在 GUI 内执行两轮原生组件测试；第二轮保留两条真实模型回执（deepseek-flash、finish_reason=stop），原始与修订大纲均为10页且内容确实变化。
- **未通过**：Paper2Any原生结构化制片。20次真实API调用，10次主题均截断、3次页面截断并回退；保存10页原始输出和失败结果，未进入PPT导出，不把模板当成生成成功。
- **通过**：右侧Markdown预览与文件切换。下拉框按显示时间由新到旧列出stage1、stage2报告及PDF；实际由MD切PDF再切stage2，右栏从标题滚动至审计表，独立滚动且占满可用高度。截图06、07。
- **部分通过**：65页PDF预览。65页PDF可见正文、缩略图、页数与缩放；内置阅读器的可访问性树同时提示无法下载文本提取文件。视觉显示可用，不宣称辅助技术读取全部正常。
- **未通过**：长会话完整状态刷新。约350个持久化事件的长会话结束后，出现Electron contextBridge recursion depth exceeded；再次Enter提交被Pi接收但状态刷新失败，流式工具仍继续。截图09。
- **通过（有限范围）**：右侧PPTX预览。Pi 只读核对最终审定版 445239 字节及完整 SHA-256 与回执一致；点击助手输出文件的预览按钮，右栏识别16页，实际查看封面、第2页原生表格及第7页原生柱状图。下一页和页码下拉跳转有效。100%在约720px右栏会横向裁切，手动缩至70%后整页可见；未声称像素级保真。截图08。
- **通过**：检查器关闭后重开。点击关闭检查器，中栏扩展占据宽度；点击顶部检查器图标重新打开，仍显示审定版PPTX第7页及70%缩放，没有丢失当前预览选择。

### 已观察到的问题或限制

- 长回合中统计检查器保留上一刷新值；发送补充指令触发刷新后从0.059M活动上下文/1.09M缓存读取更新为0.079M/5.85M。同一回合的新工具消息不持续刷新面板，左侧消息计数也有同样现象。
- 左侧栏收起且中栏约1120px时，顶部会话快捷控件与长项目名出现重叠；缩窄中栏后更多菜单可正常访问。截图03。
- 停止按钮中止了当前Pi等待工具，但代理以nohup启动的科学后台子进程继续运行；主代理核对命令行后按确定PID停止了该错误批次，未影响其他进程。
- 模型配置页点击当前选中的历史任务未返回会话，须从PI原生工作台的当前会话入口返回。该导航路径已如实记录，未修改业务代码。
- 绝对路径用Markdown粗体包装时未识别为会话文件；同一路径用行内代码正常。工具write成功本身也不会被当前文件扫描器发现。
- 长会话全量bootstrap跨Electron contextBridge时发生递归深度错误，未修复，不能将长任务稳定性判为通过。
- PPTX默认100%预览没有适应窄右栏，约720px宽度时表格末列被裁切；手动缩至70%才整页可见。缩放同时缩小内嵌页码控件，低倍率下控件偏小。
- 自动压缩、全部模型、跨平台安装、完整Paper2MCP以及Paper2Any多模态Web工作流不在本次已通过范围。

首轮401来自本测试生成器的旧式环境变量写法，而非用户原有key失效。修正为 `${DEEPSEEK_API_KEY}`，在GUI通过真实连接测试后重试。原有失败会话记录保留。

## 8. 文件索引

- `deliverables/MoleculeNet-复现与Pi工具实测-审定版.pptx`：最终中文说明演示文稿；不带“审定版”的文件为 Pi 阶段性生成记录，保留以核对历史回执。
- `verification/summary.csv`：全模型汇总。`runs.json`：48个运行的独立验收。
- `results/esol`、`results-corrected`：有效实验的指标、预测、分区与曲线。
- `gui-test/paper2agent/moleculenet-paper`：Pi GUI 实际构建的阅读包。
- `gui-test/paper2any`：原始和修订大纲及API回执。
- `gui-test/evidence`：真实界面截图。`gui-test/session-audit.json`：最小化的会话执行审计。
- `benchmark.py`、`experiment.json`、`verify_results.py` 与 `test_*.py`：可检查的科学代码与校验。

## 9. 复运行说明

本次实际验证平台为 Windows，本机所用精确依赖见 requirements.txt 及环境冻结清单。未测试 macOS/Linux 安装流程。不要覆盖已有 metrics.json，脚本会拒绝。完整重跑可用新输出目录，之后更新验证脚本中的数据根目录映射。

```powershell
.\.venv\Scripts\python.exe benchmark.py --output results-new
.\.venv\Scripts\python.exe -m pytest test_benchmark.py test_verify_results.py test_source_data.py test_outline_validation.py -q
```

Paper2Any 使用独立 Python 3.12 环境，避免其现代依赖覆盖科学环境。脚本路径默认指向本次固定提交的本机临时克隆；移机时需要检出相同提交并更新 REPO 路径。密钥仅通过继承环境变量传入。Pi GUI 是本项目现有单一 Pi 核心，没有增加第二套核心。

## 10. 来源与许可

- [MoleculeNet 期刊全文](https://pmc.ncbi.nlm.nih.gov/articles/PMC5868307/)，Wu et al.，CC BY-NC 3.0；保留图表署名，阅读包原图不得脱离其许可再分发。
- [DeepChem 2.8.0](https://github.com/deepchem/deepchem/tree/2.8.0)，原生科学实现。
- [FreeSolv 原始数据库](https://github.com/MobleyLab/FreeSolv)。
- [Paper2Agent](https://github.com/jmiao24/Paper2Agent)。
- [Paper2Any](https://github.com/OpenDCAI/Paper2Any)。
- [DeepSeek V4.1 发布说明](https://api-docs.deepseek.com/news/news260910/)。
