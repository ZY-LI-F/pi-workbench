import type { PiCommand } from "../shared/contracts";
import { AGENT_THINKING_LEVELS } from "../shared/kanban";

type JsonRecord = Readonly<Record<string, unknown>>;

const COMMAND_TYPES = new Set([
  "prompt", "steer", "follow_up", "abort", "new_session", "get_state", "set_model",
  "cycle_model", "get_available_models", "set_thinking_level", "cycle_thinking_level",
  "get_available_thinking_levels", "set_steering_mode", "set_follow_up_mode", "compact",
  "set_auto_compaction", "set_auto_retry", "abort_retry", "bash", "abort_bash",
  "get_session_stats", "export_html", "switch_session", "fork", "clone",
  "get_fork_messages", "get_entries", "get_tree", "get_last_assistant_text",
  "set_session_name", "get_messages", "get_commands",
] as const);

function recordValue(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Pi RPC 命令必须是对象");
  }
  return value as JsonRecord;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} 必须是字符串`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  const result = stringValue(value, label);
  if (result.trim().length === 0) throw new Error(`${label} 不能为空`);
  return result;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, label);
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label} 必须是布尔值`);
  return value;
}

function enumValue<const T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new Error(`${label} 必须是 ${values.join(" / ")} 之一`);
  }
  return value as T;
}

function imageValues(value: unknown): readonly Readonly<{ type: "image"; data: string; mimeType: string }>[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Pi RPC images 必须是数组");
  return Object.freeze(value.map((candidate, index) => {
    const image = recordValue(candidate);
    if (image.type !== "image") throw new Error(`Pi RPC images[${index}].type 必须是 image`);
    const data = requiredString(image.data, `Pi RPC images[${index}].data`);
    const mimeType = requiredString(image.mimeType, `Pi RPC images[${index}].mimeType`);
    if (!mimeType.toLocaleLowerCase("en-US").startsWith("image/")) {
      throw new Error(`Pi RPC images[${index}].mimeType 必须是图片 MIME 类型`);
    }
    return Object.freeze({ type: "image" as const, data, mimeType });
  }));
}

function command<T extends PiCommand>(value: T): PiCommand {
  return Object.freeze(value) as unknown as PiCommand;
}

export function validatedPiCommand(value: unknown): PiCommand {
  const record = recordValue(value);
  const type = record.type;
  if (typeof type !== "string" || !COMMAND_TYPES.has(type as (typeof COMMAND_TYPES extends Set<infer T> ? T : never))) {
    throw new Error(`不支持的 Pi RPC 命令: ${String(type)}`);
  }

  switch (type) {
    case "prompt": {
      const images = imageValues(record.images);
      const streamingBehavior = record.streamingBehavior === undefined
        ? undefined
        : enumValue(record.streamingBehavior, ["steer", "followUp"] as const, "Pi RPC streamingBehavior");
      return command({
        type,
        message: stringValue(record.message, "Pi RPC prompt.message"),
        ...(images ? { images: [...images] } : {}),
        ...(streamingBehavior ? { streamingBehavior } : {}),
      });
    }
    case "steer":
    case "follow_up": {
      const images = imageValues(record.images);
      return command({
        type,
        message: stringValue(record.message, `Pi RPC ${type}.message`),
        ...(images ? { images: [...images] } : {}),
      });
    }
    case "new_session": {
      const parentSession = optionalString(record.parentSession, "Pi RPC parentSession");
      return command({ type, ...(parentSession ? { parentSession } : {}) });
    }
    case "set_model":
      return command({
        type,
        provider: requiredString(record.provider, "Pi RPC provider"),
        modelId: requiredString(record.modelId, "Pi RPC modelId"),
      });
    case "set_thinking_level":
      return command({ type, level: enumValue(record.level, AGENT_THINKING_LEVELS, "Pi RPC thinking level") });
    case "set_steering_mode":
    case "set_follow_up_mode":
      return command({ type, mode: enumValue(record.mode, ["all", "one-at-a-time"] as const, `Pi RPC ${type}.mode`) });
    case "compact": {
      const customInstructions = optionalString(record.customInstructions, "Pi RPC compact.customInstructions");
      return command({ type, ...(customInstructions ? { customInstructions } : {}) });
    }
    case "set_auto_compaction":
    case "set_auto_retry": {
      if (typeof record.enabled !== "boolean") throw new Error(`Pi RPC ${type}.enabled 必须是布尔值`);
      return command({ type, enabled: record.enabled });
    }
    case "bash": {
      const excludeFromContext = optionalBoolean(record.excludeFromContext, "Pi RPC bash.excludeFromContext");
      return command({
        type,
        command: requiredString(record.command, "Pi RPC bash.command"),
        ...(excludeFromContext === undefined ? {} : { excludeFromContext }),
      });
    }
    case "export_html": {
      const outputPath = optionalString(record.outputPath, "Pi RPC export_html.outputPath");
      return command({ type, ...(outputPath ? { outputPath } : {}) });
    }
    case "switch_session":
      return command({ type, sessionPath: requiredString(record.sessionPath, "Pi RPC switch_session.sessionPath") });
    case "fork":
      return command({ type, entryId: requiredString(record.entryId, "Pi RPC fork.entryId") });
    case "get_entries": {
      const since = optionalString(record.since, "Pi RPC get_entries.since");
      return command({ type, ...(since ? { since } : {}) });
    }
    case "set_session_name":
      return command({ type, name: requiredString(record.name, "Pi RPC 会话名称") });
    case "abort":
    case "get_state":
    case "cycle_model":
    case "get_available_models":
    case "cycle_thinking_level":
    case "get_available_thinking_levels":
    case "abort_retry":
    case "abort_bash":
    case "get_session_stats":
    case "clone":
    case "get_fork_messages":
    case "get_tree":
    case "get_last_assistant_text":
    case "get_messages":
    case "get_commands":
      return command({ type });
    default:
      throw new Error(`不支持的 Pi RPC 命令: ${String(type)}`);
  }
}
