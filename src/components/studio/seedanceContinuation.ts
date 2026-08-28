import type { GeneratedStudioAsset } from "./generatedAssets";
import type { VideoMoment } from "./musicVideoProject";
import type { GenerationReferenceSelection, ReferenceAsset } from "./referenceAssets";

export type SeedanceReferenceRole = "accepted-final-frame" | "character-identity" | "environment" | "custom" | "contact-sheet";

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
  model: "Enhanced Seedance 2.0 Fast";
  generationMode: "image-to-video";
  continuationType: "seamless-continuation";
  durationSeconds: 15;
  aspectRatio: "16:9";
  resolution: "720p";
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
}): SeedanceContinuationPacket {
  const references: SeedanceContinuationReference[] = [];
  const errors: string[] = [];
  const finalFrameUrl = durableUrl(params.moment?.lastFrameUrl);

  if (finalFrameUrl) {
    references.push({
      tag: "@Image_1",
      role: "accepted-final-frame",
      label: `${params.moment?.sourceRefLabel ?? params.moment?.label ?? "source shot"} final frame`,
      url: finalFrameUrl,
      instruction: "@Image_1 is the accepted final frame and first-frame continuity source. It controls the actual opening pose, screen position, wardrobe, environment arrangement, lighting phase, and framing.",
    });
  } else {
    errors.push("The selected source moment has no durable last frame. Finish scene processing before preparing a continuation.");
  }

  const selectedAssets = [
    params.referenceSelection.character1Id,
    params.referenceSelection.character2Id,
    params.referenceSelection.environmentId,
    params.referenceSelection.customId,
  ].filter(Boolean) as string[];

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

  const contactSheetUrl = durableUrl(
    params.contactSheet?.fullStorage?.mediaUrl
      ?? params.contactSheet?.fullStorage?.publicUrl
      ?? params.contactSheet?.resultUrl,
  );
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

  const completedAction = cleanClause(params.moment?.captionMeta?.action) || "the action already completed in the source shot";
  const storyIntent = cleanClause(params.storyIntent) || "move the current song section forward with a new visual beat";
  const referenceContract = [params.audioVideoReference?.instruction, ...references.map((reference) => reference.instruction)].filter(Boolean).join("\n");
  const audioDirection = params.audioVideoReference
    ? "Use @Video_1 as the timing clock for the selected song section. Keep visual continuity controlled by the image references; generated production audio may be replaced by the master mix in the final edit."
    : "The section-timing @Video_1 has not been prepared yet. Do not submit this packet until its exact song placement and handles are rendered.";
  const prompt = `${referenceContract}

Begin exactly where @Image_1 ends. Continue the open motion naturally without restarting or replaying ${completedAction}. This clip only advances the narrative job for ${params.sectionLabel}: ${storyIntent}. Stage one clearly new, readable action that changes the character's position, relationship, discovery, or objective; let the camera reveal that change with one motivated move. End on a materially different composition that gives the editor clean handles and makes the story feel farther along than the source shot.

Preserve canonical identities from their assigned character references and preserve the current location from @Image_1${references.some((reference) => reference.role === "environment") ? " plus the assigned environment reference" : ""}. ${audioDirection} Do not introduce an unrelated location, duplicate people, restart the completed action, or jump ahead to a later song section. No captions, titles, logos, or burned-in text. Stop after this one new beat completes.`;

  return {
    projectId: params.projectId,
    clipId: `${params.sectionId}-continuation-${params.songStart.toFixed(2)}`,
    parentClipId: params.moment?.id ?? "missing-parent",
    sceneId: params.sectionId,
    songRange: { start: params.songStart, end: params.songEnd },
    narrativeJob: storyIntent,
    feltIntent: "The viewer should feel the story move forward into a genuinely new beat instead of looping familiar coverage.",
    providerLane: "higgsfield-manual-unlimited",
    model: "Enhanced Seedance 2.0 Fast",
    generationMode: "image-to-video",
    continuationType: "seamless-continuation",
    durationSeconds: 15,
    aspectRatio: "16:9",
    resolution: "720p",
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
    `${packet.model} · Unlimited · ${packet.durationSeconds}s · ${packet.aspectRatio} · ${packet.resolution}`,
    `Mode: ${packet.generationMode} · ${packet.continuationType}`,
    audioVideoReference,
    referenceList,
    "PROMPT",
    packet.prompt,
  ].filter(Boolean).join("\n\n");
}

function buildRoleInstruction(tag: string, role: SeedanceReferenceRole, label: string, kind: string) {
  if (role === "character-identity") {
    return `${tag} controls canonical identity and wardrobe for ${label} only. Ignore pose, background, camera, lighting, and action from that sheet.`;
  }
  if (role === "environment") {
    return `${tag} controls the named location ${label} only; preserve its architecture, layout, materials, palette, and lighting direction, and ignore any people or action shown in that reference.`;
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
