import { queue } from "@trigger.dev/sdk";

export const MEDIA_ASSEMBLY_MACHINE = "large-1x" as const;

export const serviceHealthQueue = queue({
  name: "service-health",
  concurrencyLimit: 2,
});

export const sceneDetectionQueue = queue({
  name: "scene-detection",
  concurrencyLimit: 3,
});

export const mediaFinalizationQueue = queue({
  name: "media-finalization",
  concurrencyLimit: 2,
});

export const mediaAssemblyQueue = queue({
  name: "media-assembly",
  concurrencyLimit: 2,
});

export const vm100HeavyQueue = queue({
  name: "vm100-heavy",
  concurrencyLimit: 1,
});

// Paid generation is serialized independently so retries or multiple browser
// sessions cannot create a provider burst or duplicate spend.
export const paidGenerationQueue = queue({
  name: "paid-generation",
  concurrencyLimit: 1,
});

export const externalProviderQueue = queue({
  name: "external-provider",
  concurrencyLimit: 2,
});
