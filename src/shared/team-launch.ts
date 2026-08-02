import type { TaskPriority } from "./kanban";

const TEAM_LAUNCH_MENTION_PATTERN = /(^|\s)@([A-Za-z0-9_-]+)(?=$|\s|[^\p{L}\p{N}_-])/gu;
const TITLE_LIMIT = 42;

export interface TeamLaunchDraft {
  readonly title: string;
  readonly objective: string;
  readonly acceptanceCriteria: string;
  readonly priority: TaskPriority;
  readonly targetToken: string;
}

function titleFromObjective(objective: string): string {
  const flattened = objective.replace(/\s+/gu, " ").trim();
  const firstSentence = flattened.split(/[。！？!?\r\n]/u)[0]?.trim() || flattened;
  const characters = Array.from(firstSentence);
  return characters.length > TITLE_LIMIT
    ? `${characters.slice(0, TITLE_LIMIT).join("")}…`
    : firstSentence;
}

export function deriveTeamLaunchDraft(body: string, acceptanceCriteria: string): TeamLaunchDraft {
  if (typeof body !== "string") throw new Error("任务启动指令必须是字符串");
  const message = body.trim();
  if (!message) throw new Error("请先写明要交给团队的任务目标");
  if (typeof acceptanceCriteria !== "string") throw new Error("验收标准必须是字符串");
  const normalizedAcceptance = acceptanceCriteria.trim();
  if (!normalizedAcceptance) throw new Error("请先写明可验证的验收标准");

  const mentions = [...message.matchAll(TEAM_LAUNCH_MENTION_PATTERN)]
    .map((match) => match[2]?.toLocaleLowerCase())
    .filter((token): token is string => Boolean(token));
  if (mentions.length === 0) throw new Error("任务启动台需要通过一个 @Agent 指定负责人");
  if (mentions.length !== 1) throw new Error("每条启动指令只能指定一个负责人；范围复杂或归属不清时请只使用 @LEAD");
  const targetToken = mentions[0];
  if (!targetToken) throw new Error("任务启动指令缺少负责人");

  const objective = message
    .replace(TEAM_LAUNCH_MENTION_PATTERN, "$1")
    .trim()
    .replace(/^[\s:：,，;；\-—]+/u, "")
    .trim();
  if (!objective) throw new Error("请在 @Agent 后写明任务目标");

  return Object.freeze({
    title: titleFromObjective(objective),
    objective,
    acceptanceCriteria: normalizedAcceptance,
    priority: "medium",
    targetToken,
  });
}
