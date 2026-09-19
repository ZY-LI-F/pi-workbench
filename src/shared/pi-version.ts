/** The GUI version and the Pi core version are independent release numbers. */
export interface PiVersionSnapshot {
  readonly guiVersion: string;
  readonly bundledVersion: string;
  readonly checkedAt: string;
  readonly status: "matched" | "mismatch" | "missing" | "error";
  readonly localVersion?: string;
  readonly localPath?: string;
  readonly installPrefix?: string;
  readonly canSync: boolean;
  readonly detail: string;
}

export interface PiVersionSyncResult {
  readonly outcome: "updated" | "cancelled" | "unchanged";
  readonly snapshot: PiVersionSnapshot;
}
