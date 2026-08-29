export function resolveRangePointerRatio({
  clientX,
  left,
  width,
}: {
  clientX: number;
  left: number;
  width: number;
}) {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return Math.max(0, Math.min(1, (clientX - left) / width));
}
