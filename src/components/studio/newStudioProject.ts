import { createPersistableStudioProjectDraft, saveNamedStudioProject, type PersistedStoryState } from "./projectPersistence";

export function newStudioProjectNameError(value: string): string | null {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) return "Enter a project name.";
  if (name.length > 120) return "Use 120 characters or fewer.";
  return null;
}

/** A confirmed New operation creates a separate blank record, never a copy or an update. */
export async function createBlankNamedStudioProject(name: string, storyState: PersistedStoryState) {
  const error = newStudioProjectNameError(name);
  if (error) throw new Error(error);
  const draft = createPersistableStudioProjectDraft({ analysis: null, videoSources: [], storyState,
    musicVideoProject: null, referenceAssets: [], generatedAssets: [], generatedDraft: null,
    workflowUiSettings: { activeTab: "review" } });
  return saveNamedStudioProject({ projectId: null, name: name.trim().replace(/\s+/g, " "), draft });
}
