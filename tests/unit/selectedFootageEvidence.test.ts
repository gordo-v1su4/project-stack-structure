import { describe, expect, test } from "bun:test";
import { resolveSelectedFootageEvidence, type SelectedFootageEvidenceInput } from "@/components/studio/selectedFootageEvidence";
import { selectedFootageFixture } from "../helpers/selectedFootageEvidence";
describe("selected footage evidence", () => {
  test("uses canonical requested direction and exact partial trim, never claims completion", () => {
    const input = selectedFootageFixture(), result = resolveSelectedFootageEvidence(input)!;
    expect(result.evidence).toMatchObject({ requestedDirection: input.job!.request.prompt, sourceStart: 1.5, sourceEnd: 2.5, completion: "unverified", evidenceKind: "requested-direction" });
    expect(JSON.stringify(result)).not.toContain(input.asset.prompt);
    expect(result.canonicalBinding.mediaSha256).toBe(input.asset.mediaSha256);
  });
  test("pending is usable only when selected; rejected never is", () => {
    const input = selectedFootageFixture();
    expect(resolveSelectedFootageEvidence(input)).not.toBe(undefined);
    expect(resolveSelectedFootageEvidence({ ...input, selected: false } as unknown as SelectedFootageEvidenceInput)).toBe(undefined);
    input.asset.reviewStatus = "rejected"; expect(resolveSelectedFootageEvidence(input)).toBe(undefined);
  });
  test("missing, wrong owner/project/ready/media/target/trim/reference and oversized intent fail closed", () => {
    const mutations: Array<(input: SelectedFootageEvidenceInput) => void> = [
      input => { input.job = undefined; }, input => { input.job!.ownerId = "other"; }, input => { input.job!.projectId = "other"; },
      input => { input.job!.state = "rendering"; }, input => { input.asset.mediaSha256 = "e".repeat(64); },
      input => { input.asset.fullStorage!.objectKey += "-other"; }, input => { input.asset.target!.timelineItemId = "other"; },
      input => { input.window.sourceStart = 1.6; }, input => { input.job!.referenceHashes = []; },
      input => { input.job!.request.prompt = "x".repeat(6001); }, input => { input.job!.result!.asset.identityVerification = undefined; },
    ];
    for (const mutate of mutations) { const input = selectedFootageFixture(); mutate(input); expect(resolveSelectedFootageEvidence(input)).toBe(undefined); }
  });
  test("editorial import supplies media/trim only and never consumes its editable prompt", () => {
    const input = selectedFootageFixture(); input.job = undefined;
    input.asset = { ...input.asset, id: "editorial:1", provider: "editorial", model: "original-footage-edit", jobId: undefined,
      fullStorage: { bucket: "media", objectKey: "media-uploads/owner/original.mp4", publicUrl: "https://media.test/original.mp4", storagePath: "media-uploads/owner/original.mp4", mime: "video/mp4" } };
    const result = resolveSelectedFootageEvidence(input)!;
    expect(result.evidence.evidenceKind).toBe("media-only"); expect(result.evidence.requestedDirection).toBe(undefined);
    expect(result.evidence.completion).toBe("unverified");
    input.asset.fullStorage!.objectKey = `media-uploads/projects/owner/generated/project/h3-${"a".repeat(64)}/shot.mp4`;
    expect(resolveSelectedFootageEvidence(input)).toBe(undefined);
    input.asset.fullStorage!.objectKey += "/renamed";
    expect(resolveSelectedFootageEvidence(input)).toBe(undefined);
  });
});
