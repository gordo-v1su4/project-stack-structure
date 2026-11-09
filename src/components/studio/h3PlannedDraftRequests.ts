import { buildH3ShotPlanningInput, parseH3ShotPlanningResult, type H3ShotDirection, type H3ShotPlanningInput, type H3ShotPlanningResult } from "./h3ShotPlanning";
import { appendH3AestheticReferenceIds, h3RequestWindowKey, h3WindowKey, nextH3Attempt, selectH3ReferenceAssetIds } from "./h3DraftPlan";
import type { EditPlanPreviewSegment, MusicVideoProject } from "./musicVideoProject";
import { isH3JobTerminal, type H3GenerationJob, type H3GenerationRequest } from "./h3Generation";
import { identityPolicyChoiceForReferences } from "./issuedIdentityPolicy";
import type { ReferenceAsset } from "./referenceAssets";
import type { AestheticReferenceLibrary } from "./aestheticReferences";
import { buildH3ResolvedPlanningScaffold } from "./h3ResolvedPlanningScaffold";
import { resolveSelectedFootageEvidence, type SelectedFootageEvidence } from "./selectedFootageEvidence";
import { withCurrentReferenceIdentity } from "./currentReferenceIdentity";
import type { GeneratedStudioAsset } from "./generatedAssets";
import type { GeneratedDraftSelection } from "./generatedDraft";

export function buildH3DraftPlanningInput(projectId: string, project: MusicVideoProject, references: ReferenceAsset[], context: {
  assets?: GeneratedStudioAsset[]; draft?: GeneratedDraftSelection | null; jobs?: H3GenerationJob[];
  canonicalEvidenceByWindowKey?: ReadonlyMap<string, SelectedFootageEvidence>;
} = {}) {
  const assets = withCurrentReferenceIdentity(context.assets ?? [], project.currentIdentity);
  const scaffold = buildH3ResolvedPlanningScaffold({ project, generatedAssets: assets, draft: context.draft });
  const evidence = context.canonicalEvidenceByWindowKey ?? new Map(scaffold.coverageLedger.flatMap(row => {
    if (row.kind !== "generated") return [];
    const asset = assets.find(asset => asset.id === row.generatedAssetId);
    if (!asset || row.sourceStart === undefined || row.sourceEnd === undefined) throw new Error("Applied footage planning evidence is unavailable.");
    const resolved = resolveSelectedFootageEvidence({ selected: true, projectId, generationScope: scaffold.stableBindingPayload.planSignature,
      asset, window: { songStart: row.songStart, songEnd: row.songEnd, sourceStart: row.sourceStart, sourceEnd: row.sourceEnd },
      job: context.jobs?.find(job => job.id === asset.jobId), currentIdentity: project.currentIdentity, advisoryCachedRange: true });
    if (!resolved) throw new Error("The selected footage no longer matches its canonical planning context.");
    return [[row.windowKey, resolved] as const];
  }));
  return buildH3ShotPlanningInput({ projectId, project,
    segments: scaffold.segments, generatedEvidenceByWindowKey: evidence, coverageBinding: scaffold.stableBindingPayload,
    subjectNames: references.filter(asset => asset.kind === "character" || asset.role.startsWith("character")).map(asset => asset.displayName),
  });
}

export function previousH3WindowJob(projectId: string, window: EditPlanPreviewSegment, jobs: H3GenerationJob[]) {
  return jobs.filter(job => job.projectId === projectId && h3RequestWindowKey(job.request) === h3WindowKey(window))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

/** Keep one native camera/framing lead and put the reviewed physical states
 * into the rendered shot body. Actual H3 compilation/lint remains a separate
 * preflight; this adapter neither repairs prose nor certifies its quality. */
export function composePlannedH3ShotDirection(planned: H3ShotDirection) {
  const framing = /^(\[[^\]]+\]\s*[^.\n]+\.)\s*([\s\S]*)$/.exec(planned.direction);
  if (!framing) throw new Error("The planned shot needs its native camera and framing sentence before video generation.");
  const sentence = (value: string) => /[.!?]$/.test(value) ? value : `${value}.`;
  return `${framing[1].replace(/\s+/g, " ")} ${sentence(planned.entryState)} ${framing[2].trim()} ${sentence(planned.exitState)}`.trim();
}

/** Existing packets retain their own authority; partial overlays need an exact
 * scoped direction rather than replaying the enclosing completed action. */
export function buildPlannedH3DraftRequests(params: {
  projectId: string; windows: EditPlanPreviewSegment[]; jobs: H3GenerationJob[]; draftRevision: number;
  referenceAssets: ReferenceAsset[]; aestheticReferences?: AestheticReferenceLibrary;
  planningInput?: H3ShotPlanningInput; planningResult?: H3ShotPlanningResult; newIntent?: () => string;
}): H3GenerationRequest[] {
  const result = params.planningInput && params.planningResult ? parseH3ShotPlanningResult(params.planningResult, params.planningInput) : undefined;
  if (params.planningInput && params.planningInput.projectId !== params.projectId) throw new Error("Shot planning belongs to another project.");
  return params.windows.map(window => {
    const contextWindow = params.planningInput?.groups.flatMap(group => group.windows).find(candidate => candidate.key === h3WindowKey(window));
    if (contextWindow?.sourceEvidence || contextWindow?.generatedEvidence) {
      throw new Error("This window already contains canonical footage. Restore its playback source before generating missing shots.");
    }
    const previous = previousH3WindowJob(params.projectId, window, params.jobs);
    if (previous && !isH3JobTerminal(previous)) return previous.request;
    if (previous) return { ...nextH3Attempt(previous, params.jobs, params.draftRevision), draftRevision: undefined };
    const planned = result?.directions.find(direction => direction.windowKey === h3WindowKey(window));
    if (!planned || params.planningInput?.planSignature !== window.planSignature) {
      throw new Error("This missing window has no exact current shot direction. Review its partial pickup or changed cut plan before generating.");
    }
    const prompt = composePlannedH3ShotDirection(planned);
    const referenceAssetIds = appendH3AestheticReferenceIds(selectH3ReferenceAssetIds(params.referenceAssets, prompt), params.aestheticReferences, window);
    return { projectId: params.projectId, planSignature: window.planSignature!, requirementId: window.requirementId,
      timelineItemId: window.timelineItemId, sectionId: window.sectionId, songStart: window.musicStart, songEnd: window.musicEnd,
      prompt, requestIntentId: params.newIntent ? params.newIntent() : crypto.randomUUID(), attempt: 0, referenceAssetIds,
      ...identityPolicyChoiceForReferences(params.referenceAssets, referenceAssetIds), draftRevision: undefined };
  });
}
