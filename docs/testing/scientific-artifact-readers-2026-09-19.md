# 科研产物阅读器 · 验收记录

日期：2026-09-19。范围：[Spec](../specs/scientific-artifact-readers.md)、[Tickets](../specs/scientific-artifact-readers-tickets.md)。

## 环境与结果

- Windows 本机；源码版本仍为 `0.7.2`，Electron `43.1.1`，唯一官方 Pi 核心 `0.85.1`。本轮没有升级 Pi、改动全局 Pi 配置、推送仓库或生成安装包。
- `npm run check`：类型检查与 Lint 通过；134 个测试文件、654 项测试通过、1 项平台跳过。跳过的是 `node-cli-discovery.test.ts` 中不适用于 Windows 的 macOS 可执行符号链接测试。
- `npm run build`：生产构建通过。KaTeX/高亮/Notebook 阅读器按需加载，表格使用独立 Worker；字体与解析代码本地打包，不依赖 CDN。
- 设置真实论文包路径后运行 `npm run test:e2e:native`：24/24 通过，约 3.3 分钟。覆盖聊天、Skills、模型配置、会话/草稿、实际文件工具、自动/手动压缩、长会话、后台停止、Office/PDF 以及新增阅读链。
- SVG 最终保真调整后的组件专项：14/14 通过；最终生产构建通过，三条科研 E2E（含真实论文包）再次 3/3 通过，约 29 秒。
- `git diff --check`：通过。

## 新增验收场景

| 能力 | 实际检查 |
| --- | --- |
| 目录与授权 | 原生文件夹选择取消/确认、当前目录搜索、分类/分页、关联独立证据目录；中文和编码路径、缺失文件、普通符号链接越界、授权目录后来被 junction 替换 |
| 学术 Markdown | KaTeX 公式、重名标题、脚注、相对 SVG、正文 → CSV/PDF/源码；返回保留原滚动位置和窄栏宽度；运行状态刷新不重建链接节点 |
| CSV/TSV | 实际 Worker 解析；前导零、超过 JS 安全精度的整数、引号/换行、公式样文本、UTF-8/BOM/UTF-16/GB18030、显式数值排序、搜索、列过滤、分页；12,000+ 行不截断 |
| JSON/验证报告 | 原文/树/搜索、坏 JSON 错误、大整数精度提示、缺失字段不推断通过；`reviewed_with_limitations` 明确呈现限制；关联包根目录后打开 `artifact_checks[].file` |
| Notebook | nbformat 4 结构、字符串数组、Markdown 附件、保存日志、错误、静态 HTML 表格、未知 widget MIME、无保存输出；HTML sandbox 无脚本执行和外部网络请求 |
| 源码/MCP 文档 | Python/R/Shell/PowerShell/JS/TS 高亮与特殊字符；405 行分页、定位、完整复制；`USAGE.md` → 源码 → schema；不 import、不执行、不注册 MCP |

## 真实论文产物检查

使用此前保存在本机的 MoleculeNet Paper2Skill 产物，复制到隔离 E2E 项目读取，未修改原始产物：

- `references/paper.md` → `assets/table/table-8.csv`：真实论文表格可以切换到数据阅读器；指标与误差文本原样保留。
- `moleculenet-review/verification.json`：显示“已复核（存在限制）”，不会改成“科学复现成功”。
- 关联 `moleculenet-paper` 根目录后，从验证报告打开 `assets/figure/figure-p0006-003.jpg`。
- 关联独立 evidence/originals 目录，打开真实 65 页 PDF，跳到第 6 页并检查 Methods 文字和图像。截图已由主代理实际查看。

新增常规 Notebook/源码夹具明确是**合成的阅读器测试**。本次测试没有调用付费/远端模型，也没有重新运行 Paper2Agent/Paper2MCP 的科研实验。原生 E2E 启动真实 Electron 与未修改的 Pi，模型接口使用仓库已有的、明确标记的本地协议夹具；UI 与文件读取走真实 IPC 和真实文件系统。

## 测试发现并修复的问题

1. 导航工具栏误落入旧网格窄列：为阅读导航独占整行，避免文字竖排和挤压正文。
2. Markdown 渲染时内联组件身份变化：稳定链接/图片组件，保留焦点、图像解码与滚动过程。
3. 窄 PDF 页比视口短：旧“第一张有部分可见”的页码判断会覆盖明确跳页，改为主要可见页；非法及超范围链接不猜测页码。
4. 目录读取错误后取消原生选择：保留原错误，不出现假装仍在加载的状态。
5. 授权目录被替换为 junction：只读授权绑定当时的规范目录，不能跟随新目标继承权限。
6. SVG 安全处理与科研图保真：移除脚本、事件和外链，保留普通 CSS、本地渐变和内嵌位图；不让隔离过程抹掉正常图表内容。
7. 旧 E2E 假设 `.ps1` 不能预览：更新为验证新需求“只读源码可预览，但系统直接打开仍被拒绝”，不是删除安全检查。

## 复现命令与本地证据

```powershell
npm run check
npm run build
# 不设置此变量时，仅跳过依赖私有本机样本的第三条科研测试。
$env:STELLA_REAL_PAPER_BUNDLE = 'C:\path\to\moleculenet-paper'
npm run test:e2e:native
```

真实样本测试需要相邻的 `moleculenet-review/verification.json` 和 `originals/s001-moleculenet-author-manuscript.pdf`。通用两条科研 E2E 不依赖这些私有数据。

可视化证据由测试写到被 Git 忽略的 `test-results/scientific-artifact-reader-*/`：`csv-narrow-reader.png`、`source-readonly.png`、`verification-with-limitations.png`、`notebook-saved-outputs.png`、`real-paper-table.png`、`real-paper-figure.png`、`real-paper-original-pdf.png`。测试输出和原有 `output/` 不属于本次源码交付。

## 明确边界

- 保持单一 Pi 核心；不增加 Python、Jupyter、Office 插件或 MCP 服务依赖。
- 目录搜索仅作用于当前层，全部条目分页可达，不递归扫描硬盘。目录类别按格式/名称辅助归类，不替代来源鉴定。
- 授权与阅读链限于当前应用运行；会话切换隔离阅读链，仍保留已有会话文件恢复机制。
- Notebook 只读已保存内容，不支持交互 widget 或运行单元。HTML 不加载外部资源；远端图片需先保存到已授权本地目录。
- JSON 树使用 JS 数字，超过安全整数精度会明确提示以原始 JSON 为准；CSV 数值和标识符不进行数值转换。
- 本轮不验证科学结论，不自动解压/安装代码包；未构建安装器，未执行 macOS 运行时验收，未提交或推送 GitHub。
