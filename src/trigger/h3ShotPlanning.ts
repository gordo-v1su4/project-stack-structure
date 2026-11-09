import { AbortTaskRunError, task } from "@trigger.dev/sdk";
import { executeH3ShotPlanning, type H3ShotPlanningReference } from "@/lib/h3ShotPlanningServer";
import { generateH3ShotPlan } from "@/lib/h3ShotPlanningGateway";
import { resolveSceneCaptionGatewayAuth } from "@/lib/sceneCaptionGateway";
import { ensureQwenBackend } from "./storyTreatment";
import { vm100HeavyQueue } from "./queues";
import { markWorkCompleted, markWorkRunning } from "./workMetadata";

export const h3ShotPlanningTask = task({
  id: "qwen-h3-shot-planning",
  queue: vm100HeavyQueue,
  maxDuration: 1800,
  retry: { maxAttempts: 1 },
  run: async (reference: H3ShotPlanningReference, { ctx }) => {
    const owners = ctx.run.tags.filter(tag => tag.startsWith("user:"));
    if (owners.length !== 1 || owners[0] !== `user:${reference.ownerId}`) {
      throw new AbortTaskRunError("Shot planning requires its authenticated dispatch owner.");
    }
    markWorkRunning("preparing", "Checking canonical shot planning context", { progressMode: "indeterminate" });
    const result = await executeH3ShotPlanning(reference, {
      generate: async input => {
        const auth = resolveSceneCaptionGatewayAuth();
        await ensureQwenBackend(auth.gatewayUrl, auth.token ? { Authorization: `Bearer ${auth.token}` } : undefined, ctx.run.id);
        markWorkRunning("planning", "Authoring and reviewing musical shot directions", { progressMode: "indeterminate" });
        return generateH3ShotPlan(input);
      },
    });
    markWorkCompleted("Shot directions stored; film selection unchanged", { completedItems: result.directions.length, totalItems: result.directions.length });
    return { ok: true, kind: "shot-planning" as const, bindingSha256: result.bindingSha256, directionCount: result.directions.length };
  },
});
