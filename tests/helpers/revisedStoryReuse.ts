import { selectedFootageFixture } from "./selectedFootageEvidence";
import { createMusicVideoProject, placementInputSignature, prepareApprovedPlacements } from "@/components/studio/musicVideoProject";
import { generationScopeSha256, generationSemanticSha256, effectiveGenerationScope, sourceReferenceManifest, type GenerationScopeReceipt } from "@/components/studio/generationScope";
import { buildStudioSourceContextSignature, studioSourceContextInput } from "@/components/studio/studioSourceContext";
import { buildStoryContentSignature, type StoryTreatment } from "@/components/studio/storyTreatments";
import type { SavedStudioProject } from "@/lib/studioProjectStore";

export function revisedStoryReuseFixture() {
  const source = selectedFootageFixture(), job = source.job!, asset = source.asset;
  const treatment: StoryTreatment = { id: "story", kind: "faithful", title: "Original", logline: "The club waits.", synopsis: "A club at rest.",
    visualThesis: "A place waiting.", endingHook: "The door opens.", expectedReusePercent: 100, expectedGenerationPercent: 0, anchors: [] };
  const analysis = { sourceLabel: "master.wav", audioUrl: "", duration: 4, waveform: [], energy: [], beats: [], onsets: [], sections: [],
    storageBucket: "media", storagePath: "media-uploads/owner/source-audio/master.wav", storageUrl: "https://media.test/master.wav", mediaKey: "master" };
  const references = [{ id: "club", role: "environment" as const, kind: "environment" as const, displayName: "Club", fileName: "club.png",
    previewUrl: "", promptHint: "", storageStatus: "uploaded" as const, storageBucket: "media", storagePath: "media-uploads/owner/references/club.png", createdAt: "2026-11-09T00:00:00Z" }];
  const beats = [{ id: "verse", label: "Verse", start: 0, end: 4, prompt: "The club waits." }];
  const context = buildStudioSourceContextSignature({ analysis, videoSources: [], referenceAssets: references });
  const project = prepareApprovedPlacements({ project: { ...createMusicVideoProject({ id: "project", analysis, duration: 4, storyDrafts: beats }), sourceContextSignature: context }, videoSources: [] });
  const saved: SavedStudioProject = { version: 1, revision: '"r1"', project: { id: "project", ownerId: "owner", name: "Finishing copy",
    storageFolder: "media-uploads/projects/owner/finishing", createdAt: "2026-11-09T00:00:00Z", updatedAt: "2026-11-09T00:00:00Z",
    audioLabel: "master.wav", videoCount: 0, sceneCount: 0, captionedSceneCount: 0, status: "assembled" },
    draft: { version: 3, savedAt: "2026-11-09T00:00:00Z", analysis, videoSources: [], musicVideoProject: project, referenceAssets: references,
      generatedAssets: [asset], storyState: { storyGenerated: true, storyBeats: beats, activeBeatId: "verse", vocalStemName: "", transcriptSummary: null,
        confirmedTreatmentId: treatment.id, confirmedTreatmentSnapshot: treatment, confirmedSourceContextSignature: context,
        storyContentSignature: buildStoryContentSignature(treatment, beats), editSettings: project.placementPlan!.settings } } };
  project.generationScopeVersion = 2;
  project.generationSourceContextSha256 = generationScopeSha256(studioSourceContextInput({ analysis, videoSources: [], referenceAssets: references }));
  project.generationStorySha256 = generationScopeSha256({ storyBeats: beats, confirmedTreatmentSnapshot: treatment,
    storyContentSignature: saved.draft.storyState.storyContentSignature, editSettings: saved.draft.storyState.editSettings });
  project.placementPlan!.inputSignature = placementInputSignature(project);
  const scope = effectiveGenerationScope(project)!;
  asset.target = { ...asset.target!, planSignature: scope, timelineItemId: project.editPlan.timelineItems[0].id, sectionId: "verse", songStart: 0, songEnd: 2 };
  job.target = structuredClone(asset.target);
  job.request = { ...job.request, planSignature: scope, timelineItemId: asset.target.timelineItemId, sectionId: "verse", songStart: 0, songEnd: 2 };
  job.references[0].objectKey = references[0].storagePath;
  job.result!.asset = structuredClone(asset);
  const body: GenerationScopeReceipt["body"] = { version: 1, kind: "baseline", ownerId: "owner", projectId: "project", baselineRevision: saved.revision!,
    fromSourceContext: context, toSourceContext: context, fromInputSignature: project.placementPlan!.inputSignature, toInputSignature: project.placementPlan!.inputSignature,
    scopeSignature: scope, semanticSha256: generationSemanticSha256(project), references: sourceReferenceManifest(references),
    rawReferences: [{ assetId: "club", bucket: "media", objectKey: references[0].storagePath, etag: '"original"', sha256: "c".repeat(64), byteLength: 100 }],
    sourceMediaVersions: [{ id: "master", bucket: "media", objectKey: analysis.storagePath, etag: '"master"', byteLength: 100 }], appendedReferenceIds: [],
    sourceInventorySha256: project.generationSourceContextSha256, storySha256: project.generationStorySha256 };
  const sha256 = generationScopeSha256(body), baseline: GenerationScopeReceipt = { version: 1, id: `generation-scope-${sha256}`, sha256, body };
  project.generationScope = baseline;
  saved.draft.generatedDraft = { planSignature: scope, revision: 1, assetIds: [asset.id] };
  return { saved, job, asset, baseline };
}
