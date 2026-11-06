import { createMusicVideoProject, prepareApprovedPlacements } from "@/components/studio/musicVideoProject";
import type { H3GenerationRequest } from "@/components/studio/h3Generation";
import type { StoryTreatment } from "@/components/studio/storyTreatments";
import type { SavedStudioProject } from "@/lib/studioProjectStore";

export function h3ProjectFixture() {
  const project = prepareApprovedPlacements({ project: createMusicVideoProject({ id: "project-1", analysis: null,
    duration: 10, storyDrafts: [{ id: "verse", label: "Verse", start: 0, end: 10, prompt: "Diego crosses the club floor." }] }), videoSources: [] });
  const item = project.editPlan.timelineItems[0];
  const saved: SavedStudioProject = { version: 1,
    project: { id: "project-1", ownerId: "github-test", name: "Test", storageFolder: "media-uploads/projects/github-test/test",
      createdAt: "2026-11-06T00:00:00Z", updatedAt: "2026-11-06T00:00:00Z", audioLabel: "Master", videoCount: 0, sceneCount: 0, captionedSceneCount: 0, status: "assembled" },
    draft: { version: 3, savedAt: "2026-11-06T00:00:00Z", analysis: null, videoSources: [], musicVideoProject: project,
      storyState: { storyGenerated: true, storyBeats: [], activeBeatId: "", vocalStemName: "", transcriptSummary: null,
        confirmedTreatmentId: "story-1", confirmedTreatmentSnapshot: { id: "story-1" } as StoryTreatment },
      referenceAssets: [
        { id: "diego", role: "character-1", kind: "character", displayName: "Diego", fileName: "diego.png", previewUrl: "", promptHint: "", storageStatus: "uploaded", storageBucket: "studio", storagePath: "media-uploads/github-test/references/diego-uuid/diego.png", createdAt: "2026-11-06T00:00:00Z" },
        { id: "club", role: "environment", kind: "environment", displayName: "CLUB_MAIN", fileName: "club.png", previewUrl: "", promptHint: "", storageStatus: "uploaded", storageBucket: "studio", storagePath: "media-uploads/github-test/references/club-uuid/club.png", createdAt: "2026-11-06T00:00:00Z" },
      ] },
  };
  const request: H3GenerationRequest = { projectId: "project-1", planSignature: project.placementPlan!.inputSignature,
    sectionId: item.sectionId, timelineItemId: item.id, songStart: 0, songEnd: 5,
    prompt: "Diego strides between the booths as amber reflections sweep across the floor.",
    referenceAssetIds: ["diego", "club"], requestIntentId: "eacaa976-4fca-4cab-9160-0164107b8440", attempt: 0 };
  return { saved, request };
}
