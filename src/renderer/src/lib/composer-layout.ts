export const MIN_COMPOSER_EDITOR_HEIGHT = 40;
export const AUTO_COMPOSER_EDITOR_MAX_HEIGHT = 190;
export const MAX_COMPOSER_EDITOR_HEIGHT = 560;
export const COMPOSER_VIEWPORT_RESERVE = 220;

export function maximumComposerEditorHeight(viewportHeight: number): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    throw new Error("窗口高度必须是有效的正数");
  }
  return Math.max(
    MIN_COMPOSER_EDITOR_HEIGHT,
    Math.min(MAX_COMPOSER_EDITOR_HEIGHT, Math.floor(viewportHeight - COMPOSER_VIEWPORT_RESERVE)),
  );
}

export function constrainComposerEditorHeight(height: number, viewportHeight: number): number {
  if (!Number.isFinite(height)) throw new Error("输入区高度必须是有效数字");
  return Math.min(
    maximumComposerEditorHeight(viewportHeight),
    Math.max(MIN_COMPOSER_EDITOR_HEIGHT, Math.round(height)),
  );
}
