import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const FFGLITCH_DIR = path.join(os.tmpdir(), "ffglitch-scripts");

export type FfglitchFeature = "mv" | "mv_delta" | "mb" | "info" | "glitch_text" | "delogo" | "qscale";

export interface FfglitchCapabilities {
  ffeditPath: string | null;
  ffgacPath: string | null;
  available: boolean;
}

export async function detectFfglitch(): Promise<FfglitchCapabilities> {
  const results = await Promise.allSettled([
    execFileAsync("ffedit", ["-version"]),
    execFileAsync("ffgac", ["-version"]),
  ]);

  const ffeditPath = results[0].status === "fulfilled" ? "ffedit" : null;
  const ffgacPath = results[1].status === "fulfilled" ? "ffgac" : null;

  return {
    ffeditPath,
    ffgacPath,
    available: ffeditPath !== null || ffgacPath !== null,
  };
}

export async function probeFfglitchFeatures(inputPath: string, ffeditPath = "ffedit"): Promise<FfglitchFeature[]> {
  try {
    const { stdout } = await execFileAsync(ffeditPath, ["-i", inputPath]);
    const features: FfglitchFeature[] = [];
    const featurePattern = /\[(\w+)\s*\]/g;
    let match: RegExpExecArray | null;
    while ((match = featurePattern.exec(stdout)) !== null) {
      const feature = match[1] as FfglitchFeature;
      if (!features.includes(feature)) {
        features.push(feature);
      }
    }
    return features;
  } catch {
    return [];
  }
}

export async function exportMotionVectors(
  inputPath: string,
  ffeditPath = "ffedit"
): Promise<string | null> {
  await mkdir(FFGLITCH_DIR, { recursive: true });
  const outputPath = path.join(FFGLITCH_DIR, `mv-${Date.now()}.json`);

  try {
    await execFileAsync(ffeditPath, [
      "-i", inputPath,
      "-f", "mv",
      "-e", outputPath,
    ]);
    return outputPath;
  } catch {
    return null;
  }
}

export interface GlitchMotionVectorParams {
  mode: "shuffle" | "reverse" | "zero" | "amplify" | "beat-sync";
  intensity: number;
  beatTimes?: number[];
  segmentIndex?: number;
}

export async function generateGlitchScript(
  params: GlitchMotionVectorParams
): Promise<string> {
  await mkdir(FFGLITCH_DIR, { recursive: true });
  const scriptPath = path.join(FFGLITCH_DIR, `glitch-${Date.now()}.js`);

  const scriptContent = buildGlitchScriptContent(params);
  await writeFile(scriptPath, scriptContent, "utf-8");

  return scriptPath;
}

export async function applyGlitchWithScript(
  inputPath: string,
  scriptPath: string,
  outputPath: string,
  ffeditPath = "ffedit",
  features: FfglitchFeature[] = ["mv"]
): Promise<{ outputPath: string; duration: number }> {
  await execFileAsync(ffeditPath, [
    "-i", inputPath,
    "-f", ...features,
    "-s", scriptPath,
    "-o", outputPath,
  ]);

  return { outputPath, duration: 0 };
}

export async function applyGlitchWithJson(
  inputPath: string,
  jsonPath: string,
  outputPath: string,
  ffeditPath = "ffedit",
  features: FfglitchFeature[] = ["mv"]
): Promise<{ outputPath: string; duration: number }> {
  await execFileAsync(ffeditPath, [
    "-i", inputPath,
    "-f", ...features,
    "-a", jsonPath,
    "-o", outputPath,
  ]);

  return { outputPath, duration: 0 };
}

export async function replicateWithFfgac(
  inputPath: string,
  outputPath: string,
  ffgacPath = "ffgac",
  extraArgs: string[] = []
): Promise<{ outputPath: string }> {
  await execFileAsync(ffgacPath, [
    "-i", inputPath,
    ...extraArgs,
    "-y",
    outputPath,
  ]);

  return { outputPath };
}

function buildGlitchScriptContent(params: GlitchMotionVectorParams): string {
  const { mode, intensity, beatTimes } = params;
  const beatTimesJson = JSON.stringify(beatTimes ?? []);

  return `// FFglitch auto-generated script — mode: ${mode}
let frame_num = 0;
const intensity = ${intensity};
const beatTimes = ${beatTimesJson};
const mode = "${mode}";

export function setup(args) {
  args.features.push("mv");
}

export function glitch_frame(frame, stream) {
  const mvs = frame.mv?.forward;
  if (!mvs) { frame_num++; return; }

  if (mode === "zero") {
    mvs.fill([0, 0]);
  } else if (mode === "amplify") {
    for (let i = 0; i < mvs.length; i++) {
      const row = mvs[i];
      if (!row) continue;
      for (let j = 0; j < row.length; j++) {
        const mv = row[j];
        if (!mv || mv[0] === null) continue;
        mv[0] = Math.round(mv[0] * intensity);
        mv[1] = Math.round(mv[1] * intensity);
      }
    }
  } else if (mode === "reverse") {
    for (let i = 0; i < mvs.length; i++) {
      const row = mvs[i];
      if (!row) continue;
      for (let j = 0; j < row.length; j++) {
        const mv = row[j];
        if (!mv || mv[0] === null) continue;
        mv[0] = -mv[0];
        mv[1] = -mv[1];
      }
    }
  } else if (mode === "shuffle") {
    const allMvs = [];
    for (let i = 0; i < mvs.length; i++) {
      const row = mvs[i];
      if (!row) continue;
      for (let j = 0; j < row.length; j++) {
        if (row[j] && row[j][0] !== null) allMvs.push(row[j]);
      }
    }
    for (let k = allMvs.length - 1; k > 0; k--) {
      const r = Math.floor(pseudoRandom(frame_num + k) * (k + 1));
      const tmp = allMvs[k];
      allMvs[k] = allMvs[r];
      allMvs[r] = tmp;
    }
    let idx = 0;
    for (let i = 0; i < mvs.length; i++) {
      const row = mvs[i];
      if (!row) continue;
      for (let j = 0; j < row.length; j++) {
        if (row[j] && row[j][0] !== null && idx < allMvs.length) {
          const src = allMvs[idx++];
          row[j][0] = src[0];
          row[j][1] = src[1];
        }
      }
    }
  } else if (mode === "beat-sync") {
    const beatIdx = frame_num % Math.max(1, beatTimes.length);
    const boost = beatIdx === 0 ? intensity : 1.0;
    for (let i = 0; i < mvs.length; i++) {
      const row = mvs[i];
      if (!row) continue;
      for (let j = 0; j < row.length; j++) {
        const mv = row[j];
        if (!mv || mv[0] === null) continue;
        mv[0] = Math.round(mv[0] * boost);
        mv[1] = Math.round(mv[1] * boost);
      }
    }
  }

  frame_num++;
}

function pseudoRandom(seed) {
  let x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
`;
}
