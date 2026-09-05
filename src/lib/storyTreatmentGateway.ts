const DEFAULT_STORY_MODEL_ID = "Qwen/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M";

export type StoryTreatmentGatewayConfig = {
  configured: boolean;
  url: string;
  token: string;
  model: string;
  endpoint: string;
};

export function getStoryTreatmentGatewayConfig(
  env: Record<string, string | undefined> = process.env,
): StoryTreatmentGatewayConfig {
  const url = cleanUrl(env.SCENE_CAPTION_SMART_GATEWAY_URL || env.QWEN_CAPTION_GATEWAY_URL || "");
  const token = cleanString(env.SCENE_CAPTION_SMART_GATEWAY_TOKEN || env.QWEN_CAPTION_GATEWAY_TOKEN || "");
  const model = cleanString(env.SCENE_CAPTION_SMART_MODEL_ID || env.QWEN_CAPTION_MODEL_ID || DEFAULT_STORY_MODEL_ID);
  const endpoint = cleanString(env.STORY_TREATMENT_GATEWAY_ENDPOINT || "/story/treatments");
  return {
    configured: Boolean(url),
    url,
    token,
    model,
    endpoint: normalizeEndpoint(endpoint),
  };
}

export function isStoryTreatmentConfigured(
  env: Record<string, string | undefined> = process.env,
) {
  const gateway = getStoryTreatmentGatewayConfig(env);
  const triggerReady = Boolean(env.TRIGGER_API_URL?.trim() && env.TRIGGER_SECRET_KEY?.trim());
  return gateway.configured && triggerReady;
}

function cleanString(value: string | undefined) {
  return value?.trim() ?? "";
}

function cleanUrl(value: string | undefined) {
  return cleanString(value).replace(/\/+$/, "");
}

function normalizeEndpoint(value: string) {
  return value.startsWith("/") ? value : `/${value}`;
}
