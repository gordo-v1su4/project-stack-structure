import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const DEFAULT_LOCAL_FALLBACK_ENV_FILES = [
  "stutter-blaster/.env.local",
  "stutter-blaster/apps/web/.env.local",
  "essentia-endpoint/.env.local",
  "fftron-sync/.env.local",
  "stutter balster/.env.local",
] as const;

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

const INCLUDE_RAW_UPSTREAM_PAYLOAD = process.env.NODE_ENV !== "production";

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
          error:
            "Missing Essentia API key. Set ESSENTIA_API_KEY or VITE_ESSENTIA_API_KEY. For local development, you can also set ESSENTIA_ENV_FALLBACK_FILES to one or more .env paths.",
        },
        { status: 500 }
      );
    }

    const upstreamForm = new FormData();
    upstreamForm.set("file", file, file.name);

    const upstreamResponse = await fetch(`${config.apiUrl}/analyze/full`, {
      method: "POST",
      headers: {
        // The sibling Essentia clients use both headers, so we preserve that contract here.
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

    const payload = parseEssentiaFullResponse(text);

    return Response.json({
      sourceLabel: file.name,
      bpm: payload.bpm ?? null,
      duration: payload.duration ?? null,
      beats: payload.beats ?? [],
      onsets: payload.onsets ?? [],
      energy: payload.energy?.curve ?? [],
      boundaries: payload.structure?.boundaries ?? [],
      sections: payload.structure?.sections ?? [],
      ...(INCLUDE_RAW_UPSTREAM_PAYLOAD ? { raw: payload } : {}),
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

  for (const absolutePath of getFallbackEnvFiles()) {
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

  const maxPasses = Math.max(1, Object.keys(values).length * 2);

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;

    for (const [key, value] of Object.entries(values)) {
      const expanded = value.replace(/\$\{([^}]+)\}/g, (_, reference: string) => {
        return values[reference] ?? process.env[reference] ?? "";
      });

      if (expanded !== value) {
        values[key] = expanded;
        changed = true;
      }
    }

    if (!changed) break;
  }

  return values;
}

function getFallbackEnvFiles() {
  const configured = splitEnvPathList(process.env.ESSENTIA_ENV_FALLBACK_FILES);
  if (configured.length) {
    return configured.map(resolveFallbackPath);
  }

  if (process.env.NODE_ENV === "production") {
    return [];
  }

  return DEFAULT_LOCAL_FALLBACK_ENV_FILES.map((relativePath) =>
    path.join(/* turbopackIgnore: true */ process.cwd(), "..", relativePath)
  );
}

function splitEnvPathList(value: string | undefined) {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveFallbackPath(candidate: string) {
  if (path.isAbsolute(candidate)) return candidate;
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), candidate);
}

function parseEssentiaFullResponse(source: string): EssentiaFullResponse {
  const parsed = JSON.parse(source) as unknown;

  if (!isRecord(parsed)) {
    throw new Error("Essentia returned an invalid JSON payload.");
  }

  const energy = isRecord(parsed.energy)
    ? {
        curve: asNumberArray(parsed.energy.curve),
      }
    : undefined;

  const structure = isRecord(parsed.structure)
    ? {
        boundaries: asNumberArray(parsed.structure.boundaries),
        sections: asSectionArray(parsed.structure.sections),
      }
    : undefined;

  return {
    bpm: asNumber(parsed.bpm),
    duration: asNumber(parsed.duration),
    beats: asNumberArray(parsed.beats),
    onsets: asNumberArray(parsed.onsets),
    energy,
    structure,
  };
}

function asSectionArray(value: unknown): EssentiaSection[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value
    .map((entry) => {
      if (!isRecord(entry)) return null;

      const start = asNumber(entry.start);
      const end = asNumber(entry.end);
      const label = typeof entry.label === "string" ? entry.label : "Section";
      const duration = asNumber(entry.duration) ?? Math.max(0, (end ?? 0) - (start ?? 0));
      const energy = asNumber(entry.energy) ?? 0;

      if (start === undefined || end === undefined) return null;

      return {
        start,
        end,
        label,
        duration,
        energy,
      } satisfies EssentiaSection;
    })
    .filter((entry): entry is EssentiaSection => entry !== null);
}

function asNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const numbers = value
    .map((entry) => asNumber(entry))
    .filter((entry): entry is number => entry !== undefined);

  return numbers;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
