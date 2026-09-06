/**
 * Dev helper: seed confirmed story treatments into the local studio draft
 * without calling Qwen. Uses fixture treatment shapes from storyTreatments tests.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  applyTreatmentAnchorsToStoryBeats,
  applyTreatmentCoverageToProject,
  buildStoryContentSignature,
  hydrateTreatmentCoverage,
  isStoryPlanConfirmable,
  parseGeneratedTreatments,
  type StoryTreatment,
} from "../src/components/studio/storyTreatments";

const DRAFT_PATH = path.join(process.cwd(), ".tmp", "studio-drafts", "default.json");

const generated = {
  treatments: ["faithful", "bold", "wildcard"].map((kind, treatmentIndex) => ({
    id: `${kind}-story`,
    kind,
    title: `${kind} — Love Me Tonight`,
    logline: `${kind} treatment follows two dancers through a red-lit club as worship energy builds toward a final reunion ${treatmentIndex}.`,
    synopsis: `A visually specific sequence of rooms creates a complete cinematic progression for the ${kind} version, with movement remaining the primary spectacle and a distinct ending.`,
    visualThesis: "Bodies move through hard pools of light while architecture fractures around them.",
    endingHook: `${kind} ending lands on a different final decision.`,
    expectedReusePercent: 75,
    expectedGenerationPercent: 25,
    anchors: Array.from({ length: 4 }, (_, anchorIndex) => ({
      id: `${kind}-anchor-${anchorIndex + 1}`,
      title: ["Tunnel arrival", "Crowded dance room", "Search through the maze", "Collapsing arena"][anchorIndex],
      description: [
        "A stranger descends through a wet tunnel toward the hidden underground dance complex.",
        "Two dancers move independently through a crowded room without noticing one another.",
        "They search separate corridors after realizing their missed connection mattered.",
        "They reunite and dance as the central arena floor splits and collapses.",
      ][anchorIndex],
      purpose: "Advance the physical search and make the underground geography legible.",
      generationPrompt: "Cinematic wide shot of dancers moving through an underground industrial chamber.",
    })),
  })),
};

function resolveTreatment(treatment: StoryTreatment): StoryTreatment {
  return {
    ...treatment,
    anchors: treatment.anchors.map((anchor) => {
      if (anchor.resolution) return anchor;
      if (anchor.candidates[0]) {
        return {
          ...anchor,
          resolution: "source",
          selectedCandidateId: anchor.candidates[0].momentId,
        };
      }
      return { ...anchor, resolution: "generate", selectedCandidateId: null };
    }),
  };
}

async function main() {
  const draft = JSON.parse(await readFile(DRAFT_PATH, "utf8")) as {
    storyState: Record<string, unknown>;
    musicVideoProject: Parameters<typeof applyTreatmentCoverageToProject>[0];
    workflowUiSettings?: Record<string, unknown>;
    savedAt?: string;
  };

  const moments = draft.musicVideoProject?.videoMoments ?? [];
  if (!moments.length) throw new Error("Draft has no video moments — run ingest first.");

  const treatments = hydrateTreatmentCoverage(parseGeneratedTreatments(generated), moments);
  const faithful = treatments.find((treatment) => treatment.kind === "faithful") ?? treatments[0];
  const resolved = resolveTreatment(faithful);
  if (!isStoryPlanConfirmable(resolved)) {
    throw new Error("Resolved treatment is not confirmable.");
  }

  const storyBeats = draft.storyState.storyBeats as Parameters<typeof applyTreatmentAnchorsToStoryBeats>[0];
  const storyBeatsWithAnchors = applyTreatmentAnchorsToStoryBeats(storyBeats, resolved);
  const musicVideoProject = applyTreatmentCoverageToProject(draft.musicVideoProject, resolved);

  draft.storyState = {
    ...draft.storyState,
    treatments,
    selectedTreatmentId: resolved.id,
    confirmedTreatmentId: resolved.id,
    confirmedTreatmentSnapshot: resolved,
    storyGenerated: true,
    storyBeats: storyBeatsWithAnchors,
    storyContentSignature: buildStoryContentSignature(resolved, storyBeatsWithAnchors),
    generationMeta: { model: "dev-seed", generatedAt: new Date().toISOString() },
  };
  draft.musicVideoProject = musicVideoProject;
  draft.workflowUiSettings = { ...draft.workflowUiSettings, activeTab: "story" };
  draft.savedAt = new Date().toISOString();

  await writeFile(DRAFT_PATH, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
  console.info(`[seed] story plan confirmed: ${resolved.title} (${resolved.anchors.length} anchors)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
