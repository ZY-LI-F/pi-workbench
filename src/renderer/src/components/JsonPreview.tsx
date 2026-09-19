import { useMemo, useState } from "react";
import type { LocalFilePreviewData } from "@shared/file-preview";
import { previewError, previewText } from "../lib/artifact-preview";
import { jsonRecord } from "../lib/notebook-data";
import { searchJson, verificationReport } from "../lib/verification-report";

function scalar(value: unknown): string { return typeof value === "string" ? JSON.stringify(value) : String(value); }
function summary(value: unknown): string { return value !== null && typeof value === "object" ? `${Array.isArray(value) ? "数组" : "对象"} · ${Object.keys(value).length} 项` : scalar(value); }
const PAGE_SIZE = 50;
export function JsonNode({ value, label = "$", initiallyOpen = false }: { readonly value: unknown; readonly label?: string; readonly initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [page, setPage] = useState(0);
  if (value === null || typeof value !== "object") return <div className="artifact-json__leaf"><strong>{label}: </strong><span>{scalar(value)}</span>{typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value) && <em> · 超出安全整数精度，请以原始 JSON 为准</em>}</div>;
  const entries = Object.entries(value);
  return <div className="artifact-json__node">
    <button type="button" className="artifact-json__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "▾" : "▸"} {label} <small>{summary(value)}</small></button>
    {open && <div className="artifact-json__children">
      {entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(([key, child]) => <JsonNode key={key} label={key} value={child} />)}
      {entries.length > PAGE_SIZE && <div className="artifact-tools"><button type="button" disabled={!page} onClick={() => setPage(page - 1)}>前 {PAGE_SIZE} 项</button><span>{page * PAGE_SIZE + 1}–{Math.min(entries.length, (page + 1) * PAGE_SIZE)} / {entries.length}</span><button type="button" disabled={(page + 1) * PAGE_SIZE >= entries.length} onClick={() => setPage(page + 1)}>后 {PAGE_SIZE} 项</button></div>}
    </div>}
  </div>;
}

function pathHref(path: string, page?: unknown): string {
  return encodeURI(path).replace(/#/g, "%23").replace(/\?/g, "%3F") + (Number.isSafeInteger(page) && Number(page) > 0 ? `#page=${page}` : "");
}
function VerificationSummary({ value, artifactRoot, onNavigate }: { readonly value: unknown; readonly artifactRoot?: string; readonly onNavigate: (href: string, root?: string) => Promise<void> }) {
  const report = verificationReport(value);
  const [error, setError] = useState<string>();
  if (!report) return null;
  const navigate = (href: string, root?: string) => { setError(undefined); void onNavigate(href, root).catch((cause: unknown) => setError(previewError(cause))); };
  return <section className="artifact-verification" aria-label="验证报告摘要">
    <h3>阅读包验证报告</h3><strong className={`artifact-status is-${report.status.tone}`}>{report.status.label}</strong>
    <p>机械检查：{report.mechanical} · 人工 / Agent 复核：{report.reviewed}</p>
    <p className="artifact-note">这些是文件中记录的检查结果，不代表当前 GUI 重新验证，也不证明论文结论、模型指标或科学复现成功。</p>
    {report.scope && <p><strong>报告范围：</strong>{report.scope}</p>}
    {report.limitations !== undefined && <div><h4>限制与保留意见</h4><JsonNode value={report.limitations} label="limitations" initiallyOpen /></div>}
    <h4>问题与差异</h4>{report.issues === undefined ? <p>报告未提供 issues 字段，不能据此判断无问题。</p> : report.issues.length === 0 ? <p>报告的 issues 列表为空；仍需阅读限制说明。</p> : <JsonNode value={report.issues} label="issues" initiallyOpen />}
    {report.documents.length > 0 && <><h4>来源文档</h4>{report.documents.map((document) => <div key={document.name} className="artifact-verification__document"><JsonNode label={document.name} value={document.data} />
      {jsonRecord(document.data) && ["file", "path", "source", "evidence"].filter((key) => typeof document.data === "object" && document.data !== null && typeof (document.data as Record<string, unknown>)[key] === "string").map((key) => {
        const metadata = document.data as Record<string, unknown>;
        return <button key={key} type="button" onClick={() => navigate(pathHref(metadata[key] as string, metadata.page))}>查看 {key}：{String(metadata[key])}</button>;
      })}</div>)}</>}
    {report.artifacts.length > 0 && <><h4>图表与产物核对 · {report.artifacts.length}</h4>
      {!artifactRoot && <p className="artifact-note">请先用“产物目录 → 选择产物目录”关联阅读包根目录；报告中的 file 相对于阅读包，不一定相对于报告本身。</p>}
      {report.artifacts.map((artifact, index) => <div key={index}><JsonNode label={`产物 ${index + 1}`} value={artifact} />{typeof artifact.file === "string" && <button type="button" disabled={!artifactRoot} title={artifactRoot} onClick={() => navigate(pathHref(String(artifact.file)), artifactRoot)}>查看产物 {artifact.file}</button>}</div>)}
    </>}
    {error && <p role="alert" className="artifact-error">{error}</p>}
  </section>;
}

export default function JsonPreview({ data, artifactRoot, onNavigate }: { readonly data: LocalFilePreviewData; readonly artifactRoot?: string; readonly onNavigate: (href: string, root?: string) => Promise<void> }) {
  const parsed = useMemo(() => {
    let source = "";
    try { source = previewText(data.bytes); return { source, value: JSON.parse(source) as unknown }; }
    catch (cause) { return { source, error: previewError(cause) }; }
  }, [data]);
  const [raw, setRaw] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const matches = useMemo(() => searchJson(parsed.value, query), [parsed.value, query]);
  const isVerification = /^verification(?:[._-]|$)/i.test(data.name) || (jsonRecord(parsed.value)
    && ["mechanical_ok", "all_sources_agent_reviewed", "all_pages_agent_reviewed", "artifact_checks"].some((key) => Object.hasOwn(parsed.value as object, key)));
  return <section className="artifact-reader artifact-json" aria-label="JSON 阅读器">
    <div className="artifact-tools"><button type="button" aria-pressed={raw} onClick={() => setRaw(!raw)}>{raw ? "查看结构" : "查看原始 JSON"}</button>
      {!raw && <input aria-label="搜索 JSON 键和值" placeholder="搜索键、值或路径" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />}
    </div>
    {parsed.error && <p role="alert" className="artifact-error">JSON 解析失败：{parsed.error}。原始文本仍可查看。</p>}
    {raw || parsed.error ? <pre className="artifact-raw">{parsed.source}</pre> : <>
      {isVerification && <VerificationSummary value={parsed.value} artifactRoot={artifactRoot} onNavigate={onNavigate} />}
      {query ? <div><p>{matches.length} 个匹配项</p>{matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((item) => <JsonNode key={item.path} label={item.path} value={item.value} />)}
        {matches.length > PAGE_SIZE && <div className="artifact-tools"><button type="button" disabled={!page} onClick={() => setPage(page - 1)}>上一页结果</button><span>{page + 1} / {Math.ceil(matches.length / PAGE_SIZE)}</span><button type="button" disabled={(page + 1) * PAGE_SIZE >= matches.length} onClick={() => setPage(page + 1)}>下一页结果</button></div>}
      </div> : <JsonNode value={parsed.value} initiallyOpen />}
    </>}
  </section>;
}
