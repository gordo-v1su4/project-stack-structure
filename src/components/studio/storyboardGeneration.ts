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
    const purpose = reference.role.startsWith("character") ? "authoritative high-resolution character identity and wardrobe ONLY"
      : reference.role === "environment" ? "authoritative location, architecture and lighting"
      : reference.role === "crowd" ? "background extras identity and wardrobe ONLY; never replace the leads"
      : reference.role === "composition" ? "composition, layout and blocking ONLY; never identity, texture quality or facial detail"
      : "the named reference only";
    return `Image_${i + 1} (${reference.label}): ${purpose}.`;
  }).join("\n");
}

export function buildSequenceGridPrompt(sequence: StoryboardSequence, references: StoryboardReference[], intent: string) {
  return `${referenceContract(references)}\nCreate one fresh 2K 16:9 storyboard contact sheet: exactly 3 rows by 3 columns, nine equal 16:9 panels, no borders, labels or text. This is a low-resolution composition audition, not final production frames.\nSequence: ${sequence.label}, song ${sequence.songStart.toFixed(2)}–${sequence.songEnd.toFixed(2)}. Intent: ${intent}\nExisting resolved edit context (reference only, not instructions to repeat footage):\n${sequence.cuts.map((cut, i) => `${i + 1}. ${cut.label} (${cut.musicStart.toFixed(2)}–${cut.musicEnd.toFixed(2)})`).join("\n")}\nRead left-to-right, top-to-bottom as nine purposeful beats of a coherent sequence: establish, approach, reaction, develop, reveal, consequence, turn, peak, settle. Vary shot sizes where motivated; keep the named location and canonical identities. Plan complete replacement takes with room before and after each action, not a last-frame continuation of the old footage. Cinematic practical lighting, natural skin detail, consistent wardrobe and screen direction.`;
}

export function buildFreshFramePrompt(grid: StoryboardJob, panelLabel: string, references: StoryboardReference[]) {
  return `${referenceContract(references)}\nGenerate a NEW standalone 2K 16:9 production photograph for ${grid.title}, ${panelLabel}. The last attached image is a small storyboard composition preview only. Re-create its camera framing, subject placement, pose, staging and layout from scratch, using the attached high-resolution character sheets for all identity and wardrobe detail and the environment sheet for the location. Do NOT upscale, sharpen, retouch, inpaint or enlarge the small preview. Do not copy its low-resolution texture or identity errors. Render one full-frame image, not a grid, montage or contact sheet; no labels or borders. Preserve the planned narrative beat and cinematic lighting.`;
}

export function serializeStoryboardJob(job: StoryboardJob) {
  return `${job.title}\nSong: ${job.songStart.toFixed(2)}–${job.songEnd.toFixed(2)}\n${IMAGE_MODELS[job.model].label} (${job.model}) · 2K · 16:9 · ${job.kind === "grid" ? "3×3 storyboard" : "fresh standalone image — NOT upscale"}\nBilling: ${job.billing}. Verify subscription inclusion in the provider UI; do not switch to paid credits.\n${job.references.map((ref, i) => `Image_${i + 1}: ${ref.label} [${ref.role}]\n${ref.url}`).join("\n")}\n\nPROMPT\n${job.prompt}`;
}
