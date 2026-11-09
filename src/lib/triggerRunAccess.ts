export class TriggerRunOwnershipError extends Error {
  constructor() {
    super("Trigger run is not visible to the current application user.");
    this.name = "TriggerRunOwnershipError";
  }
}

export async function retrieveOwnedTriggerRun<T extends { tags: string[] }>(
  runId: string,
  userId: string,
  retrieve: (runId: string) => Promise<T>,
): Promise<T> {
  const run = await retrieve(runId);
  if (!run.tags.includes(`user:${userId}`)) throw new TriggerRunOwnershipError();
  return run;
}
