# MoleculeNet 局部复现说明讲稿

适用：科研组会，约 12–15 分钟。页数与时长为本轮默认设计，不是实验计时。

## 1. MoleculeNet 分子性质预测局部复现

本报告介绍 MoleculeNet 的三个理化性质基准，以及现代软件环境下完成的局部复现实验。已有实验包含三个数据集、四个模型和三个随机种子，再加一个骨架划分诊断，共四十八次训练与评估。这里的重点是哪些结论有实际数据支持，以及哪些差异仍未解释。这不等于完整复现论文的十七个数据集，也不构成湿实验或药物有效性证据。

来源：Wu et al. MoleculeNet: a benchmark for molecular machine learning. Chemical Science 9, 513–530 (2018). DOI: 10.1039/C7SC02664A. https://pubmed.ncbi.nlm.nih.gov/29629118/
Local evidence: ../moleculenet-reproduction-20260918/verification/summary.json; runs.json; diagnostics.json. Experiments completed 2026-09-18. Numerical computation by DeepChem on CPU.

## 2. 本次复现聚焦三个理化性质数据集

MoleculeNet 将分子机器学习任务划分为量子力学、物理化学、生物物理和生理学等层面，原论文汇集十七个数据集。本次只选取图中物理化学部分的 ESOL、FreeSolv 和 Lipophilicity。三个集合都使用完整数据，而不是小样本演示，但其他十四个集合和论文中的其他算法没有运行。范围上的完整与局部需要同时说明。

来源：Wu et al. MoleculeNet: a benchmark for molecular machine learning. Chemical Science 9, 513–530 (2018). DOI: 10.1039/C7SC02664A. https://pubmed.ncbi.nlm.nih.gov/29629118/
原图：arXiv v3 Fig.2, p.7. https://arxiv.org/abs/1703.00564v3 。Wu et al.，CC BY-NC 3.0。

## 3. 三个基准使用不同目标与单位

ESOL 有一千一百二十八条记录，预测水溶解度的对数。FreeSolv 有六百四十二条记录，目标是以每摩尔千卡表示的溶剂化自由能。Lipophilicity 有四千二百条记录，预测 logD。这些目标的尺度不同，因此不能把三组误差平均成一个总分。每个数据集只应在自己的单位和相同划分条件下比较模型。

来源：Local evidence: ../moleculenet-reproduction-20260918/verification/summary.json; runs.json; diagnostics.json. Experiments completed 2026-09-18. Numerical computation by DeepChem on CPU.
Wu et al. MoleculeNet: a benchmark for molecular machine learning. Chemical Science 9, 513–530 (2018). DOI: 10.1039/C7SC02664A. https://pubmed.ncbi.nlm.nih.gov/29629118/

## 4. 模型比较采用预先固定的实验协议

四个模型包括训练均值基线、随机森林、核岭回归和图卷积网络。随机森林和核岭回归使用相同的 ECFP4 特征，图模型使用原子特征。参数在结果出现前固定，图模型取第一百个 epoch，不按测试集效果选点。软件环境为 DeepChem 2.8 与 TensorFlow 2.15.1，因此这是一套公开记录的现代重跑协议，而不是原论文执行环境的完全还原。

来源：Local evidence: ../moleculenet-reproduction-20260918/verification/summary.json; runs.json; diagnostics.json. Experiments completed 2026-09-18. Numerical computation by DeepChem on CPU.
../moleculenet-reproduction-20260918/experiment.json, benchmark.py

## 5. 随机划分与骨架划分回答不同问题

原图对比了四种数据划分方式。本次主实验采用随机划分，并只对 ESOL 增加骨架划分诊断。骨架划分让共享骨架的分子保持在同一分区，从而检验更困难的结构外推。需要特别注意，所用 DeepChem ScaffoldSplitter 是确定性的，三次运行使用同一个骨架分区，改变的是学习器随机性，不是三折交叉验证。

来源：Wu et al. MoleculeNet: a benchmark for molecular machine learning. Chemical Science 9, 513–530 (2018). DOI: 10.1039/C7SC02664A. https://pubmed.ncbi.nlm.nih.gov/29629118/
原图：arXiv v3 Fig.3, p.13，CC BY-NC 3.0。
Local evidence: ../moleculenet-reproduction-20260918/verification/summary.json; runs.json; diagnostics.json. Experiments completed 2026-09-18. Numerical computation by DeepChem on CPU.

## 6. ESOL 上 GraphConv 的平均误差最低

先看 ESOL。三个学习模型都优于训练均值基线，GraphConv 的平均测试误差最低。其均值为一点零四六，而论文同模型为零点九七。两者在量级上接近，但运行次数只有三次，训练条件也不一致，不能直接据此断言复现了相同性能。随机划分中的重复结构交叉还会限制对新结构的外推解释。

本次标准差使用 ddof=1。论文标准差的具体口径未独立恢复。不同超参数与分区下的比较仅为描述性比较，不代表统计显著性或算法因果优劣。

来源：MoleculeNet author manuscript arXiv:1703.00564v3, Table 8, p.51. https://arxiv.org/abs/1703.00564v3
Local evidence: ../moleculenet-reproduction-20260918/verification/summary.json; runs.json; diagnostics.json. Experiments completed 2026-09-18. Numerical computation by DeepChem on CPU.

## 7. FreeSolv 未重现 GraphConv 的优势

FreeSolv 是本轮必须保留的负结果。原论文中 GraphConv 的测试误差为一点四，而本次为二点一五一，较论文均值高百分之五十三点七。本次 KRR 和 RF 的误差均值都略低于 GraphConv。这个结果说明固定协议下没有重现图模型的优势。我们没有为得到更漂亮的排序重新选择种子，也没有把未经验证的训练配置差异当成已确定的原因。

本次标准差使用 ddof=1。论文标准差的具体口径未独立恢复。不同超参数与分区下的比较仅为描述性比较，不代表统计显著性或算法因果优劣。

来源：MoleculeNet author manuscript arXiv:1703.00564v3, Table 8, p.51. https://arxiv.org/abs/1703.00564v3
Local evidence: ../moleculenet-reproduction-20260918/verification/summary.json; runs.json; diagnostics.json. Experiments completed 2026-09-18. Numerical computation by DeepChem on CPU.

## 8. 脂溶性任务中 GraphConv 的平均误差最低

Lipophilicity 的结果与 ESOL 在模型排序上相似：GraphConv 平均误差最低，RF 和 KRR 接近。GraphConv 的误差是零点七零四，论文对应数值为零点六五五。这个结果支持图表示在当前协议和当前任务中的价值，但不足以外推到所有分子性质，更不能直接转化为药物发现成功率的保证。

本次标准差使用 ddof=1。论文标准差的具体口径未独立恢复。不同超参数与分区下的比较仅为描述性比较，不代表统计显著性或算法因果优劣。

来源：MoleculeNet author manuscript arXiv:1703.00564v3, Table 8, p.51. https://arxiv.org/abs/1703.00564v3
Local evidence: ../moleculenet-reproduction-20260918/verification/summary.json; runs.json; diagnostics.json. Experiments completed 2026-09-18. Numerical computation by DeepChem on CPU.

## 9. 骨架划分提高了 ESOL 的测试误差

同一组模型转到 ESOL 骨架测试集后，误差均值都升高。KRR 从一点四八五上升到二点四七二，甚至高于二点三一五的均值基线。GraphConv 仍是本轮骨架测试中的最低误差模型，但也从一点零四六升到一点三七零。这里展示的是一个特定固定骨架分区的诊断结果，不能把差值解释为普遍适用的外推损失。

来源：Local evidence: ../moleculenet-reproduction-20260918/verification/summary.json; runs.json; diagnostics.json. Experiments completed 2026-09-18. Numerical computation by DeepChem on CPU.

## 10. FreeSolv 的数据单位错误已纠正并重跑

在数据审计时发现，DeepChem 2.8 默认下载的 FreeSolv 压缩文件已经进行全数据标准化。若直接把其误差标成每摩尔千卡，就会产生大约三点八四五倍的虚假改善。我们改用原始 SAMPL.csv 的 expt 列，只在训练集上拟合标准化，并将相关实验完整重跑。前面所有 FreeSolv 数字都来自纠正后的批次。这个案例说明数据尺度检查比单纯跑通模型更重要。

来源：Local evidence: ../moleculenet-reproduction-20260918/verification/summary.json; runs.json; diagnostics.json. Experiments completed 2026-09-18. Numerical computation by DeepChem on CPU.
../moleculenet-reproduction-20260918/data/freesolv/SOURCE-CORRECTION.md

## 11. 重复结构限制随机划分的外推解释

ESOL 有十一条重复结构记录。三个随机种子下，训练集和测试集之间的相同规范结构交集分别为二、二和零。FreeSolv 与 Lipophilicity 没有发现这种交叉。这里没有为了消除重复而改变事先确定的全量数据协议，所以必须如实报告。另一方面，已独立核对所有运行的预测与标签、分区覆盖、指标、归一化及数据哈希。数据可核查不等于所有科学偏差已消除。

来源：Local evidence: ../moleculenet-reproduction-20260918/verification/summary.json; runs.json; diagnostics.json. Experiments completed 2026-09-18. Numerical computation by DeepChem on CPU.

## 12. 本次结果仍有明确的复现边界

论文比较与本地重跑之间存在多处差异。数据范围只覆盖三个理化性质集合，软件使用较新的 DeepChem 与 TensorFlow，没有还原原论文的全部模型和超参数搜索。原论文使用的精确种子与分区索引也未在本轮恢复。这些差异提醒我们，对结果应使用描述性语言，而不是宣称已经证明某种算法一定更好或更差。完整论文复现仍然没有完成。

来源：Wu et al. MoleculeNet: a benchmark for molecular machine learning. Chemical Science 9, 513–530 (2018). DOI: 10.1039/C7SC02664A. https://pubmed.ncbi.nlm.nih.gov/29629118/
Local evidence: ../moleculenet-reproduction-20260918/verification/summary.json; runs.json; diagnostics.json. Experiments completed 2026-09-18. Numerical computation by DeepChem on CPU.

## 13. AIDD 基准结果应按任务和划分解读

本轮实验提供了三个实际可用的判断。第一，模型优势依赖任务，GraphConv 在 ESOL 和脂溶性上平均误差最低，但在 FreeSolv 上没有显示同样优势。第二，随机与骨架划分衡量不同的泛化条件，不应互相替代。第三，数据单位、重复结构和独立指标核验是解释结果的前提。这些结论对评估 AIDD 模型有帮助，但当前实验仍然只是性质预测基准，不能提供药物有效性证据。

来源：Local evidence: ../moleculenet-reproduction-20260918/verification/summary.json; runs.json; diagnostics.json. Experiments completed 2026-09-18. Numerical computation by DeepChem on CPU.
Wu et al. MoleculeNet: a benchmark for molecular machine learning. Chemical Science 9, 513–530 (2018). DOI: 10.1039/C7SC02664A. https://pubmed.ncbi.nlm.nih.gov/29629118/

## 14. 文献与可复运行证据

文献通过 PubMed 和 DOI 定位。数值对照使用作者稿第三版的 Table 8，避免期刊与作者稿图号混用。本地证据包括固定配置、训练脚本、原始预测、分区以及独立核验汇总。复运行时应使用新的输出目录，以免覆盖既有结果。不同硬件或库版本不保证逐位相同。

Wu et al. MoleculeNet: a benchmark for molecular machine learning. Chemical Science 9, 513–530 (2018). DOI: 10.1039/C7SC02664A. https://pubmed.ncbi.nlm.nih.gov/29629118/
MoleculeNet author manuscript arXiv:1703.00564v3, Table 8, p.51. https://arxiv.org/abs/1703.00564v3
DeepChem 2.8.0: https://github.com/deepchem/deepchem/tree/2.8.0
Local evidence: ../moleculenet-reproduction-20260918/verification/summary.json; runs.json; diagnostics.json. Experiments completed 2026-09-18. Numerical computation by DeepChem on CPU.
参考路径均相对本报告所属工作区的历史实验目录。

## 修改与复用

1. 修改 Canvas 页面中的 content 数据。
2. 保持每个数值的单位和来源。
3. 样本或模型变动后重新生成独立审计汇总。
4. 调整版式后重新导出并逐页检查。
5. 用新文件名保存，保留历史实验与报告。
