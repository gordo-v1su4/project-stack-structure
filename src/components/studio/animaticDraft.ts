import { buildEditPlanPreviewSegments, isPlacementPlanCurrent, type EditPlanPreviewSegment, type MusicVideoProject,
  type StoryPlanDraft, type StoryEditSettings } from "./musicVideoProject";
import { effectiveGenerationScope } from "./generationScope";
import { animaticContextSha256, animaticImage, animaticShotBinding, normalizeStillAnimaticPlan, type StillAnimaticPlan } from "./stillAnimatic";
import { animaticReviewBinding } from "./animaticReview";
import { stillMediaUrl } from "./h3StillClient";
import type { StoryTreatment } from "./storyTreatments";
import type { SceneProofPlan } from "./sceneProofs";
import type { ReferenceAsset } from "./referenceAssets";
import type { UploadedVideoSource } from "./types";

/** One projection shared by Draft playback and server export reconciliation. */
export function buildStoryDraftSegments(input: { projectId: string; project: MusicVideoProject | null;
  videoSources: UploadedVideoSource[]; referenceAssets: ReferenceAsset[];
  audio?: { storageBucket?: string; storagePath?: string } | null;
  storyState: { stillAnimaticPlan?: StillAnimaticPlan; sceneProofPlan?: SceneProofPlan; confirmedTreatmentSnapshot?: StoryTreatment | null;
    storyBeats: StoryPlanDraft[]; editSettings?: Partial<StoryEditSettings> } }): EditPlanPreviewSegment[] {
  const { project, storyState: story } = input;
  const legacy = () => buildEditPlanPreviewSegments({ project, videoSources: input.videoSources, editSettings: story.editSettings });
  if (!story.stillAnimaticPlan) return legacy();
  const plan = normalizeStillAnimaticPlan(story.stillAnimaticPlan);
  if (!plan || !project || plan.projectId !== input.projectId) return legacy().map(segment => ({ ...segment,
    kind: "gap", videoUrl: "", planSignature: undefined, gapReason: "Restore the current timed shot plan before preparing motion." }));
  const context = story.confirmedTreatmentSnapshot && story.sceneProofPlan ? animaticContextSha256({ projectId: input.projectId, project,
    treatment: story.confirmedTreatmentSnapshot, storyBeats: story.storyBeats, references: input.referenceAssets, sceneProofPlan: story.sceneProofPlan }) : "";
  const audioUrl = input.audio?.storageBucket && input.audio.storagePath
    ? `/api/storage/media?${new URLSearchParams({ bucket: input.audio.storageBucket, objectKey: input.audio.storagePath })}` : "";
  const reviewBinding = animaticReviewBinding(plan, context, audioUrl);
  const reviewed = reviewBinding && plan.review?.status === "approved" && plan.review.bindingSha256 === reviewBinding && isPlacementPlanCurrent(project);
  const planSignature = reviewed ? effectiveGenerationScope(project) : undefined;
  return plan.shots.map(shot => {
    const image = animaticImage(plan, shot, context);
    const musicStart = shot.startFrame / plan.fps, musicEnd = Math.min(shot.endFrame / plan.fps, plan.masterDuration);
    return { animaticShotId: shot.id, animaticRetainedSource: Boolean(shot.sourceFrame), animaticReferenceAssetIds: [...shot.referenceAssetIds],
      ...(reviewed && image ? { animaticMotion: { ...animaticShotBinding(plan, shot), reviewBindingSha256: reviewBinding, imageSha256: image.sha256 } } : {}),
      ...(reviewed && shot.proof ? { animaticFirstFrame: { kind: "first-frame" as const, artifactId: shot.proof.result.artifactId, expectedSha256: shot.proof.result.native.sha256 } } : {}),
      planSignature, timelineItemId: `animatic:${shot.id}`, placementId: `animatic:${shot.id}`, sectionId: story.sceneProofPlan?.scenes.find(scene => scene.id === shot.sceneId)?.sectionId ?? shot.sceneId,
      storyDirection: shot.prompt, label: `${shot.id} · ${shot.title}`, kind: "gap" as const, videoUrl: "", musicStart, musicEnd,
      startTime: 0, endTime: musicEnd - musicStart, thumbnailUrl: image ? stillMediaUrl(image) : undefined,
      gapReason: !reviewed ? "Complete and review the full-song still animatic before motion."
        : shot.sourceFrame ? "Review and place the existing source footage for this shot." : "Prepare and review motion for this shot." };
  });
}
