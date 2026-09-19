import { useEffect, useMemo, useState } from "react";
import { ArrowUp, File, Folder, RefreshCw } from "lucide-react";
import type { StellaDesktopApi } from "@shared/contracts";
import type { LocalPathInspection } from "@shared/local-path";
import type { ArtifactDirectory } from "@shared/artifact-library";
import { artifactCategory, previewError, previewParent } from "../lib/artifact-preview";
import { Modal } from "./Modal";

interface Props {
  readonly api: StellaDesktopApi; readonly initialPath?: string;
  readonly artifactRoot?: string; readonly evidenceRoot?: string;
  readonly onRoot: (path: string, evidence: boolean) => void;
  readonly onSelect: (file: LocalPathInspection) => void; readonly onClose: () => void;
}
const PAGE_SIZE = 50;
export function ArtifactLibraryPicker({ api, initialPath, artifactRoot, evidenceRoot, onRoot, onSelect, onClose }: Props) {
  const [path, setPath] = useState(initialPath ?? artifactRoot ?? evidenceRoot);
  const [listing, setListing] = useState<ArtifactDirectory>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (!path) return;
    let active = true;
    setListing(undefined); setError(undefined); setPage(0);
    void api.listArtifactDirectory(path).then((next) => { if (active) setListing(next); }, (cause: unknown) => { if (active) setError(previewError(cause)); });
    return () => { active = false; };
  }, [api, path, reload]);
  const entries = useMemo(() => listing?.entries.filter((entry) => entry.name.toLowerCase().includes(query.toLowerCase())
    && (category === "全部" || (entry.inspection?.kind === "directory" ? category === "文件夹" : entry.inspection && artifactCategory(entry.inspection) === category))) ?? [], [listing, query, category]);
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const choose = async (evidence: boolean) => {
    setBusy(true);
    try {
      const directory = await api.chooseArtifactDirectory();
      if (directory) { onRoot(directory.canonicalPath, evidence); setPath(directory.canonicalPath); setQuery(""); setCategory("全部"); setReload((value) => value + 1); }
    } catch (cause) { setError(previewError(cause)); }
    finally { setBusy(false); }
  };
  return <Modal title="产物与证据目录" eyebrow="LOCAL READING LIBRARY" onClose={onClose} className="artifact-library">
    <p className="artifact-note">只读浏览，不切换项目、不授予执行信任。授权仅在本次应用运行期间有效。</p>
    <div className="artifact-tools">
      <button type="button" disabled={busy} onClick={() => void choose(false)}>选择产物目录</button>
      <button type="button" disabled={busy} onClick={() => void choose(true)}>关联证据目录</button>
      {artifactRoot && <button type="button" title={artifactRoot} onClick={() => setPath(artifactRoot)}>产物根目录</button>}
      {evidenceRoot && <button type="button" title={evidenceRoot} onClick={() => setPath(evidenceRoot)}>证据根目录</button>}
    </div>
    <div className="artifact-tools">
      <button type="button" aria-label="上一级目录" disabled={!path || previewParent(path) === path} onClick={() => path && setPath(previewParent(path))}><ArrowUp size={15} /></button>
      <code className="artifact-path">{path ?? "尚未选择目录"}</code>
      <button type="button" aria-label="刷新目录" disabled={!path} onClick={() => setReload((value) => value + 1)}><RefreshCw size={15} /></button>
    </div>
    <div className="artifact-tools">
      <input aria-label="搜索当前目录" placeholder="搜索当前目录中的文件名" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
      <select aria-label="产物类别" value={category} onChange={(event) => { setCategory(event.target.value); setPage(0); }}>
        {["全部", "文件夹", "正文与说明", "补充材料", "图像", "表格", "PDF 文档", "验证与数据", "Notebook", "源码", "其他"].map((item) => <option key={item}>{item}</option>)}
      </select>
    </div>
    {error && <p className="artifact-error" role="alert">{error}</p>}
    {path && !listing && !error && <p role="status">正在读取当前目录…</p>}
    <ul className="artifact-library__entries" aria-label="目录内容">
      {entries.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((entry) => {
        const file = entry.inspection;
        const directory = file?.kind === "directory";
        return <li key={entry.path}>
          <button type="button" disabled={!file || (!directory && !file.preview)} title={entry.path} onClick={() => {
            if (!file) return;
            if (directory) { setPath(file.canonicalPath); setQuery(""); setCategory("全部"); }
            else { onSelect(file); onClose(); }
          }}>
            {directory ? <Folder size={18} /> : <File size={18} />}
            <span><strong>{entry.name}</strong><small>{entry.error ?? (directory ? "文件夹" : file?.preview ? artifactCategory(file) : "此类型暂不支持预览")}</small></span>
            {file?.modifiedAt !== undefined && <time dateTime={new Date(file.modifiedAt).toISOString()} title="文件修改时间">{new Date(file.modifiedAt).toLocaleString("zh-CN")}</time>}
          </button>
        </li>;
      })}
    </ul>
    {listing && entries.length === 0 && <p role="status">{query || category !== "全部" ? "当前目录没有匹配项" : "这是空目录"}</p>}
    <div className="artifact-tools artifact-pagination">
      <span>{entries.length} 项 · 文件夹优先，其余按修改时间倒序 · 不递归搜索</span>
      <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button>
      <span>{currentPage + 1} / {pages}</span>
      <button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button>
    </div>
  </Modal>;
}
