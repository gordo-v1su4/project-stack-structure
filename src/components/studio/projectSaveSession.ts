/** One instance per mounted editor, never shared through localStorage or tabs. */
export class ProjectSaveSession {
  private epoch = 0;
  private projectId: string | null = null;
  private revision: string | undefined;
  private blocked: Error | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  get contextEpoch() { return this.epoch; }

  restore(projectId: string | null, revision?: string) {
    this.epoch++;
    this.projectId = projectId;
    this.revision = revision;
    this.blocked = null;
  }

  save<T extends { project: { id: string }; revision?: string }>(
    projectId: string | null,
    write: (expectedRevision: string | undefined) => Promise<T>,
    expectedEpoch = this.epoch,
  ): Promise<T> {
    const operation = this.tail.then(async () => {
      if (expectedEpoch !== this.epoch || (projectId !== null && projectId !== this.projectId)) {
        throw new Error("The open project changed before this save. Its obsolete snapshot was not written.");
      }
      if (this.blocked) throw this.blocked;
      if (projectId && !this.revision) throw new Error("Reload this saved project before saving it; this window has no saved revision.");
      let result: T;
      try { result = await write(projectId ? this.revision : undefined); }
      catch (error) {
        if (expectedEpoch === this.epoch) {
          const detail = error instanceof Error ? error.message : "The save acknowledgment was unavailable.";
          this.blocked = new Error(`${detail} Automatic saving is paused to preserve your changes. Reopen the saved project to reconcile it.`, { cause: error });
        }
        throw this.blocked ?? error;
      }
      if (expectedEpoch !== this.epoch) throw new Error("The open project changed while this save completed. Its old acknowledgment was not applied to the current editor.");
      if (expectedEpoch === this.epoch) {
        if (!result.revision) {
          this.blocked = new Error("The save acknowledgment has no revision. Reopen the saved project before saving again.");
          throw this.blocked;
        }
        this.revision = result.revision;
        if (!projectId) { this.projectId = result.project.id; this.epoch++; }
      }
      return result;
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }
}
