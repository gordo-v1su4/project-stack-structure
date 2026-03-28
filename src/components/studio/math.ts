export function sv(seed: number) {
  const x = Math.sin(seed * 127.1 + 3.7) * 43758.5453;
  return x - Math.floor(x);
}

export function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function makeWavePoints(n: number, seed: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const t = i / n;
    const env = 0.1 + 0.85 * Math.pow(Math.sin(t * Math.PI), 0.4);
    const hi = Math.abs(Math.sin(t * 53.1 + seed * 2.3)) * 0.6;
    const mid = Math.abs(Math.sin(t * 17.7 + seed * 1.1)) * 0.35;
    const lo = Math.abs(Math.sin(t * 6.2 + seed * 0.7)) * 0.25;
    return Math.min(0.98, env * (0.12 + hi + mid + lo));
  });
}
