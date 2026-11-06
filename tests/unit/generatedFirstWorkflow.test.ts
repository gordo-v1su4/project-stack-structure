import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPipelineState, type PipelineStageInput } from "@/components/studio/studioPipeline";
import { buildWorkflowNavigation } from "@/components/studio/workflowNavigation";
import { ActRail } from "@/components/studio/shell/ActRail";
import { buildStudioCommands } from "@/components/studio/shell/commands";
import { StoryTab, createDefaultStoryTabState } from "@/components/studio/panels/StoryTab";
import { handleStoryTreatmentsPost } from "@/app/api/story/treatments/route";

const input: PipelineStageInput = {
  activeTab: "review", hasAudioAnalysis: true, hasLyricTranscript: false, hasRequiredReferences: true,
  videoCount: 0, sceneCount: 0, captionReadyCount: 0, captionTotalCount: 0,
  storyTreatmentSelected: true, storyAnchorsResolved: true, storyPlanConfirmed: true,
  editSlotCount: 4, matchedSlotCount: 0, gapSlotCount: 4, weakMatchSlotCount: 0, shortReviewSlotCount: 0,
  storySegmentCount: 4, hasCommittedSplit: false, shaderPresetLabel: "None", finalExportReady: false,
};

describe("generated-first workflow", () => {
  test("a song and references unlock Story and Draft without footage, captions, lyrics or a Split visit", () => {
    const pipeline = buildPipelineState(input);
    expect(pipeline.stages.find((stage) => stage.key === "review")?.ready).toBe(true);
    expect(pipeline.stages.find((stage) => stage.key === "generate")).toMatchObject({ available: true, ready: false });
    expect(pipeline.stages.find((stage) => stage.key === "join")?.available).toBe(true);
    expect(pipeline.stages.find((stage) => stage.key === "compose")?.available).toBe(false);
    expect(pipeline.nextStage?.key).toBe("generate");
    const navigation = buildWorkflowNavigation(pipeline.stages, "join");
    expect(navigation.map((step) => step.label)).toEqual(["Setup", "Story", "Draft", "Finish"]);
    expect(navigation[2]).toMatchObject({ active: true, complete: false, isNext: true });
    const markup = renderToStaticMarkup(createElement(ActRail, { stages: pipeline.stages, tab: "join", onSelectTab: () => {} }));
    expect(markup.match(/aria-current="step"/g)).toHaveLength(1);
    expect(markup).toContain("3. Draft");
    expect(markup).toContain("4. Finish");
    expect(markup).toContain("Tools</summary>");
    expect(markup).toContain("2/4 steps complete");
  });

  test("numbered commands follow the four main steps while every detailed tool remains reachable", () => {
    const commands = buildStudioCommands({ activeTab: "review", stages: buildPipelineState(input).stages, model: null, transport: null, onSelectTab: () => {}, onPrimary: () => {}, onSecondary: () => {}, onTogglePlayback: () => {}, onStopPlayback: () => {}, onOpenShortcuts: () => {} });
    const numbered = commands.filter((command) => /^\d$/.test(command.shortcut ?? ""));
    expect(numbered.map((command) => [command.shortcut, command.label])).toEqual([["1", "Go to Setup"], ["2", "Go to Story"], ["3", "Go to Draft"], ["4", "Go to Finish"]]);
    expect(commands.filter((command) => command.id.startsWith("go:")).map((command) => command.id).sort()).toEqual(["go:compose", "go:generate", "go:join", "go:ramp", "go:review", "go:shuffle", "go:split", "go:story"]);
  });

  test("lyric-free Story uses the analyzed song timing and enables treatment generation with no source moments", () => {
    const markup = renderToStaticMarkup(createElement(StoryTab, {
      analysis: { sourceLabel: "song.wav", audioUrl: "", waveform: [], energy: [], beats: [0, 4, 8], onsets: [], sections: [{ label: "Opening", start: 0, end: 8 }], duration: 8 },
      audioStatus: "Ready", videoSources: [], segmentPreviews: [], state: createDefaultStoryTabState(), onStateChange: () => {},
    }));
    expect(markup).toContain("Music-section timing · lyrics optional");
    expect(markup).toContain("Planning from the music");
    const generateButton = markup.match(/<button[^>]*>Generate three treatments<\/button>/)?.[0];
    expect(Boolean(generateButton)).toBe(true);
    expect(generateButton).not.toMatch(/\sdisabled(?:=|\s|>)/);
    expect(markup).not.toContain("Finish song analysis and scene captions");
  });

  test("authenticated zero-footage, lyric-free Story dispatch preserves actual empty evidence", async () => {
    let dispatched = false;
    const response = await handleStoryTreatmentsPost(new Request("http://localhost/api/story/treatments", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief: "A high-energy performance by Diego", song: { duration: 8, sections: [{ label: "Opening", start: 0, end: 8 }] }, footage: { sourceCount: 0, momentCount: 0, captionClusters: [] } }),
    }), { getUser: async () => ({ id: "test-user" }), isConfigured: true, queue: async (request) => {
      expect(request.song.lyricExcerpt).toBe(undefined);
      expect(request.footage).toEqual({ captionClusters: [], sourceCount: 0, momentCount: 0 });
      expect(request.song.sections).toEqual([{ label: "Opening", start: 0, end: 8, energy: undefined }]);
      dispatched = true;
      return { runId: "run-master-only", model: "qwen" };
    } });
    expect(response.status).toBe(202);
    expect(dispatched).toBe(true);
  });
});
