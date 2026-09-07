import type { GeneratedStudioAsset } from "@/components/studio/generatedAssets";

export function acceptedFreshFrame(): GeneratedStudioAsset {
  return { id: "fresh", provider: "higgsfield", model: "nano_banana_pro", prompt: "Fresh dance photograph", createdAt: "2026-09-07", status: "completed", reviewStatus: "approved", mediaKind: "image", resultUrl: "https://media.example/fresh.png", width: 2752, height: 1536,
    storyboard: { id: "fresh-job", projectId: "project-1", sequenceId: "dance", planSignature: "plan-current", requirementId: "dance", sectionId: "verse", title: "Dance", songStart: 20, songEnd: 30, kind: "fresh-frame", model: "nano_banana_pro", billing: "subscription-manual", resolution: "2k", prompt: "Fresh dance photograph", references: [], sourceGridId: "grid", panelIndex: 4 } };
}
