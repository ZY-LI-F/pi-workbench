# PI Stage 2 报告：48 项独立审计、单元测试与 Paper2Any 原生组件实测

生成时间：2026-09-18（本机时间）
模型：DeepSeek V4.1 Flash（同一模型，未切换）
子代理：未开启（全程主代理顺序执行）
密钥：未打印、未写入文件（脚本只从继承环境读取 `DEEPSEEK_API_KEY`）

本报告只记录**已经实际执行**的步骤与真实产物。所有实验结果均为真机运行，未使用模拟数据、未调参、未缩小数据。

---

## 1. 数值实验完成状态

### 1.1 数据集与来源

| 数据集 | 源文件 | 行数 | 任务 | 单位 | 源文件 SHA-256 |
| --- | --- | --- | --- | --- | --- |
| ESOL | `data/esol/delaney-processed.csv` | 1128 | measured log solubility in mols per litre | log10(mol/L) | `8c06a76f…602f189` |
| FreeSolv | `data/freesolv/SAMPL.csv`（原始） | 642 | expt | kcal/mol | `ab5895d9…f9dcb72` |
| Lipophilicity | `data/lipophilicity/Lipophilicity.csv` | 4200 | exp（logD） | logD | 见 `verification/summary.json` |

- FreeSolv 使用的是**原始 SAMPL.csv 的 expt**（物理单位 kcal/mol），不是 DeepChem 2.8 预标准化的 `freesolv.csv.gz`（后者为全数据集 z-score）。该单位错误已单独记录于 `data/freesolv/SOURCE-CORRECTION.md`。
- 错误批次 `results-remaining/` 已排除，仅保留供诊断，不纳入任何统计。

### 1.2 完成矩阵

- ESOL：`results/`（保留，未覆盖），random + scaffold × 3 种子 × 4 模型 = 24 次。
- FreeSolv / Lipophilicity：`results-corrected/`，random × 3 种子 × 4 模型 = 24 次。
- 合计 **48 次**，全部真实完成。`results-corrected/completed.json` 记录 24 次、`elapsed_seconds ≈ 3129`；无 `failure.json`。

### 1.3 独立审计结果（`verify_results.py`）

命令：`.venv/Scripts/python.exe verify_results.py`
该审计**不导入** `benchmark.py`、TensorFlow 或 DeepChem，独立从原始数据 + 保存的预测重算指标。

- `status`: **`verified`**
- `total_runs`: **48**
- 退出码：0
- 审计范围：原始数据逐行对齐、划分覆盖（每行恰好一次）、仅训练集拟合标准化、指标有限性、残差恒等式、GC 训练 100 epoch 检查。
- 产物：`verification/summary.json`、`verification/summary.csv`、`verification/runs.json`、`verification/split-audits.json`。

### 1.4 48 次聚合结果（本次实测，不是论文数值）

随机 80/10/10 划分，样本标准差 `ddof=1`（n=3）。单位与论文 Table 8 一致。

| 数据集 | 模型 | 本次 Test RMSE（均值 ± 样本 SD） | 论文 Table 8 原始值（供对照） |
| --- | --- | --- | --- |
| ESOL | mean 基线 | 2.137 ± 0.016 | —（无） |
| ESOL | RF | 1.190 ± 0.159 | 1.07 ± 0.19 |
| ESOL | KRR | 1.485 ± 0.119 | 1.53 ± 0.06 |
| ESOL | GC | 1.046 ± 0.106 | 0.97 ± 0.01 |
| FreeSolv | mean 基线 | 3.963 ± 0.473 | —（无） |
| FreeSolv | RF | 2.061 ± 0.664 | 2.03 ± 0.22 |
| FreeSolv | KRR | 1.999 ± 0.410 | 2.11 ± 0.07 |
| FreeSolv | GC | 2.151 ± 0.232 | 1.40 ± 0.16 |
| Lipophilicity | mean 基线 | 1.169 ± 0.014 | —（无） |
| Lipophilicity | RF | 0.838 ± 0.011 | 0.876 ± 0.040 |
| Lipophilicity | KRR | 0.835 ± 0.016 | 0.899 ± 0.043 |
| Lipophilicity | GC | 0.704 ± 0.016 | 0.655 ± 0.036 |

ESOL 骨架划分诊断（额外，非论文 Fig.12 原协议）：mean 2.315；RF 1.691 ± 0.018；KRR 2.472；GC 1.370 ± 0.036。

观察（仅陈述本次数据）：

- 三个数据集的趋势大体与论文一致：GC 在 Lipophilicity 最好；FreeSolv 上 GC 误差偏高。
- 绝对数值与标准差与论文存在差异。ESOL 的 GC 本次 1.046 对论文 0.97；FreeSolv 的 GC 本次 2.151 对论文 1.40，差异明显。
- FreeSolv 的 RF 样本标准差很大（0.664），源于 3 个种子的划分不同。
- 重复性检查（`repeatability_esol_seed123`）：mean / KRR / GC 的预测字节级一致；RF 不一致（并行随机森林的固有非确定性），已如实记录。
- 上述均为**本次现代环境**结果，**不是**论文原始数值，也不能据以认定论文正确或错误。

### 1.5 与论文的已知偏差（`verification/summary.json` 的 `deviations`）

- 现代 DeepChem 2.8.0 与 TensorFlow 2.15.1，非 2017 原始环境。
- 无高斯过程超参优化。
- 论文的原始种子值、精确划分索引**在本次工作中未被恢复**；本次使用显式种子 123/456/789。
- 仅 3 个数据集 + 3 个学习模型 + 1 个训练均值基线，非全部 17 个数据集/全部算法。
- ESOL 骨架扩展是附加诊断，不是 Fig.12 原协议。
- `ScaffoldSplitter` 是确定性的；其三种子只改变学习器随机性，不改变骨架划分。
- 论文 SD 定义未被独立复原；本次使用样本标准差 ddof=1。

---

## 2. 单元测试

命令：`.venv/Scripts/python.exe -m pytest -q test_benchmark.py test_verify_results.py test_source_data.py test_outline_validation.py`

结果：**26 passed in 3.89s**（4 个文件）。

| 测试文件 | 作用 |
| --- | --- |
| `test_benchmark.py` | 划分覆盖/泄漏/空集、指标尺度、有限性、结构重叠 |
| `test_verify_results.py` | 审计脚本自身的边界 |
| `test_source_data.py` | FreeSolv 原始物理源与上游预标准化源的差异回归（642 行、std≈3.845、最大绝对差 < 1e-12） |
| `test_outline_validation.py` | Paper2Any 大纲输出的结构边界（页数、字段、禁止虚构图像引用） |

（本阶段共执行两次上述四文件套件：一次在数值审计后、一次在 Paper2Any 文本组件实测后，两次均为 **26 passed**。）

`pytest --collect-only` 确认 collect 数为 26。

---

## 3. Paper2Any 原生组件实测

使用独立环境 `.venv-paper2any/Scripts/python.exe`（Python 3.12.13）。上游仓库固定提交 `b538531e25798d9b9d41afd5fa93c9222949b5a5`（已核对 `git rev-parse HEAD`）。顺序调用库，不开启子代理。密钥只从继承环境读取，未打印、未落盘。

### 3.1 文本大纲与修订（`test_paper2any_live.py`）——**通过**

本步骤有两个尝试，如实区分：

**尝试 A（首轮，输出保留在 `gui-test/paper2any/`）**

- 阶段：上游 `outline_agent`（simple 模式）+ `outline_refine_agent`（simple 模式）。
- 结果：**`status: passed`**，10 页，模型 `deepseek-flash`。
- 耗时：outline 约 27.5s，refine 约 25.8s；修订前后均 10 页且内容变化。
- **已知问题：`api_calls` 为空数组。** 原因已查明：当时的观测钩子挂在 `TextLLMCaller.call`，而上游 simple 模式经由 `create_llm().ainvoke` 直接调用，**未走到该路径**——**并非模型没有发起请求**（真实调用已由耗时与上游日志证实）。该问题来自我提供的观测脚本，不是上游或模型的问题。
- 产物：`gui-test/paper2any/{outline-original.json, outline-refined.json, outline.md, result.json}`。

**尝试 B（修正观测后重跑，输出在 `gui-test/paper2any/outline-observed/`，首轮未被覆盖）**

- 已修正 `test_paper2any_live.py`：改为观察原生 `ChatOpenAI.ainvoke`，并要求**两次真实完成回执**（`finish_reason == stop` 且 `response_model == deepseek-flash`）；未满足即判定失败。
- 命令：`.venv-paper2any/Scripts/python.exe test_paper2any_live.py --output gui-test/paper2any/outline-observed`，日志单独保存为 `gui-test/paper2any-live-observed.log`。
- 前置门槛：脚本先校验 `verification/summary.json` 必须为 `status=verified, total_runs=48`，否则拒绝执行（已满足）。
- 结果：**`status: passed`**，10 页，修订前后确实不同（`changed: True`）。
- **两次真实 API 回执（`outline-observed/api-receipts.json`）**：
  - 第 1 次（outline）：`requested_model=deepseek-flash`，`response_model=deepseek-flash`，`finish_reason=stop`，tokens：prompt 25941 / completion 5973（其中 reasoning 4462）/ total 31914。
  - 第 2 次（refine）：`requested_model=deepseek-flash`，`response_model=deepseek-flash`，`finish_reason=stop`，tokens：prompt 27062 / completion 3495（其中 reasoning 1685）/ total 30557。
  - 仅记录允许的模型、`finish_reason` 与 token 信息，未记录 prompt、请求头或任何凭证。
- 产物：`gui-test/paper2any/outline-observed/{outline-original.json, outline-refined.json, outline.md, result.json, api-receipts.json}`。
- 已核实输出区分了“论文原始基准（Table 8）”与“本次复现”，并包含 RMSE 越低越好、三种子、无超参搜索、不得据此认定临床有效等边界说明。

已知局限（两轮共有）：

- 这是**组件级**真实 API 测试，不是完整 Paper2Any Web 应用或多模态流水线。
- 未使用图像模型、MinerU 或 SAM 服务；输入是用 Paper2Agent 提取的已审查文本。
- 结构合法不等于科学准确，仍需主代理内容复核。

### 3.2 原生可编辑幻灯片服务与 PPTX 导出（`test_paper2any_frontend.py`）——**失败（如实保留）**

- 调用：`fastapi_app.services.paper2ppt_frontend_service.Paper2PPTFrontendService.generate_slides`，逐页顺序调用 10 页，随后由上游 `run_paper2ppt_structured_export_cli.ts`（PptxGenJS）导出。
- 结果：**`status: failed`**，`exported: false`。退出码 1。
- 触发失败的具体证据（来自 `frontend/api-receipts.json`，实际共 20 次请求，均为 `status 200`、`response_model=deepseek-flash`）：
  1. **10 次主题（deck theme）调用 `requested_max_tokens=1400`，全部 `finish_reason=length`**，无一完成，日志出现 10 次 “Failed to generate deck theme”。
  2. **10 次页面调用 `requested_max_tokens=3400`，其中 3 次 `finish_reason=length`**（对应第 2、4、9 页），触发上游默认模板回退（`fallback: true`，原始 AI JSON 为解析错误）；其余 7 次为 `stop`。
  3. **默认模板兜底**：第 2、4、9 页按 raw 标记 `fallback: true`；上游日志另显示第 1、3、8 页 “Falling back to default slide”。脚本据此判定不接受兜底模板为通过。
  4. **输出截断**：`reasoning_tokens` 占满额度导致 JSON 不完整（如某 3400 上限调用 reasoning 占满 3400）。
  5. **调用次数不符**：实际 20 次请求，脚本预期 11 次（1 次主题 + 10 次页面）。
- 产物（失败证据，已保留）：
  - `gui-test/paper2any/frontend/result.json`
  - `gui-test/paper2any/frontend/api-receipts.json`（逐次收据，含 model / status / usage / finish_reason，无密钥）
  - `gui-test/paper2any/frontend/page-01..10.raw.json`、`slides.json`、`theme.json`
  - 上游临时工作目录：`C:\Users\qq108\AppData\Local\Temp\stella-paper2any-20260918\outputs\stella-moleculenet-20260918`
- **未生成任何 PPTX**（已确认项目内无新 PPTX 文件）。

结论：**不能称为成功，也不是全流程成功**。未更换模型、未放宽限制、未伪造输出。失败原因是上游服务在该模型/参数下的推理 token 截断：**10 次主题调用均达到 1400 上限**，页面调用中第 2/4/9 页达到 3400 上限并回退默认模板。这是真实上游行为，本次未修改上游、也未重跑其 10 页；制版与可视化 QA 由主代理继续。

---

## 3.3 独立说明稿 PPTX（`build/build_deck.mjs`，非 Paper2Any 原生导出）——**已生成**

- 脚本读取已核验 48 组结果（`verification/summary.json`）、含真实回执的 `gui-test/paper2any/outline-observed/` 与 frontend 失败证据，生成 **16 页中文可编辑 PPTX**。
- 运行：`C:/Users/qq108/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe build/build_deck.mjs`；需设 `RUNTIME_NODE_MODULES` 指向运行时 node_modules（first-party import 子进程要求）。
- **明确声明：这是独立制版脚本，不是 Paper2Any 原生 PPT 导出。**
- 产物：`deliverables/MoleculeNet-复现与Pi工具实测.pptx`（16 页，`byteCount=445262`，`finalSha256=28fc33ae…560956`）。
- 验证回执（`build/build-result.json`）全部通过：packageIntegrity 0 findings；presentationLayout 0 findings（16 页，13.333×7.5 英寸，字体 Noto Sans SC）；firstPartyImport passed（16 页）；nativeTableArithmetic 0 findings；nativeChartTitles 0 findings；nativeChartValidation passed；chartDataPackaging 将 5 个原生图表转为字面量快照（slides 7–11）。
- 制版过程中由主代理修正了脚本两处真实错误（均已保留原始错误并修正脚本，未更换制版库）：
  1. `layoutArgs` 缺少与 `requiredNativeTableOwnerSlides=[2,5,6,12,13]` 对应的 `--require-native-table-slide` 策略 → 报错 “Every source-required native-table owner must have exactly one validation policy”；补上 5 个标志后通过。
  2. 图表值使用完整双精度 float（16 位有效数字），超出 Excel 字面量快照的 15 位上限 → 报错 `chart-data-snapshot`：“Excel cannot preserve the literal chart's numeric precision”；增加 `q()` 将值归入 12 位有效数字（细于显示的 3 位小数）后通过。
- 一次重跑曾出现原生段错误（退出码 139），清理候选文件后重跑成功；属瞬时原生崩溃，已如实记录。
- 预览图：`build/slides/slide-01..16.png`。

---

## 4. 三层交付物区分

| 层 | 产物 | 状态 |
| --- | --- | --- |
| 数值复现 | `results/`（ESOL 24）、`results-corrected/`（24）、`verification/` | 48/48 完成，独立审计 `verified` |
| Paper2Agent 阅读包 | `gui-test/paper2agent/moleculenet-paper` + 评审目录 | 构建完成，严格验证 `reviewed_with_limitations` |
| Paper2Any 输出 | `gui-test/paper2any/`（首轮文本大纲/修订）、`gui-test/paper2any/outline-observed/`（修正观测后重跑）、`gui-test/paper2any/frontend/`（失败证据） | 文本大纲/修订两轮均通过（第二轮含 2 条真实回执）；原生幻灯片服务失败，无 PPTX |
| 独立说明稿 | `deliverables/MoleculeNet-复现与Pi工具实测.pptx` | 16 页可编辑 PPTX，全部验证门通过；**不是 Paper2Any 原生导出** |

---

## 5. 明确限制（不得省略）

- 数值复现为**现代环境局部子集**（3 数据集 / 4 模型 / 3 种子），**不是** 2017 环境数值复刻，也**不是**论文 17 个数据集完整复现。
- 论文原始种子与精确划分索引在本次工作中未恢复。
- Paper2Agent 阅读包的评审来自当前 Codex 主代理的可视检查（复用既有逐页审阅），不是人类人工审查，也不是多代理独立认证；状态为“已审查并保留限制”。
- Paper2Any 只做了文本组件与原生幻灯片服务的顺序库调用，**不是**完整多模态平台测试；幻灯片服务本次**失败**，未产出 PPTX。
- `deliverables/MoleculeNet-复现与Pi工具实测.pptx` 由**独立制版脚本**生成，不是 Paper2Any 原生导出；通过的是结构/几何/字体/图表验证，不等于内容经过 PowerPoint 原生渲染或人工逐页审阅。
- 任何结果都不能用于临床有效性或药物疗效声明。

---

## 6. 供预览的绝对路径

- 本报告：`C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918\gui-test\pi-stage2-report.md`
- Stage 1 报告：`C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918\gui-test\pi-stage1-report.md`
- 独立审计摘要：`C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918\verification\summary.json`
- 审计明细表：`C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918\verification\summary.csv`
- 已修正数值结果：`C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918\results-corrected`
- ESOL 数值结果：`C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918\results`
- Paper2Any 文本大纲结果（尝试 A）：`C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918\gui-test\paper2any\result.json`
- Paper2Any 文本大纲结果（尝试 B，含 2 条真实回执）：`C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918\gui-test\paper2any\outline-observed\result.json`
- Paper2Any 幻灯片失败证据：`C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918\gui-test\paper2any\frontend\result.json`
- 阅读包严格验证报告：`C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918\gui-test\paper2agent\moleculenet-review\verification.json`
- 独立说明稿 PPTX：`C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918\deliverables\MoleculeNet-复现与Pi工具实测.pptx`

## 7. 当前 Codex 主代理的最终复核补记

以上为 Pi 阶段性执行报告，保留其原始叙述以便核对历史。以下明确两个容易误读的范围：

- 3.2 中“随后由上游……导出”是脚本计划路径，**实际在制片验证失败后终止，未执行原生导出器**。“未生成任何 PPTX”只针对 Paper2Any 原生路线，不能理解为独立制版后整个项目仍没有 PPTX。
- 3.3 的制版脚本由 Codex 主代理准备，Pi 在本会话执行时修改了表格验证参数和图表数字精度，重试后成功；主代理随后完成逐页审阅和明确失败边界的文案修订。不是 Paper2Any 全流程成功，也不是完全无主代理准备的自主论文复现。

最终交付为 `deliverables/MoleculeNet-复现与Pi工具实测-审定版.pptx`，445239 字节，SHA-256 为 `ea76d5936698bc7a5d261731d30fc7d70a793ada60a8f5e123f641fb9646a353`。Pi 已通过只读任务核对这两个值。GUI 验收已完成但包含明确失败，见 `gui-test/acceptance.json`；最新完整报告见 `REPORT.zh-CN.md`。旧版文件保留为阶段性证据。
