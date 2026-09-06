import type { EditPlanPreviewSegment } from "./musicVideoProject";
import type { ReferenceAsset } from "./referenceAssets";

export const IMAGE_MODELS = {
  nano_banana_pro: { label: "Nano Banana Pro", guideUsd2k: 0.134 },
  nano_banana_flash: { label: "Nano Banana 2 · budget", guideUsd2k: 0.101 },
} as const;
export type StoryboardImageModel = keyof typeof IMAGE_MODELS;
export type GenerationBilling = "subscription-manual" | "api-credits";
export type VideoFrameRole = "composition-reference" | "start-frame" | "end-frame";
export const IMAGE_PRICE_GUIDE = { checkedAt: "2026-08-30", url: "https://ai.google.dev/gemini-api/docs/pricing", note: "Google standard API image-output benchmark only. Input, thinking, retries and provider markup excluded; not a Higgsfield invoice or subscription charge." };

export type StoryboardReference = { url: string; label: string; role: string };
export type StoryboardSequence = {
  id: string; sectionId: string; label: string; songStart: number; songEnd: number;
  cuts: EditPlanPreviewSegment[];
};
export type StoryboardJob = {
  id: string; projectId: string; sequenceId: string; sectionId: string; title: string;
  songStart: number; songEnd: number; kind: "grid" | "fresh-frame";
  model: StoryboardImageModel; billing: GenerationBilling; resolution: "2k";
  prompt: string; references: StoryboardReference[];
  sourceGridId?: string; panelIndex?: number;
};
export type StoryboardQuote = {
  token: string; expiresAt: number; credits: number | null; guideUsd: number;
};

/** Stable UI identity for immutable job content; server approval uses SHA-256. */
export function identifyStoryboardJob(job: StoryboardJob): StoryboardJob {
  let fingerprint = 2166136261;
  for (const character of JSON.stringify({ ...job, id: "" })) {
    fingerprint = Math.imul(fingerprint ^ character.charCodeAt(0), 16777619);
  }
  return { ...job, id: `${job.id}:${(fingerprint >>> 0).toString(16)}` };
}

// Plan against actual resolved edits, not the primary-match shortage heuristic.
export function buildStoryboardSequences(segments: EditPlanPreviewSegment[]): StoryboardSequence[] {
  const result: StoryboardSequence[] = [];
  for (const cut of segments) {
    if (!(cut.musicEnd > cut.musicStart)) continue;
    let sequence = result[result.length - 1];
    if (!sequence || sequence.sectionId !== cut.sectionId || sequence.cuts.length === 9
      || Math.abs(sequence.songEnd - cut.musicStart) > 0.05) {
      sequence = { id: `${cut.sectionId}:${cut.musicStart.toFixed(3)}`, sectionId: cut.sectionId,
        label: cut.sectionId, songStart: cut.musicStart, songEnd: cut.musicEnd, cuts: [] };
      result.push(sequence);
    }
    sequence.cuts.push(cut);
    sequence.songEnd = cut.musicEnd;
  }
  return result;
}

export function canonicalStoryboardReferences(assets: ReferenceAsset[]): StoryboardReference[] {
  return assets.filter((asset) => asset.storageStatus === "uploaded" && asset.storageUrl?.startsWith("https://"))
    .map((asset) => ({ url: asset.storageUrl!, label: asset.displayName, role: asset.role }));
}

export function referenceContract(references: StoryboardReference[]) {
  return references.map((reference, i) => {
    const image = `Image ${i + 1}`;
    if (reference.role.startsWith("character")) {
      return `${image} is the character sheet for ${reference.label}. Use the exact identity and wardrobe lock.`;
    }
    if (reference.role === "environment") return `${image} is the master location reference for ${reference.label}.`;
    if (reference.role === "composition") {
      return `${image} guides character blocking and placement in the environment only. Do not copy texture, image quality or facial detail.`;
    }
    if (reference.role === "crowd") return `${image} is the crowd reference for ${reference.label}.`;
    if (reference.role === "style" || reference.role === "atmosphere") return `${image} is the style and atmosphere reference.`;
    return `${image} is the reference for ${reference.label}.`;
  }).join("\n");
}

export function defaultSequenceGridDirection(references: StoryboardReference[]) {
  const names = references.filter((reference) => reference.role.startsWith("character")).map((reference) => reference.label);
  const location = references.find((reference) => reference.role === "environment")?.label;
  return `Show ${names.length ? names.join(" and ") : "the scene"}${location ? ` in ${location}` : ""}.`;
}

// Image prompts contain visual direction only. Placement, model settings and
// reference URLs stay in the job envelope; Seedance has its own prompt builder.
export function buildSequenceGridPrompt(references: StoryboardReference[], intent: string) {
  const direction = intent.trim() || defaultSequenceGridDirection(references);
  return `${referenceContract(references)}\n\nCreate a new 3x3 cinematic anamorphic grid of shots. ${direction}${/[.!?]$/.test(direction) ? "" : "."} Capture the sequence with dynamic camera movement and varied compositions.`;
}

export function buildFreshFramePrompt(references: StoryboardReference[]) {
  return `${referenceContract(references)}\n\nCreate one new cinematic anamorphic photograph from the composition reference. Rebuild the image with sharp character detail and natural lighting. Do not upscale the reference.`;
}

export function serializeStoryboardJob(job: StoryboardJob) {
  return `JOB DETAILS — separate from the image prompt\n${job.title}\nSong: ${job.songStart.toFixed(2)}–${job.songEnd.toFixed(2)}\n${IMAGE_MODELS[job.model].label} (${job.model}) · 2K · 16:9 · ${job.kind === "grid" ? "3×3 storyboard" : "fresh standalone image — NOT upscale"}\nBilling: ${job.billing}. Verify subscription inclusion in the provider UI; do not switch to paid credits.\n${job.references.map((ref, i) => `Image ${i + 1}: ${ref.label} [${ref.role}]\n${ref.url}`).join("\n")}\n\nPROMPT — exact text sent to the image model\n${job.prompt}`;
}
