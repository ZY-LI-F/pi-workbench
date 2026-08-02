import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const parameters = Type.Object({
  action: Type.Union([
    Type.Literal("delegate"),
    Type.Literal("request_revision"),
    Type.Literal("replan"),
    Type.Literal("complete"),
    Type.Literal("ask_human"),
  ]),
  summary: Type.String({ minLength: 1, description: "Concise explanation shown in the Task Room" }),
  delegations: Type.Array(Type.Object({
    agentId: Type.String({ minLength: 1 }),
    objective: Type.String({ minLength: 1 }),
    acceptanceCriteria: Type.String({ minLength: 1 }),
  }, { additionalProperties: false })),
  question: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });

const coordinatorActionTool = defineTool({
  name: "coordinator_action",
  label: "Coordinator Action",
  description: "Submit the Coordinator's final, machine-validated action for this turn.",
  promptSnippet: "Finish every Coordinator turn by calling coordinator_action exactly once",
  promptGuidelines: [
    "You must call coordinator_action as the final action of every Coordinator turn.",
    "Do not print JSON or a natural-language substitute for this tool call.",
    "Use delegate/request_revision/replan only with one or more delegations; use ask_human only with a question.",
  ],
  parameters,
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text" as const, text: `Coordinator action accepted: ${params.action}` }],
      details: Object.freeze({
        action: params.action,
        summary: params.summary,
        delegations: Object.freeze(params.delegations.map((delegation) => Object.freeze({ ...delegation }))),
        question: params.question,
      }),
      terminate: true,
    };
  },
});

export default function registerCoordinatorAction(pi: ExtensionAPI): void {
  pi.registerTool(coordinatorActionTool);
}
