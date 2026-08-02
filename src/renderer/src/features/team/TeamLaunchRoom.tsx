import { useMemo, useState } from "react";
import { AtSign, Bot, GitBranch, Orbit, Send, Sparkles } from "lucide-react";
import type { ProjectMeta } from "@shared/contracts";
import type { AgentPresence } from "@shared/agent-presence";
import type { AgentDefinition } from "@shared/kanban";
import { deriveTeamLaunchDraft, type TeamLaunchDraft } from "@shared/team-launch";
import { AgentMentionInput, type AgentMentionRequest } from "../kanban/AgentMentionInput";
import { parseAgentMentions, type AgentMentionQuery } from "@shared/agent-mentions";

interface TeamLaunchRoomProps {
  readonly project?: ProjectMeta;
  readonly lead?: AgentDefinition;
  readonly agents: readonly AgentDefinition[];
  readonly presences: readonly AgentPresence[];
  readonly mentionRequest?: AgentMentionRequest;
  readonly focusRequest?: number;
  readonly availableSkillNames?: readonly string[];
  readonly busy: boolean;
  readonly executionEnabled: boolean;
  readonly onLaunch: (body: string, acceptanceCriteria: string) => Promise<void>;
}

interface LaunchPreview {
  readonly draft?: TeamLaunchDraft;
  readonly target?: AgentDefinition;
  readonly error?: string;
}

export function TeamLaunchRoom({
  project,
  lead,
  agents,
  presences,
  mentionRequest,
  focusRequest,
  availableSkillNames,
  busy,
  executionEnabled,
  onLaunch,
}: TeamLaunchRoomProps) {
  const [body, setBody] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [activeQuery, setActiveQuery] = useState<AgentMentionQuery>();
  const [error, setError] = useState("");
  const disabledReason = !project
    ? "请先打开一个项目"
    : agents.length === 0
      ? "当前项目没有可用 Agent"
      : !executionEnabled
        ? "Pi Runtime 尚未就绪，不能启动 Agent"
        : undefined;
  const preview = useMemo<LaunchPreview>(() => {
    if (!body.trim() || activeQuery) return Object.freeze({});
    try {
      const draft = deriveTeamLaunchDraft(body, acceptanceCriteria);
      const parsed = parseAgentMentions(body, agents);
      const target = parsed.agents[0];
      if (parsed.tokens.length !== 1 || parsed.agents.length !== 1 || !target) throw new Error("请选择一个无歧义的负责人");
      return Object.freeze({ draft, target });
    } catch (cause) {
      return Object.freeze({ error: cause instanceof Error ? cause.message : String(cause) });
    }
  }, [acceptanceCriteria, activeQuery, agents, body]);

  const submit = async (): Promise<void> => {
    setError("");
    try {
      deriveTeamLaunchDraft(body, acceptanceCriteria);
      await onLaunch(body.trim(), acceptanceCriteria.trim());
      setBody("");
      setAcceptanceCriteria("");
      setActiveQuery(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="team-launch-room" aria-label="任务启动台">
      <header className="team-launch-room__header">
        <div><small>TASK LAUNCHPAD</small><h2>任务启动台</h2></div>
        <span><i />{project?.name ?? "尚未选择项目"}</span>
      </header>

      <div className="team-launch-room__stage">
        <div className="team-launch-room__seed" aria-hidden="true"><i /><b /><span><AtSign size={20} /></span></div>
        <small>MISSION SEED · STELLA RELAY</small>
        <h3>先说目标，再形成任务</h3>
        <p>范围复杂或归属不清时交给 <strong>@LEAD</strong>；目标清楚时可直接选择一个 Worker。Stella 会把消息、任务与首个 AgentTask 原子写入同一条事实流。</p>
        <div className="team-launch-room__relay" aria-label="任务启动顺序">
          <span><b>1</b><small>你说明目标</small></span><i />
          <span><b>2</b><small>指定唯一负责人</small></span><i />
          <span><b>3</b><small>协调或直接执行</small></span>
        </div>
        <article className="team-launch-room__lead">
          <span><Bot size={15} /><i /></span>
          <div><strong>{lead?.name ?? "通用调度负责人"}</strong><small>@LEAD · 复杂任务协调入口</small><p>{lead?.responsibility ?? "判断是否需要澄清，再拆解、委派并验收真实报告。"}</p></div>
        </article>
      </div>

      <form className="team-launch-room__composer" aria-label="任务启动台输入器" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="team-launch-room__composer-label"><span><Orbit size={11} />发送启动指令</span><small>只指定一个负责人；复杂任务优先 @LEAD</small></div>
        <AgentMentionInput
          id="team-launch-message"
          ariaLabel="选择负责人并输入团队任务"
          value={body}
          agents={agents}
          presences={presences}
          mentionRequest={mentionRequest}
          focusRequest={focusRequest}
          availableSkillNames={availableSkillNames}
          mentionsDisabled={Boolean(disabledReason)}
          mentionsDisabledReason={disabledReason}
          placeholder="@LEAD 处理复杂任务，或 @指定Worker 直接执行清晰任务…"
          rows={4}
          onChange={(value) => { setBody(value); setError(""); }}
          onQueryChange={setActiveQuery}
          onRequestError={setError}
        />
        <label className="kanban-field team-launch-room__acceptance">
          <span>验收标准 <i>必填</i><small>结果应满足哪些可核查条件</small></span>
          <textarea
            value={acceptanceCriteria}
            rows={3}
            onChange={(event) => { setAcceptanceCriteria(event.target.value); setError(""); }}
            placeholder="例如：输出带原始来源和数据日期的证据表；分别说明支持、反对与未知证据；给出可证伪的下一步实验。"
          />
        </label>
        <div className={`team-launch-room__impact ${error || preview.error ? "is-error" : preview.draft ? "is-ready" : ""}`} role={error || preview.error ? "alert" : "status"}>
          {error || preview.error
            ? <><AtSign size={12} /><span>{error || preview.error}</span></>
            : activeQuery
              ? <><AtSign size={12} /><span>选择一个负责人，然后继续写明任务目标。</span></>
              : preview.draft
                ? <><GitBranch size={12} /><span>将创建任务“{preview.draft.title}”，并{preview.target?.id === "lead" ? "启动 LEAD Coordinator" : `直接交给 ${preview.target?.name ?? "所选 Worker"}`}。</span></>
                : <><Sparkles size={12} /><span>消息发送成功后会进入新 Task Room；启动台不保存第二份聊天历史。</span></>}
        </div>
        <footer><span><i />原子写入 Task · Message · AgentTask</span><button type="submit" className="button-primary" disabled={busy || Boolean(disabledReason) || !preview.draft || !preview.target || Boolean(activeQuery)}><Send size={13} />{busy ? "正在建立任务…" : preview.target?.id === "lead" ? "创建任务并交给 LEAD" : "创建并直接执行"}</button></footer>
      </form>
    </section>
  );
}
