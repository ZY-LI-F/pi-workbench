# MoleculeNet 局部复现与 Pi GUI 真实测试

日期：2026-09-18。48 次科学运行全部完成并独立审计，26 项相关单元测试通过。Paper2Agent 阅读包与 Paper2Any 文本大纲组件通过；Paper2Any 原生制片失败，Pi GUI 长会话刷新也发现未修复缺陷。详细状态见 [完整报告](REPORT.zh-CN.md) 和 [GUI 验收](gui-test/acceptance.json)，不能把“测试执行完毕”理解为“所有功能通过”。

## 直接阅读

- [16页中文说明 PPTX](deliverables/MoleculeNet-复现与Pi工具实测-审定版.pptx)：可编辑图表、表格与讲者备注。根据真实数据独立制版，不是 Paper2Any 原生导出。
- [完整科学与工具报告](REPORT.zh-CN.md)。
- [真实实验汇总 CSV](verification/summary.csv)、[逐运行审计](verification/runs.json)。
- [Pi GUI 问题记录](gui-test/ISSUES.md)、[界面截图](gui-test/evidence)。
- [Paper2Any 第二次大纲与修订](gui-test/paper2any/outline-observed/outline.md)、[两条真实API回执](gui-test/paper2any/outline-observed/api-receipts.json)。
- [原生制片失败证据](gui-test/paper2any/frontend/result.json)。

PPTX 使用 Noto Sans SC。此字体未嵌入文件；其他电脑缺少它时 Office 可能替换字体。未声称在 PowerPoint/macOS 中验证过一致性。压缩包是研究证据包，不是带全部运行环境的安装程序。

## 论文、模型与范围

Wu et al., *MoleculeNet: a benchmark for molecular machine learning*, Chemical Science 9, 513–530 (2018)，在线发表于2017-10-31。[PubMed PMID 29629118](https://pubmed.ncbi.nlm.nih.gov/29629118/)，[DOI 10.1039/C7SC02664A](https://doi.org/10.1039/C7SC02664A)。一区按 [RSC 当前期刊指标](https://www.rsc.org/publishing/journals/journal-metrics)的 JCR Q1 核验，不是中科院或2017年历史分区声明。

- Pi：0.85.1，现有单核心。模型：DeepSeek V4.1 Flash，`deepseek/deepseek-flash`，GUI 实际连通并执行工具。
- ESOL 1128、FreeSolv 642、Lipophilicity 4200条全量数据；mean / RF / KRR / GraphConv。
- 36次随机80/10/10实验，种子123/456/789；另加12次ESOL确定性骨架划分诊断。
- 原生 DeepChem 2.8.0 / TensorFlow 2.15.1 / Python 3.10.11 / CPU 4线程，无模拟数据、无HPO、未按测试结果选模型。
- 未覆盖完整17数据集、原始软件环境、原论文精确划分/种子，不能解释为临床有效或分子设计验证。

## 科学结果复核

在本目录执行。需要可运行 TensorFlow 2.15.1 的 Python 3.10 环境；本次验证 Windows，其他平台未测。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe verify_results.py
.\.venv\Scripts\python.exe -m pytest test_benchmark.py test_verify_results.py test_source_data.py test_outline_validation.py -q
```

审计使用压缩包中的真实原始CSV、预测CSV和源代码快照，不需要API密钥或重新训练。源代码历史用于解释早期ESOL与修正后FreeSolv读取器的差别。

重新训练使用**新的目录**，不要覆盖已有结果：

```powershell
.\.venv\Scripts\python.exe benchmark.py --output results-new
```

默认生成完整48次矩阵。`verify_results.py` 的映射针对交付批次（ESOL位于 `results`，另两者位于 `results-corrected`）；要审计新批次，需明确更新这一映射及新批次的来源快照，不应把本次审计结果复用为新批次通过。

FreeSolv 必须使用 `data/freesolv/SAMPL.csv` 的物理单位 `expt`。DeepChem 默认压缩文件的 y 已经全数据标准化，不能标成 kcal/mol。原错误批次不纳入报告，见 [单位纠正](data/freesolv/SOURCE-CORRECTION.md)。

## 两个上游工具

- [Paper2Agent](https://github.com/jmiao24/Paper2Agent)：`8c2d059165ef8cdcb70dbea76655b9c2b55b38e6`。测试 Paper2Skill 的读取/构建/严格验证；使用主代理对65页作者稿的实际审阅记录，不是人工审阅或多代理独立认证。未测完整Paper2MCP。
- [Paper2Any](https://github.com/OpenDCAI/Paper2Any)：`b538531e25798d9b9d41afd5fa93c9222949b5a5`。测试原生outline/refine的simple mode，以及原生无图片幻灯片服务。都是顺序库调用，没有启动Codex子代理。
- `upstream-patches/` 保存Windows路径和密钥日志补丁；均只应用于测试副本，未向上游提交。

Paper2Any 需要独立 Python 3.12 环境；精确依赖见 `verification/paper2any-environment.txt`。检出上述提交后安装其依赖及OpenCV，应用隐私日志补丁，再设置 `PAPER2ANY_REPO` 和继承环境中的 `DEEPSEEK_API_KEY`。密钥不写入源码或命令参数。不要让这套依赖覆盖科学环境。

```powershell
$env:PAPER2ANY_REPO = 'C:\path\to\Paper2Any'
.\.venv-paper2any\Scripts\python.exe test_paper2any_live.py --output gui-test/paper2any/new-observed-attempt
```

该脚本需要交付包中的核验结果和论文阅读包。已有测试结果不可覆盖。原生frontend脚本记录本次失败，固定了本机Node/tsx和一次性上游工作目录；移机重测需更新这几项，不能直接覆盖原证据。完整Web平台、MinerU、SAM及图像模型未测。

## 文件与隐私

所有产物均在本测试目录。虚拟环境、Pi凭证、隔离用户配置、完整私有会话和模型检查点不进入证据ZIP。会话只导出模型、次数、用量和哈希等最小化元信息。ZIP内 `MANIFEST.sha256.json` 覆盖每个交付文件。

说明稿的构建脚本依赖本机 Codex 演示文稿运行时及技能校验器，供审查过程使用，不承诺脱离该环境一键重新制版。原生数据、科学代码与PPTX本身均可单独使用。图表工作簿为本次真实数值的12位有效数字快照，细于幻灯片显示的3位小数；原始预测CSV仍保留完整精度。

论文原图遵循 Wu et al. 的 CC BY-NC 3.0 条款并保留署名。此证据包含非商业许可素材，不能当作无条件商用素材包。没有修改PI-GUI业务代码、用户原有凭证或Pi核心，没有推送GitHub。
