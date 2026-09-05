import { buildStoryboardSequences, buildSequenceGridPrompt, buildFreshFramePrompt, IMAGE_MODELS, type StoryboardJob } from "./storyboardGeneration";
import { buildSeedanceContinuationPacket } from "./seedanceContinuation";
import { sanitizeGeneratedStudioAssetForStorage } from "./generatedAssets";
import type { EditPlanPreviewSegment } from "./musicVideoProject";
import type { ReferenceAsset } from "./referenceAssets";

/** Shared browser-visible regression checks; no provider calls or paid work. */
export function runStoryboardChecks() {
  const results: { label: string; passed: boolean }[] = [];
  const check = (label: string, passed: boolean) => results.push({ label, passed });
  const cuts: EditPlanPreviewSegment[] = Array.from({ length: 10 }, (_, i) => ({
    sectionId: "verse", videoUrl: "https://fixture.invalid/source.mp4", label: `Cut ${i}`, startTime: 0, endTime: 2, musicStart: i * 2, musicEnd: i * 2 + 2,
  }));
  const sequences = buildStoryboardSequences(cuts);
  check("Ten resolved cuts become two review boards, not ten required generations", sequences.length === 2 && sequences[0].cuts.length === 9);
  const refs: ReferenceAsset[] = [{ id: "diego", role: "character-1", kind: "character", displayName: "Diego", fileName: "diego.png", previewUrl: "https://fixture.invalid/diego.png", storageUrl: "https://fixture.invalid/diego.png", storageStatus: "uploaded", promptHint: "", createdAt: "2026-08-30" }];
  const refInputs = [{ url: refs[0].storageUrl!, label: "Diego", role: "character-1" }];
  const job: StoryboardJob = { id: "fixture", projectId: "fixture", sequenceId: "verse:0.000", sectionId: "verse", title: "Fixture", songStart: 0, songEnd: 10, kind: "grid", model: "nano_banana_pro", billing: "subscription-manual", resolution: "2k", references: refInputs, prompt: buildSequenceGridPrompt(sequences[0], refInputs, "Walk to the club") };
  check("Grid includes canonical identity and 3×3 contract", job.prompt.includes("authoritative high-resolution character") && job.prompt.includes("3 rows by 3 columns"));
  const freshPrompt = buildFreshFramePrompt(job, "Panel 1", [...refInputs, { url: "https://fixture.invalid/panel.png", label: "Panel", role: "composition" }]);
  check("Fresh-frame prompt creates a new image, never an upscale", freshPrompt.includes("NEW standalone 2K") && freshPrompt.includes("Do NOT upscale"));
  const base = { projectId: "fixture", sectionId: "verse", sectionLabel: "Verse", storyIntent: "Walk to club", songStart: 0, songEnd: 10,
    moment: { id: "moment", sourceClipId: 1, label: "Walk", start: 0, end: 5, duration: 5, firstFrameUrl: "https://fixture.invalid/first.png", lastFrameUrl: "https://fixture.invalid/last.png" }, referenceAssets: refs, referenceSelection: { character1Id: "diego" } };
  const packet = buildSeedanceContinuationPacket(base);
  check("5-second source for 10-second coverage becomes a 12-second whole replacement", packet.durationSeconds === 12 && packet.continuationType === "whole-shot-replacement");
  check("Opening composition, never last-frame glue", packet.references[0].url.endsWith("first.png") && packet.references[0].role === "composition-reference");
  check("Missing character sheet blocks video handoff", buildSeedanceContinuationPacket({ ...base, referenceAssets: [], referenceSelection: {} }).errors.some((error) => error.includes("character sheet")));
  check("Seedance 2.0 rejects over-length replacement instead of silently shortening", buildSeedanceContinuationPacket({ ...base, songEnd: 16 }).errors.some((error) => error.includes("at most 15s")));
  check("Seedance 2.5 accepts longer whole replacement", buildSeedanceContinuationPacket({ ...base, songEnd: 16, model: "Seedance 2.5" }).durationSeconds === 18);
  const frame = { id: "frame", provider: "higgsfield" as const, model: "nano_banana_pro", createdAt: "2026-08-30", prompt: freshPrompt, status: "completed" as const, reviewStatus: "approved" as const,
    resultUrl: "https://fixture.invalid/fresh.png", storyboard: { ...job, kind: "fresh-frame" as const, sourceGridId: "grid", panelIndex: 1 }, frameRole: "composition-reference" as const, panelReviews: { "1": "approved" as const }, triggerRunId: "fixture-run" };
  const restored = JSON.parse(JSON.stringify(sanitizeGeneratedStudioAssetForStorage(frame)));
  check("Persistence round-trip retains parent panel, review, conditioning role and run ID", restored.storyboard.panelIndex === 1 && restored.frameRole === "composition-reference" && restored.triggerRunId === "fixture-run" && restored.reviewStatus === "approved");
  check("Unapproved fresh images never become video references", !buildSeedanceContinuationPacket({ ...base, approvedFrames: [{ ...frame, reviewStatus: "pending" }] }).references.some((ref) => ref.url.endsWith("fresh.png")));
  check("Approved standalone frame guides composition", buildSeedanceContinuationPacket({ ...base, approvedFrames: [frame] }).references.some((ref) => ref.url.endsWith("fresh.png") && ref.role === "composition-reference"));
  check("Exact start conflicts with leading handles", buildSeedanceContinuationPacket({ ...base, approvedFrames: [{ ...frame, frameRole: "start-frame" }] }).errors.some((error) => error.includes("conflicts")));
  check("Model comparison uses separate 2K price benchmarks", IMAGE_MODELS.nano_banana_pro.guideUsd2k === 0.134 && IMAGE_MODELS.nano_banana_flash.guideUsd2k === 0.101);
  return results;
}
