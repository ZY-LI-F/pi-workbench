import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

interface CoordinatorActionParams {
  readonly action: "delegate" | "request_revision" | "replan" | "complete" | "ask_human";
  readonly summary: string;
  readonly delegations: readonly {
    readonly agentId: string;
    readonly objective: string;
    readonly acceptanceCriteria: string;
  }[];
  readonly question?: string;
}

const parameters = {
  type: "object",
  additionalProperties: false,
  required: ["action", "summary", "delegations"],
  properties: {
    action: { enum: ["delegate", "request_revision", "replan", "complete", "ask_human"] },
    summary: { type: "string", minLength: 1, description: "Concise explanation shown in the Task Room" },
    delegations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["agentId", "objective", "acceptanceCriteria"],
        properties: {
          agentId: { type: "string", minLength: 1 },
          objective: { type: "string", minLength: 1 },
          acceptanceCriteria: { type: "string", minLength: 1 },
        },
      },
    },
    question: { type: "string", minLength: 1 },
  },
} as unknown as TSchema;

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
    const action = params as unknown as CoordinatorActionParams;
    return {
      content: [{ type: "text" as const, text: `Coordinator action accepted: ${action.action}` }],
      details: Object.freeze({
        action: action.action,
        summary: action.summary,
        delegations: Object.freeze(action.delegations.map((delegation) => Object.freeze({ ...delegation }))),
        question: action.question,
      }),
      terminate: true,
    };
  },
});

export default function registerCoordinatorAction(pi: ExtensionAPI): void {
  pi.registerTool(coordinatorActionTool);
}
