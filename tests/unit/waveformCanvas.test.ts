import { describe, expect, test } from "bun:test";
import { paintWaveformLayers } from "@/components/studio/waveformCanvas";

class FakePath {
  vertices: number[][] = [];
  moveTo(x: number, y: number) { this.vertices.push([x, y]); }
  lineTo(x: number, y: number) { this.vertices.push([x, y]); }
  closePath() {}
}

function canvasFixture() {
  const operations: { operation: string; style?: unknown; path?: FakePath }[] = [];
  const gradients: { stops: [number, string][]; addColorStop: (offset: number, color: string) => void }[] = [];
  let writes = 0;
  const context = {
    fillStyle: undefined as unknown,
    strokeStyle: undefined as unknown,
    lineWidth: 0,
    setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    createLinearGradient() {
      const gradient = { stops: [] as [number, string][], addColorStop(offset: number, color: string) { this.stops.push([offset, color]); } };
      gradients.push(gradient);
      return gradient;
    },
    fillRect() { operations.push({ operation: "background", style: this.fillStyle }); },
    fill(path: FakePath) { operations.push({ operation: "fill", style: this.fillStyle, path }); },
    stroke(path?: FakePath) { operations.push({ operation: "stroke", style: this.strokeStyle, path }); },
  };
  let width = 0, height = 0;
  const canvas = {
    get width() { return width; }, set width(value: number) { width = value; writes++; },
    get height() { return height; }, set height(value: number) { height = value; writes++; },
    style: {} as Record<string, string>, getContext: () => context,
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, operations, gradients, get writes() { return writes; } };
}

function fixture() {
  const inactive = canvasFixture(), played = canvasFixture(), outline = canvasFixture();
  const options = { inactive: inactive.canvas, played: played.canvas, outline: outline.canvas,
    points: [-0.25, 0.75, 1.2, -2], width: 2, height: 20, duration: 4, windowStart: 0, visibleDuration: 4, dpr: 2 };
  return { inactive, played, outline, options };
}

describe("static waveform layers", () => {
  test("shares the original absolute peak geometry and preserves transparent blend order and colors", () => {
    const original = globalThis.Path2D;
    globalThis.Path2D = FakePath as unknown as typeof Path2D;
    try {
      const { inactive, played, outline, options } = fixture();
      paintWaveformLayers(options);
      const baseFill = inactive.operations.find((operation) => operation.operation === "fill")!;
      const activeFill = played.operations[0]!;
      const stroke = outline.operations[0]!;
      expect(baseFill.path!.vertices).toEqual([[0, 10], [0, 5.5], [1, 4], [1, 16], [0, 14.5]]);
      expect(activeFill.path).toBe(baseFill.path);
      expect(stroke.path).toBe(baseFill.path);
      expect(inactive.operations.map((operation) => operation.operation)).toEqual(["background", "stroke", "fill"]);
      // No second background or inactive fill: transparent colors must not be composited twice.
      expect(played.operations.map((operation) => operation.operation)).toEqual(["fill"]);
      expect(outline.operations.map((operation) => operation.operation)).toEqual(["stroke"]);
      expect(inactive.gradients.map((gradient) => gradient.stops)).toEqual([
        [[0, "rgba(14, 14, 13, 0.98)"], [0.5, "rgba(9, 9, 9, 0.94)"], [1, "rgba(14, 14, 13, 0.98)"]],
        [[0, "rgba(235, 232, 228, 0.30)"], [0.5, "rgba(235, 232, 228, 0.20)"], [1, "rgba(235, 232, 228, 0.30)"]],
        [[0, "rgba(255, 122, 31, 0.95)"], [0.5, "rgba(224, 92, 0, 0.85)"], [1, "rgba(255, 122, 31, 0.95)"]],
      ]);
      expect(activeFill.style).toBe(inactive.gradients[2]);
      expect(stroke.style).toBe("rgba(255, 255, 255, 0.08)");
    } finally { globalThis.Path2D = original; }
  });

  test("data and window changes rebuild peaks without resizing unchanged bitmaps; resize and DPR still apply", () => {
    const original = globalThis.Path2D;
    globalThis.Path2D = FakePath as unknown as typeof Path2D;
    try {
      const { inactive, played, outline, options } = fixture();
      paintWaveformLayers(options);
      expect(inactive.canvas.width).toBe(4);
      expect(inactive.canvas.height).toBe(40);
      paintWaveformLayers({ ...options, points: [0.1, 0.2, 0.3, 0.4], windowStart: 2, visibleDuration: 2 });
      expect(inactive.writes + played.writes + outline.writes).toBe(6);
      const secondPath = inactive.operations.filter((operation) => operation.operation === "fill")[1]!.path!;
      expect(secondPath.vertices[1]).toEqual([0, 8.2]);
      expect(secondPath.vertices[2]).toEqual([1, 7.6]);
      paintWaveformLayers({ ...options, width: 3, height: 24, dpr: 1 });
      for (const layer of [inactive, played, outline]) {
        expect(layer.canvas.width).toBe(3);
        expect(layer.canvas.height).toBe(24);
        expect(layer.canvas.style.width).toBe("3px");
      }
    } finally { globalThis.Path2D = original; }
  });

  test("empty data keeps the background and centerline with empty played/outline layers", () => {
    const { inactive, played, outline, options } = fixture();
    paintWaveformLayers({ ...options, points: [] });
    expect(inactive.operations.map((operation) => operation.operation)).toEqual(["background", "stroke"]);
    expect(played.operations).toHaveLength(0);
    expect(outline.operations).toHaveLength(0);
  });
});
