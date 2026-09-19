import { useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import bash from "highlight.js/lib/languages/bash";
import powershell from "highlight.js/lib/languages/powershell";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import { previewError } from "../lib/artifact-preview";

for (const [name, grammar] of Object.entries({ python, r, bash, powershell, javascript, typescript })) hljs.registerLanguage(name, grammar);
const EXTENSIONS: Readonly<Record<string, string>> = { py: "python", r: "r", sh: "bash", bash: "bash", ps1: "powershell", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript" };
const PAGE_SIZE = 200;
export default function CodePreview({ source, name, language, onCopy, compact = false }: {
  readonly source: string; readonly name: string; readonly language?: string; readonly onCopy?: (source: string) => Promise<void>; readonly compact?: boolean;
}) {
  const lines = useMemo(() => source.split(/\r?\n/), [source]);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [match, setMatch] = useState(0);
  const [lineInput, setLineInput] = useState("");
  const [feedback, setFeedback] = useState<string>();
  const [focusedLine, setFocusedLine] = useState<number>();
  const sourceRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => query ? lines.flatMap((line, index) => line.toLowerCase().includes(query.toLowerCase()) ? [index] : []) : [], [lines, query]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(lines.length / PAGE_SIZE) - 1));
  const selectedLanguage = language ?? EXTENSIONS[name.split(".").at(-1)?.toLowerCase() ?? ""];
  const highlighted = useMemo(() => {
    const text = lines.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).join("\n");
    return selectedLanguage && hljs.getLanguage(selectedLanguage) ? hljs.highlight(text, { language: selectedLanguage, ignoreIllegals: true }).value : undefined;
  }, [lines, currentPage, selectedLanguage]);
  useEffect(() => { setPage(0); setMatch(0); setFeedback(undefined); }, [source]);
  useEffect(() => {
    const element = sourceRef.current;
    const row = element?.querySelector<HTMLElement>(`[data-source-line="${focusedLine}"]`);
    if (element && row) element.scrollTop = row.offsetTop - 14;
  }, [focusedLine, currentPage]);
  const find = (index: number) => {
    if (!matches.length) return;
    const next = (index + matches.length) % matches.length;
    setMatch(next); setPage(Math.floor(matches[next]! / PAGE_SIZE)); setFocusedLine(matches[next]);
  };
  return <section className={`artifact-reader artifact-code${compact ? " is-compact" : ""}`} aria-label={`源码 ${name}`}>
    {!compact && <p className="artifact-note">只读源码 · {selectedLanguage && hljs.getLanguage(selectedLanguage) ? selectedLanguage : "纯文本（未提供此语言高亮）"} · 不运行代码或注册 MCP</p>}
    <details className="artifact-code__controls" open={compact ? undefined : true}>
      <summary>查找、跳转与复制</summary>
    <div className="artifact-tools">
      <input aria-label={`在 ${name} 中查找`} placeholder="查找源码" value={query} onChange={(event) => {
        const term = event.target.value; setQuery(term); setMatch(0);
        const first = term ? lines.findIndex((line) => line.toLowerCase().includes(term.toLowerCase())) : -1;
        if (first >= 0) { setPage(Math.floor(first / PAGE_SIZE)); setFocusedLine(first); }
      }} onKeyDown={(event) => { if (event.key === "Enter") find(event.shiftKey ? match - 1 : match + 1); }} />
      <button type="button" disabled={!matches.length} onClick={() => find(match - 1)}>上一处</button><button type="button" disabled={!matches.length} onClick={() => find(match + 1)}>下一处</button>
      {query && <span>{matches.length ? `${match + 1} / ${matches.length} · 第 ${matches[match]! + 1} 行` : "没有匹配行"}</span>}
      {onCopy && <button type="button" onClick={() => { void onCopy(source).then(() => setFeedback("已复制完整源码"), (cause: unknown) => setFeedback(`复制失败：${previewError(cause)}`)); }}>复制完整源码</button>}
    </div>
    <form className="artifact-tools" onSubmit={(event) => { event.preventDefault(); const line = Number(lineInput); if (Number.isSafeInteger(line) && line >= 1 && line <= lines.length) { setPage(Math.floor((line - 1) / PAGE_SIZE)); setFocusedLine(line - 1); setFeedback(`已定位第 ${line} 行`); } else setFeedback(`行号应为 1–${lines.length} 的整数`); }}>
      <label>跳转行 <input aria-label="源码行号" type="number" min={1} max={lines.length} value={lineInput} onChange={(event) => setLineInput(event.target.value)} /></label><button type="submit">定位</button>
      <span>{currentPage * PAGE_SIZE + 1}–{Math.min(lines.length, (currentPage + 1) * PAGE_SIZE)} / {lines.length} 行</span>
      <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>前 {PAGE_SIZE} 行</button><button type="button" disabled={(currentPage + 1) * PAGE_SIZE >= lines.length} onClick={() => setPage(currentPage + 1)}>后 {PAGE_SIZE} 行</button>
    </form>
    {feedback && <p role="status">{feedback}</p>}
    </details>
    <div className="artifact-code__source" tabIndex={0} ref={sourceRef}>
      <pre className="artifact-code__numbers" aria-label="源码行号列表">{lines.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((_, index) => {
        const row = currentPage * PAGE_SIZE + index;
        return <span data-source-line={row} className={matches.includes(row) || row === focusedLine ? "is-match" : ""} key={row}>{row + 1}{"\n"}</span>;
      })}</pre>
      {highlighted === undefined ? <pre><code>{lines.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).join("\n")}</code></pre> : <pre><code dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>}
    </div>
  </section>;
}
