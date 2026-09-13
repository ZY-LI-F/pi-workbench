export interface NativeDiagnosticLayout {
  readonly width: number;
  readonly height: number;
  readonly inspectorWidth: number;
  readonly inspectorOpen: boolean;
  readonly sidebarOpen: boolean;
  readonly fontSize: "small" | "default" | "large";
}

export interface NativeRequestTrace {
  readonly id: string;
  readonly command: string;
  readonly stage: "sent" | "accepted" | "rejected" | "transport-error";
}

export interface NativeDiagnosticExportResult {
  readonly path: string;
  readonly revealError?: string;
}
