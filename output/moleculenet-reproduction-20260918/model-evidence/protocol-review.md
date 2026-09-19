# 实验方案审查意见

以下审查严格区分三类信息：**论文正文/表格中可直接引用的文献结果**、**随附 DeepChem 源码所反映的历史超参数**、以及**拟复现方案中的假设与风险**。凡证据不足处均标注为需核验。

---

## 1）原文对应方法与原始数值在哪里，哪些数值可直接引用

### 1.1 定位

Fig.12 与 Table S5 对应论文第 **4.3 节 "Physical chemistry tasks"**（正文 body 中 `<sec><label>4.3</label>`）。该节描述 ESOL / FreeSolv / Lipophilicity 三个数据集上的 RMSE 结果，图题为 *"ESOL, 8 models are evaluated by RMSE on random split; FreeSolv, 8 models are evaluated by RMSE on random split; lipophilicity, 8 models are evaluated by RMSE on random split"*。**图本身（c7sc02664a-f12.jpg）不在随附 XML 内**，其数值需从 Table S5（ESI 附件 SC-009-C7SC02664A-s001.pdf）读取，**该附件同样不在随附证据中**。因此逐方法数值目前不可见，不能凭图注推断。

### 1.2 可直接引用于正文的数值（Table 3，test subset，best-performing）

论文正文 Table 3 明确给出物理化学三数据集的"最佳"对照：

| 数据集 | 指标 | Conventional 最佳 | Graph-based 最佳 |
|---|---|---|---|
| ESOL | RMSE | XGBoost: 0.99 | MPNN: 0.58 |
| FreeSolv | RMSE | XGBoost: 1.74 | MPNN: 1.15 |
| Lipophilicity | RMSE | XGBoost: 0.799 | GC: 0.655 |

**引用限制**：这些是**各方法族内的最佳值**（ESOL/FreeSolv 最佳为 MPNN，Lipophilicity 最佳为 GC），**不是** GC 在三个数据集上的完整结果，也**不是** 方案中所跑 GC/RF/KRR 的对应数值。ESOL/FreeSolv 的 GraphConvModel 结果在 Table 3 中并未列出。

### 1.3 可引用的协议性事实（正文可核）

- 划分比例 80/10/10（第 3.2 节明确）；
- 随机划分用于 ESOL/FreeSolv/Lipophilicity，推荐指标 RMSE（Table 1）；
- "three independent runs with different random seeds"、"all benchmark results presented here are the average of three runs, with standard deviations listed or illustrated as error bars"（第 4 节开头）；
- "We run a brief Gaussian process hyperparameter optimization on each combination of dataset and model"（同上）；
- 数据量：ESOL 1128、FreeSolv 643、Lipophilicity 4200（Table 1）；
- 原文对 FreeSolv 报告 ±1.5 kcal/mol 级别的 ab initio 精度作为参照（第 4.3 节）。

### 1.4 精度边界声明

原文未公开三个种子的具体取值、未公开每次运行的 RMSE 明细（仅在 ESI 中可能以表格形式给出），因此**无法逐点比对**。本次复现只能做**协议与趋势对照**，不能宣称等价。此边界必须写进 PPTX。

---

## 2）方案中可能导致错误复现的具体问题

以下逐条给出，每条附证据来源或需核验标记。

**P1. 超参数误用风险（最严重）**
方案写"GC 默认两层 128、dense 256、100 epochs、batch 128、学习率 0.0005"。**只有后三项与随附 preset_hyper_parameters.py 中的 `graphconvreg` 一致**：`batch_size: 128`、`nb_epoch: 100`、`learning_rate: 0.0005`。该文件中的键是 `n_filters: 128`、`n_fully_connected_nodes: 256`，**未显式写明"层数"**——"两层"是方案自行推断。同时请特别注意：preset 中还有一个 `graphconv`（分类用）为 `n_filters: 64`、`n_fully_connected_nodes: 128`、`nb_epoch: 40`。**分类版与回归版参数不同，方案若误取分类版或混用将导致结果偏差**。必须在代码中显式核对实际传入的 `n_filters` / `n_fully_connected_nodes` / 层数。

**P2. "原生 DeepChem 2.8.0 默认超参数"的表述与证据不符**
preset 文件中 `graphconvreg` 的 seed 写死为 123，而方案要跑 456、789 作为额外种子；这不是"默认值"问题，而是方案已在修改默认。同时 2.8.0 的 `GraphConvModel` 默认与 2017 年 preset 是否一致**无法从现有证据确认**（证据中只有 preset 文件，没有 2.8.0 源码）。必须在报告中区分"DeepChem 2.8.0 默认"与"2017 年 preset"，不可混称。

**P3. "全数据"用量的歧义**
"MoleculeNet 的全部数据"容易被读成 ESOL+FreeSolv+Lipophilicity 合并。原文是**三个独立子实验**，各自独立划分与评估。方案应明确是"每个数据集各自全部样本，分别建模"，而非合并。

**P4. 归一化时机与位置**
"先划分后仅在训练集拟合归一化"方向正确（与原文"training sets used to train, validation for tuning, test for evaluation"精神一致），但需核实 `NormalizationTransformer` 的 `transform()` 是否对 validation 集单独处理、是否在 y 上也做归一化（回归任务需要注意 y 变换后再计算 RMSE 时的反变换）。此外若 `transform()` 默认对 train/valid/test 独立拟合，则需显式禁止。**这是最易静默出错的一步，必须打印检查归一化前后的统计量。**

**P5. GC 的 featurization 冲突**
方案写"GraphConvModel 和 CircularFingerprint"。原文是"All graph models use their corresponding featurizations. Non-graph models use ECFP featurizations by default"（第 4 节开头）。也就是说 GC 应用 graph convolution featurizer，RF/KRR 用 ECFP。**如果对 GC 误用了 CircularFingerprint，或对 RF/KRR 误用了 graph featurizer，就偏离了协议。** 方案表述含糊，需明确每模型一 featurization。

**P6. 均值基线的取值域**
"训练集均值基线"必须明确：预测值是训练集 y 的均值（常数预测），还是 y 归一化后再反变换。若忘记反变换，RMSE 数值会与真值不在同一量纲，导致与其它模型不可比。

**P7. SMILES 重复与跨集重叠检查的必要性**
方案已列出，方向正确。但更需关注 **Lipophilicity 中同分异构体/盐型/立体异构体** 的处理：同一化合物的不同 SMILES 可能被当成不同样本落入 train/test 两侧。原文的预处理细节在 ESI 中，**不在随附证据内**，必须如实标注为"沿用 DeepChem 2.8.0 加载器，未做额外的原文级去重"。

**P8. scaffold 划分敏感性对照**
方案已声明为"扩展分析"。这一点正确，但需补充：scaffold 划分下**训练集/测试集的标签分布会显著偏移**（论文第 4.1 节明确指出 "As compounds are divided by their molecular scaffolds, increasing differences between train, validation and test performances are observed"），因此不能把 scaffold 结果与 random 结果直接比较 RMSE，只能报告"random vs scaffold 的退化幅度"这一趋势。

**P9. 训练与测试标签统计的输出**
方案要输出"训练与测试标签统计"，方向正确，但必须包含**测试集标签范围**（在训练范围之外的比例），这对 FreeSolv 这类小数据集尤其重要——论文明确提到 FreeSolv 范围是 −25.5 到 3.4 kcal/mol（第 4.3 节），若测试集存在范围外样本，RMSE 的解释需谨慎。

**P10. 运行时长与随机性**
方案记录运行时长是好的，但需注意：DeepChem 的随机性来源不仅有 numpy/python seed，还包括 TensorFlow 的图级 seed 与 GPU 非确定性。方案写了"固定种子 123、456、789"，但**没有机制保证跨机器/跨版本可复现**。必须在 PPTX 中明确"seed 仅控制我们所声明的随机源，不保证跨环境比特级一致"。

**P11. 与 Table S5 的逐方法数值对照尚不可行**
如前所述，Figure 12 的原始数值与 Table S5 均不在随附证据中，**目前无法把任何一次实测的 GC/RF/KRR 数值与论文逐方法对照**。这一点必须在 PPTX 的"局限"页明确写出，不能等到结果出来后临时补。

**P12. 不调用子代理的约束**
方案没提子代理，此处仅确认不启用，符合边界要求。无需进一步动作。

---

## 3）最小必要修正

按优先级列出，均为"不改就不能称之为复现"的最小集：

1. **显式绑定每个模型与其 featurizer**：GC ↔ graph convolution featurizer；RF/KRR ↔ CircularFingerprint(ECFP)。不得交叉。
2. **显式核对 GC 超参数来源**：在 notebook 中打印实际传入的 `n_filters`、`n_fully_connected_nodes`、层数、batch、epoch、lr，并与 preset 文件中的 `graphconvreg` 逐项对照；若使用 DeepChem 2.8.0 默认而非 2017 preset，在报告中明说。
3. **归一化审计**：对每个种子、每个数据集打印 train/valid/test 在归一化前后的 y 的均值/方差/范围，并确认 test 的转换参数来自 train。
4. **反变换审计**：确认 RMSE/MAE/R² 计算在**反变换后的原始量纲**上进行。
5. **划分可复现**：把 (seed, dataset) → (train_idx, valid_idx, test_idx) 的索引数组落盘（npy/json），确保 RF/KRR/GC/均值基线共享同一份索引。
6. **SMILES 与重复样本审计**：输出 train/valid/test 之间 SMILES 字符串集合的交集大小；若将 Lipophilicity 的同一 InChIKey 视为潜在重复，需另记一份。
7. **scaffold 对照的元信息**：在输出中标记该次划分的 split type，禁止与 random 结果混入同一统计表。
8. **失败记录**：捕获每个 (dataset, model, seed) 的异常并写入独立 CSV，字段为 dataset、model、seed、stage、exception。不重跑、不填数。
9. **原文数值引用规范**：PPTX 中凡是 Table 3 的数值，统一标注"Table 3, test subset, best in class"；凡是我们实测的数值，统一标注"本复现，seed=...，随机划分"。两者不混排。

以上 9 条即最小必要集。其余如"增加更多算法""复刻 MPNN""复刻 XGBoost"均超出边界，不应加入。

---

## 4）适合本次子实验的验收条件（预先定义）

按"通过 / 部分通过 / 未通过"三级，每级附判据。

### A. 工程正确性（必须全满足，否则"未通过"）

- A1. 三数据集的加载样本数分别等于 1128 / 643 / 4200（Table 1）；若不等，记录差异。
- A2. 每个 (dataset, seed) 下 train/valid/test 索引互斥、并集覆盖全集（覆盖率 100%）。
- A3. 每个 (dataset, seed) 下 train/valid/test 的 y 统计被打印且数值有限。
- A4. test 集在全部建模流程中被显式排除；代码层面禁止调参依赖 test。
- A5. 逐样本预测表存在，行数等于对应 test 集大小，字段包含索引、y_true、y_pred。
- A6. 三个种子的 RMSE/MAE/R² 均有记录，且每个数值至少出现两次（独立脚本复算一次）。

### B. 协议一致性（可容许小幅偏差，但必须披露）

- B1. GC/RF/KRR/均值基线均使用同一份索引。
- B2. GC 超参数与 preset `graphconvreg` 一致，或明确列出偏差项。
- B3. 归一化只在 train 上拟合。
- B4. 指标在原始量纲上计算。
- B5. scaffold 对照被明确标记为扩展分析。

### C. 科学结论的置信边界（决定"能下什么结论"）

- C1. **可下结论**：在相同协议下，GC / RF / KRR / 均值基线的相对排序；三个种子间的样本标准差。
- C2. **可下结论**：random 划分下 RMSE 与 scaffold 划分下 RMSE 的退化幅度（只报趋势，不报相等性检验）。
- C3. **不可下结论**：任何"我们复现了 Fig.12 的数值"的表述；任何将 GC 实测值等同于 Table 3 中 MPNN 最优值的表述；任何"与原文逐点一致"的表述。
- C4. **不可下结论**：把 2.8.0 下的结果称为"原文默认超参数结果"，除非逐项证实与 preset 一致。

### D. 通过判定

- **通过**：A 全满足 + B 中至多一项披露偏差 + C 全部遵守。
- **部分通过**：A 全满足 + B 中一到两项未满足但已披露 + C 全部遵守。
- **未通过**：A 有任一未满足，或 C 被违反（例如把实测值当作论文数值展示）。

---

## 5）中文 PPTX 应包含的关键科学边界

以下为"必须写进 PPTX 的科学边界"清单，逐条给出应出现的措辞或数据约束。这些不是排版建议，而是防止过度声明的下限。

1. **复现范围**：明确写"部分复现 MoleculeNet（PMID 29629118）第 4.3 节物理化学子实验，使用 ESOL / FreeSolv / Lipophilicity 三个数据集、GC / RF / KRR / 均值基线四个模型、随机 80/10/10 划分、三个种子。**未**复现 17 数据集全集、**未**复现 2017 年 Gaussian-process 超参数搜索、**未**复现 MPNN / Weave / DTNN / DAG 等图模型。"

2. **软件版本差异**：写"使用 DeepChem 2.8.0，而非作者 2017 年所用版本。超参数取自随附 preset_hyper_parameters.py 中的 `graphconvreg` 项（batch 128、epoch 100、lr 5e-4、n_filters 128、n_fully_connected_nodes 256），并在实验日志中逐项核对。"

3. **原文数值的可引用范围**：只允许引用 Table 3 的三组"最佳"数值（ESOL MPNN 0.58 / FreeSolv MPNN 1.15 / Lipophilicity GC 0.655），并注明为 "test subset, best in class"；**不引用** Figure 12 的柱状值，因为无法从随附证据中读出。

4. **不可宣称的结论**：
   - "复现了 Fig.12 的柱状值"；
   - "GC 在本实验中的值等于论文的 MPNN 最优值"；
   - "我们的 RMSE 与原文逐点一致"；
   - "使用了与论文完全相同的超参数"。

5. **protocol vs. 趋势对照**：写明本实验的输出是"协议一致性 + 趋势方向"两类证据，不做逐点等价。趋势方向的判据示例：GC 在 Lipophilicity 上应体现出与原文同向的"图模型优于常规方法"的趋势，但幅度可能不同。

6. **scaffold 敏感性对照的定位**：写"该对照为本次扩展分析，不在原文协议内，用于评估划分方式对 RMSE 的影响。scaffold 与 random 的数值不直接比较，仅报告退化幅度。"

7. **失败保留声明**：写"所有 (dataset, model, seed) 组合均执行到底，失败组合以 CSV 原样记录，未替换为成功结果或模拟数值。"

8. **复现性边界**：写"seed 固定为 123 / 456 / 789，控制 numpy / python / TensorFlow 层随机源；不保证跨机器、跨 Python / CUDA 版本的比特级一致。所有划分索引已落盘以便复核。"

9. **指标定义**：RMSE 定义在原始标签量纲上；R² 使用 sklearn 定义（1 − SS_res/SS_tot），在 test 集上计算；MAE 同量纲。若某次运行 y_pred 全部相同（退化），需单独标注。

10. **数据来源边界**：写"数据集由 DeepChem 2.8.0 `molnet` 加载器获取；未执行额外的原文级 SMILES 标准化、盐型剥离、立体异构体归并。若存在 SMILES 重复或跨集重叠，已在审计表中列出。"

11. **结论页禁止项**：不出现"超越原文""SOTA""首次复现"等表述；不出现任何未经日志支撑的数值；不出现将 protein-ligand、quantum mechanics、physiology 子实验的内容借用到物理化学结论中的表述。

---

## 附：需要在动手前补齐的关键信息

以下信息在随附证据中缺失，需在启动实验前从**官方渠道**获取并记录，否则 Section 2 的若干问题无法闭环：

- Table S5 的具体数值（用于合理的量级预期，而非作为调参依据）；
- Figure 12 各模型柱状值（同上）；
- 原文对 ESOL / FreeSolv / Lipophilicity 的**预处理脚本或说明**（是否去重、是否固定 SMILES）；
- DeepChem 2.8.0 中 `GraphConvModel` 的真实默认层数与 `NormalizationTransformer` 的默认作用域。

在这些信息补齐之前，本方案的任何"与原文对照"仍应停留在协议层，不能进入数值层。