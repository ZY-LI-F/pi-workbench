export interface WorkAreaSize {
  readonly width: number;
  readonly height: number;
}

export interface MainWindowBounds {
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
}

const DEFAULT_WIDTH = 1480;
const DEFAULT_HEIGHT = 940;
const MINIMUM_WIDTH = 980;
const MINIMUM_HEIGHT = 680;
const WORK_AREA_INSET = 24;

function availableDimension(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} 必须是正数`);
  return Math.max(1, Math.floor(value) - WORK_AREA_INSET);
}

export function mainWindowBounds(workArea: WorkAreaSize): MainWindowBounds {
  const availableWidth = availableDimension(workArea.width, "显示器工作区宽度");
  const availableHeight = availableDimension(workArea.height, "显示器工作区高度");
  return Object.freeze({
    width: Math.min(DEFAULT_WIDTH, availableWidth),
    height: Math.min(DEFAULT_HEIGHT, availableHeight),
    minWidth: Math.min(MINIMUM_WIDTH, availableWidth),
    minHeight: Math.min(MINIMUM_HEIGHT, availableHeight),
  });
}
