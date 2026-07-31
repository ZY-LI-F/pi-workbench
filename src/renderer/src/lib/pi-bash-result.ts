export interface BashResult {
  readonly output: string;
  readonly exitCode: number | null;
  readonly cancelled: boolean;
  readonly truncated: boolean;
  readonly fullOutputPath?: string;
}

export function parseBashResult(value: unknown): BashResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Pi 返回了无效的 Bash 结果");
  }
  const record = value as Record<string, unknown>;
  const cancelled = record.cancelled;
  const exitCode = record.exitCode;
  const validExitCode = typeof exitCode === "number" || exitCode === null || (exitCode === undefined && cancelled === true);
  if (
    typeof record.output !== "string" ||
    !validExitCode ||
    typeof cancelled !== "boolean" ||
    typeof record.truncated !== "boolean"
  ) {
    throw new Error("Pi 返回的 Bash 结果字段不完整");
  }
  return Object.freeze({
    output: record.output,
    // Pi 的 BashExecutor 在取消进程时返回 undefined；JSON RPC 会省略该字段。
    exitCode: typeof exitCode === "number" ? exitCode : null,
    cancelled,
    truncated: record.truncated,
    fullOutputPath: typeof record.fullOutputPath === "string" ? record.fullOutputPath : undefined,
  });
}
