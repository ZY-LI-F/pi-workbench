import type { PiCommand } from "./contracts";

export type NativeTurnCommand = Extract<PiCommand, { type: "prompt" | "steer" | "follow_up" }>;
export type NativeSubmissionStatus = "pending" | "accepted" | "rejected" | "unknown";
export interface NativeSubmissionInput {
  readonly id: string;
  readonly sessionId: string;
  readonly command: NativeTurnCommand;
}
export interface NativeSubmissionReceipt {
  readonly id: string;
  readonly sessionId: string;
  readonly sessionFile?: string;
  readonly cwd: string;
  readonly generation: string;
  readonly command: NativeTurnCommand["type"];
  readonly status: NativeSubmissionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly error?: string;
}
export interface NativeSubmissionResult {
  readonly receipt: NativeSubmissionReceipt;
  /** A Pi response may be known even when persisting it fails. Never hide this condition. */
  readonly persistenceError?: string;
}
