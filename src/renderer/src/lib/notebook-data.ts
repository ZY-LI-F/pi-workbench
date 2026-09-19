export type NotebookBundle = Readonly<Record<string, unknown>>;
export interface NotebookOutput { readonly type: string; readonly text?: string; readonly data?: NotebookBundle }
export interface NotebookCell {
  readonly type: "markdown" | "code" | "raw"; readonly source: string; readonly executionCount: number | null;
  readonly outputs: readonly NotebookOutput[]; readonly attachments: Readonly<Record<string, NotebookBundle>>;
}
export interface NotebookData { readonly cells: readonly NotebookCell[]; readonly language: string }
export function jsonRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
export function notebookText(value: unknown, label: string): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((part) => typeof part === "string")) return value.join("");
  throw new Error(`${label} 必须是字符串或字符串数组`);
}
export function parseNotebook(source: string): NotebookData {
  const root: unknown = JSON.parse(source);
  if (!jsonRecord(root) || root.nbformat !== 4 || !Array.isArray(root.cells)) throw new Error("仅支持包含 cells 的 nbformat 4 Notebook");
  const metadata = jsonRecord(root.metadata) ? root.metadata : {};
  const language = jsonRecord(metadata.language_info) && typeof metadata.language_info.name === "string" ? metadata.language_info.name : "text";
  const cells = root.cells.map((cell: unknown, index): NotebookCell => {
    const label = `第 ${index + 1} 个单元`;
    if (!jsonRecord(cell) || !["markdown", "code", "raw"].includes(String(cell.cell_type))) throw new Error(`${label} 类型无效`);
    const source = notebookText(cell.source, label);
    const attachments: Record<string, NotebookBundle> = Object.create(null);
    if (cell.attachments !== undefined) {
      if (!jsonRecord(cell.attachments)) throw new Error(`${label} 附件无效`);
      for (const [name, bundle] of Object.entries(cell.attachments)) {
        if (!jsonRecord(bundle)) throw new Error(`${label} 附件 ${name} 无效`);
        attachments[name] = bundle;
      }
    }
    if (cell.cell_type !== "code") return { type: cell.cell_type as "markdown" | "raw", source, executionCount: null, outputs: [], attachments };
    if (cell.execution_count !== null && (!Number.isSafeInteger(cell.execution_count) || Number(cell.execution_count) < 0)) throw new Error(`${label} 执行序号无效`);
    if (!Array.isArray(cell.outputs)) throw new Error(`${label} 缺少 outputs 数组`);
    const outputs = cell.outputs.map((output: unknown): NotebookOutput => {
      if (!jsonRecord(output) || typeof output.output_type !== "string") throw new Error(`${label} 输出结构无效`);
      if (output.output_type === "stream") {
        if (output.name !== "stdout" && output.name !== "stderr") throw new Error(`${label} 日志流名称无效`);
        return { type: output.name, text: notebookText(output.text, `${label} 日志`) };
      }
      if (output.output_type === "error") {
        if (!Array.isArray(output.traceback) || !output.traceback.every((line) => typeof line === "string")) throw new Error(`${label} 错误堆栈无效`);
        return { type: "error", text: `${String(output.ename ?? "Error")}: ${String(output.evalue ?? "")}\n${output.traceback.join("\n")}` };
      }
      if (["display_data", "execute_result"].includes(output.output_type)) {
        if (!jsonRecord(output.data)) throw new Error(`${label} 缺少 MIME 输出数据`);
        return { type: "display", data: output.data };
      }
      return { type: `unsupported:${output.output_type}`, data: output };
    });
    return { type: "code", source, executionCount: cell.execution_count as number | null, outputs, attachments };
  });
  return { cells, language };
}
