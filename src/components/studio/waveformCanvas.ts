type WaveformCanvasOptions = {
  inactive: HTMLCanvasElement;
  played: HTMLCanvasElement;
  outline: HTMLCanvasElement;
  points: number[];
  width: number;
  height: number;
  duration: number;
  windowStart: number;
  visibleDuration: number;
  dpr: number;
};

/** Keep the original background → inactive → played → outline blend order without repainting on progress. */
export function paintWaveformLayers({ inactive, played, outline, points, width, height, duration, windowStart, visibleDuration, dpr }: WaveformCanvasOptions) {
  const contexts = [inactive, played, outline].map((canvas) => {
    const pixelWidth = Math.floor(width * dpr);
    const pixelHeight = Math.floor(height * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
    }
    return ctx;
  });
  const [base, active, stroke] = contexts;
  if (!base || !active || !stroke) return;

  const background = base.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "rgba(14, 14, 13, 0.98)");
  background.addColorStop(0.5, "rgba(9, 9, 9, 0.94)");
  background.addColorStop(1, "rgba(14, 14, 13, 0.98)");
  const inactiveGradient = base.createLinearGradient(0, 0, 0, height);
  inactiveGradient.addColorStop(0, "rgba(235, 232, 228, 0.30)");
  inactiveGradient.addColorStop(0.5, "rgba(235, 232, 228, 0.20)");
  inactiveGradient.addColorStop(1, "rgba(235, 232, 228, 0.30)");
  const playedGradient = base.createLinearGradient(0, 0, 0, height);
  playedGradient.addColorStop(0, "rgba(255, 122, 31, 0.95)");
  playedGradient.addColorStop(0.5, "rgba(224, 92, 0, 0.85)");
  playedGradient.addColorStop(1, "rgba(255, 122, 31, 0.95)");

  const centerY = height / 2;
  let path: Path2D | null = null;
  if (points.length) {
    const innerHeight = Math.max(centerY - 4, 1);
    const amplitudes = Array.from({ length: width }, (_, x) => {
      const sampleStart = windowStart + (x / width) * visibleDuration;
      const sampleEnd = windowStart + ((x + 1) / width) * visibleDuration;
      const startIndex = Math.floor((sampleStart / duration) * points.length);
      const endIndex = Math.max(startIndex + 1, Math.floor((sampleEnd / duration) * points.length));
      let peak = 0;
      for (let index = startIndex; index < endIndex; index++) {
        const point = points[index] ?? 0;
        peak = Math.max(peak, Math.max(0, Math.min(1, Math.abs(point))));
      }
      return peak;
    });
    path = new Path2D();
    path.moveTo(0, centerY);
    for (let x = 0; x < amplitudes.length; x++) path.lineTo(x, centerY - amplitudes[x] * innerHeight);
    for (let x = amplitudes.length - 1; x >= 0; x--) path.lineTo(x, centerY + amplitudes[x] * innerHeight);
    path.closePath();
  }

  base.fillStyle = background;
  base.fillRect(0, 0, width, height);
  base.strokeStyle = "rgba(110, 110, 110, 0.14)";
  base.lineWidth = 1;
  base.beginPath();
  base.moveTo(0, centerY);
  base.lineTo(width, centerY);
  base.stroke();
  if (!path) return;
  base.fillStyle = inactiveGradient;
  base.fill(path);
  active.fillStyle = playedGradient;
  active.fill(path);
  stroke.strokeStyle = "rgba(255, 255, 255, 0.08)";
  stroke.lineWidth = 1;
  stroke.stroke(path);
}
