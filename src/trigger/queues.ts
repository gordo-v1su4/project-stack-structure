import { queue } from "@trigger.dev/sdk/v3";

export const serviceHealthQueue = queue({
  name: "service-health",
  concurrencyLimit: 2,
});

// Essentia, FFmpeg/NVENC, Qwen, and ComfyUI share the VM100 RTX 4090.
export const vm100HeavyQueue = queue({
  name: "vm100-heavy",
  concurrencyLimit: 1,
});
