import { describe, expect, test } from "bun:test";
import { createCanonicalSelectedFootageEvidenceResolver, resolveCanonicalSelectedFootageEvidence } from "@/lib/selectedFootageEvidenceServer";
import { selectedFootageFixture } from "../helpers/selectedFootageEvidence";
import { h3IdentityAssessmentFixture } from "../helpers/h3IdentityAssessment";
import { resolveSelectedFootageEvidence } from "@/components/studio/selectedFootageEvidence";

describe("canonical selected-footage evidence", () => {
  test("one context shares exact job/first-frame proof but still checks each window and fresh job binding", async () => {
    const fixture = selectedFootageFixture();
    let checks = 0, reads = 0;
    const dependencies = { readJob: async () => { reads++; return fixture.job!; }, firstFrame: async () => { checks++; } };
    const resolve = createCanonicalSelectedFootageEvidenceResolver(dependencies);
    const input = { ...fixture, ownerId: "owner" };
    expect(await resolve(input)).not.toBe(undefined);
    const next = { ...input, window: { songStart: 11, songEnd: 12, sourceStart: 2, sourceEnd: 3 } };
    expect((await resolve(next))!.evidence.sourceStart).toBe(2);
    expect(checks).toBe(1); expect(reads).toBe(2);
    expect(await resolve({ ...next, window: { ...next.window, sourceEnd: 4 } })).toBe(undefined);
    expect(checks).toBe(1);
    fixture.job!.updatedAt = "2026-11-09T00:00:00Z";
    expect(await resolve(input)).not.toBe(undefined); expect(checks).toBe(2);
    const fresh = createCanonicalSelectedFootageEvidenceResolver(dependencies);
    expect(await fresh(input)).not.toBe(undefined); expect(checks).toBe(3);
  });

  test("failed first-frame proof stays rejected within its context and is read again in a fresh context", async () => {
    const fixture = selectedFootageFixture(); let checks = 0;
    const dependencies = { readJob: async () => fixture.job!, firstFrame: async () => { checks++; throw new Error("PNG changed"); } };
    const resolve = createCanonicalSelectedFootageEvidenceResolver(dependencies), input = { ...fixture, ownerId: "owner" };
    await expect(resolve(input)).rejects.toThrow("PNG changed");
    await expect(resolve(input)).rejects.toThrow("PNG changed"); expect(checks).toBe(1);
    await expect(createCanonicalSelectedFootageEvidenceResolver(dependencies)(input)).rejects.toThrow("PNG changed");
    expect(checks).toBe(2);
  });
  test("cached PNG validation never bypasses changed asset receipt or per-window current-reference validation", async () => {
    const fixture = selectedFootageFixture(); let checks = 0, currentChecks = 0, rejectCurrent = false;
    const resolve = createCanonicalSelectedFootageEvidenceResolver({ readJob: async () => fixture.job!,
      firstFrame: async (_owner, _project, _job, asset) => { checks++; if (asset.firstFrame) throw new Error("First-frame receipt differs"); },
      currentIdentity: async (_owner, _project, _job, asset) => { currentChecks++; if (rejectCurrent) throw new Error("Current evidence changed"); return asset; } });
    const input = { ...fixture, ownerId: "owner", currentIdentity: { migrationSha256: "a".repeat(64), contextSha256: "b".repeat(64), replacements: [], assessments: {}, activeAssessments: {} } };
    expect(await resolve(input)).not.toBe(undefined);
    const tampered = structuredClone(input);
    tampered.asset.firstFrame = {} as NonNullable<typeof tampered.asset.firstFrame>;
    await expect(resolve(tampered)).rejects.toThrow("First-frame receipt differs");
    expect(checks).toBe(2);
    rejectCurrent = true;
    await expect(resolve(input)).rejects.toThrow("Current evidence changed");
    expect(currentChecks).toBe(3); expect(checks).toBe(2);
  });
  test("reads only the selected owned job and uses immutable request intent", async () => {
    const fixture = selectedFootageFixture(), calls: string[][] = [];
    const result = await resolveCanonicalSelectedFootageEvidence({ ...fixture, ownerId: "owner" }, {
      readJob: async (...args) => { calls.push(args); return fixture.job!; },
      readRange: async () => { throw new Error("No range requested"); },
    });
    expect(calls).toEqual([["owner", "project", fixture.job!.id]]);
    expect(result?.evidence.requestedDirection).toBe(fixture.job!.request.prompt);
    expect(result?.evidence.completion).toBe("unverified");
  });
  test("cannot consume another owner job or a missing exact range assessment", async () => {
    const fixture = selectedFootageFixture();
    const other = structuredClone(fixture.job!); other.ownerId = "other";
    expect(await resolveCanonicalSelectedFootageEvidence({ ...fixture, ownerId: "owner" }, { readJob: async () => other })).toBe(undefined);
    fixture.asset.identityAssessmentId = `h3-assessment-${"e".repeat(64)}`;
    let reads = 0;
    expect(await resolveCanonicalSelectedFootageEvidence({ ...fixture, ownerId: "owner" }, {
      readJob: async () => fixture.job!, readRange: async (owner, project, job, assessment) => {
        reads++; expect([owner, project, job, assessment]).toEqual(["owner", "project", fixture.job!.id, fixture.asset.identityAssessmentId]); return null;
      },
    })).toBe(undefined);
    expect(reads).toBe(1);
  });
  test("canonical current-reference check runs independently and its rejection propagates", async () => {
    const fixture = selectedFootageFixture();
    const currentIdentity = { migrationSha256: "a".repeat(64), contextSha256: "b".repeat(64), replacements: [], assessments: {}, activeAssessments: {} };
    let checks = 0;
    await expect(resolveCanonicalSelectedFootageEvidence({ ...fixture, ownerId: "owner", currentIdentity }, {
      readJob: async () => fixture.job!, currentIdentity: async () => { checks++; throw new Error("Canonical assessment changed"); },
    })).rejects.toThrow("Canonical assessment changed");
    expect(checks).toBe(1);
  });
  test("editorial media-only context does not read jobs or convert prompt into action", async () => {
    const fixture = selectedFootageFixture();
    fixture.asset.provider = "editorial"; fixture.asset.model = "original-footage-edit"; fixture.asset.jobId = undefined;
    fixture.asset.fullStorage!.objectKey = "media-uploads/owner/edit.mp4";
    const result = await resolveCanonicalSelectedFootageEvidence({ ...fixture, ownerId: "owner" }, {
      readJob: async () => { throw new Error("Editorial has no job"); },
    });
    expect(result?.evidence.evidenceKind).toBe("media-only"); expect(result?.evidence.requestedDirection).toBe(undefined);
  });
  test("advisory cached range matches canonical evidence, but injected cache mode cannot bypass server reads", async () => {
    const fixture = h3IdentityAssessmentFixture(), { job, assessed, record, policy } = fixture;
    const input = { selected: true as const, ownerId: job.ownerId, projectId: job.projectId,
      generationScope: job.target.planSignature!, asset: assessed,
      window: { songStart: job.target.songStart, songEnd: job.target.songEnd, sourceStart: .5, sourceEnd: 1.5 } };
    const client = resolveSelectedFootageEvidence({ ...input, job, advisoryCachedRange: true });
    expect(client === undefined).toBe(false);
    const server = await resolveCanonicalSelectedFootageEvidence(input, { readJob: async () => job,
      readRange: async () => record, readPolicy: async () => policy });
    expect(server).toEqual(client);
    const injected = { ...input, advisoryCachedRange: true };
    let rangeReads = 0;
    expect(await resolveCanonicalSelectedFootageEvidence(injected, { readJob: async () => job,
      readRange: async () => { rangeReads++; return null; } })).toBe(undefined);
    expect(rangeReads).toBe(1);
    const tampered = structuredClone(input);
    tampered.asset.identityVerification!.assessedAt = "2026-11-08T02:00:00Z";
    const staleClient = resolveSelectedFootageEvidence({ ...tampered, job, advisoryCachedRange: true });
    expect(staleClient === undefined).toBe(false);
    expect(staleClient!.canonicalBinding.identityEvidenceSha256 === server!.canonicalBinding.identityEvidenceSha256).toBe(false);
  });
});
