export interface ClipboardTextPort {
  writeText(value: string): void;
  readText(): string;
}

function normalizedClipboardText(value: string): string {
  return value.replaceAll("\r\n", "\n");
}

/**
 * Electron's clipboard API is synchronous but can fail without throwing when
 * the desktop session does not expose a usable system clipboard. Verify the
 * round trip so the UI never reports a false successful copy.
 */
export function writeVerifiedClipboardText(clipboard: ClipboardTextPort, value: string): void {
  clipboard.writeText(value);
  if (normalizedClipboardText(clipboard.readText()) !== normalizedClipboardText(value)) {
    throw new Error("系统剪贴板未接受待复制文本；请重试或手动选择复制");
  }
}
