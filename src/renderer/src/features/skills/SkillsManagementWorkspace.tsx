import { useMemo, useState } from "react";
import {
  BookOpenCheck,
  CheckCircle2,
  Copy,
  FolderInput,
  FolderOpen,
  Menu,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Zap,
} from "lucide-react";
import type { RuntimeBootstrap, SlashCommandSummary, StellaDesktopApi } from "@shared/contracts";
import type { PiSkillInstallResult, PiSkillInstallScope } from "@shared/pi-skill";
import { HeaderOverflowMenu } from "../../components/HeaderOverflowMenu";

interface SkillsManagementWorkspaceProps {
  readonly api: StellaDesktopApi;
  readonly bootstrap?: RuntimeBootstrap;
  readonly online: boolean;
  readonly runtimeBusy: boolean;
  readonly onOpenSidebar: () => void;
  readonly onRuntimeRefresh: () => Promise<RuntimeBootstrap>;
  readonly onNotify: (message: string, type: "success" | "error" | "info" | "warning") => void;
}

function skillName(command: SlashCommandSummary): string {
  return command.name.startsWith("skill:") ? command.name.slice("skill:".length) : command.name;
}

function scopeLabel(location: string | undefined): string {
  if (location === "project") return "当前项目";
  if (location === "user") return "所有项目";
  if (location === "temporary") return "临时加载";
  return "显式路径";
}

function skillSearchText(command: SlashCommandSummary): string {
  return `${skillName(command)} ${command.description ?? ""} ${command.location ?? ""} ${command.path ?? ""}`.toLocaleLowerCase();
}

export function SkillsManagementWorkspace({
  api,
  bootstrap,
  online,
  runtimeBusy,
  onOpenSidebar,
  onRuntimeRefresh,
  onNotify,
}: SkillsManagementWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [requestedScope, setRequestedScope] = useState<PiSkillInstallScope>("project");
  const [installing, setInstalling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [lastInstall, setLastInstall] = useState<Extract<PiSkillInstallResult, { readonly cancelled: false }>>();
  const projectTrusted = bootstrap?.project.trusted ?? false;
  const installScope: PiSkillInstallScope = requestedScope === "project" && !projectTrusted ? "user" : requestedScope;
  const skills = useMemo(
    () => (bootstrap?.commands ?? [])
      .filter((command) => command.source === "skill")
      .sort((left, right) => skillName(left).localeCompare(skillName(right))),
    [bootstrap?.commands],
  );
  const filteredSkills = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? skills.filter((command) => skillSearchText(command).includes(normalized)) : skills;
  }, [query, skills]);
  const projectSkillCount = skills.filter((command) => command.location === "project").length;
  const userSkillCount = skills.filter((command) => command.location === "user").length;
  const actionDisabled = !online || runtimeBusy || installing || refreshing || !bootstrap;

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    setActionError("");
    try {
      await onRuntimeRefresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setActionError(`刷新 Skills 失败：${message}`);
    } finally {
      setRefreshing(false);
    }
  };

  const install = async (): Promise<void> => {
    setInstalling(true);
    setActionError("");
    try {
      const result = await api.installPiSkillFolder(installScope);
      if (result.cancelled) return;
      setLastInstall(result);
      try {
        await onRuntimeRefresh();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const warning = `Skill ${result.skill.name} 已安装且 Pi 已热加载，但界面同步失败：${message}`;
        setActionError(warning);
        onNotify(warning, "warning");
        return;
      }
      onNotify(`Skill ${result.skill.name} 已安装并热加载`, "success");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setActionError(`添加 Skill 失败：${message}`);
      onNotify(`添加 Skill 失败：${message}`, "error");
    } finally {
      setInstalling(false);
    }
  };

  const reveal = (path: string): void => {
    void api.revealPath(path).catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      onNotify(`无法在文件管理器中显示 Skill：${message}`, "error");
    });
  };

  const copyCommand = (name: string): void => {
    void api.copyText(`/skill:${name} `)
      .then(() => onNotify(`已复制 /skill:${name}`, "success"))
      .catch((cause: unknown) => onNotify(`复制命令失败：${cause instanceof Error ? cause.message : String(cause)}`, "error"));
  };

  return (
    <main className="skills-workspace">
      <header className="skills-header">
        <button type="button" className="icon-button skills-header__menu" aria-label="打开侧栏" onClick={onOpenSidebar}><Menu size={18} /></button>
        <div className="skills-header__identity"><span><BookOpenCheck size={17} /></span><div><small>PI RESOURCE DECK</small><h1>Skills 管理</h1></div></div>
        <div className="skills-header__actions">
          <span className={`skills-runtime-state ${online ? "is-online" : ""}`}><i />{online ? runtimeBusy ? "PI RUNTIME BUSY" : "PI RUNTIME ONLINE" : "PI RUNTIME OFFLINE"}</span>
          <button type="button" className="button-secondary" disabled={refreshing || installing || !online} onClick={() => void refresh()}><RefreshCw size={14} className={refreshing ? "spin" : ""} />{refreshing ? "刷新中" : "刷新"}</button>
          <button type="button" className="button-primary" disabled={actionDisabled} onClick={() => void install()}><FolderInput size={15} />{installing ? "正在安装并热加载…" : "添加 Skill 文件夹"}</button>
          <HeaderOverflowMenu
            className="skills-header__more"
            ariaLabel="更多 Skills 操作"
            status={!online ? "Pi Runtime 离线" : runtimeBusy ? "Pi Runtime 忙碌" : "Pi Runtime 在线"}
            actions={[
              {
                id: "refresh",
                label: refreshing ? "正在刷新" : "刷新 Skills",
                description: "重新读取当前 Pi Skill 目录",
                icon: <RefreshCw size={14} className={refreshing ? "spin" : ""} />,
                disabled: refreshing || installing || !online,
                onSelect: () => void refresh(),
              },
              {
                id: "install",
                label: "添加 Skill 文件夹",
                description: installScope === "project" ? "安装到当前项目并热加载" : "安装到所有项目并热加载",
                icon: <FolderInput size={14} />,
                disabled: actionDisabled,
                onSelect: () => void install(),
              },
            ]}
          />
        </div>
      </header>

      <section className="skills-load-rail" aria-label="Skill 热加载路径">
        <div><FolderInput size={15} /><span><small>01 · SOURCE</small><strong>选择文件夹</strong><em>根目录包含 SKILL.md</em></span></div><i />
        <div><ShieldAlert size={15} /><span><small>02 · VALIDATE</small><strong>Pi 校验</strong><em>名称、描述与来源碰撞</em></span></div><i />
        <div><RefreshCw size={15} /><span><small>03 · RELOAD</small><strong>保持当前 Session</strong><em>重新加载 Pi Resources</em></span></div><i />
        <div className="is-ready"><Zap size={15} /><span><small>04 · READY</small><strong>/skill:name</strong><em>无需重启桌面应用</em></span></div>
      </section>

      {actionError && <section className="skills-alert" role="alert"><ShieldAlert size={17} /><div><strong>Skill 操作没有完成</strong><p>{actionError}</p></div><button type="button" aria-label="关闭 Skill 错误" onClick={() => setActionError("")}>×</button></section>}
      {lastInstall && <section className="skills-install-result" role="status"><CheckCircle2 size={17} /><div><strong>{lastInstall.skill.name} 已热加载</strong><p>{lastInstall.skill.description}</p><code>{lastInstall.skill.destination}</code></div><button type="button" className="button-secondary" onClick={() => reveal(lastInstall.skill.destination)}><FolderOpen size={13} />所在位置</button></section>}

      <div className="skills-layout">
        <aside className="skills-import-console" aria-label="添加 Skill">
          <header><span><Sparkles size={15} /></span><div><small>FOLDER IMPORT</small><h2>添加到哪里</h2></div></header>
          <div className="skills-scope-switch" role="radiogroup" aria-label="Skill 安装范围">
            <button type="button" role="radio" aria-checked={installScope === "project"} className={installScope === "project" ? "is-selected" : ""} disabled={!projectTrusted || installing} onClick={() => setRequestedScope("project")}><strong>当前项目</strong><small>.pi/skills</small>{!projectTrusted && <em>需要信任项目</em>}</button>
            <button type="button" role="radio" aria-checked={installScope === "user"} className={installScope === "user" ? "is-selected" : ""} disabled={installing} onClick={() => setRequestedScope("user")}><strong>所有项目</strong><small>~/.pi/agent/skills</small><em>用户级</em></button>
          </div>
          <section className="skills-folder-rule"><FolderInput size={16} /><div><strong>只支持文件夹</strong><p>请选择具体的 Skill 文件夹；根目录必须包含 <code>SKILL.md</code>。不会接受单个 Markdown、ZIP 或其他压缩包。</p></div></section>
          <section className="skills-security-note"><ShieldAlert size={15} /><p>Skills 会向模型提供指令，也可能包含模型调用的脚本。只添加你已检查并信任的文件夹。</p></section>
          <button type="button" className="skills-import-action" disabled={actionDisabled} onClick={() => void install()}><FolderInput size={16} /><span><strong>{installing ? "正在复制并重新加载 Pi" : "选择文件夹并热加载"}</strong><small>{!online ? "Pi 离线，暂不能热加载" : runtimeBusy ? "当前任务结束后可添加" : installScope === "project" ? "安装到当前项目" : "安装到所有项目"}</small></span></button>
        </aside>

        <section className="skills-catalog" aria-label="当前 Pi Skills">
          <header className="skills-catalog__header">
            <div><small>LIVE PI CATALOG</small><h2>当前 Pi 支持的 Skills</h2><p>列表直接来自当前 Pi RPC 的 <code>get_commands</code>；安装完成后会随同一 Session 热更新。</p></div>
            <dl><div><dt>全部</dt><dd>{skills.length}</dd></div><div><dt>项目</dt><dd>{projectSkillCount}</dd></div><div><dt>用户</dt><dd>{userSkillCount}</dd></div></dl>
          </header>
          <label className="skills-search"><Search size={14} /><input aria-label="搜索 Skills" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按名称、描述或路径筛选" /><span>{filteredSkills.length}/{skills.length}</span></label>
          <div className="skills-catalog__list" aria-live="polite">
            {filteredSkills.map((command) => {
              const name = skillName(command);
              return <article className="skill-row" key={`${command.location ?? "path"}:${command.path ?? command.name}`}>
                <span className="skill-row__mark"><BookOpenCheck size={16} /><i /></span>
                <div className="skill-row__identity"><strong>{name}</strong><code>/skill:{name}</code><p>{command.description ?? "Pi 没有返回 Skill 描述"}</p></div>
                <div className="skill-row__source"><span className={`is-${command.location ?? "path"}`}>{scopeLabel(command.location)}</span><small title={command.path}>{command.path ?? "Pi 未返回来源路径"}</small></div>
                <div className="skill-row__actions"><button type="button" className="button-secondary" onClick={() => copyCommand(name)}><Copy size={12} />复制命令</button>{command.path && <button type="button" className="button-secondary" onClick={() => reveal(command.path!)}><FolderOpen size={12} />所在位置</button>}</div>
              </article>;
            })}
            {filteredSkills.length === 0 && <div className="skills-catalog__empty"><BookOpenCheck size={25} /><strong>{skills.length === 0 ? "当前 Pi 还没有加载 Skill" : "没有匹配的 Skill"}</strong><p>{skills.length === 0 ? "从左侧选择一个包含 SKILL.md 的文件夹，安装后会立即热加载。" : "清除搜索词以查看完整目录。"}</p></div>}
          </div>
        </section>
      </div>
    </main>
  );
}
