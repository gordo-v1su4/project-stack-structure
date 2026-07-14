import { logger, task } from "@trigger.dev/sdk";

import { serviceHealthQueue } from "./queues";
import { markWorkCompleted, markWorkRunning } from "./workMetadata";

type HealthPayload = {
  failOnUnhealthy?: boolean;
};

type HealthResult = {
  name: string;
  url: string;
  reachable: boolean;
  ready: boolean;
  status?: number;
  elapsedMs: number;
  body?: unknown;
  error?: string;
};

const TARGETS = [
  {
    name: "trigger",
    env: "TRIGGER_HEALTH_URL",
    fallback: "https://trigger.v1su4.dev/healthcheck",
    readyFromBody: false,
  },
  {
    name: "essentia",
    env: "ESSENTIA_HEALTH_URL",
    fallback: "http://192.168.8.222:18000/health",
    readyFromBody: true,
  },
  {
    name: "media",
    env: "MEDIA_HEALTH_URL",
    fallback: "http://192.168.8.241:4545/health",
    readyFromBody: true,
  },
  {
    name: "caption-gateway",
    env: "CAPTION_HEALTH_URL",
    fallback: "http://192.168.8.222:18091/health",
    readyFromBody: true,
  },
] as const;

export const stackStructureServiceHealthTask = task({
  id: "stack-structure-service-health",
  queue: serviceHealthQueue,
  maxDuration: 60,
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 10_000,
    randomize: true,
  },
  run: async (payload: HealthPayload = {}) => {
    markWorkRunning("checking", "Checking production services", {
      progressMode: "exact",
      completedItems: 0,
      totalItems: TARGETS.length,
    });
    const services = await Promise.all(TARGETS.map(checkTarget));
    const required = services.filter((service) => service.name !== "caption-gateway");
    const ok = required.every((service) => service.reachable && service.ready)
      && services.find((service) => service.name === "caption-gateway")?.reachable === true;

    logger.info("Stack Structure service health", { ok, services });

    if (payload.failOnUnhealthy && !ok) {
      const failed = services
        .filter((service) => !service.reachable || (service.name !== "caption-gateway" && !service.ready))
        .map((service) => service.name);
      throw new Error(`Required services are unhealthy: ${failed.join(", ")}`);
    }

    markWorkCompleted("Production services checked", {
      completedItems: services.length,
      totalItems: services.length,
    });
    return {
      ok,
      checkedAt: new Date().toISOString(),
      services,
    };
  },
});

async function checkTarget(target: (typeof TARGETS)[number]): Promise<HealthResult> {
  const url = process.env[target.env]?.trim() || target.fallback;
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const text = await response.text();
    const body = parseBody(text);
    const bodyReady = readBoolean(body, "ok") ?? readBoolean(body, "healthy") ?? true;

    return {
      name: target.name,
      url,
      reachable: response.ok,
      ready: response.ok && (!target.readyFromBody || bodyReady),
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      body,
    };
  } catch (error) {
    return {
      name: target.name,
      url,
      reachable: false,
      ready: false,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Health request failed",
    };
  }
}

function parseBody(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 500);
  }
}

function readBoolean(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "boolean" ? candidate : undefined;
}
