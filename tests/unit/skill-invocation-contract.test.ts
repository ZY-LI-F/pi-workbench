// @vitest-environment node
import { parseSkillBlock } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { parseExpandedSkillInvocation } from "@renderer/lib/skill-invocation";

// Contract with the actually installed Pi, not a second local expected regex.
// A Pi upgrade changing its persisted representation must fail this suite.
describe("Pi Skill expansion compatibility", () => {
  const block = '<skill name="target-evidence" location="C:\\skills\\SKILL.md">\n# Evidence\n\nBody with <tag> and 中文.\n</skill>';
  it.each([
    block, `${block}\n\n  task\nmore  `, `${block}\n\n`, `${block}\n`,
    block.replace("# Evidence\n\nBody with <tag> and 中文.", ""),
    block.replaceAll("\n", "\r\n"),
    block.replace('name="target-evidence"', 'name=""'),
    block.replace("</skill>", "</wrong>"),
    `plain text ${block}`, `\`\`\`xml\n${block}\n\`\`\``, "normal message", "",
  ])("matches upstream interpretation for %s", (text) => {
    const upstream = parseSkillBlock(text);
    expect(parseExpandedSkillInvocation(text)).toEqual(upstream ? {
      name: upstream.name, location: upstream.location, instructions: upstream.content,
      ...(upstream.userMessage ? { userMessage: upstream.userMessage } : {}),
    } : undefined);
  });
});
