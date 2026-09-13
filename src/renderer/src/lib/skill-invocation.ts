export interface ExpandedSkillInvocation {
  readonly name: string;
  readonly location: string;
  readonly instructions: string;
  readonly userMessage?: string;
}

const EXPANDED_SKILL_PATTERN = /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/u;

/** Mirrors Pi's persisted /skill:name expansion without importing its Node-only AgentSession bundle. */
export function parseExpandedSkillInvocation(text: string): ExpandedSkillInvocation | undefined {
  const match = text.match(EXPANDED_SKILL_PATTERN);
  if (!match?.[1] || !match[2] || match[3] === undefined) return undefined;
  const userMessage = match[4]?.trim();
  return Object.freeze({
    name: match[1],
    location: match[2],
    instructions: match[3],
    ...(userMessage ? { userMessage } : {}),
  });
}

export function skillInvocationCommand(invocation: ExpandedSkillInvocation): string {
  return `/skill:${invocation.name}${invocation.userMessage ? ` ${invocation.userMessage}` : ""}`;
}
