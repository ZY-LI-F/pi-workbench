import { useState, type FormEvent } from "react";
import { FolderOpen } from "lucide-react";
import type { StellaDesktopApi } from "@shared/contracts";
import { PROJECT_STAGES, PROJECT_STAGE_LABEL, type ProjectStage, type RegisteredProject } from "@shared/project-registry";
import type { ProjectRegistryController } from "../../hooks/use-project-registry";
import { Modal } from "../../components/Modal";

interface Props {
  readonly project?: RegisteredProject;
  readonly api: StellaDesktopApi;
  readonly controller: ProjectRegistryController;
  readonly onClose: () => void;
}

export function ProjectEditorDialog({ project, api, controller, onClose }: Props) {
  const [name, setName] = useState(project?.name ?? "");
  const [path, setPath] = useState(project?.path ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [archived, setArchived] = useState(project?.archived ?? false);
  const [stage, setStage] = useState<ProjectStage>(project?.stage ?? "planned");
  const [saving, setSaving] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string>();
  const busy = saving || choosing;

  const choose = async () => {
    setChoosing(true);
    setError(undefined);
    try {
      const selected = await api.chooseProject();
      if (!selected) return;
      setPath(selected.path);
      if (!name.trim()) setName(selected.name);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setChoosing(false); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setSaving(true);
    setError(undefined);
    try {
      if (project) await controller.update({ projectId: project.id, name, description, archived, stage });
      else await controller.add({ path, name, description });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };

  return <Modal title={project ? "编辑项目" : "添加项目"} eyebrow="PROJECT" className="project-editor" onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={(event) => { void submit(event); }}>
      <label>项目名称<input autoFocus required value={name} disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="例如：Stella 工作台" /></label>
      <label>项目目录<div className="project-editor__directory"><input required value={path} readOnly={Boolean(project)} disabled={busy} onChange={(event) => setPath(event.target.value)} placeholder="本地项目的完整目录路径" />
        {!project && <button type="button" className="button-secondary" disabled={busy} onClick={() => { void choose(); }}><FolderOpen size={15} />选择目录</button>}</div></label>
      <p className="project-editor__hint">{project ? "名称和说明只用于项目看板，目录和历史任务保持原有归属。" : "选择已有目录即可登记。添加项目后，可自行决定何时打开工作区。"}</p>
      <label>项目说明<textarea value={description} disabled={busy} onChange={(event) => setDescription(event.target.value)} placeholder="记录项目目标、背景或当前重点" rows={4} /></label>
      {project && <label>项目阶段<select value={stage} disabled={busy} onChange={(event) => setStage(event.target.value as ProjectStage)}>{PROJECT_STAGES.map((value) => <option key={value} value={value}>{PROJECT_STAGE_LABEL[value]}</option>)}</select><small className="project-editor__hint">用于整理项目计划。任务的运行、完成与验收仍按各自状态推进。</small></label>}
      {project && <label className="project-editor__archive"><input type="checkbox" checked={archived} disabled={busy} onChange={(event) => setArchived(event.target.checked)} /><span>归档项目<small>从活跃列表收起，随时可以恢复。已有任务、执行与自动化继续保留和运行。</small></span></label>}
      {error && <p className="project-error" role="alert">{error}</p>}
      <footer><button type="button" className="button-secondary" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="button-primary" disabled={busy || !name.trim() || !path.trim()}>{saving ? "正在保存…" : project ? "保存项目" : "添加项目"}</button></footer>
    </form>
  </Modal>;
}
