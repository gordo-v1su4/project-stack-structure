import { annotateMusicSections, reportsMusicSectionFallback } from "@/components/studio/musicSectionProvenance";

type Job = { id: string; status: string; stage: string; result?: Record<string, unknown>; error?: { message?: string; code?: string } };

/** Submission is idempotent across Trigger attempts; polling never resubmits work. */
export async function analyzeStudioAudio(args: {
  apiUrl: string;
  apiKey: string;
  file: File;
  idempotencyKey: string;
  /** Saved accepted job ID, restored by the worker on a later attempt. */
  jobId?: string;
  onJobAccepted?: (jobId: string) => Promise<void>;
  onStage?: (stage: string) => void;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}) {
  const fetcher = args.fetcher ?? fetch;
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (args.timeoutMs ?? 25 * 60_000);
  const base = `${args.apiUrl.replace(/\/+$/, "")}/analyze/studio/jobs`;
  const headers = { "X-API-Key": args.apiKey };
  let job: Job;
  if (args.jobId) {
    job = await readJob(await fetcher(`${base}/${encodeURIComponent(args.jobId)}`, {
      headers, signal: AbortSignal.timeout(Math.min(30_000, Math.max(1, deadline - Date.now()))),
    }));
    if (job.id !== args.jobId) throw new Error("Studio audio response belongs to another job.");
  } else {
    const form = new FormData();
    form.set("file", args.file);
    job = await readJob(await fetcher(base, {
      method: "POST", headers: { ...headers, "Idempotency-Key": args.idempotencyKey }, body: form,
      signal: AbortSignal.timeout(Math.min(90_000, Math.max(1, deadline - Date.now()))),
    }));
    // Persist before polling; a lost submission response still retries the same key.
    await args.onJobAccepted?.(job.id);
  }
  const jobId = job.id;
  let lastStage = "";
  let consecutivePollFailures = 0;
  while (true) {
    if (job.stage !== lastStage) { args.onStage?.(job.stage); lastStage = job.stage; }
    if (job.status === "completed") {
      if (!isRecord(job.result)) throw new Error("Studio audio job completed without analysis.");
      return job.result;
    }
    if (job.status === "failed") throw new Error(`Studio audio analysis failed${job.error?.code ? ` (${job.error.code})` : ""}: ${job.error?.message ?? "unknown analysis error"}`);
    if (!["queued", "running"].includes(job.status)) throw new Error("Studio audio job returned an invalid status.");
    if (Date.now() >= deadline) throw new Error(`Studio audio analysis timed out; job ${jobId} may still be running.`);
    await sleep(Math.min(3_000, Math.max(1, deadline - Date.now())));
    let response: Response;
    try {
      response = await fetcher(`${base}/${encodeURIComponent(jobId)}`, {
        headers, signal: AbortSignal.timeout(Math.min(30_000, Math.max(1, deadline - Date.now()))),
      });
    } catch (error) {
      if (++consecutivePollFailures <= 3 && Date.now() < deadline) continue;
      throw error;
    }
    if ((response.status === 429 || response.status >= 500) && ++consecutivePollFailures <= 3 && Date.now() < deadline) continue;
    job = await readJob(response);
    if (job.id !== jobId) throw new Error("Studio audio response belongs to another job.");
    consecutivePollFailures = 0;
  }
}

async function readJob(response: Response): Promise<Job> {
  if (!response.ok) throw new Error(`Studio audio API request failed (${response.status}).`);
  const value: unknown = await response.json();
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || typeof value.status !== "string" || typeof value.stage !== "string") {
    throw new Error("Studio audio API returned an invalid job.");
  }
  return value as Job;
}

export function normalizeStudioAudio(payload: Record<string, unknown>, sourceLabel: string, maxEnergyPoints = 1_200) {
  if (payload.schema_version !== "studio-audio-v1") throw new Error("Unsupported Studio audio analysis contract.");
  const duration = positive(payload.duration, "duration");
  const bpm = positive(payload.bpm, "BPM");
  const beats = eventTimes(payload.beats, duration, "beats");
  const onsets = eventTimes(payload.onsets, duration, "onsets");
  if (!beats.length) throw new Error("Studio audio analysis returned no beats.");
  if (!isRecord(payload.energy) || !isRecord(payload.structure)) throw new Error("Studio audio analysis is incomplete.");
  const structure = payload.structure;
  if (structure.source !== "allin1") throw new Error("Studio requires All-In-One song structure.");
  if (reportsMusicSectionFallback(structure)) throw new Error("Studio does not accept fallback song structure.");
  const provenance = structure.provenance;
  if (!isRecord(provenance) || provenance.status !== "detected" || provenance.device !== "cuda" ||
    typeof provenance.method !== "string" || !provenance.method.startsWith("allin1:")) {
    throw new Error("Studio requires detected All-In-One structure analyzed on CUDA.");
  }
  const analyzedDuration = positive(structure.analyzed_duration_s, "analyzed duration");
  if (Math.abs(analyzedDuration - duration) > 0.25) throw new Error("Song structure does not cover the analyzed master duration.");
  const sections = structure.sections;
  if (!Array.isArray(sections) || sections.length === 0) throw new Error("Studio audio analysis returned no song sections.");
  let previousEnd = 0;
  const checked = sections.map((section, index) => {
    if (!isRecord(section) || typeof section.start !== "number" || typeof section.end !== "number" ||
      !Number.isFinite(section.start) || !Number.isFinite(section.end) || section.start < 0 ||
      section.end <= section.start || section.end > duration + 0.25 ||
      (index === 0 ? section.start > 0.25 : Math.abs(section.start - previousEnd) > 1e-6) ||
      typeof section.label !== "string" || !section.label.trim()) {
      throw new Error("Studio audio analysis returned invalid song section timing.");
    }
    if (reportsMusicSectionFallback(section)) throw new Error("Studio does not accept fallback song sections.");
    previousEnd = section.end;
    return section as Record<string, unknown> & { start: number; end: number };
  });
  if (Math.abs(duration - previousEnd) > 0.25) throw new Error("Song structure does not cover the master audio.");
  const curve = finiteArray(payload.energy.curve, "energy");
  if (!curve.length || curve.some((value) => value < 0 || value > 1)) throw new Error("Studio energy must be normalized between zero and one.");
  const sampleRate = positive(payload.energy.sample_rate_hz, "energy sample rate");
  const start = payload.energy.start_time_s;
  if (typeof start !== "number" || !Number.isFinite(start) || Math.abs(start) > 1 / sampleRate) throw new Error("Studio energy has an invalid time origin.");
  if (Math.abs(start + (curve.length - 1) / sampleRate - duration) > Math.max(0.1, 2 / sampleRate)) {
    throw new Error("Energy samples do not cover the master audio.");
  }
  const energy = resampleEnergy(curve, sampleRate, start, duration, maxEnergyPoints);
  return {
    schemaVersion: "studio-audio-v1", sourceLabel, duration, bpm, beats, onsets,
    energy, energyTiming: { start: 0, step: duration / Math.max(1, energy.length - 1) },
    boundaries: [checked[0].start, ...checked.map((section) => section.end)],
    sections: annotateMusicSections(checked, duration, structure),
    analysisProvenance: { structureSource: "allin1", analyzedDuration },
  };
}

/** Aggregate each source sample into its actual time bin on the editor's uniform grid. */
export function resampleEnergy(curve: number[], sampleRate: number, start: number, duration: number, maxPoints: number) {
  const count = Math.max(2, Math.min(curve.length, maxPoints));
  const result = Array<number>(count).fill(0);
  for (let i = 0; i < curve.length; i++) {
    const time = start + i / sampleRate;
    const index = Math.max(0, Math.min(count - 1, Math.floor(time / duration * (count - 1))));
    result[index] = Math.max(result[index], curve[i]);
  }
  // The final grid point represents the end of the song, including a fractional final hop.
  result[count - 1] = curve[curve.length - 1];
  return result;
}

function positive(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`Studio audio analysis has invalid ${label}.`);
  return value;
}
function finiteArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) throw new Error(`Studio audio analysis has invalid ${label}.`);
  return value;
}
function eventTimes(value: unknown, duration: number, label: string) {
  const times = finiteArray(value, label);
  if (times.some((time, index) => time < 0 || time > duration || (index > 0 && time <= times[index - 1]))) throw new Error(`Studio audio analysis has invalid ${label} timing.`);
  return times;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
