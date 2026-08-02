import { useEffect, useMemo, useState } from "react";
import {
  CircleAlert,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  FolderOpen,
  LoaderCircle,
  MapPin,
  ShieldAlert,
} from "lucide-react";
import type { LocalPathInspection } from "@shared/local-path";
import type { StellaDesktopApi } from "@shared/contracts";
import { extractLocalPaths } from "../lib/local-paths";

type InspectionState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly inspection: LocalPathInspection }
  | { readonly status: "error"; readonly message: string };

type PathAction = "open" | "reveal" | "copy";

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function LocalPathItem({
  api,
  path,
  onPreview,
}: {
  readonly api: StellaDesktopApi;
  readonly path: string;
  readonly onPreview: (inspection: LocalPathInspection) => void;
}) {
  const [inspectionState, setInspectionState] = useState<InspectionState>({ status: "loading" });
  const [busyAction, setBusyAction] = useState<PathAction | null>(null);
  const [actionMessage, setActionMessage] = useState<{ readonly kind: "success" | "error"; readonly text: string } | null>(null);

  useEffect(() => {
    let active = true;
    setInspectionState({ status: "loading" });
    void api.inspectLocalPath(path).then(
      (inspection) => {
        if (active) setInspectionState({ status: "ready", inspection });
      },
      (cause: unknown) => {
        if (active) setInspectionState({ status: "error", message: errorMessage(cause) });
      },
    );
    return () => { active = false; };
  }, [api, path]);

  const runAction = async (action: PathAction, operation: () => Promise<void>, successMessage?: string) => {
    setBusyAction(action);
    setActionMessage(null);
    try {
      await operation();
      if (successMessage) setActionMessage({ kind: "success", text: successMessage });
    } catch (cause) {
      setActionMessage({ kind: "error", text: errorMessage(cause) });
    } finally {
      setBusyAction(null);
    }
  };

  const inspection = inspectionState.status === "ready" ? inspectionState.inspection : null;
  const displayName = inspection?.name || path;
  const isDirectory = inspection?.kind === "directory";
  const Icon = isDirectory ? FolderOpen : FileText;
  const disabled = busyAction !== null;

  return (
    <div className={`output-path${inspectionState.status === "error" ? " is-error" : ""}`}>
      <span className="output-path__icon" aria-hidden="true">
        {inspectionState.status === "loading" ? <LoaderCircle size={16} className="spin" /> : <Icon size={16} />}
      </span>
      <span className="output-path__copy">
        <strong title={path}>{displayName}</strong>
        <code title={path}>{path}</code>
        {inspectionState.status === "loading" && <small>正在验证路径与访问范围…</small>}
        {inspectionState.status === "error" && <small className="output-path__error" role="alert"><CircleAlert size={12} />路径不可用：{inspectionState.message}</small>}
        {inspection?.directOpenBlockedReason && <small className="output-path__warning"><ShieldAlert size={12} />{inspection.directOpenBlockedReason}</small>}
        {actionMessage && (
          <small className={actionMessage.kind === "error" ? "output-path__error" : "output-path__success"} role={actionMessage.kind === "error" ? "alert" : "status"}>
            {actionMessage.kind === "error" && <CircleAlert size={12} />}{actionMessage.text}
          </small>
        )}
      </span>
      <span className="output-path__actions">
        {inspection?.preview && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPreview(inspection)}
            aria-label={`预览文件 ${path}`}
          >
            <Eye size={13} />预览
          </button>
        )}
        {inspection?.directOpenAllowed && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void runAction("open", () => api.openPath(inspection.canonicalPath))}
            aria-label={`${isDirectory ? "打开文件夹" : "打开文件"} ${path}`}
          >
            {busyAction === "open" ? <LoaderCircle size={13} className="spin" /> : isDirectory ? <FolderOpen size={13} /> : <ExternalLink size={13} />}
            {isDirectory ? "打开文件夹" : "打开文件"}
          </button>
        )}
        {inspection && !isDirectory && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void runAction("reveal", () => api.revealPath(inspection.canonicalPath))}
            aria-label={`打开所在位置 ${path}`}
          >
            {busyAction === "reveal" ? <LoaderCircle size={13} className="spin" /> : <MapPin size={13} />}
            所在位置
          </button>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => void runAction("copy", () => api.copyText(path), "路径已复制")}
          aria-label={`复制路径 ${path}`}
          title="复制完整路径"
        >
          {busyAction === "copy" ? <LoaderCircle size={13} className="spin" /> : <Copy size={13} />}
          复制路径
        </button>
      </span>
    </div>
  );
}

export function LocalPathArtifacts({
  api,
  text,
  onPreviewFile,
}: {
  readonly api: StellaDesktopApi;
  readonly text: string;
  readonly onPreviewFile: (inspection: LocalPathInspection) => void;
}) {
  const paths = useMemo(() => extractLocalPaths(text), [text]);
  if (paths.length === 0) return null;
  return (
    <section className="output-paths" aria-label="输出文件与路径">
      <header>
        <span>OUTPUTS</span>
        <strong>输出文件与路径</strong>
        <small>{paths.length} 项</small>
      </header>
      <div className="output-paths__list">
        {paths.map((path) => <LocalPathItem key={path} api={api} path={path} onPreview={onPreviewFile} />)}
      </div>
    </section>
  );
}
