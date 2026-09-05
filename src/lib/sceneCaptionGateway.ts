export type SceneCaptionGatewayAuth = {
  gatewayUrl: string;
  token: string;
  isLoopbackGateway: boolean;
};

/**
 * VM100 Trigger workers should call the caption gateway on loopback, not
 * through Cloudflare. Vercel and browsers use the public URL from BWS.
 */
export function resolveSceneCaptionGatewayAuth(
  env: Record<string, string | undefined> = process.env,
): SceneCaptionGatewayAuth {
  const gatewayUrl = (
    env.SCENE_CAPTION_SMART_GATEWAY_INTERNAL_URL
    || env.SCENE_CAPTION_SMART_GATEWAY_URL
    || env.QWEN_CAPTION_GATEWAY_URL
    || "http://127.0.0.1:18091"
  ).replace(/\/+$/, "");
  const isLoopbackGateway = /^https?:\/\/(?:127\.0\.0\.1|localhost|192\.168\.8\.222)(?::\d+)?$/i.test(gatewayUrl);
  const token = (env.STACK_STRUCTURE_LOCAL_TRIGGER === "1" || isLoopbackGateway)
    ? ""
    : env.SCENE_CAPTION_SMART_GATEWAY_TOKEN
      || env.QWEN_CAPTION_GATEWAY_TOKEN
      || "";
  return { gatewayUrl, token, isLoopbackGateway };
}

export function formatSceneCaptionGatewayError(
  status: number,
  payload: Record<string, unknown>,
  endpoint: string,
) {
  const detail = readGatewayError(payload);
  if (detail && /<!doctype html/i.test(detail)) {
    return `Caption gateway ${endpoint} returned Cloudflare HTML (${status}). VM100 Trigger workers must use SCENE_CAPTION_SMART_GATEWAY_INTERNAL_URL=http://127.0.0.1:18091 and the gateway must expose ${endpoint}.`;
  }
  return detail || `Caption gateway ${endpoint} failed (${status})`;
}

function readGatewayError(payload: Record<string, unknown>) {
  const detail = payload.detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  const error = payload.error;
  return typeof error === "string" && error.trim() ? error.trim() : undefined;
}
