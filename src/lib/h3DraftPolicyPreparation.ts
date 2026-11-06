import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import { getH3PolicyFamily, type H3IdentityPolicyPreflightInput, type H3IdentityPolicyPreflightResult,
  type H3IssuedDraftPolicy, type H3PolicyRawReference } from "@/components/studio/issuedIdentityPolicy";
import { downloadH3ReferenceImage } from "./h3JobStore";
import { assertIssuedH3DraftPolicyMatchesJob, identityPolicyPreflightBinding, issueH3DraftPolicy, readIssuedH3DraftPolicy } from "./h3DraftPolicyStore";
import { H3_FIRST_FRAME_PROFILE } from "@/components/studio/h3FirstFrame";

const execute = promisify(execFile);
const EXTENSIONS: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
export type PreparedH3PolicyReference = { raw: H3PolicyRawReference; imagePath: string; mime: string; bytes: Uint8Array };

async function runPreflight(inputPath: string, outputPath: string) {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "production" };
  for (const name of ["PATH", "HOME", "USERPROFILE", "TMP", "TEMP", "TMPDIR", "SYSTEMROOT", "LANG", "UV_CACHE_DIR", "UV_PYTHON_INSTALL_DIR", "UV_OFFLINE", "UV_PYTHON_DOWNLOADS"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  const script = path.join(path.dirname(process.env.IDENTITY_SCRIPT_PATH || path.join(process.cwd(), "scripts/identity/verify.py")), "prepare_policy.py");
  await execute(process.env.IDENTITY_UV_PATH || "uv", ["run", "--offline", "--no-project", "--python",
    process.env.IDENTITY_PYTHON_PATH || "/opt/stack-identity/.venv/bin/python", "python", script,
    "--input", inputPath, "--output", outputPath, "--model-dir", process.env.IDENTITY_MODEL_DIR || "/opt/stack-identity/models"],
  { env, timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true });
}

/** This is called before any provider prompt; unsuitable references cannot consume a render. */
export async function prepareH3IdentityPolicy(job: H3GenerationJob, tempFolder: string,
  options: { runPreflight?: (inputPath: string, outputPath: string) => Promise<void> } = {}): Promise<{
    policy: H3IssuedDraftPolicy; references: PreparedH3PolicyReference[];
  }> {
  const family = getH3PolicyFamily(job.request.identityPolicyFamily ?? "");
  if (!family || !["h3-ref2va-int8-v3",H3_FIRST_FRAME_PROFILE].includes(job.profile) || job.references.filter(ref => ref.role === "identity").length !== family.scope.requiredIdentityCount) {
    throw new Error("This job does not match a supported identity screen family.");
  }
  const references: PreparedH3PolicyReference[] = [];
  for (const [index, reference] of job.references.entries()) {
    const media = await downloadH3ReferenceImage(reference);
    const bytes = new Uint8Array(media.bytes), extension = EXTENSIONS[media.mime];
    if (!extension || bytes.byteLength < 1 || bytes.byteLength > 32 * 1024 * 1024) throw new Error("Identity preflight requires bounded readable raw image references.");
    const rawSha256 = createHash("sha256").update(bytes).digest("hex");
    if (job.referenceHashes && job.referenceHashes[index] !== rawSha256) throw new Error("Raw reference bytes changed before identity preflight.");
    // metadata() reads compressed headers, never decoded pixels. Match the
    // Python bounds before cv2.imread can allocate an oversized image.
    try {
      const metadata = await sharp(bytes, { limitInputPixels: 32 * 1024 * 1024 }).metadata();
      if (!metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) > 8192
        || metadata.width * metadata.height > 32 * 1024 * 1024 || !["png", "jpeg", "webp"].includes(metadata.format ?? "")) {
        throw new Error("Image header is outside the reference bounds.");
      }
    } catch {
      throw new Error("Identity reference headers must be readable PNG, JPEG or WebP, at most 8192 pixels per side and 32 megapixels; no pixels were decoded for preflight.");
    }
    const imagePath = path.join(tempFolder, `policy-reference-${index}${extension}`);
    await writeFile(imagePath, bytes);
    references.push({ raw: { ...reference, rawSha256 }, imagePath, mime: media.mime, bytes });
  }
  const rawReferences = references.map(reference => reference.raw), hashes = rawReferences.map(reference => reference.rawSha256);
  if (job.identityPolicy) {
    const existing = await readIssuedH3DraftPolicy(job.ownerId, job.projectId, job.identityPolicy);
    if (!existing) throw new Error("The canonical identity screen is unavailable; generation was not submitted.");
    assertIssuedH3DraftPolicyMatchesJob(existing, job, hashes);
    return { policy: existing, references };
  }
  const input: H3IdentityPolicyPreflightInput = { version: 1, bindingSha256: identityPolicyPreflightBinding(job, rawReferences), family,
    references: references.map(reference => ({ ...reference.raw, localPath: reference.imagePath })) };
  const inputPath = path.join(tempFolder, "policy-preflight-input.json"), outputPath = path.join(tempFolder, "policy-preflight-report.json");
  await writeFile(inputPath, JSON.stringify(input));
  await (options.runPreflight ?? runPreflight)(inputPath, outputPath);
  if ((await stat(outputPath)).size > 256 * 1024) throw new Error("Identity reference preflight exceeded its report bound.");
  const report = JSON.parse(await readFile(outputPath, "utf8")) as H3IdentityPolicyPreflightResult;
  if (report.status !== "ready") throw new Error(`Reference preflight needs a clear coherent frontal authority (${report.reason ?? "unverifiable"}); no GPU render was submitted.`);
  return { policy: await issueH3DraftPolicy({ job, rawReferences, preflight: report }), references };
}
