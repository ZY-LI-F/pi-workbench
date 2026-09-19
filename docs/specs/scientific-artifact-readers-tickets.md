# 科研产物阅读器 · Tickets / Todo

规格：[scientific-artifact-readers.md](scientific-artifact-readers.md)。勾选必须有代码与测试证据，不以编译代替交互验收。

## AR-01 · 目录导航与只读资源访问

- [x] 定义目录列表/链接解析契约，增加原生文件夹选择与独立只读授权。
- [x] 按目录导航、类别筛选、搜索、分页和关联外部证据目录。
- [x] 文件缺失、越界、编码路径、符号链接、取消选择与导航回退测试。

证据：`artifact-library-service.test.ts` 6 项真实文件系统测试，包括授权根目录被 junction 替换后不继承权限；目录取消/搜索的组件测试与真实 IPC E2E。

## AR-02 · 学术 Markdown 与连续阅读

- [x] 公式、目录、脚注、锚点、相对图片与文件链接。
- [x] PDF 明确页码跳转，返回原文件原位置，保持窄栏尺寸。
- [x] 重名标题、中文路径、资源错误及无脚本执行测试。

证据：`artifact-readers-ui.test.tsx`、`scientific-artifact-readers.spec.ts`。回归同时修正 Markdown 刷新重建链接、导航工具栏挤压、窄 PDF 页错误选回上一页。

## AR-03 · CSV / TSV 数据阅读

- [x] 字符串保真解析、编码与表头选择、原文视图。
- [x] 搜索、列过滤、明确排序方式、冻结首列及分页。
- [x] 引号/换行/空白/BOM/长 ID/公式文本/坏文件与大表测试。

证据：`artifact-readers-data.test.ts` 的精度/编码/12,000+ 行测试；Electron 实际 Worker 解析、分页/搜索/排序和真实 MoleculeNet CSV。

## AR-04 · JSON 与验证证据

- [x] JSON 树、搜索、原文与解析错误。
- [x] Paper2Skill 真实状态、限制与文档摘要；证据链接。
- [x] 有限制不冒充成功、缺失字段不猜测、关联根目录解析测试。

证据：真实 `reviewed_with_limitations` 报告及根目录关联后打开图表的 E2E；泛用 JSON `status` 不误当论文验证报告；大整数树视图明确提示以原文为准。

## AR-05 · 只读 Notebook

- [x] nbformat 4 校验、单元格、附件、保存输出、错误与未知 MIME。
- [x] 复用 Markdown/代码/图像与隔离 HTML 组件，不启动内核。
- [x] 无输出、坏结构、恶意 HTML、attachments 与混合输出测试。

证据：保存输出夹具的单测与 Electron E2E，实际验证 sandbox 中的脚本未执行且未发出外部请求。夹具明确标记为合成测试，不冒充真实 Paper2MCP 运行结果。

## AR-06 · 源码与 MCP 说明

- [x] 源码类型注册、只读高亮、行号、搜索/跳转与复制。
- [x] `USAGE.md` 与 schema 导航；打开源码无进程执行。
- [x] Python/R/Shell/JS 等语法和特殊字符测试。

证据：405 行分页/复制测试、R/Shell/PowerShell/JS/TS 实际高亮测试、MCP 文档 → 源码 → schema E2E。PowerShell 新增只读预览但系统直接执行仍被拒绝。

## AR-07 · 集成与验收

- [x] 保留统一文件下拉、引用、版本检查、刷新、拖宽、关闭。
- [x] 全量类型/Lint/单测、构建、原生 Electron 回归。
- [x] 六项能力的可视化 E2E、真实论文包补充验收。
- [x] 更新中英文 README、验收记录及所有 ticket 的真实结果。

证据：`npm run check`（134 文件、654 通过、1 平台跳过）、生产构建、24/24 原生 Electron E2E；最终 SVG 保真调整后 14/14 组件专项及 3/3 科研 E2E 复验通过。详见[验收记录](../testing/scientific-artifact-readers-2026-09-19.md)。本轮不含提交、推送或安装包发布。
