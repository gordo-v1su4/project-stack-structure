/**
 * Client-side captioning driver. Owns a single LFM worker instance (lazy,
 * shared across assets so the ~450MB model loads once) and exposes a queue:
 * submit a frame bitmap, get back structured caption text.
 */

import type { SceneCaptionData } from "../store/types";

export interface CaptionResult {
  text: string;
  meta?: SceneCaptionData;
}

type Pending = {
  resolve: (r: CaptionResult) => void;
  reject: (e: Error) => void;
};

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

export type LoadProgress = (percent: number, stage: string) => void;
const loadListeners = new Set<LoadProgress>();

export function onCaptionModelProgress(cb: LoadProgress): () => void {
  loadListeners.add(cb);
  return () => loadListeners.delete(cb);
}

function ensureWorker(): Promise<void> {
  if (readyPromise) return readyPromise;

  worker = new Worker(new URL("./lfm-scene-worker.ts", import.meta.url), {
    type: "module",
  });

  readyPromise = new Promise<void>((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      const msg = e.data;
      switch (msg.type) {
        case "ready":
          resolve();
          break;
        case "progress":
          loadListeners.forEach((cb) => cb(msg.percent ?? 0, msg.stage ?? ""));
          break;
        case "caption": {
          const p = pending.get(msg.id);
          if (p) {
            pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error));
            else p.resolve({ text: msg.text, meta: msg.meta });
          }
          break;
        }
        case "error":
          if (msg.id != null) {
            const p = pending.get(msg.id);
            if (p) {
              pending.delete(msg.id);
              p.reject(new Error(msg.message));
            }
          } else {
            reject(new Error(msg.message));
          }
          break;
      }
    };
    worker!.addEventListener("message", onMessage);
    worker!.postMessage({ type: "init" });
  });

  return readyPromise;
}

/** Caption a single frame bitmap. The bitmap ownership is transferred. */
export async function captionFrame(bitmap: ImageBitmap): Promise<CaptionResult> {
  await ensureWorker();
  const id = nextId++;
  return new Promise<CaptionResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ type: "caption", id, bitmap }, [bitmap]);
  });
}

/** True once a worker exists and the model has begun/finished loading. */
export function isCaptionModelInitialized(): boolean {
  return worker !== null;
}
