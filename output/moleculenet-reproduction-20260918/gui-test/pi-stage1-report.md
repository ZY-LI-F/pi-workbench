# PI Stage 1 报告：Paper2Agent 阅读包、Table 8 检索与 MoleculeNet 数值复现

生成时间：2026-09-18（本机时间；数值训练于 22:34 完成，审计与测试于 22:35 完成）
模型：DeepSeek V4.1 Flash（同一模型，未切换）
子代理：未开启（全程主代理顺序执行）

本报告只记录**已经实际执行**的步骤与真实产物。数值部分最终共 48 次真实运行已完成，并已通过独立审计；与论文原始数值的对照及偏差说明见下文与分析详见 `gui-test/pi-stage2-report.md`。

---

## 0. 任务范围与边界

- 论文：Wu et al., *MoleculeNet: a benchmark for molecular machine learning*，Chemical Science 9, 513–530 (2018)，PMID 29629118，DOI 10.1039/C7SC02664A。
- 本机使用的是 **65 页作者稿（arXiv:1703.00564v3）**，不是出版社排版 PDF，也不是出版社 Supplementary Information。
- 所有工作限定在当前项目目录 `C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918`，未修改 GUI 业务代码、未推送 GitHub、未打印或保存任何密钥。
- 复现范围是**期刊 Fig.12（即作者稿 Fig.13）**所选模型中的一个**子集**：3 个数据集、4 个模型（mean 训练均值基线、RF、KRR、GC）、3 个随机种子、80/10/10 划分。**不是**论文全部 17 个数据集的完整复现。

---

## 1. Paper2Agent（Paper2Skill 路线）阅读包构建与严格验证

### 1.1 使用的工具与路线

- 路线：**Paper2Skill**（仅阅读包），**不使用 Paper2MCP**。
- 工具：技能原生脚本 `gui-test/pi-agent/skills/paper2agent/paper2skill/scripts/paper_bundle.py`。
- 运行环境：`uv run --python 3.12`（uv 0.11.7，Python 3.12 可用）。技能副本中已修正 Windows 路径兼容问题。

### 1.2 实际执行的命令序列

在新评审目录 `gui-test/paper2agent/moleculenet-review` 中执行：

1. `prepare`：以 `sources/moleculenet-author-manuscript.pdf` 为 main，绑定 name/title。
2. `extract`：逐页解析 65 页，生成页级评审脚手架。
3. `reuse-review --from-work review`：源文件 SHA-256 与既有评审目录**逐字节一致**，因此复用逐页评审决定。
4. `review-aid`：生成联系表和评审队列（65 页，22 条队列项）。
5. `build --require-reviewed`：在 `gui-test/paper2agent/moleculenet-paper` 生成最终阅读包。
6. `verify --strict`：严格验证。

### 1.3 源一致性证据

- 原始 PDF SHA-256：`a017e94a…cae3701`
- `reuse-review` 记录的导入来源 SHA-256：`a017e94ab6a9b3165a99035b4839a10646e07f632f9406de98dd4c220cae3701`（与原始 PDF 相同，属同一批源字节）
- 复用 provenance 文件：`gui-test/paper2agent/moleculenet-review/review-import.json`

### 1.4 严格验证结果（真实报告，非声明）

`gui-test/paper2agent/moleculenet-review/verification.json`：

- `status`: **`reviewed_with_limitations`**（译为“已审查并保留限制”，属已通过的 Reviewed 状态；严格验证退出码 0）
- `mechanical_ok`: `true`
- `all_sources_agent_reviewed`: `true`
- `issues`: `[]`
- 文档 `s001-moleculenet-author-manuscript`：`all_pages_agent_reviewed = true`，`applied_adjudications = 6`，`stale_adjudications = 0`
- 资产检查：31 项，全部 `matches_source_conversion = true`

产物路径：

- 阅读包：`gui-test/paper2agent/moleculenet-paper`（35 个文件：`SKILL.md`、`references/{index,paper,supplement}.md`，`assets/{figure,table,supp_figs,supp_table}`）
- 外部评审与验证：`gui-test/paper2agent/moleculenet-review`

### 1.5 保留的既有评审记录与限制（未伪造新审查）

- 既有根目录阅读包 `moleculenet-paper` **未被覆盖**（构建时间保持 21:14，新包 21:33）。二者内容经 `diff -rq` 校验为一致，源与评审决定均来自同一批已逐页审查的记录。
- 本次**没有**新增独立审查：复用的是此前 65 页的逐页审阅结论。该逐页审阅由**当前 Codex 主代理的可视检查**完成，**不是人类人工审查**；也未声称多代理独立验证。
- 既有 6 条 adjudication（页码 20、36、62、65）原样保留，全部指纹匹配、无过期项。示例：第 20 页 `ANI-1` 后接上标 71 被解析器合并为 `-171`；第 36 页 `±1.5 kcal/mol` 被独立解析器拆分。均为**解析器差异**，不是科学数值改动。
- 限制说明（写在 `references/paper.md` 的 Conversion notes 中）：
  - Table 1–7、9–13 以源图保留（合并单元格、数学排版、代码标识符无法可靠转 CSV）；Table 8 为经验证的 CSV。
  - 公式保留为源图；正文可能保留作者名重音/行内数学排版的不完美；精确排版以原稿为准。
  - 跨页段落已按可视化检查重新拼接；浮动图表按阅读顺序前移而非删除；原始数值未改动。

---

## 2. 从新阅读包回答的问题

### 2.1 作者稿 Table 8 中 Graph Convolution（GC）在三数据集的 Test RMSE

（说明：本节数值均为**论文原始数据**，不是本次计算；本次计算见第 3 节。）

数据来源：`gui-test/paper2agent/moleculenet-paper/assets/table/table-8.csv` 以及 `references/paper.md`（Table 8 标题：*ESOL, FreeSolv, Lipophilicity Performances (Root-Mean-Square Error)*）。

| 数据集 | 模型 | Test RMSE（均值 ± 标准差） | 单位 |
| --- | --- | --- | --- |
| ESOL | GC | **0.97 ± 0.01** | logS（log 溶解度，mol/L）；RMSE 单位为 log 单位 |
| FreeSolv | GC | **1.40 ± 0.16** | kcal/mol |
| Lipophilicity | GC | **0.655 ± 0.036** | logD（pH 7.4） |

补充说明：

- 表列同时给出 Training RMSE 与 Validation RMSE（如 ESOL GC 训练 0.43±0.20、验证 1.05±0.15），上表只列问题所问的 Test RMSE。
- 单位依据阅读包内多处文字佐证：ESOL 附录写“RMSE in logS (log solubility in mol per litre)”；FreeSolv 写“kcal/mol”且“free energy values ranging from −25.5 to 3.4 kcal/mol”；Lipophilicity 定义为“octanol/water distribution coefficient (logD at pH 7.4)”。
- Table 8 标题明确评估指标为 RMSE（Root-Mean-Square Error），Fig.13 caption 也注明“evaluated by RMSE on random split”。

### 2.2 这是原论文数据，不是本次计算

上述 0.97±0.01 / 1.40±0.16 / 0.655±0.036 是**作者稿 Table 8 报告的原始基准数值**，来自论文，不是本次在本机计算的结果。本次实际实验（见第 3 节）使用现代 DeepChem 2.8.0 / TensorFlow 2.15.1 环境、新的随机种子，其结果与论文数值不是同一批数据，不能等同。

### 2.3 作者稿 Fig.13 与期刊版本 Fig.12 的编号差异

- 本次源 PDF 是**作者稿（arXiv v3，2018-10-26，含附录，65 页）**。阅读包 Conversion notes 明确记录：“Figure numbering differs: manuscript Figure 13 corresponds to journal Figure 12.”
- 因此：**作者稿 Figure 13 = 期刊版 Figure 12**。两者内容相同——物理化学任务（ESOL、FreeSolv、Lipophilicity，各 8 个模型，random split，RMSE）的基准性能对比；caption 中 “lower value indicates better performance (to the right)” 亦一致。
- 编号偏移的原因是作者稿比期刊排版多出原始 Figure 12（FreeSolv 训练集规模曲线“Out-of-sample performances with different training set sizes on FreeSolv”）。作者稿正文第 361 行“Figure 13 and Table 8 presented performances on predicting these properties”对应的正是期刊 Fig.12。引用该图时应注明所用编号体系，避免与期刊版混淆。

---

## 3. 数值复现执行状态（进行中）

### 3.1 ESOL（已完成，保留）

- 结果目录：`results/`（**保留，不覆盖**）。
- 已完成：ESOL 的 random 与 scaffold 两种划分 × 3 种子 × 4 模型 = **24 次已完成**（`find results/esol -name metrics.json` 计数为 24）。
- 这些结果本次**未重跑、未改动**。

### 3.2 FreeSolv / Lipophilicity（进行中）

- 目标输出目录：`results-corrected/`（random × 3 种子 × 4 模型 = 24 次待完成）。
- 运行方式：现有 `.venv/Scripts/python.exe benchmark.py --datasets freesolv lipophilicity --splits random --seeds 123 456 789 --models mean rf krr gc --output results-corrected`，`PYTHONIOENCODING=utf-8 PYTHONUTF8=1`。
- 协议保持固定：80/10/10、ECFP r=2/1024、GC 特征 75、RF 500 树、KRR(rbf, α=1e-3, γ=1/1024)、GC [128,128]/256、batch 128、lr 5e-4、100 epoch、无 HPO、无测试集选型。**未调参、未缩小数据、未生成模拟数据。**

### 3.3 关键更正：FreeSolv 源标签单位错误（已排除错误批次）

- 已发现并证实：DeepChem 2.8.0 `load_freesolv` 的 `freesolv.csv.gz` 中 `y` 是**全数据集 z-score**，不是 kcal/mol。
- 与原始 `SAMPL.csv` 642 行逐项对应：原始 `expt` 均值 −3.8030062305295944，总体标准差 **3.844822204602953**；`(expt − mean)/std` 与压缩 `y` 最大绝对差约 2.66e-15。
- 若直接使用会制造约 3.845 倍的**虚假性能改善**。
- 处理：停止并**排除**最初写入 `results-remaining/` 的错误批次（保留其日志与结果仅供诊断，不纳入任何最终统计）；`benchmark.py` 已修正为使用原始 `SAMPL.csv` 的 `expt` + DeepChem 原生 `CSVLoader`，其余协议不变。更正记录见 `data/freesolv/SOURCE-CORRECTION.md`。
- 更正后 `results-corrected/freesolv/data-audit.json` 显示：`tasks=["expt"]`、`unit="kcal/mol"`、`data_file=data\freesolv\SAMPL.csv`、`source_label_mean=-3.803…`、`source_label_std=3.8448…`，物理单位恢复正确。

### 3.4 完成计数（训练已于 2026-09-18 22:34 全部结束）

- `results-corrected/run.log` 中 `"complete"` 计数：**24 / 24**（全部完成）。
- 无 `failure.json`；无失败记录。
- `results-corrected/completed.json`：`runs = 24`，`elapsed_seconds ≈ 3129`，`config_sha256 = 976ab4c8…`（与 ESOL 批次一致）。

**状态标记：数值训练已完成。独立审计与单元测试均已于 22:35 执行并通过，详见 `gui-test/pi-stage2-report.md`。**

---

## 4. 后续执行状态（已在 Stage 2 完成）

1. `results-corrected` 的 24 次实验已全部真实结束（共 48 次与 ESOL 合计）。
2. 已用 `.venv/Scripts/python.exe` 运行 `verify_results.py`：**`status: verified`，`total_runs: 48`**，退出码 0。
3. 已运行四个 pytest 文件（共 **26 项**）：**26 passed**。
4. 已用独立 `.venv-paper2any/Scripts/python.exe` 运行 `test_paper2any_live.py`：文本大纲/修订**通过**（10 页真实输出）；`test_paper2any_frontend.py`：**失败**（上游默认模板兜底 + 输出截断，无 PPTX）。
5. 完整记录见 `gui-test/pi-stage2-report.md`。

---

## 5. 明确限制（不得省略）

- 阅读包为**已审查并保留限制**（`reviewed_with_limitations`，严格验证通过）；其评审标志来自先前由当前 Codex 主代理可视检查完成的逐页审阅的复用，不等同于人类人工审查或多代理独立认证。
- Table 1–7、9–13 为源图，不能全文检索；引用其单元格需人工核对原图。
- 数值复现为**现代环境**（DeepChem 2.8.0 / TF 2.15.1）下的局部子集，**不是** 2017 年原始执行环境的数值复刻，也不是论文 17 个数据集的完整复现。
- 论文的原始种子与精确划分索引**在本次工作中未被恢复**，因此本次使用新的显式种子；此处仅陈述“未恢复”这一事实，不对其是否公开作无证据断言。
- 任何结果都不能用于临床有效性声明。

---

## 6. 供预览的绝对路径

- 本报告：`C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918\gui-test\pi-stage1-report.md`
- 新阅读包：`C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918\gui-test\paper2agent\moleculenet-paper`
- 阅读包严格验证报告：`C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918\gui-test\paper2agent\moleculenet-review\verification.json`
- 数值结果（ESOL，已完成）：`C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918\results`
- 数值结果（FreeSolv/Lipophilicity，进行中）：`C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918\results-corrected`
- 已排除的错误批次：`C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918\results-remaining`
- FreeSolv 更正记录：`C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918\data\freesolv\SOURCE-CORRECTION.md`
