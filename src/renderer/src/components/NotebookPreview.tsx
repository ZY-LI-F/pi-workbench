import { useMemo, useState } from "react";
import type { LocalFilePreviewData } from "@shared/file-preview";
import type { StellaDesktopApi } from "@shared/contracts";
import { notebookText, parseNotebook, type NotebookBundle, type NotebookOutput } from "../lib/notebook-data";
import { previewError, previewText } from "../lib/artifact-preview";
import AcademicMarkdown from "./AcademicMarkdown";
import CodePreview from "./CodePreview";
import { ArtifactImage, embeddedImage, StaticArtifactHtml } from "./ArtifactMedia";
import { JsonNode } from "./JsonPreview";

const SUPPORTED = ["image/png", "image/jpeg", "image/svg+xml", "text/html", "text/markdown", "text/latex", "application/json", "text/plain"];
function MimeOutput({ bundle, api, fromPath, onNavigate }: { readonly bundle: NotebookBundle; readonly api: StellaDesktopApi; readonly fromPath: string; readonly onNavigate: (href: string) => Promise<void> }) {
  const types = Object.keys(bundle);
  const [selected, setSelected] = useState(() => SUPPORTED.find((mime) => Object.hasOwn(bundle, mime)) ?? types[0] ?? "");
  const content = useMemo(() => {
    try {
      const value = bundle[selected];
      if (selected === "application/json" || !SUPPORTED.includes(selected)) return { value };
      const text = notebookText(value, selected);
      if (selected === "image/svg+xml") return { image: { bytes: new TextEncoder().encode(text), mimeType: selected } };
      if (selected.startsWith("image/")) return { image: embeddedImage(`data:${selected};base64,${text}`) };
      return { text };
    } catch (cause) { return { error: previewError(cause) }; }
  }, [bundle, selected]);
  return <div className="artifact-notebook__output">
    {types.length > 1 && <label className="artifact-tools">输出格式 <select aria-label="Notebook 输出格式" value={selected} onChange={(event) => setSelected(event.target.value)}>{types.map((mime) => <option key={mime}>{mime}</option>)}</select></label>}
    {content.error ? <p role="alert" className="artifact-error">{content.error}</p>
      : content.image ? <ArtifactImage {...content.image} name="Notebook 保存的图像输出" />
      : selected === "text/html" ? <><small>已保存的静态 HTML · 脚本、外部资源和表单已隔离</small><StaticArtifactHtml source={content.text ?? ""} title="Notebook 静态 HTML 输出" /></>
      : ["text/markdown", "text/latex"].includes(selected) ? <AcademicMarkdown api={api} fromPath={fromPath} source={content.text ?? ""} onNavigate={onNavigate} compact />
      : selected === "text/plain" ? <pre className="artifact-raw">{content.text}</pre>
      : selected === "application/json" ? <JsonNode value={content.value} initiallyOpen />
      : <><p className="artifact-note">不支持可视化此输出格式：{selected || "空 MIME 数据"}。不会执行 widget、JavaScript 或请求外部服务。</p><JsonNode value={content.value} label={selected || "data"} /></>}
  </div>;
}

function SavedOutput({ output, api, fromPath, onNavigate }: { readonly output: NotebookOutput; readonly api: StellaDesktopApi; readonly fromPath: string; readonly onNavigate: (href: string) => Promise<void> }) {
  if (output.type === "display") return <MimeOutput bundle={output.data!} api={api} fromPath={fromPath} onNavigate={onNavigate} />;
  if (output.type.startsWith("unsupported:")) return <div className="artifact-notebook__output"><p className="artifact-note">未支持的输出类型：{output.type.slice(12)}；仅显示保存的数据。</p><JsonNode value={output.data} /></div>;
  // Strip only terminal styling; never interpret terminal control sequences as commands.
  const text = output.text?.replace(/\u001b\[[0-9;]*m/g, "");
  return <div className={`artifact-notebook__output is-${output.type}`}><strong>{output.type === "error" ? "文件保存的错误输出" : output.type}</strong><pre className="artifact-raw">{text}</pre></div>;
}

export default function NotebookPreview({ data, api, onNavigate }: { readonly data: LocalFilePreviewData; readonly api: StellaDesktopApi; readonly onNavigate: (href: string) => Promise<void> }) {
  const parsed = useMemo(() => {
    let source = "";
    try { source = previewText(data.bytes); return { source, notebook: parseNotebook(source) }; }
    catch (cause) { return { source, error: previewError(cause) }; }
  }, [data]);
  const [raw, setRaw] = useState(false);
  return <section className="artifact-reader artifact-notebook" aria-label="Notebook 只读阅读器">
    <div className="artifact-tools"><strong>{parsed.notebook?.cells.length ?? "—"} 个单元</strong><button type="button" aria-pressed={raw} onClick={() => setRaw(!raw)}>{raw ? "查看单元" : "查看原始 Notebook"}</button></div>
    <p className="artifact-note">仅显示文件中保存的单元和输出；不启动 Python / R 内核，不重跑代码。执行序号不是本次运行的状态。</p>
    {parsed.error && <p className="artifact-error" role="alert">Notebook 解析失败：{parsed.error}</p>}
    {raw || parsed.error ? <pre className="artifact-raw">{parsed.source}</pre> : parsed.notebook?.cells.map((cell, index) => <section key={index} className="artifact-notebook__cell" aria-label={`Notebook 单元 ${index + 1}`}>
      <header>单元 {index + 1} · {cell.type}{cell.type === "code" && ` · In [${cell.executionCount ?? " "}]（保存值）`}</header>
      {cell.type === "markdown" ? <AcademicMarkdown source={cell.source} fromPath={data.canonicalPath} api={api} attachments={cell.attachments} onNavigate={onNavigate} compact />
        : cell.type === "raw" ? <pre className="artifact-raw">{cell.source}</pre>
        : <><details open><summary>代码 · 只读</summary><CodePreview source={cell.source} name={`单元 ${index + 1}`} language={parsed.notebook!.language} onCopy={api.copyText} compact /></details>
          {cell.outputs.length === 0 ? <p className="artifact-note">未保存输出；不会自动执行此单元。</p> : cell.outputs.map((output, outputIndex) => <SavedOutput key={outputIndex} output={output} api={api} fromPath={data.canonicalPath} onNavigate={onNavigate} />)}</>}
    </section>)}
  </section>;
}
