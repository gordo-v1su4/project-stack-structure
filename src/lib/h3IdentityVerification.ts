import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { generatedAssetIdentityBlockReason, type GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import { H3_DRAFT_SIMILARITY_POLICY_ID, H3_DRAFT_SIMILARITY_POLICY_SHA256, H3_DRAFT_SIMILARITY_PROJECT_ID,
  H3_DRAFT_SIMILARITY_RAW_IDENTITY_SHA256 } from "@/components/studio/identityDraftPolicy";
import { generatedAssetDraftIdentityBlockReason, normalizeGeneratedAssetIdentityVerification } from "@/components/studio/generatedAssetIdentity";
import { H3_FPS, type H3GenerationJob } from "@/components/studio/h3Generation";
import { downloadH3ReferenceImage } from "./h3JobStore";
import { resolveH3IdentityGallery, type H3IdentityFaceRegion } from "./h3IdentityGallery";

const execute = promisify(execFile);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const MAX_REPORT_BYTES = 2 * 1024 * 1024;

export type H3IdentityInput = {
  version: 1;
  assetId: string;
  jobId: string;
  generationModel: string;
  projectId: string;
  draftSimilarityPolicyId?: string;
  draftSimilarityPolicySha256?: string;
  videoPath: string;
  mediaSha256: string;
  frameCount: number;
  fps: number;
  durationSeconds: number;
  verifiedStartFrame: number;
  verifiedEndFrameExclusive: number;
  generationReferenceHashes: string[];
  identityReferenceHashes: string[];
  references: { path: string; hash: string; canonicalName: string; role: string; faceRegions?: H3IdentityFaceRegion[] }[];
};

async function executeVerifier(inputPath: string, outputPath: string) {
  // Python receives no application/storage credentials and performs no network I/O.
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "production" };
  for (const name of ["PATH", "HOME", "USERPROFILE", "TMP", "TEMP", "TMPDIR", "SYSTEMROOT", "LANG", "UV_CACHE_DIR", "UV_PYTHON_INSTALL_DIR", "UV_OFFLINE", "UV_PYTHON_DOWNLOADS"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  const script = process.env.IDENTITY_SCRIPT_PATH || path.join(process.cwd(), "scripts/identity/verify.py");
  const python = process.env.IDENTITY_PYTHON_PATH || "/opt/stack-identity/.venv/bin/python";
  const models = process.env.IDENTITY_MODEL_DIR || "/opt/stack-identity/models";
  await execute(process.env.IDENTITY_UV_PATH || "uv", ["run", "--offline", "--no-project", "--python", python,
    "python", script, "--input", inputPath, "--output", outputPath, "--model-dir", models], {
    env, timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true,
  });
}

/** Verify the selected trim; a failed verifier banks the take without granting draft eligibility. */
export async function assessH3Identity(params: {
  job: H3GenerationJob;
  asset: GeneratedStudioAsset;
  outputPath: string;
  tempFolder: string;
  runVerifier?: (inputPath: string, outputPath: string) => Promise<void>;
}): Promise<GeneratedStudioAsset> {
  const { job, outputPath, tempFolder } = params;
  const asset: GeneratedStudioAsset = { ...params.asset, mediaSha256: sha256(await readFile(outputPath)),
    mediaFrameCount: job.frames, mediaFrameRate: H3_FPS, generationReferenceHashes: [...(job.referenceHashes ?? [])],
    identityReferenceHashes: job.references.flatMap((ref, index) => ref.role === "identity" && job.referenceHashes?.[index] ? [job.referenceHashes[index]] : []),
    identityVerification: undefined };
  try {
    if (!job.frames || !asset.durationSeconds || job.referenceHashes?.length !== job.references.length) {
      throw new Error("Reference hashes or the media probe are incomplete.");
    }
    const references: H3IdentityInput["references"] = [];
    for (let index = 0; index < job.references.length; index++) {
      const ref = job.references[index];
      const media = await downloadH3ReferenceImage(ref);
      const bytes = new Uint8Array(media.bytes);
      const hash = sha256(bytes);
      if (hash !== job.referenceHashes[index]) throw new Error("The rendered reference bytes changed.");
      const localPath = path.join(tempFolder, `identity-reference-${index}`);
      await writeFile(localPath, bytes);
      const gallery = resolveH3IdentityGallery({ rawSha256: hash, canonicalName: ref.canonicalName, role: ref.role });
      references.push({ path: localPath, hash, canonicalName: ref.canonicalName, role: ref.role,
        ...(gallery ? { faceRegions: gallery.faceRegions } : {}) });
    }
    const trimStart = asset.trimStart ?? 0;
    const trimDuration = job.request.songEnd - job.request.songStart;
    const canApplyDraftFilter = job.projectId === H3_DRAFT_SIMILARITY_PROJECT_ID && job.profile === "h3-ref2va-int8-v2"
      && asset.identityReferenceHashes?.length === 1 && asset.identityReferenceHashes[0] === H3_DRAFT_SIMILARITY_RAW_IDENTITY_SHA256;
    const input: H3IdentityInput = { version: 1, assetId: asset.id, jobId: job.id, generationModel: job.profile, projectId: job.projectId,
      ...(canApplyDraftFilter ? { draftSimilarityPolicyId: H3_DRAFT_SIMILARITY_POLICY_ID,
        draftSimilarityPolicySha256: H3_DRAFT_SIMILARITY_POLICY_SHA256 } : {}),
      videoPath: outputPath, mediaSha256: asset.mediaSha256!, frameCount: job.frames, fps: H3_FPS,
      durationSeconds: asset.durationSeconds, verifiedStartFrame: Math.floor(trimStart * H3_FPS + 1e-6),
      verifiedEndFrameExclusive: Math.min(job.frames, Math.ceil((trimStart + trimDuration) * H3_FPS - 1e-6)),
      generationReferenceHashes: asset.generationReferenceHashes!, identityReferenceHashes: asset.identityReferenceHashes!, references };
    const inputPath = path.join(tempFolder, "identity-input.json");
    const outputReport = path.join(tempFolder, "identity-report.json");
    await writeFile(inputPath, JSON.stringify(input));
    await (params.runVerifier ?? executeVerifier)(inputPath, outputReport);
    if ((await stat(outputReport)).size > MAX_REPORT_BYTES) throw new Error("Identity report exceeded its bound.");
    const proof = normalizeGeneratedAssetIdentityVerification(JSON.parse(await readFile(outputReport, "utf8")));
    if (!proof) throw new Error("Identity report was malformed.");
    if (proof.assetId !== asset.id || proof.jobId !== job.id || proof.generationModel !== job.profile
      || proof.mediaSha256 !== asset.mediaSha256 || proof.frameCount !== job.frames || proof.durationSeconds !== asset.durationSeconds
      || proof.frameRate !== input.fps || proof.verifiedStartFrame !== input.verifiedStartFrame
      || proof.verifiedEndFrameExclusive !== input.verifiedEndFrameExclusive
      || JSON.stringify(proof.referenceHashes) !== JSON.stringify(asset.generationReferenceHashes)
      || JSON.stringify(proof.identityReferenceHashes) !== JSON.stringify(asset.identityReferenceHashes)) throw new Error("Identity report belongs to different inputs.");
    const assessed = { ...asset, identityVerification: proof };
    const block = generatedAssetIdentityBlockReason(assessed);
    // A model's claimed pass must also satisfy the shared binding/coverage contract.
    if ((proof.status === "passed" || proof.status === "not_required") && block) throw new Error("Identity report did not match this take.");
    const draftBlock = generatedAssetDraftIdentityBlockReason(assessed);
    return { ...assessed, reviewStatus: proof.status === "rejected" ? "rejected" : asset.reviewStatus,
      reviewNotes: draftBlock ? `${draftBlock}. ${proof.reason ?? "The take is outside the draft until similarity can be checked."}`
        : proof.draftSimilarityFilter?.status === "eligible"
          ? ["Similarity filter passed · review required", ...proof.draftSimilarityFilter.warnings].join(". ") : asset.reviewNotes };
  } catch {
    // Do not retry inference because an optional post-render verifier failed.
    return { ...asset, identityVerification: undefined,
      reviewNotes: "Identity verifier unavailable or its evidence did not match. This take is outside the draft." };
  }
}
