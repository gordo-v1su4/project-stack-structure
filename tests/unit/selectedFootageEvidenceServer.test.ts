import { describe, expect, test } from "bun:test";
import { resolveCanonicalSelectedFootageEvidence } from "@/lib/selectedFootageEvidenceServer";
import { selectedFootageFixture } from "../helpers/selectedFootageEvidence";
import { h3IdentityAssessmentFixture } from "../helpers/h3IdentityAssessment";
import { resolveSelectedFootageEvidence } from "@/components/studio/selectedFootageEvidence";

describe("canonical selected-footage evidence", () => {
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
