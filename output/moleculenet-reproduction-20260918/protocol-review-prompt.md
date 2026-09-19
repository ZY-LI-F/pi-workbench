# 实验方案审查

用户要求以一篇 PubMed 一区 AIDD 论文开展真实复现，并制作中文 PPTX。论文已选为 MoleculeNet，PMID 29629118，Chemical Science，出版社官方表显示 JCR Q1。

请基于随附论文正式发表版本的 XML 和 DeepChem 默认超参数审查以下方案。给出具体问题与修正建议，不能假设实验已经成功。

拟复现 Fig.12 的物理化学性质预测子实验，采用 ESOL、FreeSolv 和 Lipophilicity 的全部数据。原文为 random 80/10/10、RMSE、3 个独立种子。使用现代 DeepChem 2.8.0 原生 GraphConvModel 和 CircularFingerprint、RandomSplitter、NormalizationTransformer，以及其 sklearn 模型接口，运行 GC、RF、KRR 和训练集均值基线。GC 默认两层 128、dense 256、100 epochs、batch 128、学习率 0.0005。RF 500 棵树，KRR RBF alpha=0.001。固定种子 123、456、789。所有模型使用相同的行号划分，先划分后仅在训练集拟合归一化。保持测试集封存，不依据测试表现调参。

拟在 ESOL 加一个 scaffold 划分的敏感性对照，明确这是扩展分析，非 Fig.12 原始协议。检查完整覆盖、行号互斥、SMILES 重复/跨集重叠、训练与测试标签统计，输出逐样本预测、三个种子的每次 RMSE/MAE/R²、样本标准差与运行时长。失败时保留失败记录，不改成模拟成功。

重要边界：本次不完整复现 17 数据集/全部算法，不复刻 2017 年所有依赖及 Gaussian-process HPO。对论文数值只能做协议和趋势对照，不能宣称逐点等价，不能把 GC 实测值当成论文的 MPNN 最优值。

请回答：1）原文对应方法与原始数值在哪里，哪些数值可直接引用；2）方案中可能导致错误复现的具体问题；3）最小必要修正；4）预先定义适合这次子实验的验收条件；5）中文 PPTX 应包含的关键科学边界。不要写空泛宣传。
