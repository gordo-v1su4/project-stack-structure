import { expect, test } from "bun:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MiniMaxDraftPanel } from "@/components/studio/panels/MiniMaxDraftPanel";
import { currentReferenceIdentityFixture } from "../helpers/currentReferenceIdentity";

/** Source-render fixture only: no browser, provider, project writes or playback. */
test("stale Story exposes completed bank takes lazily with creative actions disabled", () => {
  const { asset, job } = currentReferenceIdentityFixture();
  const props: ComponentProps<typeof MiniMaxDraftPanel> = {
    projectId: job.projectId, storyApproved: false, assets: [{ ...asset, reviewStatus: "pending" }], draft: null,
    segments: [], referenceAssets: [], onEnsureSavedProject: async () => { throw new Error("Must remain read only"); },
    onGeneratedAsset: () => { throw new Error("Must not deliver in source fixture"); },
    onReviewDraft: async () => { throw new Error("Must remain read only"); }, onAcceptDraft: async () => {},
    onRejectAsset: () => {}, onSelectAsset: () => {},
  };
  const before = JSON.stringify(props.assets);
  const markup = renderToStaticMarkup(createElement(MiniMaxDraftPanel, props));
  expect(markup).toContain("Arriving and saved takes");
  expect(markup).toContain("Open saved take");
  expect(markup).toContain("Banked");
  expect(markup).toContain("Revision notes");
  expect(markup).not.toContain("<video");
  expect(markup).not.toContain("<audio");
  for (const label of ["Create missing shots", "Render revised take, then pause", "Use in draft", "Use this draft"]) {
    const attributes = markup.match(new RegExp(`<button([^>]*)>${label}</button>`))?.[1];
    expect(attributes).toContain("disabled");
  }
  expect(JSON.stringify(props.assets)).toBe(before);
});
