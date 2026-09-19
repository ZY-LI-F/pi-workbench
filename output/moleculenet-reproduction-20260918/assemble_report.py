"""Assemble the human report only from audited numeric and real tool evidence."""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load(name):
    return json.loads((ROOT/name).read_text(encoding='utf-8'))


def main():
    result = load('verification/summary.json')
    paper = load('gui-test/paper2agent/moleculenet-review/verification.json')
    any_result = load('gui-test/paper2any/outline-observed/result.json')
    frontend = load('gui-test/paper2any/frontend/result.json')
    gui = load('gui-test/acceptance.json')
    if result['status'] != 'verified' or result['total_runs'] != 48:
        raise RuntimeError('Incomplete scientific experiment')
    if not paper['mechanical_ok'] or paper['issues'] or any_result['status'] != 'passed':
        raise RuntimeError('Tool workflow has unresolved failures')
    names = {'esol':'ESOL','freesolv':'FreeSolv','lipophilicity':'Lipophilicity'}
    models = {'mean':'训练均值基线','rf':'RF','krr':'KRR','gc':'GraphConv'}
    def get(ds, model, split='random'):
        return next(a for a in result['aggregate'] if (a['dataset'],a['model'],a['split']) == (ds,model,split))
    def pm(row):
        return f"{row['test_rmse_mean']:.3f} ± {row['test_rmse_sample_sd']:.3f}"
    lines = ['# MoleculeNet 局部复现与 Pi GUI 工具实测','',
      '日期：2026-09-18。语言模型：DeepSeek V4.1 Flash（`deepseek/deepseek-flash`）。数值训练由本机 CPU 上的原生 DeepChem 执行，语言模型负责阅读、调用工具和说明，不生成模拟实验数据。','',
      '## 1. 结论与范围','',
      '已完成 48 次真实训练/评估：3 个完整数据集 × 4 个模型 × 3 个随机种子共 36 次，加 ESOL 骨架划分的 12 次诊断。逐分子预测、分区索引、指标、训练曲线和数据哈希均保存，并通过独立计算核对。','',
      '**总体结论：测试已执行，但不能判为全部通过。** Paper2Agent 阅读包与 Paper2Any 大纲/修订通过；Paper2Any 原生结构化制片失败；Pi GUI 多项交互可用，但长会话状态刷新稳定性未通过。最终说明 PPTX 是独立制版产物，不是 Paper2Any 原生导出。','',
      '这属于**现代环境下的局部复现**。没有复刻完整论文的 17 个数据集、全部模型、2017 年软件环境、原始种子/分区或超参数优化。没有湿实验、靶点验证、分子设计或临床有效性证据。','',
      '## 2. 论文与分区依据','',
      '- Wu et al. *MoleculeNet: a benchmark for molecular machine learning*. Chemical Science 9, 513–530 (2018)，在线发表 2017-10-31。',
      '- [PubMed，PMID 29629118](https://pubmed.ncbi.nlm.nih.gov/29629118/)。[DOI](https://doi.org/10.1039/C7SC02664A)。',
      '- 一区按 [RSC 官方期刊指标](https://www.rsc.org/publishing/journals/journal-metrics)的 JCR Q1（Chemistry, Multidisciplinary）口径核验。不是中科院一区声明，也不是发表当年的历史分区声明。',
      '- 期刊全文使用 PMC XML。PDF 使用合法开放的 [arXiv v3 作者稿](https://arxiv.org/abs/1703.00564v3)，65 页。数字参考来自作者稿 Table 8 / p.51，理化性质主图为作者稿 Fig.13，对应期刊 Fig.12。不同版本不能混用图号。','',
      '## 3. 真实实验结果','',
      '测试 RMSE，均值 ± 样本标准差（ddof=1），n=3。每个数据集单位独立，不能跨数据集直接比较数值大小。','',
      '| 数据集 | N | 单位 | 均值基线 | RF | KRR | GraphConv |',
      '|---|---:|---|---:|---:|---:|---:|']
    for ds in names:
        meta=result['datasets'][ds]
        lines.append(f"| {names[ds]} | {meta['n']} | {meta['unit']} | " + ' | '.join(pm(get(ds,m)) for m in models) + ' |')
    lines += ['', '### 与论文相同模型的描述性比较','',
      '| 数据集 | 模型 | 本次测试 RMSE | 论文测试 RMSE | 相对论文均值差 |',
      '|---|---|---:|---:|---:|']
    for ds in names:
        for model in ['rf','krr','gc']:
            a=get(ds,model); original=a['paper_test_rmse']
            diff=(a['test_rmse_mean']/original[0]-1)*100
            lines.append(f"| {names[ds]} | {models[model]} | {pm(a)} | {original[0]:.3f} ± {original[1]:.3f} | {diff:+.1f}% |")
    lines += ['', '比较中的正号表示本次误差更大。原论文与本次超参数、软件、划分不同，因此这些差异不能作算法优劣或统计显著性的因果解释。没有按结果重新调参或挑选好看的种子。','',
      '### ESOL 骨架划分扩展','',
      '| 模型 | 随机划分 | 骨架划分 |','|---|---:|---:|']
    for m in models:
        lines.append(f"| {models[m]} | {pm(get('esol',m))} | {pm(get('esol',m,'scaffold'))} |")
    lines += ['', 'DeepChem ScaffoldSplitter 是确定性的：三个种子使用同一骨架划分，仅学习器随机性改变。不是三折交叉验证。KRR 在这一测试集上的误差高于训练均值基线，保留该负结果。','',
      '### 重复结构与外推限制','']
    audits=load('verification/split-audits.json')
    for ds in names:
        meta=result['datasets'][ds]
        overlapping=[a['canonical_overlap']['train_test'] for a in audits if a['dataset']==ds and a['split']=='random']
        lines.append(f"- {names[ds]}：{meta['n']} 条记录，{meta['unique_canonical_smiles']} 个唯一规范结构，重复结构行 {meta['duplicate_structure_rows']}；三个随机划分的训练/测试相同结构交集数为 {overlapping}。")
    lines += ['', '未删除原始重复记录，以保持预先确定的全量数据协议。因此随机划分结果不等同于严格新结构外推性能，不能宣称完全没有结构泄漏。骨架扩展单独审计。','',
      '## 4. 数据单位错误与纠正','',
      '本轮真实测试发现 DeepChem 2.8 的 `load_freesolv` 默认下载 `freesolv.csv.gz`，其 y 已是全数据集 z-score。与原始 `SAMPL.csv` 的 642 行按顺序核对，标准化关系最大偏差仅 2.66e-15，原始总体标准差为 3.8448222046 kcal/mol。把该 y 的 RMSE 标成 kcal/mol，会虚假改善约 3.845 倍。','',
      '已停止并排除 `results-remaining` 错误批次。使用原始 `SAMPL.csv` 的 `expt` 列，通过原生 DeepChem CSVLoader 读入，只在训练集拟合标准化。纠正后的实验完整重跑到 `results-corrected`，没有缩小数据或改变模型参数。原日志、原压缩文件和数据纠正说明均保留。详见 `data/freesolv/SOURCE-CORRECTION.md`。','',
      '另一个早期错误是元数据读取旧文件名 SAMPL.csv，而原生 2.8 下载文件名已改变。后续对数值本身的交叉检查进一步发现了上述单位问题。两者不能混为同一个错误。','',
      '## 5. 固定实验协议与独立审计','',
      '- 模型：训练均值基线、ECFP4/RF 500 棵树、ECFP4/KRR（RBF，alpha=0.001，gamma=1/1024）、原生 GraphConv。',
      '- 图模型：75 维原子特征，图卷积 [128,128]，稠密层 256，batch 128，学习率 0.0005，100 epochs，dropout 0，batch normalization。',
      '- 主实验 random 80/10/10，种子 123、456、789。GraphConv 固定最后一个 epoch，不按测试集选点。不做原论文高斯过程超参数搜索。',
      '- DeepChem 2.8.0 / TensorFlow 2.15.1 / Python 3.10.11 / RDKit 2023.9.6。CPU 4 线程，启用 TensorFlow 确定性选项。没有声称使用 GPU。',
      '- `verify_results.py` 不导入训练脚本或其指标函数，从原始 CSV 和每个 predictions.csv 独立重算 RMSE、MAE、R²，检查数据哈希、标签/SMILES 对齐、分区完整性、训练集标准化、有限数值与 100 epoch。',
      '- 26 项专项单元测试通过，覆盖科学协议边界、独立指标计算、FreeSolv 单位交叉核对和大纲 schema。它们不等于 PI-GUI 全仓库测试，亦不能替代失败的真实集成链路。',
      f"- 汇总的模型 fit 时长 {result['fit_seconds_total']/60:.2f} 分钟；此值包含 GC 的周期验证开销，不含环境安装、所有最终预测、模型/API思考或主代理审阅，不等于任务端到端时长。",
      '- ESOL seed 123 重跑：mean、KRR、GC 逐行预测完全一致；RF 的171行有浮点末位差异，最大绝对差1.78e-15（1128行），不是有实质大小的性能偏移。符合并行浮点求和次序差异的表现，但未独立追踪底层线程求和顺序。不能据此保证跨硬件和跨库版本逐位重现。见 verification/diagnostics.json。','',
      '## 6. 两个工具实际测到了什么','',
      '| 维度 | Paper2Agent | Paper2Any |',
      '|---|---|---|',
      '| 项目 | jmiao24/Paper2Agent | OpenDCAI/Paper2Any |',
      '| 固定提交 | 8c2d059165ef8cdcb70dbea76655b9c2b55b38e6 | b538531e25798d9b9d41afd5fa93c9222949b5a5 |',
      '| 实测路线 | Paper2Skill：prepare / extract / reuse-review / build / strict verify / 检索 | 原生 outline_agent 与 outline_refine_agent 的 simple mode |',
      '| 输入 | 65页作者稿与已完成的逐页审查记录 | 阅读包正文、真实实验审计结果 |',
      '| 实际输出 | 35文件阅读包，30图片、1个结果CSV | 10页结构化大纲及修订版本 |',
      '| 模型 | Pi 中 DeepSeek V4.1 Flash | DeepSeek V4.1 Flash 真实API，顺序调用 |',
      '| 通过条件 | strict verify，机械完整性、所有页审查、无issues、0过期裁定 | 真实响应、10页schema、无虚构图片引用、修订产生实际变化 |',
      '| 未覆盖 | 完整 Paper2MCP 多代理代码转MCP | MinerU、SAM、图片模型、完整Web UI；原生制片已尝试但失败、未进入导出 |','',
      f"Paper2Any 回执复测的大纲阶段用时 {any_result['outline_seconds']:.2f} 秒，修订 {any_result['refine_seconds']:.2f} 秒。API 模型与 token 回执在 `gui-test/paper2any/outline-observed/api-receipts.json`。首轮观测器挂在未使用的 TextLLMCaller.call，导致回执数组为空；修正到真实调用的 ChatOpenAI.ainvoke 后独立重跑，未覆盖首轮。两轮均保留。组件通过并不自动证明内容科学正确。",'',
      f"另外实际调用了原生 `Paper2PPTFrontendService` 的无图片结构化路线，顺序逐页执行。实际状态：**{frontend['status']}**，处理页数 {frontend.get('pages',0)}，原生导出是否完成：{frontend.get('exported',False)}。完整回执与未修改的模型输出保存在 `gui-test/paper2any/frontend`。检测到默认模板、API失败或截断会明确判为未通过，不把上游返回的 success 单独当作成功依据。",'',
      '具体失败：20次请求均HTTP 200，10次主题请求的1400 token上限全部耗尽；页面2/4/9的3400 token上限也耗尽，缺失/不完整JSON被上游捕获后替换为默认模板。上游没有按 finish_reason 判失败。测试器原先预期主题缓存只调用一次，实际重复调用10次，因此额外产生请求数不符；即使去掉该计数断言，13次截断与3页模板回退也足以判失败。未通过加大上限、关闭思考或换模型掩盖该默认兼容问题。','',
      '主代理核对两轮大纲的关键实验数字均与审计汇总相符；首轮“趋势大体一致”不够严谨，FreeSolv 的GC排序实际劣于RF/KRR。第二轮一页塞入过多要点且保留汇报人XXX占位，不能直接视为最终成稿。这些未修改的上游输出作为测试证据保留，独立说明稿采用经核验的精简叙事。','',
      '测试副本的明确补丁：Paper2Agent 的 Windows 包内路径比对使用 `.as_posix()`，修复反斜杠误报；Paper2Any 的 text.py 与 base_agent.py 移除两处明文 key 日志。未向上游提交。仓库 README 将当前开源 Paper2Any 标为 legacy snapshot，本测试不代表其商业托管版本。','',
      '主交付 PPTX 使用可编辑原生图表和表格据核验结果制作；没有把该说明稿冒充 Paper2Any 原生导出结果。新增结构化路线的成功/失败独立记录，仍未覆盖 Web UI、MinerU 或图像模型。','',
      '## 7. Pi GUI 可视化验收','']
    for check in gui['checks']:
        lines.append(f"- **{check['status']}**：{check['name']}。{check['evidence']}")
    lines += ['', '### 已观察到的问题或限制','']
    for issue in gui['issues']:
        lines.append(f"- {issue}")
    lines += ['', '首轮401来自本测试生成器的旧式环境变量写法，而非用户原有key失效。修正为 `${DEEPSEEK_API_KEY}`，在GUI通过真实连接测试后重试。原有失败会话记录保留。','',
      '## 8. 文件索引','',
      '- `deliverables/MoleculeNet-复现与Pi工具实测-审定版.pptx`：最终中文说明演示文稿；不带“审定版”的文件为 Pi 阶段性生成记录，保留以核对历史回执。',
      '- `verification/summary.csv`：全模型汇总。`runs.json`：48个运行的独立验收。',
      '- `results/esol`、`results-corrected`：有效实验的指标、预测、分区与曲线。',
      '- `gui-test/paper2agent/moleculenet-paper`：Pi GUI 实际构建的阅读包。',
      '- `gui-test/paper2any`：原始和修订大纲及API回执。',
      '- `gui-test/evidence`：真实界面截图。`gui-test/session-audit.json`：最小化的会话执行审计。',
      '- `benchmark.py`、`experiment.json`、`verify_results.py` 与 `test_*.py`：可检查的科学代码与校验。','',
      '## 9. 复运行说明','',
      '本次实际验证平台为 Windows，本机所用精确依赖见 requirements.txt 及环境冻结清单。未测试 macOS/Linux 安装流程。不要覆盖已有 metrics.json，脚本会拒绝。完整重跑可用新输出目录，之后更新验证脚本中的数据根目录映射。','',
      '```powershell',
      '.\.venv\Scripts\python.exe benchmark.py --output results-new',
      '.\.venv\Scripts\python.exe -m pytest test_benchmark.py test_verify_results.py test_source_data.py test_outline_validation.py -q',
      '```','',
      'Paper2Any 使用独立 Python 3.12 环境，避免其现代依赖覆盖科学环境。脚本路径默认指向本次固定提交的本机临时克隆；移机时需要检出相同提交并更新 REPO 路径。密钥仅通过继承环境变量传入。Pi GUI 是本项目现有单一 Pi 核心，没有增加第二套核心。','',
      '## 10. 来源与许可','',
      '- [MoleculeNet 期刊全文](https://pmc.ncbi.nlm.nih.gov/articles/PMC5868307/)，Wu et al.，CC BY-NC 3.0；保留图表署名，阅读包原图不得脱离其许可再分发。',
      '- [DeepChem 2.8.0](https://github.com/deepchem/deepchem/tree/2.8.0)，原生科学实现。',
      '- [FreeSolv 原始数据库](https://github.com/MobleyLab/FreeSolv)。',
      '- [Paper2Agent](https://github.com/jmiao24/Paper2Agent)。',
      '- [Paper2Any](https://github.com/OpenDCAI/Paper2Any)。',
      '- [DeepSeek V4.1 发布说明](https://api-docs.deepseek.com/news/news260910/)。','']
    (ROOT/'REPORT.zh-CN.md').write_text('\n'.join(lines),encoding='utf-8')
    print('REPORT_WRITTEN')


if __name__ == '__main__':
    main()
