"use client";
import { useState } from "react";
import { GenerateTab } from "@/components/studio/panels/GenerateTab";
import { runStoryboardChecks } from "@/components/studio/storyboardChecks";
import { sanitizeGeneratedStudioAssetForStorage, type GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import { buildSequenceGridPrompt, buildStoryboardSequences, canonicalStoryboardReferences, type StoryboardJob } from "@/components/studio/storyboardGeneration";
import type { EditPlanPreviewSegment, MusicVideoProject } from "@/components/studio/musicVideoProject";
import type { ReferenceAsset } from "@/components/studio/referenceAssets";
import type { PreviewCutRange } from "@/components/studio/resolvedPreviewSelection";

// Intentionally synthetic. Never substitute these assets for production E2E media.
const preview = "/dev/storyboard/image";
const references: ReferenceAsset[] = ["Diego", "Valentina", "Underground Latin Club", "Crowd 1", "Crowd 2", "Crowd 3"].map((displayName, i) => ({ id: `ref-${i}`, role: i === 0 ? "character-1" : i === 1 ? "character-2" : i === 2 ? "environment" : "crowd", kind: i < 2 ? "character" : i === 2 ? "environment" : "crowd", displayName, fileName: `${i}.png`, previewUrl: preview, storageUrl: `https://fixture.invalid/ref-${i}.png`, storageStatus: "uploaded", promptHint: "Fixture only", createdAt: "2026-08-30" }));
const segments: EditPlanPreviewSegment[] = Array.from({ length: 4 }, (_, i) => ({ sectionId: i < 2 ? "Verse 1" : "Chorus", label: i % 2 ? "Reaction and reveal" : "Walk into the club", videoUrl: "", startTime: 0, endTime: 5, musicStart: i * 10, musicEnd: i * 10 + 10, momentId: `moment-${i}`, sourceClipId: i, thumbnailUrl: preview }));
const project: MusicVideoProject = { id: "browser-fixture", song: null, duration: 40, lyricChunks: [], storySections: [], reviewFindings: [],
  videoMoments: segments.map((segment, i) => ({ id: `moment-${i}`, sourceClipId: i, label: segment.label, start: 0, end: 5, duration: 5, thumbnailUrl: preview, firstFrameUrl: `${preview}?opening=${i}`, lastFrameUrl: `${preview}?ending=${i}` })),
  editPlan: { id: "fixture-edit", createdAt: "2026-08-30", timelineItems: segments.map((segment, i) => ({ id: `item-${i}`, sectionId: segment.sectionId, label: segment.sectionId, prompt: segment.label, start: segment.musicStart, end: segment.musicEnd, lyricChunkIds: [], videoMomentId: `moment-${i}` })) } };

export function StoryboardBrowserFixture({ serverChecks }: { serverChecks: { label: string; passed: boolean }[] }) {
  const [assets, setAssets] = useState<GeneratedStudioAsset[]>([]);
  const [range, setRange] = useState<PreviewCutRange | null>({ startIndex: 0, endIndex: 0 });
  const [roundtrip, setRoundtrip] = useState(false);
  const checks = [...serverChecks, ...runStoryboardChecks()];
  const sequence = buildStoryboardSequences(segments)[0];
  const refs = canonicalStoryboardReferences(references);
  const job: StoryboardJob = { id: "fixture-grid", projectId: project.id, sequenceId: sequence.id, sectionId: sequence.sectionId, title: "Verse 1 fixture board", songStart: 0, songEnd: 20, kind: "grid", model: "nano_banana_pro", billing: "subscription-manual", resolution: "2k", references: refs, prompt: buildSequenceGridPrompt(sequence, refs, "Walk into club") };
  const upsert = (asset: GeneratedStudioAsset) => setAssets((current) => [asset, ...current.filter((candidate) => candidate.id !== asset.id)]);
  return <main className="min-h-screen space-y-4 bg-black p-6 text-zinc-200">
    <h1 className="text-xl">Development-only browser verification · synthetic media · no paid generation</h1>
    <p>{checks.filter((check) => check.passed).length}/{checks.length} regression checks passed</p>
    <details><summary>Inspect regression checks</summary><ul>{checks.map((check) => <li key={check.label}>{check.passed ? "PASS" : "FAIL"} · {check.label}</li>)}</ul></details>
    <div className="flex gap-3">
      <button className="rounded border p-2" onClick={() => upsert({ id: "fixture-grid", provider: "higgsfield", model: job.model, title: job.title, createdAt: "2026-08-30", prompt: job.prompt, status: "completed", mediaKind: "image", storyboard: job, resultUrl: preview,
        split: { splitId: "fixture", sourceFilename: "fixture.svg", width: 2048, height: 1152, mode: "fixed", rows: 3, cols: 3, gutterPx: 0, panels: Array.from({ length: 9 }, (_, i) => ({ index: i + 1, row: Math.floor(i / 3), col: i % 3, label: `Panel ${i + 1}`, url: preview, assetPath: "fixture" })) } })}>Load returned-grid fixture</button>
      <button className="rounded border p-2" onClick={() => upsert({ id: "fixture-fresh", provider: "higgsfield", model: job.model, title: "Panel 1 fresh 2K fixture", createdAt: "2026-08-30", prompt: "Fixture", status: "completed", mediaKind: "image", reviewStatus: "pending", storyboard: { ...job, id: "fixture-fresh", kind: "fresh-frame", sourceGridId: "fixture-grid", panelIndex: 1 }, resultUrl: preview })}>Load returned-fresh-frame fixture</button>
      <button className="rounded border p-2" onClick={() => { setAssets(JSON.parse(JSON.stringify(assets.map(sanitizeGeneratedStudioAssetForStorage)))); setRoundtrip(true); }}>Round-trip persisted assets</button>
    </div>
    <p>{roundtrip ? "Persistence round-trip applied" : "Fixture state is ephemeral"} · {assets.length} assets · {assets.filter((asset) => asset.reviewStatus === "approved").length} visually approved</p>
    <GenerateTab project={project} analysis={null} storyGenerated onsetDensity={50} lyricCueBlend={50} lyricMergeWindow={1} previewSegments={segments}
      referenceAssets={references} persistedGeneratedAssets={assets} masterAudioRef={null} onEnsureOwnedMasterAudio={async () => { throw new Error("No real media in fixture."); }} onGeneratedAsset={upsert}
      selectedPreviewRange={range} onSelectedPreviewRange={setRange} onAuditionPreviewRange={setRange} onAuditionGeneratedAsset={() => undefined} onSelectMatch={() => undefined} onSelectJoin={() => undefined} />
  </main>;
}
