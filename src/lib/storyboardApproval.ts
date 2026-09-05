import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { IMAGE_MODELS, type StoryboardJob } from "@/components/studio/storyboardGeneration";

export function validateStoryboardJob(value: unknown, allowedHosts: string[]): StoryboardJob {
  if (!value || typeof value !== "object") throw new Error("A generation job is required.");
  const job = value as StoryboardJob;
  if (!Object.hasOwn(IMAGE_MODELS, job.model) || !["grid", "fresh-frame"].includes(job.kind)
    || !["subscription-manual", "api-credits"].includes(job.billing) || job.resolution !== "2k") throw new Error("Unsupported model, billing, stage or resolution.");
  for (const key of ["id", "projectId", "sequenceId", "sectionId", "title", "prompt"] as const) {
    if (typeof job[key] !== "string" || !job[key].trim() || job[key].length > (key === "prompt" ? 16000 : 500)) throw new Error(`Invalid ${key}.`);
  }
  if (!Number.isFinite(job.songStart) || !Number.isFinite(job.songEnd) || job.songStart < 0 || job.songEnd <= job.songStart) throw new Error("Invalid song range.");
  if (!Array.isArray(job.references) || !job.references.length || job.references.length > 14) throw new Error("Choose 1–14 durable reference images.");
  for (const reference of job.references) {
    const url = new URL(reference.url);
    if (url.protocol !== "https:" || url.username || url.password || !allowedHosts.includes(url.host)) throw new Error("References must use the configured RustFS image hosts.");
    if (typeof reference.label !== "string" || typeof reference.role !== "string") throw new Error("Every reference needs a label and role.");
  }
  if (!job.references.some((reference) => reference.role.startsWith("character"))) throw new Error("Attach the canonical character sheet before generation.");
  if (job.kind === "fresh-frame" && (!job.sourceGridId || !Number.isInteger(job.panelIndex)
    || !job.references.some((reference) => reference.role === "composition"))) throw new Error("Fresh frames require an identified storyboard panel composition reference.");
  return job;
}

export function storyboardJobHash(job: StoryboardJob) {
  return createHash("sha256").update(JSON.stringify(job)).digest("hex");
}

export function signStoryboardApproval(job: StoryboardJob, userId: string, credits: number, secret: string, now = Date.now()) {
  const payload = { hash: storyboardJobHash(job), userId, credits, expiresAt: now + 15 * 60_000 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { token: `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`, expiresAt: payload.expiresAt };
}

export function verifyStoryboardApproval(token: string, job: StoryboardJob, userId: string, secret: string, now = Date.now()) {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) throw new Error("Review and approve a new quote first.");
  const actual = Buffer.from(signature, "base64url");
  const expected = createHmac("sha256", secret).update(body).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid approval.");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as { hash: string; userId: string; credits: number; expiresAt: number };
  if (payload.hash !== storyboardJobHash(job) || payload.userId !== userId || payload.expiresAt <= now
    || !Number.isFinite(payload.credits) || payload.credits < 0) throw new Error("The quote expired or the job changed. Review again.");
  return payload;
}
