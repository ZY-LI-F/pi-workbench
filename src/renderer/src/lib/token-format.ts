/** Session usage uses millions consistently; the caller can expose exact counts in a title. */
export function formatTokenMillions(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return "—";
  const millions = value / 1_000_000;
  const digits = millions >= 10 ? 1 : millions >= 1 ? 2 : millions >= 0.01 ? 3 : 6;
  return `${Number(millions.toFixed(digits))}M`;
}
