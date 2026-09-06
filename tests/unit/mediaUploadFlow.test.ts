import { describe, expect, test } from "bun:test";

import { prepareVideoSources } from "@/components/studio/mediaUpload";

const originalDocument = globalThis.document;
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;
const originalFetch = globalThis.fetch;

describe("prepareVideoSources", () => {
  test("does not call the legacy direct splitter route when storage upload fails", async () => {
    const fetchUrls: string[] = [];
    installMediaDomStubs();
    globalThis.fetch = (async (url: string | URL | Request) => {
      fetchUrls.push(String(url));
      return Response.json({ error: "upload failed" }, { status: 503 });
    }) as typeof fetch;

    try {
      const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
      const updates: unknown[] = [];
      const prepared = await prepareVideoSources(
        [file],
        (update) => updates.push(update),
        (update) => updates.push(update),
      );
      await flushAsyncUpload();

      expect(prepared).toHaveLength(1);
      expect(fetchUrls).toEqual(["/api/storage/direct"]);
      expect(fetchUrls).not.toContain("/api/splitter/scene");
      expect(updates).toHaveLength(1);
    } finally {
      restoreGlobals();
    }
  });
});

function restoreGlobals() {
  globalThis.document = originalDocument;
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
  globalThis.fetch = originalFetch;
}

function installMediaDomStubs() {
  URL.createObjectURL = () => "blob:clip";
  URL.revokeObjectURL = () => undefined;

  globalThis.document = {
    createElement(tagName: string) {
      if (tagName === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: () => undefined }),
          toDataURL: () => "data:image/jpeg;base64,thumb",
        };
      }

      if (tagName === "video") {
        let onloadedmetadata: (() => void) | null = null;
        let onloadeddata: (() => void) | null = null;
        let onseeked: (() => void) | null = null;
        return {
          duration: 10,
          videoWidth: 640,
          videoHeight: 360,
          preload: "",
          muted: false,
          playsInline: false,
          crossOrigin: "",
          onerror: null,
          get onloadedmetadata() {
            return onloadedmetadata;
          },
          set onloadedmetadata(value) {
            onloadedmetadata = value;
            queueMicrotask(() => onloadedmetadata?.());
          },
          get onloadeddata() {
            return onloadeddata;
          },
          set onloadeddata(value) {
            onloadeddata = value;
            queueMicrotask(() => onloadeddata?.());
          },
          get onseeked() {
            return onseeked;
          },
          set onseeked(value) {
            onseeked = value;
          },
          set currentTime(_value: number) {
            queueMicrotask(() => onseeked?.());
          },
        };
      }

      throw new Error(`Unexpected element ${tagName}`);
    },
  } as unknown as Document;
}

async function flushAsyncUpload() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
