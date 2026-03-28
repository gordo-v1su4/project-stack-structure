import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const FALLBACK_ENV_FILES = [
  path.join(/* turbopackIgnore: true */ process.cwd(), "..", "stutter-blaster", ".env.local"),
  path.join(/* turbopackIgnore: true */ process.cwd(), "..", "stutter-blaster", "apps", "web", ".env.local"),
  path.join(/* turbopackIgnore: true */ process.cwd(), "..", "esentia-endpoint", ".env.local"),
  path.join(/* turbopackIgnore: true */ process.cwd(), "..", "ffttron-sync", ".env.local"),
  path.join(/* turbopackIgnore: true */ process.cwd(), "..", "stutter balster", ".env.local"),
];

interface EssentiaSection {
  start: number;
  end: number;
  label: string;
  duration: number;
  energy: number;
}

interface EssentiaFullResponse {
  bpm?: number;
  duration?: number;
  beats?: number[];
  onsets?: number[];
  energy?: {
    curve?: number[];
  };
  structure?: {
    boundaries?: number[];
    sections?: EssentiaSection[];
  };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "Audio file is required." }, { status: 400 });
    }

    const config = await loadEssentiaConfig();

    if (!config.apiKey) {
      return Response.json(
        {
          error: "Missing Essentia API key. Set ESSENTIA_API_KEY or VITE_ESSENTIA_API_KEY, or keep the stutter-blaster env nearby.",
        },
        { status: 500 }
      );
    }

    const upstreamForm = new FormData();
    upstreamForm.set("file", file, file.name);

    const upstreamResponse = await fetch(`${config.apiUrl}/analyze/full`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "X-API-Key": config.apiKey,
      },
      body: upstreamForm,
    });

    const text = await upstreamResponse.text();

    if (!upstreamResponse.ok) {
      return new Response(text, {
        status: upstreamResponse.status,
        headers: {
          "content-type": upstreamResponse.headers.get("content-type") ?? "application/json",
        },
      });
    }

    const payload = JSON.parse(text) as EssentiaFullResponse;

    return Response.json({
      sourceLabel: file.name,
      bpm: payload.bpm ?? null,
      duration: payload.duration ?? null,
      beats: payload.beats ?? [],
      onsets: payload.onsets ?? [],
      energy: payload.energy?.curve ?? [],
      boundaries: payload.structure?.boundaries ?? [],
      sections: payload.structure?.sections ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Essentia proxy error";
    return Response.json({ error: message }, { status: 500 });
  }
}

async function loadEssentiaConfig() {
  const currentEnv = {
    apiUrl:
      process.env.ESSENTIA_API_URL ??
      process.env.ESSENTIA_API_BASE_URL ??
      process.env.VITE_ESSENTIA_API_URL ??
      process.env.VITE_ESSENTIA_API_BASE_URL ??
      "https://essentia.v1su4.dev",
    apiKey: process.env.ESSENTIA_API_KEY ?? process.env.VITE_ESSENTIA_API_KEY ?? "",
  };

  if (currentEnv.apiKey) {
    return {
      apiUrl: currentEnv.apiUrl.replace(/\/$/, ""),
      apiKey: currentEnv.apiKey,
    };
  }

  for (const absolutePath of FALLBACK_ENV_FILES) {
    try {
      const raw = await readFile(absolutePath, "utf8");
      const parsed = parseEnvFile(raw);
      const apiKey = parsed.ESSENTIA_API_KEY ?? parsed.VITE_ESSENTIA_API_KEY ?? "";

      if (!apiKey) continue;

      const apiUrl =
        parsed.ESSENTIA_API_URL ??
        parsed.ESSENTIA_API_BASE_URL ??
        parsed.VITE_ESSENTIA_API_URL ??
        parsed.VITE_ESSENTIA_API_BASE_URL ??
        currentEnv.apiUrl;

      return {
        apiUrl: apiUrl.replace(/\/$/, ""),
        apiKey,
      };
    } catch {
      continue;
    }
  }

  return {
    apiUrl: currentEnv.apiUrl.replace(/\/$/, ""),
    apiKey: "",
  };
}

function parseEnvFile(source: string) {
  const values: Record<string, string> = {};

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    values[key] = stripQuotes(rawValue);
  }

  for (const [key, value] of Object.entries(values)) {
    values[key] = value.replace(/\$\{([^}]+)\}/g, (_, reference: string) => values[reference] ?? "");
  }

  return values;
}

function stripQuotes(value: string) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
