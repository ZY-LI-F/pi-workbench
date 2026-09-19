import { useEffect, useMemo, useState } from "react";
import type { LocalFilePreviewData } from "@shared/file-preview";
import { previewError, previewText } from "../lib/artifact-preview";
import { tableRowIndices, type DelimitedData, type TableQuery } from "../lib/delimited-data";
import { readDelimitedData } from "../lib/delimited-worker-client";

const PAGE_SIZE = 100;
export default function DelimitedPreview({ data }: { readonly data: LocalFilePreviewData }) {
  const [encoding, setEncoding] = useState("auto");
  const [table, setTable] = useState<DelimitedData>();
  const [error, setError] = useState<string>();
  const [raw, setRaw] = useState(false);
  const [freeze, setFreeze] = useState(true);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState<TableQuery>({ header: true, search: "", filterColumn: 0, filter: "", sortColumn: 0, sort: "original" });
  useEffect(() => {
    const controller = new AbortController();
    setTable(undefined); setError(undefined); setPage(0);
    void readDelimitedData(data.bytes, data.name.toLowerCase().endsWith(".tsv") ? "\t" : ",", encoding, controller.signal)
      .then((next) => { if (!controller.signal.aborted) setTable(next); }, (cause: unknown) => { if (!controller.signal.aborted) setError(previewError(cause)); });
    return () => controller.abort();
  }, [data, encoding]);
  const indices = useMemo(() => tableRowIndices(table?.rows ?? [], query), [table, query]);
  const pages = Math.max(1, Math.ceil(indices.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const headers = useMemo(() => Array.from({ length: table?.columns ?? 0 }, (_, index) => query.header ? table?.rows[0]?.[index] || `列 ${index + 1}（空标题）` : `列 ${index + 1}`), [table, query.header]);
  const update = (next: Partial<TableQuery>) => { setQuery((current) => ({ ...current, ...next })); setPage(0); };
  let source = table?.source ?? "";
  if (raw && !table) { try { source = previewText(data.bytes, encoding); } catch (cause) { source = previewError(cause); } }
  return <section className="artifact-reader" aria-label="CSV / TSV 阅读器">
    <div className="artifact-tools">
      <label>编码 <select aria-label="表格编码" value={encoding} onChange={(event) => setEncoding(event.target.value)}>
        <option value="auto">自动（BOM / UTF-8）</option><option value="utf-8">UTF-8</option><option value="gb18030">GB18030 / GBK</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option>
      </select></label>
      <label><input type="checkbox" checked={query.header} onChange={(event) => update({ header: event.target.checked })} />首行为标题</label>
      <label><input type="checkbox" checked={freeze} onChange={(event) => setFreeze(event.target.checked)} />冻结首列</label>
      <button type="button" aria-pressed={raw} onClick={() => setRaw(!raw)}>{raw ? "查看表格" : "查看原始文本"}</button>
    </div>
    <p className="artifact-note">文本原样保留，不计算公式、不自动转换编号或日期。数值排序支持高精度十进制；非数值排在最后。</p>
    {error && <p className="artifact-error" role="alert">表格解析失败：{error}</p>}
    {!table && !error && <p role="status">正在后台解析完整表格…</p>}
    {raw ? <pre className="artifact-raw">{source}</pre> : table && <>
      <div className="artifact-tools">
        <input aria-label="搜索表格" placeholder="搜索所有列" value={query.search} onChange={(event) => update({ search: event.target.value })} />
        <select aria-label="筛选列" value={query.filterColumn} onChange={(event) => update({ filterColumn: Number(event.target.value) })}>{headers.map((label, index) => <option key={index} value={index}>{label}</option>)}</select>
        <input aria-label="列包含文本" placeholder="此列包含…" value={query.filter} onChange={(event) => update({ filter: event.target.value })} />
      </div>
      <div className="artifact-tools">
        <label>排序列 <select aria-label="排序列" value={query.sortColumn} onChange={(event) => update({ sortColumn: Number(event.target.value) })}>{headers.map((label, index) => <option key={index} value={index}>{label}</option>)}</select></label>
        <select aria-label="表格排序方式" value={query.sort} onChange={(event) => update({ sort: event.target.value as TableQuery["sort"] })}>
          <option value="original">文件原始顺序</option><option value="text-asc">文本升序</option><option value="text-desc">文本降序</option><option value="number-asc">数值升序</option><option value="number-desc">数值降序</option>
        </select>
      </div>
      <div className={`artifact-table-scroll${freeze ? " is-frozen" : ""}`} tabIndex={0} aria-label="表格滚动区域">
        <table><thead><tr><th scope="col">记录</th>{headers.map((label, index) => <th scope="col" key={index}>{label}</th>)}</tr></thead>
          <tbody>{indices.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((rowIndex) => <tr key={rowIndex}><th scope="row">{rowIndex + 1}</th>{headers.map((_, index) => <td key={index}>{table.rows[rowIndex]?.[index] ?? ""}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="artifact-tools artifact-pagination">
        <span>{indices.length} / {Math.max(0, table.rows.length - (query.header ? 1 : 0))} 条数据 · {table.columns} 列 · 每页 {PAGE_SIZE} 条</span>
        <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页数据</button><span>{currentPage + 1} / {pages}</span><button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页数据</button>
      </div>
      {indices.length === 0 && <p role="status">没有匹配的数据记录</p>}
    </>}
  </section>;
}
