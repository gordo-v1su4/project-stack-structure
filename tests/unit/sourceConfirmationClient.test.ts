import { describe, expect, test } from "bun:test";
import { prepareAppendedSourceConfirmation, sourceConfirmationBaselineSha256 } from "@/components/studio/sourceConfirmationClient";
import { generationScopeSha256, type GenerationScopeReceipt } from "@/components/studio/generationScope";
import { h3ProjectFixture } from "../helpers/h3Project";
import { STUDIO_JSON_TRANSPORT_HEADERS } from "@/lib/studioJsonTransport";

function fixture() {
  const { saved } = h3ProjectFixture();
  const body: GenerationScopeReceipt["body"] = { version: 1, kind: "additive-reference", ownerId: "github-test", projectId: saved.project.id,
    baselineRevision: '"fresh"', fromSourceContext: "old", toSourceContext: "new", fromInputSignature: "placements-v1-a", toInputSignature: "placements-v1-b",
    scopeSignature: "placements-v1-a", semanticSha256: "a".repeat(64), references: [], rawReferences: [], sourceMediaVersions: [], appendedReferenceIds: ["new"], storySha256: "b".repeat(64), sourceInventorySha256: "c".repeat(64) };
  const sha256 = generationScopeSha256(body), receipt: GenerationScopeReceipt = { version: 1, id: `generation-scope-${sha256}`, sha256, body };
  const draft = { ...saved.draft, musicVideoProject: { ...saved.draft.musicVideoProject!, generationScope: receipt } };
  return { saved, result: { draft, receipt, expectedRevision: '"fresh"' } };
}
describe("revision-bound source confirmation client", () => {
  test("negotiates both GET and candidate responses and returns the exact old revision for CAS without a PUT", async () => {
    const { saved, result } = fixture();
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ path: String(input), init });
      return Response.json(calls.length === 1 ? { success: true, saved: { ...saved, revision: '"fresh"' } } : { success: true, ...result });
    }) as typeof fetch;
    const actual = await prepareAppendedSourceConfirmation({ projectId: saved.project.id, baseline: saved.draft, isCurrent: () => true, fetchImpl });
    expect(actual).toEqual(result);
    expect(calls.map(call => call.path)).toEqual([`/api/studio/projects/${saved.project.id}`, "/api/studio/projects/source-confirmation"]);
    expect(calls.every(call => new Headers(call.init?.headers).get("x-studio-json-transport") === STUDIO_JSON_TRANSPORT_HEADERS["x-studio-json-transport"])).toBe(true);
    expect(JSON.parse(String(calls[1].init!.body))).toEqual({ projectId: saved.project.id, expectedRevision: '"fresh"' });
    expect(calls.some(call => call.init?.method === "PUT")).toBe(false);
  });
  for (const failure of ["missing revision", "changed remote", "changed local", "changed during POST", "changed receipt", "changed revision"]) {
    test(`refuses ${failure} without saving a candidate`, async () => {
      const { saved, result } = fixture();
      let current = true, calls = 0;
      const remote = structuredClone(saved);
      if (failure === "changed remote") remote.draft.referenceAssets![0].displayName = "Changed";
      const fetchImpl = (async () => {
        calls++;
        if (calls === 1) {
          if (failure === "changed local") current = false;
          return Response.json({ success: true, saved: { ...remote, ...(failure === "missing revision" ? {} : { revision: '"fresh"' }) } });
        }
        if (failure === "changed during POST") current = false;
        if (failure === "changed receipt") result.receipt.body.scopeSignature = "placements-v1-forged";
        if (failure === "changed revision") result.expectedRevision = '"new"';
        return Response.json({ success: true, ...result });
      }) as typeof fetch;
      await expect(prepareAppendedSourceConfirmation({ projectId: saved.project.id, baseline: saved.draft, isCurrent: () => current, fetchImpl })).rejects.toThrow();
      expect(calls).toBe(["missing revision", "changed remote", "changed local"].includes(failure) ? 1 : 2);
    });
  }
  test("bank delivery participates in the baseline guard while UI time does not", () => {
    const { saved } = fixture(), draft = saved.draft;
    expect(sourceConfirmationBaselineSha256({ ...draft, savedAt: "later", workflowUiSettings: { activeTab: "story" } })).toBe(sourceConfirmationBaselineSha256(draft));
    expect(sourceConfirmationBaselineSha256({ ...draft, generatedAssets: [] })).not.toBe(sourceConfirmationBaselineSha256(draft));
    expect(sourceConfirmationBaselineSha256({ ...draft, workflowUiSettings: { shaderPresetId: "changed" } })).not.toBe(sourceConfirmationBaselineSha256(draft));
  });
});
