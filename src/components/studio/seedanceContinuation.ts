import type { GeneratedStudioAsset } from "./generatedAssets";
import type { VideoMoment } from "./musicVideoProject";
import { getOrderedSelectedReferenceIds, type GenerationReferenceSelection, type ReferenceAsset } from "./referenceAssets";

export type SeedanceReferenceRole = "accepted-final-frame" | "character-identity" | "environment" | "crowd-extras" | "custom" | "contact-sheet" | "composition-reference" | "start-frame" | "end-frame";
export type SeedanceVideoModel = "Seedance 2.0" | "Seedance 2.5";

export interface SeedanceContinuationReference {
  tag: string;
  role: SeedanceReferenceRole;
  label: string;
  url: string;
  instruction: string;
}

export interface SeedanceAudioVideoReference {
  tag: "@Video_1";
  role: "section-audio-timing";
  label: string;
  url: string;
  instruction: string;
  clipRange: { start: number; end: number };
  sectionRange: { start: number; end: number };
  sectionOffset: { start: number; end: number };
  handleSeconds: { before: number; after: number };
  placementKey: string;
}

export interface SeedanceContinuationPacket {
  projectId: string;
  clipId: string;
  parentClipId: string;
  sceneId: string;
  songRange: { start: number; end: number };
  narrativeJob: string;
  feltIntent: string;
  providerLane: "higgsfield-manual-unlimited";
  model: SeedanceVideoModel;
  generationMode: "reference-to-video";
  continuationType: "whole-shot-replacement";
  durationSeconds: number;
  aspectRatio: "16:9";
  resolution: "480p" | "720p";
  references: SeedanceContinuationReference[];
  audioVideoReference?: SeedanceAudioVideoReference;
  prompt: string;
  errors: string[];
}

export function buildSeedanceContinuationPacket(params: {
  projectId: string;
  sectionId: string;
  sectionLabel: string;
  storyIntent: string;
  songStart: number;
  songEnd: number;
  moment?: VideoMoment;
  referenceAssets: ReferenceAsset[];
  referenceSelection: GenerationReferenceSelection;
  contactSheet?: GeneratedStudioAsset;
  audioVideoReference?: SeedanceAudioVideoReference;
  model?: SeedanceVideoModel;
  resolution?: "480p" | "720p";
  handleSeconds?: number;
  approvedFrames?: GeneratedStudioAsset[];
}): SeedanceContinuationPacket {
  const references: SeedanceContinuationReference[] = [];
  const errors: string[] = [];
  const finalFrameUrl = durableUrl(params.moment?.firstFrameUrl ?? params.moment?.thumbnailUrl);

  if (finalFrameUrl) {
    references.push({
      tag: "@Image_1",
      role: "composition-reference",
      label: `${params.moment?.sourceRefLabel ?? params.moment?.label ?? "source shot"} opening composition`,
      url: finalFrameUrl,
      instruction: "@Image_1 guides composition, layout and blocking only. It is NOT an exact first/last frame or an identity source. Rebuild people from their attached high-resolution character sheets. Do not stitch onto the old action's last frame.",
    });
  } else {
    errors.push("The selected source moment has no durable opening composition. Finish scene processing before preparing a replacement.");
  }

  const selectedAssets = getOrderedSelectedReferenceIds(params.referenceSelection);

  for (const assetId of selectedAssets) {
    const asset = params.referenceAssets.find((candidate) => candidate.id === assetId);
    if (!asset) {
      errors.push(`Selected reference ${assetId} is missing from the project.`);
      continue;
    }
    const url = durableUrl(asset.storageUrl);
    if (!url || asset.storageStatus !== "uploaded") {
      errors.push(`${asset.displayName} is not uploaded to RustFS yet.`);
      continue;
    }
    const tag = `@Image_${references.length + 1}`;
    const role: SeedanceReferenceRole = asset.role === "environment"
      ? "environment"
      : asset.role === "crowd"
        ? "crowd-extras"
      : asset.role === "character-1" || asset.role === "character-2"
        ? "character-identity"
        : "custom";
    references.push({
      tag,
      role,
      label: asset.displayName,
      url,
      instruction: buildRoleInstruction(tag, role, asset.displayName, asset.kind),
    });
  }

  const contactSheetUrl = params.contactSheet?.reviewStatus === "approved" ? durableUrl(
    params.contactSheet?.fullStorage?.mediaUrl
      ?? params.contactSheet?.fullStorage?.publicUrl
      ?? params.contactSheet?.resultUrl,
  ) : undefined;
  if (contactSheetUrl && references.length < 9) {
    const tag = `@Image_${references.length + 1}`;
    references.push({
      tag,
      role: "contact-sheet",
      label: params.contactSheet?.title ?? "approved contact sheet",
      url: contactSheetUrl,
      instruction: `${tag} controls progression ideas and shot-composition vocabulary only; ignore duplicate people, identity drift, wardrobe changes, text, and unrelated environment details from this board.`,
    });
  }

  for (const frame of params.approvedFrames ?? []) {
    if (frame.reviewStatus !== "approved" || frame.storyboard?.kind !== "fresh-frame"
      || frame.storyboard.sectionId !== params.sectionId
      || frame.storyboard.songStart > params.songStart || frame.storyboard.songEnd < params.songEnd) continue;
    const url = durableUrl(frame.fullStorage?.mediaUrl ?? frame.fullStorage?.publicUrl ?? frame.resultUrl);
    if (!url) continue;
    const tag = `@Image_${references.length + 1}`;
    const role = frame.frameRole ?? "composition-reference";
    references.push({ tag, role, label: frame.title ?? "approved fresh frame", url,
      instruction: role === "composition-reference" ? `${tag} is an approved composition/layout reference only. Character sheets remain authoritative for identity.`
        : role === "start-frame" ? `${tag} is the requested exact opening frame. No pre-roll exists before this frame; identity must still match the character sheets.`
        : `${tag} is the requested ending composition; use only if the selected provider mode explicitly supports end-frame conditioning.` });
  }
  const model = params.model ?? "Seedance 2.0";
  const maxDuration = model === "Seedance 2.5" ? 30 : 15;
  const handles = Math.max(0, Math.min(5, params.handleSeconds ?? 1));
  const requiredDuration = Math.max(0, params.songEnd - params.songStart);
  const durationSeconds = Math.max(4, Math.ceil(requiredDuration + 2 * handles));
  if (durationSeconds > maxDuration) errors.push(`Whole replacement plus handles needs ${durationSeconds}s; ${model} allows at most ${maxDuration}s. Choose a longer-capable Seedance model or plan a purposeful separate shot, never stitch the same movement.`);
  if (references.length > (model === "Seedance 2.0" ? 9 : 30)) errors.push("Too many image references for this Seedance model. Select fewer composition frames; retain canonical identity sheets.");
  if (!references.some((reference) => reference.role === "character-identity")) errors.push("Attach an uploaded high-resolution character sheet. A composition frame cannot define identity.");
  if (handles > 0 && references.some((reference) => reference.role === "start-frame")) errors.push("Exact start-frame conditioning conflicts with leading handles. Use composition-reference mode or set handles to zero.");
  if (references.some((reference) => reference.role === "end-frame")) errors.push("End-frame conditioning requires a separately verified provider mode. Use composition-reference for this multimodal packet.");
  const completedAction = cleanClause(params.moment?.captionMeta?.action) || "the planned complete action";
  const storyIntent = cleanClause(params.storyIntent) || "move the current song section forward with a new visual beat";
  const referenceContract = [params.audioVideoReference?.instruction, ...references.map((reference) => reference.instruction)].filter(Boolean).join("\n");
  const audioDirection = params.audioVideoReference
    ? `Use @Video_1 as the timing clock: align its selected-section offset ${params.audioVideoReference.sectionOffset.start.toFixed(2)}s with generated-video time ${handles.toFixed(2)}s. The audio reference may have clipped handles at the song boundaries; do not shift the intended song beat. Keep visual continuity controlled by the image references; generated production audio will be replaced by the master mix in the final edit.`
    : "The section-timing @Video_1 has not been prepared yet. Do not submit this packet until its exact song placement and handles are rendered.";
  const prompt = `${referenceContract}

Generate a NEW complete ${durationSeconds}-second replacement take for ${params.sectionLabel}, not an appended extension. Story intent: ${storyIntent}. Re-stage the complete action (${completedAction}) naturally from its beginning. Do not match or continue the old clip's ending frame; do not splice separately generated halves of the same movement.
0–${handles}s: usable moving lead-in before the key action, preserving composition and screen direction.
${handles}–${(handles + requiredDuration).toFixed(2)}s: perform the complete narrative action with motivated camera movement. Plan deliberate shot changes only when the story calls for multiple shots; keep a single movement in one take.
${(handles + requiredDuration).toFixed(2)}–${durationSeconds}s: usable moving tail handle after the action, no freeze frame or fade.

Canonical high-resolution character sheets ALWAYS control faces, bodies and wardrobe. Source frames and fresh storyboard images control composition/layout only unless explicitly assigned an endpoint role. Preserve location and lighting from the environment reference. ${audioDirection} Generated audio is not the master song. No duplicate people, unrelated location, captions, titles, logos or burned-in text.`;

  return {
    projectId: params.projectId,
    clipId: `${params.sectionId}-replacement-${params.songStart.toFixed(2)}`,
    parentClipId: params.moment?.id ?? "missing-parent",
    sceneId: params.sectionId,
    songRange: { start: params.songStart, end: params.songEnd },
    narrativeJob: storyIntent,
    feltIntent: "The viewer should feel the story move forward into a genuinely new beat instead of looping familiar coverage.",
    providerLane: "higgsfield-manual-unlimited",
    model,
    generationMode: "reference-to-video",
    continuationType: "whole-shot-replacement",
    durationSeconds,
    aspectRatio: "16:9",
    resolution: params.resolution ?? "480p",
    references,
    audioVideoReference: params.audioVideoReference,
    prompt,
    errors,
  };
}

export function serializeSeedanceContinuationPacket(packet: SeedanceContinuationPacket) {
  const audioVideoReference = packet.audioVideoReference
    ? `${packet.audioVideoReference.tag} | ${packet.audioVideoReference.role} | ${packet.audioVideoReference.label}\n${packet.audioVideoReference.url}\nAudio clip ${packet.audioVideoReference.clipRange.start.toFixed(2)}–${packet.audioVideoReference.clipRange.end.toFixed(2)}; selected section occurs at ${packet.audioVideoReference.sectionOffset.start.toFixed(2)}–${packet.audioVideoReference.sectionOffset.end.toFixed(2)} inside Video_1.`
    : "@Video_1 | NOT PREPARED — render the exact placed section before submission";
  const referenceList = packet.references
    .map((reference) => `${reference.tag} | ${reference.role} | ${reference.label}\n${reference.url}`)
    .join("\n\n");
  return [
    `Project: ${packet.projectId} · Clip: ${packet.clipId} · Parent: ${packet.parentClipId} · Scene: ${packet.sceneId}`,
    `Song range: ${packet.songRange.start.toFixed(2)}–${packet.songRange.end.toFixed(2)} · Job: ${packet.narrativeJob}`,
    `Intent: ${packet.feltIntent}`,
    `${packet.model} · verify subscription eligibility in provider UI · ${packet.durationSeconds}s · ${packet.aspectRatio} · ${packet.resolution}`,
    `Mode: ${packet.generationMode} · ${packet.continuationType}`,
    audioVideoReference,
    referenceList,
    "PROMPT",
    packet.prompt,
  ].filter(Boolean).join("\n\n");
}

function buildRoleInstruction(tag: string, role: SeedanceReferenceRole, label: string, kind: string) {
  if (role === "character-identity") {
    const characterName = label.replace(/^character\s+/i, "");
    return `${tag} controls ${characterName}'s identity and wardrobe only.`;
  }
  if (role === "environment") {
    return `${tag} controls the named location ${label} only; preserve its architecture, layout, materials, palette, and lighting direction, and ignore any people or action shown in that reference.`;
  }
  if (role === "crowd-extras") {
    return `${tag} controls background-dancer identity variety and crowd wardrobe only. It does not control any named lead, the location, composition, camera, lighting, or action. Do not copy a named lead's identity or wardrobe onto any background extra.`;
  }
  return `${tag} controls the custom ${kind} reference ${label} only; ignore unrelated identity, environment, camera, and action.`;
}

function durableUrl(value: string | undefined) {
  if (!value || value.startsWith("blob:") || value.startsWith("data:")) return undefined;
  return value;
}

function cleanClause(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "") ?? "";
}
