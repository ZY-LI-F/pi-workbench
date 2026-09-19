# 文献与实验来源

## 原论文

Wu Z, Ramsundar B, Feinberg EN, et al. **MoleculeNet: a benchmark for molecular machine learning.** Chemical Science 9, 513–530 (2018). DOI: 10.1039/C7SC02664A.

- [PubMed，PMID 29629118](https://pubmed.ncbi.nlm.nih.gov/29629118/)
- [期刊 DOI](https://doi.org/10.1039/C7SC02664A)
- [PMC 全文](https://pmc.ncbi.nlm.nih.gov/articles/PMC5868307/)
- [arXiv 作者稿 v3](https://arxiv.org/abs/1703.00564v3)

PPT 第 2 页与第 5 页分别使用作者稿 Fig.2 和 Fig.3 的原图。来源署名为 Wu et al.，许可 CC BY-NC 3.0。本轮保留原比例，没有裁切或改绘。重新分发需保留署名，并遵守原图非商业使用许可。

论文性能对照数字来自作者稿 v3 的 Table 8（p.51）。作者稿 Fig.13 对应期刊 Fig.12，本报告不混用图号。

## 本地实验

实验于 2026-09-18 完成。48 次运行的数值计算来自 DeepChem，不是语言模型生成的模拟数据。本轮直接使用既有审计结果，没有重新训练。

- [完整实验说明](../../moleculenet-reproduction-20260918/REPORT.zh-CN.md)
- [独立核验汇总](../../moleculenet-reproduction-20260918/verification/summary.json)
- [逐运行核验](../../moleculenet-reproduction-20260918/verification/runs.json)
- [诊断结果](../../moleculenet-reproduction-20260918/verification/diagnostics.json)
- [FreeSolv 数据纠正说明](../../moleculenet-reproduction-20260918/data/freesolv/SOURCE-CORRECTION.md)
- [固定实验配置](../../moleculenet-reproduction-20260918/experiment.json)
- [训练脚本](../../moleculenet-reproduction-20260918/benchmark.py)
- [独立核验脚本](../../moleculenet-reproduction-20260918/verify_results.py)

误差均为原始目标单位下的测试 RMSE，均值与样本标准差来自三次运行，标准差使用 ddof=1。不同任务的单位不混合平均。骨架划分诊断的三个种子使用相同分区，不能称为三折交叉验证。

## 软件来源

- [DeepChem 2.8.0](https://github.com/deepchem/deepchem/tree/2.8.0)
- [FreeSolv 数据库](https://github.com/MobleyLab/FreeSolv)
- [Paper2Any](https://github.com/OpenDCAI/Paper2Any)

本次调用的 Paper2Any 固定提交：`b538531e25798d9b9d41afd5fa93c9222949b5a5`。

原生导出入口：`frontend-workflow/src/components/paper2ppt/canvasPptxExporter.ts` 中的 `buildCanvasSlidesPptxBlob`。
