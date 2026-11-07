import { expect, test } from "bun:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MiniMaxDraftPanel } from "@/components/studio/panels/MiniMaxDraftPanel";
import { withCurrentReferenceIdentity } from "@/components/studio/currentReferenceIdentity";
import { createGeneratedDraftSelection } from "@/components/studio/generatedDraft";
import { currentReferenceIdentityFixture } from "../helpers/currentReferenceIdentity";

function fixtureProps(): ComponentProps<typeof MiniMaxDraftPanel> {
  const fixture = currentReferenceIdentityFixture();
  fixture.context.assessments = {}; fixture.context.activeAssessments = {};
  const asset = withCurrentReferenceIdentity([{ ...fixture.asset, reviewStatus: "pending" as const }], fixture.context)[0];
  const target = asset.target!;
  return { projectId: fixture.job.projectId, assets: [asset], draft: createGeneratedDraftSelection(target.planSignature!), referenceAssets: [],
    segments: [{ kind: "gap", videoUrl: "", startTime: 0, endTime: target.songEnd - target.songStart,
      musicStart: target.songStart, musicEnd: target.songEnd, label: "Candidate", sectionId: target.sectionId,
      timelineItemId: target.timelineItemId, requirementId: target.requirementId, planSignature: target.planSignature }],
    onEnsureSavedProject: async () => fixture.job.projectId, onGeneratedAsset: () => {}, onReviewDraft: async () => { throw new Error("No review requested"); },
    onAcceptDraft: async () => {}, onRejectAsset: () => {}, onSelectAsset: () => {}, onCheckCurrentReferences: async () => {} };
}

const button = (markup: string, label: string) => markup.match(new RegExp(`<button([^>]*)>${label}</button>`))?.[1];

test("Other takes exposes an enabled explicit check before current-reference eligibility allows selection", () => {
  const props = fixtureProps(), before = JSON.stringify({ assets: props.assets, draft: props.draft });
  let selections = 0, checks = 0;
  props.onSelectAsset = () => { selections++; }; props.onCheckCurrentReferences = async () => { checks++; };
  const markup = renderToStaticMarkup(createElement(MiniMaxDraftPanel, props));
  expect(markup).toContain("Other takes");
  const check = button(markup, "Check against updated references");
  expect(check === undefined).toBe(false); expect(check).not.toContain("disabled");
  expect(button(markup, "Use in draft")).toContain("disabled");
  expect(selections).toBe(0); expect(checks).toBe(0);
  expect(JSON.stringify({ assets: props.assets, draft: props.draft })).toBe(before);
});

test("a current-reference action cannot be enabled by a missing original proof", () => {
  const props = fixtureProps(); props.assets = [{ ...props.assets[0], identityVerification: undefined }];
  const markup = renderToStaticMarkup(createElement(MiniMaxDraftPanel, props));
  expect(button(markup, "Check against updated references")).toContain("disabled");
  expect(button(markup, "Use in draft")).toContain("disabled");
});

test("the explicit bank action is absent without a current-reference callback", () => {
  const props = fixtureProps(); props.onCheckCurrentReferences = undefined;
  expect(renderToStaticMarkup(createElement(MiniMaxDraftPanel, props))).not.toContain("Check against updated references");
});
