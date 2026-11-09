import { AbortTaskRunError, task, wait } from "@trigger.dev/sdk";
import { runH3Still, type H3StillJobReference } from "@/lib/h3StillRunner";
import { vm100HeavyQueue } from "./queues";
import { markWorkCompleted, markWorkRunning } from "./workMetadata";

export const h3StillTask = task({
  id: "minimax-h3-still",
  machine: "small-2x",
  queue: vm100HeavyQueue,
  maxDuration: 1800,
  retry: { maxAttempts: 1 },
  run: async (reference: H3StillJobReference, { ctx }) => {
    const owners = ctx.run.tags.filter(tag => tag.startsWith("user:"));
    if (owners.length !== 1 || owners[0] !== `user:${reference.ownerId}`) {
      throw new AbortTaskRunError("MiniMax still generation requires its authenticated dispatch owner.");
    }
    const result = await runH3Still(reference, ctx.run.id, {
      wait: seconds => wait.for({ seconds }),
      stage: label => markWorkRunning("generating", label, { progressMode: "provider" }),
    });
    markWorkCompleted(result.state === "ready" ? "MiniMax still stored for review; identity approval is pending"
      : `MiniMax still attempt is ${result.state}; no image was accepted`, { completedItems: result.state === "ready" ? 1 : 0, totalItems: 1 });
    return result;
  },
});
