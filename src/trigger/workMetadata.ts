import { metadata } from "@trigger.dev/sdk";

type WorkMetadataValue = string | number | boolean;

export function markWorkRunning(
  stage: string,
  stageLabel: string,
  values: Record<string, WorkMetadataValue> = {},
) {
  metadata
    .set("stage", stage)
    .set("stageLabel", stageLabel)
    .set("providerStatus", "running");
  setMetadataValues(values);
}

export function markWorkCompleted(
  stageLabel: string,
  values: Record<string, WorkMetadataValue> = {},
) {
  metadata
    .set("stage", "completed")
    .set("stageLabel", stageLabel)
    .set("providerStatus", "completed");
  setMetadataValues(values);
}

export function setWorkProgress(values: Record<string, WorkMetadataValue>) {
  setMetadataValues(values);
}

function setMetadataValues(values: Record<string, WorkMetadataValue>) {
  for (const [key, value] of Object.entries(values)) metadata.set(key, value);
}
