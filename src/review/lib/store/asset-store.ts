import { create } from "zustand";
import type { Asset, AssetVersion, ReviewStatus, SceneData } from "./types";
import { probeVideo, probeImage } from "../video/metadata";
import {
  createAnalysisVideo,
  grabThumbnail,
  grabBitmap,
} from "../video/frame-grab";
import { detectScenes, cutsToScenes } from "../analysis/scene-detection";
import { captionFrame } from "../analysis/caption-client";

let seq = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

interface AssetState {
  assets: Asset[];
  activeAssetId: string | null;

  addFiles: (files: FileList | File[]) => Promise<void>;
  addVersion: (assetId: string, file: File) => Promise<void>;
  setActive: (id: string) => void;
  setStatus: (assetId: string, status: ReviewStatus) => void;
  selectVersion: (assetId: string, versionIndex: number) => void;
  setThumbnail: (assetId: string, src: string) => void;
  deleteAsset: (assetId: string) => void;
  getActive: () => Asset | null;
  getActiveVersion: () => AssetVersion | null;
}

function videoTypeFromFile(file: File): "video" | "image" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  // Fall back to extension.
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ["png", "jpg", "jpeg", "webp", "gif", "exr", "tiff"].includes(ext)
    ? "image"
    : "video";
}

export const useAssetStore = create<AssetState>((set, get) => {
  function patchAsset(id: string, patch: Partial<Asset>) {
    set((s) => ({
      assets: s.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  }

  async function runVideoAnalysis(assetId: string, version: AssetVersion) {
    let video: HTMLVideoElement | null = null;
    try {
      patchAsset(assetId, {
        analysisStage: "detecting",
        analysisProgress: 0,
        analysisLabel: "DETECTING SCENES",
      });
      video = await createAnalysisVideo(version.src);

      const cuts = await detectScenes(video, {
        onProgress: (percent) =>
          patchAsset(assetId, { analysisProgress: percent }),
      });
      const segments = cutsToScenes(cuts, version.duration);

      // Build scene records with thumbnails first (fast), captions after.
      const scenes: SceneData[] = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const sampleTime = Math.min(
          seg.startTime + 0.4,
          (seg.startTime + seg.endTime) / 2
        );
        const thumbnailUrl = await grabThumbnail(video, sampleTime);
        scenes.push({
          id: uid("scene"),
          index: i,
          startTime: seg.startTime,
          endTime: seg.endTime,
          thumbnailUrl,
        });
        patchAsset(assetId, {
          scenes: [...scenes],
          analysisProgress: (i + 1) / segments.length,
        });
      }

      // Caption pass — drives the LFM worker one scene at a time.
      patchAsset(assetId, {
        analysisStage: "captioning",
        analysisProgress: 0,
        analysisLabel: "CAPTIONING SHOTS",
      });

      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const sampleTime = Math.min(
          scene.startTime + 0.4,
          (scene.startTime + scene.endTime) / 2
        );
        try {
          const bitmap = await grabBitmap(video, sampleTime);
          const result = await captionFrame(bitmap);
          scenes[i] = { ...scene, caption: result.text, meta: result.meta };
        } catch {
          scenes[i] = { ...scene, caption: "" };
        }
        patchAsset(assetId, {
          scenes: [...scenes],
          analysisProgress: (i + 1) / scenes.length,
        });
      }

      patchAsset(assetId, {
        analysisStage: "done",
        analysisProgress: 1,
        analysisLabel: undefined,
      });
    } catch (err) {
      patchAsset(assetId, {
        analysisStage: "error",
        analysisLabel: (err as Error).message || "ANALYSIS_FAILED",
      });
    } finally {
      if (video) {
        video.src = "";
        video.remove();
      }
    }
  }

  async function buildVersion(file: File, label: string): Promise<{
    version: AssetVersion;
    type: "video" | "image";
  }> {
    const src = URL.createObjectURL(file);
    const type = videoTypeFromFile(file);

    if (type === "image") {
      const { width, height } = await probeImage(src);
      return {
        type,
        version: {
          id: uid("ver"),
          label,
          src,
          fps: 0,
          width,
          height,
          codec: file.type.split("/")[1]?.toUpperCase() ?? "IMG",
          duration: 0,
          fileSize: file.size,
          status: "in-review",
          createdAt: Date.now(),
        },
      };
    }

    const meta = await probeVideo(file, src);
    return {
      type,
      version: {
        id: uid("ver"),
        label,
        src,
        fps: meta.fps,
        width: meta.width,
        height: meta.height,
        codec: meta.codec,
        duration: meta.duration,
        fileSize: file.size,
        status: "in-review",
        createdAt: Date.now(),
      },
    };
  }

  return {
    assets: [],
    activeAssetId: null,

    addFiles: async (files) => {
      const list = Array.from(files);
      for (const file of list) {
        const assetId = uid("asset");
        // Optimistic placeholder so the row appears immediately.
        const placeholder: Asset = {
          id: assetId,
          name: file.name,
          type: videoTypeFromFile(file),
          versions: [],
          currentVersionIndex: 0,
          scenes: [],
          analysisStage: "probing",
          analysisProgress: 0,
          analysisLabel: "INGESTING",
        };
        set((s) => ({
          assets: [placeholder, ...s.assets],
          activeAssetId: assetId,
        }));

        try {
          const { version, type } = await buildVersion(file, "v1");
          patchAsset(assetId, {
            type,
            versions: [version],
            analysisStage: type === "video" ? "detecting" : "done",
            analysisLabel: undefined,
          });
          if (type === "video") {
            void runVideoAnalysis(assetId, version);
          }
        } catch (err) {
          patchAsset(assetId, {
            analysisStage: "error",
            analysisLabel: (err as Error).message || "DECODE_FAILED",
          });
        }
      }
    },

    addVersion: async (assetId, file) => {
      const asset = get().assets.find((a) => a.id === assetId);
      if (!asset) return;
      const label = `v${asset.versions.length + 1}`;
      try {
        const { version, type } = await buildVersion(file, label);
        const versions = [...asset.versions, version];
        patchAsset(assetId, {
          versions,
          currentVersionIndex: versions.length - 1,
        });
        if (type === "video") void runVideoAnalysis(assetId, version);
      } catch {
        /* ignore bad version */
      }
    },

    setActive: (id) => set({ activeAssetId: id }),

    setStatus: (assetId, status) => {
      const asset = get().assets.find((a) => a.id === assetId);
      if (!asset) return;
      const versions = asset.versions.map((v, i) =>
        i === asset.currentVersionIndex ? { ...v, status } : v
      );
      patchAsset(assetId, { versions });
    },

    selectVersion: (assetId, versionIndex) =>
      patchAsset(assetId, { currentVersionIndex: versionIndex }),

    setThumbnail: (assetId, src) =>
      patchAsset(assetId, { thumbnailOverride: src }),

    deleteAsset: (assetId) => {
      const { assets, activeAssetId } = get();
      // Release object URLs to avoid leaks.
      const target = assets.find((a) => a.id === assetId);
      target?.versions.forEach((v) => {
        if (v.src.startsWith("blob:")) URL.revokeObjectURL(v.src);
      });
      const remaining = assets.filter((a) => a.id !== assetId);
      set({
        assets: remaining,
        activeAssetId:
          activeAssetId === assetId
            ? (remaining[0]?.id ?? null)
            : activeAssetId,
      });
    },

    getActive: () => {
      const { assets, activeAssetId } = get();
      return assets.find((a) => a.id === activeAssetId) ?? null;
    },

    getActiveVersion: () => {
      const active = get().getActive();
      if (!active || active.versions.length === 0) return null;
      return active.versions[active.currentVersionIndex] ?? active.versions[0];
    },
  };
});
