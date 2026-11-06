import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "bun:test";
import { SimilarityFilterNote } from "@/components/studio/panels/MiniMaxDraftPanel";
import { draftSimilarityFixture } from "../helpers/draftSimilarity";

describe("numerical similarity evidence", () => {
  test("failed filters show assigned score range, cutoff and honest frame counts", () => {
    const { asset } = draftSimilarityFixture(), filter = asset.identityVerification!.draftSimilarityFilter!;
    filter.status = "ineligible";
    filter.eligibleFrameCount = 3;
    filter.outOfScopeFrameCount = 20;
    filter.ambiguousFrameCount = 2;
    filter.samples.forEach(sample => { sample.scores[0].score = .73; });
    filter.samples[0].scores[0].score = .84;
    filter.warnings.push("Draft filter reason: low_detection_confidence on 20/37 frames.");
    const markup = renderToStaticMarkup(createElement(SimilarityFilterNote, { asset }));
    for (const text of ["Similarity filter did not pass", "Cosine similarity 0.730–0.840", "cutoff 0.800",
      "Eligible frames 3/37 assessed", "out of scope 20", "ambiguous 2", "low_detection_confidence on 20/37",
      "Identity remains unverified", "not calibrated identity confidence"]) expect(markup).toContain(text);
    expect(markup).not.toContain("Similarity filter passed");
    expect(markup).not.toContain("%");
  });

  test("unassessable faces show no measured score rather than an invented zero", () => {
    const { asset } = draftSimilarityFixture(), filter = asset.identityVerification!.draftSimilarityFilter!;
    filter.status = "unverifiable";
    filter.eligibleFrameCount = 0;
    filter.outOfScopeFrameCount = 37;
    filter.samples.forEach(sample => { sample.scores = []; });
    const markup = renderToStaticMarkup(createElement(SimilarityFilterNote, { asset }));
    expect(markup).toContain("Similarity filter could not be assessed");
    expect(markup).toContain("No face similarity scores measured");
    expect(markup).toContain("cutoff 0.800");
    expect(markup).toContain("Eligible frames 0/37 assessed");
    expect(markup).not.toContain("Cosine similarity 0.000");
  });

  test("passed provisional filters retain their review caveat and raw numeric evidence", () => {
    const { asset } = draftSimilarityFixture();
    const markup = renderToStaticMarkup(createElement(SimilarityFilterNote, { asset }));
    expect(markup).toContain("Similarity filter passed · review required");
    expect(markup).toContain("Cosine similarity 0.900–0.900");
    expect(markup).toContain("Eligible frames 37/37 assessed");
    expect(markup).toContain("not calibrated identity confidence");
  });
});
