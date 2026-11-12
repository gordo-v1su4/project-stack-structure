import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildProjectStorageFolder, ownerProjectsIndexPath, resolveLegacyProjectObjectPath, resolveProjectObjectPath } from "@/lib/studioStoragePaths";
import { isCanonicalStudioMetadata } from "@/lib/studioMetadataPrivacy";

let pointer: string | undefined;
mock.module("next/headers", () => ({ cookies: async () => ({ get: () => pointer ? { value: pointer } : undefined }) }));
mock.module("@/lib/session", () => ({
  getSessionUser: async () => ({ id: "github-owner" }),
  unauthorizedResponse: () => Response.json({}, { status: 401 }),
}));
const { GET: readDraft } = await import("@/app/api/studio/draft/route");
const { listStudioProjects } = await import("@/lib/studioProjectStore");
const { loadUserOwnedMediaKeys } = await import("@/lib/studioMediaAccess");
const { downloadJsonFromMediaGateway } = await import("@/lib/mediaGateway");
const savedEnv = { ...process.env }, originalFetch = globalThis.fetch;
beforeEach(() => {
  pointer = undefined;
  process.env = { ...process.env, NODE_ENV: "production" };
  process.env.MEDIA_GATEWAY_URL = "https://gateway.test";
  process.env.MEDIA_GATEWAY_INTERNAL_URL = "";
  process.env.MEDIA_GATEWAY_TOKEN = "existing-server-token";
  process.env.MEDIA_GATEWAY_BUCKET = "stack-structure";
});
afterEach(() => { process.env = { ...savedEnv }; globalThis.fetch = originalFetch; });

describe("existing authenticated metadata readers survive the anonymous deny", () => {
  test("actual project key builders and canonical store prefix templates match the deny", () => {
    for (const key of [ownerProjectsIndexPath("github-owner"), resolveLegacyProjectObjectPath("github-owner", "full-id"),
      resolveProjectObjectPath(buildProjectStorageFolder("github-owner", "full-id", "Legacy named folder"))]) {
      expect(isCanonicalStudioMetadata("stack-structure", key)).toBe(true);
    }
    const sources = ["h3JobStore", "h3StillJobStore", "h3ShotPlanningStore", "h3DraftPolicyStore",
      "h3IdentityAssessmentStore", "currentIdentityStore", "generationScopeStore", "h3FirstFrameStore", "nativeFirstFrameSource",
      "h3StillResultStore"];
    for (const name of sources) {
      const source = readFileSync(new URL(`../../src/lib/${name}.ts`, import.meta.url), "utf8");
      const templates = [...source.matchAll(/`(media-uploads\/projects\/[^\`]+)`/g)];
      expect(templates.length).toBeGreaterThan(0);
      for (const [, template] of templates) {
        // Resolve the source builder's dynamic segments without importing a
        // generation service. S3 resource * spans nested paths.
        let key = template.replace(/\$\{[^}]+\}/g, "fixture");
        if (key.includes("/generation-conditioning/")) key += "/record.json";
        if (key.includes("/still-results/")) {
          expect(isCanonicalStudioMetadata("stack-structure", key + "master.png")).toBe(false);
          expect(isCanonicalStudioMetadata("stack-structure", key + "native.png")).toBe(false);
          key += "preparation.json";
        }
        expect(isCanonicalStudioMetadata("stack-structure", key)).toBe(true);
      }
    }
  });

  test("project index fetch sends the existing server bearer", async () => {
    const upstream = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer existing-server-token");
      expect(String(_input)).toContain(ownerProjectsIndexPath("github-owner"));
      return Response.json({ version: 1, projects: [] });
    });
    globalThis.fetch = upstream as unknown as typeof fetch;
    expect(await listStudioProjects("github-owner")).toEqual([]);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  test("default and timestamp pointer drafts both carry bearer and fall back without public reads", async () => {
    const paths: string[] = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer existing-server-token");
      const key = new URL(String(input)).pathname.split("/files/stack-structure/")[1];
      expect(isCanonicalStudioMetadata("stack-structure", key)).toBe(true);
      paths.push(key); return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    expect((await readDraft(new Request("http://localhost/api/studio/draft"))).status).toBe(200);
    pointer = "media-uploads/studio-drafts/1787989852482-github-owner.json";
    expect((await readDraft(new Request("http://localhost/api/studio/draft"))).status).toBe(200);
    expect(paths).toEqual(["media-uploads/studio-drafts/github-owner.json", pointer, "media-uploads/studio-drafts/github-owner.json"]);
  });

  test("ownership discovery and analysis-manifest helper retain authenticated transport", async () => {
    const paths: string[] = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer existing-server-token");
      const key = new URL(String(input)).pathname.split("/files/stack-structure/")[1]; paths.push(key);
      return Response.json(key.endsWith("index.json") ? { version: 1, projects: [] }
        : { analysis: { storagePath: "media-uploads/analysis/owned.json" } });
    }) as unknown as typeof fetch;
    expect((await loadUserOwnedMediaKeys("github-owner")).has("media-uploads/analysis/owned.json")).toBe(true);
    await downloadJsonFromMediaGateway({ bucket: "stack-structure", objectKey: "media-uploads/analysis/owned.json" });
    expect(paths).toEqual(["media-uploads/studio-drafts/github-owner.json",
      "media-uploads/projects/github-owner/index.json", "media-uploads/analysis/owned.json"]);
    expect(isCanonicalStudioMetadata("stack-structure", paths[2])).toBe(false);
  });

  test("owned named-project wrappers contribute legacy keys; foreign folders and owners do not", async () => {
    const good = buildProjectStorageFolder("github-owner", "good", "Owned"), foreign = buildProjectStorageFolder("github-other", "foreign", "Foreign");
    const paths: string[] = [];
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const key = new URL(String(input)).pathname.split("/files/stack-structure/")[1]; paths.push(key);
      if (key.endsWith("index.json")) return Response.json({ projects: [{ id: "good", storageFolder: good }, { id: "foreign", storageFolder: foreign }] });
      if (key === resolveProjectObjectPath(good)) return Response.json({ project: { ownerId: "github-owner" }, draft: { videoSources: [{ storagePath: "media-uploads/legacy-owned.mp4" }] } });
      if (key === resolveLegacyProjectObjectPath("github-owner", "foreign")) return Response.json({ project: { ownerId: "github-other" }, draft: { videoSources: [{ storagePath: "media-uploads/foreign.mp4" }] } });
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;
    const keys = await loadUserOwnedMediaKeys("github-owner");
    expect(keys.has("media-uploads/legacy-owned.mp4")).toBe(true);
    expect(keys.has("media-uploads/foreign.mp4")).toBe(false);
    expect(paths).not.toContain(resolveProjectObjectPath(foreign));
  });
});
