export const DEFAULT_INSPECTOR_WIDTH = 360;
export const FILE_INSPECTOR_WIDTH = 720;

export function constrainInspectorWidth(width: number, viewportWidth: number): number {
  const viewportMaximum = Math.max(240, viewportWidth - 24);
  const minimum = Math.min(320, viewportMaximum);
  const availableOnDesktop = viewportWidth > 1260 ? viewportWidth - 640 : viewportMaximum;
  const maximum = Math.max(minimum, Math.min(960, availableOnDesktop));
  return Math.round(Math.min(maximum, Math.max(minimum, width)));
}
