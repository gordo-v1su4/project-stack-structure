import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "bun:test";
import { NativeHandleDetails, SimilarityFilterNote } from "@/components/studio/panels/MiniMaxDraftPanel";
import { h3IdentityAssessmentTrimWindow } from "@/components/studio/h3IdentityAssessment";
import { draftSimilarityFixture } from "../helpers/draftSimilarity";

describe("numerical similarity evidence", () => {
  test("a closed library of 79 native handles mounts no media or preload requests",()=>{
    const {asset}=draftSimilarityFixture(),range=h3IdentityAssessmentTrimWindow(asset,12);
    const before=JSON.stringify({asset,range});
    const markup=renderToStaticMarkup(createElement("div",null,...Array.from({length:79},(_,key)=>createElement(NativeHandleDetails,{key,asset,range,disabled:false,onStartFrame:()=>{throw Error("Closed handle must not change selection");}}))));
    expect((markup.match(/<details/g)??[]).length).toBe(79);
    expect(markup).not.toContain("<video");
    expect(markup).not.toContain("preload=");
    expect(markup).not.toContain("/api/storage/media");
    expect(JSON.stringify({asset,range})).toBe(before);
  });
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
