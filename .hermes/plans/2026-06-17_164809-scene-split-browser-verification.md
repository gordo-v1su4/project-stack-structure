# Scene Split + Real Asset Browser Verification Implementation Plan

> **For Hermes:** Use subagent-driven-development skill if delegating. For this run, execute sequentially and verify each stage visually in the browser before asking the user to check it on the M3 Mac.

**Goal:** Restore/implement video scene-split behavior in SVS Studio using the same processing model as splitter.serving.cloud, then verify the workflow with real recent Downloads audio/video clips in the browser before handing it to the user.

**Architecture:** Keep SVS Studio as the UX shell. Add a small scene-split adapter that calls Splitter Pro 2 (`https://splitter.serving.cloud/api/jobs`) for PySceneDetect + ffmpeg scene segmentation, normalizes the returned manifest into SVS source/segment data, and falls back to current in-browser metadata-only segmentation if the Splitter API is unavailable. Standard Split should use detected scene segments. Beat Split should use audio beat/onset timing but snap/cap segments against detected scene boundaries where useful.

**Tech Stack:** Next.js 16, React, Bun, browser file inputs, Splitter Pro 2 REST API, TypeScript unit tests, browser visual QA.

---

## Current Context / Facts Already Verified

- Running project: `/root/Github/project-stack-structure`
- Current server URL: `http://100.94.7.10:3000`
- M3 Mac user: `robertspaniolo`
- Recent audio copied from M3 Downloads:
  - `/Users/robertspaniolo/Downloads/clean_seedance_instrumental_133bpm_14_95s.mp3`
  - local project copy: `public/qa-media/audio.mp3`
- Recent video clips copied from M3 Downloads:
  - `/Users/robertspaniolo/Downloads/hf_20260613_193743_2854e5a3-cc1e-4cbd-83ed-1a47dcd70fcc.mp4`
  - `/Users/robertspaniolo/Downloads/hf_20260613_193857_b2ce10c8-1aaa-4ad1-9f3d-e9a2203154d7.mp4`
  - `/Users/robertspaniolo/Downloads/hf_20260613_193547_b6f7603e-a4da-41de-9e16-04ccaafe4b39.mp4`
  - local project copies: `public/qa-media/clip-1.mp4`, `clip-2.mp4`, `clip-3.mp4`
- Browser QA already proved those real assets can load into the current UI:
  - audio duration: `14.95s`
  - video durations: about `15.09s` each
  - Beat Split currently generates 48 preview segments from beat timing
- Gap: current video segmentation is synthetic/time-sliced. Splitter Pro 2 uses PySceneDetect adaptive scene detection + ffmpeg frame-accurate scene slices + first-frame thumbnails.

## Splitter Pro 2 API Shape

Source: `https://splitter.serving.cloud/openapi.json`

- `POST /api/jobs`
  - multipart form field: `file`
  - returns `{ job: JobState }`
- `GET /api/jobs/{job_id}`
  - poll status/stage/progress/segment_count
- `GET /api/jobs/{job_id}/result`
  - returns `{ manifest: JobManifest }`
- `GET /api/jobs/{job_id}/assets/{asset_path}`
  - returns clip/still assets referenced by manifest

Need to inspect one real completed manifest before final mapping, because `web_extract` summarized the OpenAPI and did not show the complete `JobManifest` schema.

---

## Task 1: Capture one real Splitter job response with a small sample clip

**Objective:** Learn the exact manifest fields returned by Splitter Pro 2 so the adapter is accurate instead of guessed.

**Files:**
- No project files changed.
- Temporary output only: `/tmp/splitter-job-result.json`

**Steps:**
1. Upload the smallest copied clip to Splitter:
   ```bash
   curl -sS -X POST https://splitter.serving.cloud/api/jobs \
     -F "file=@public/qa-media/clip-1.mp4" \
     -o /tmp/splitter-job-created.json
   ```
2. Extract `job.job_id`:
   ```bash
   python3 - <<'PY'
   import json
   print(json.load(open('/tmp/splitter-job-created.json'))['job']['job_id'])
   PY
   ```
3. Poll until completed:
   ```bash
   JOB_ID=<id-from-step-2>
   for i in {1..60}; do
     curl -sS "https://splitter.serving.cloud/api/jobs/$JOB_ID" | tee /tmp/splitter-job-state.json
     python3 - <<'PY'
   import json
   s=json.load(open('/tmp/splitter-job-state.json'))
   print(s.get('status'), s.get('stage'), s.get('segment_count'), s.get('progress_completed'), '/', s.get('progress_total'))
   PY
     sleep 3
   done
   ```
4. Fetch result:
   ```bash
   curl -sS "https://splitter.serving.cloud/api/jobs/$JOB_ID/result" -o /tmp/splitter-job-result.json
   python3 -m json.tool /tmp/splitter-job-result.json | head -200
   ```
5. Record the manifest fields needed for mapping:
   - scene index/id
   - start time
   - end time
   - duration
   - clip asset path
   - still/thumbnail asset path
   - any confidence/detector metadata

**Expected:** A completed manifest with scene segments and asset paths.

**Fallback if blocked:** If Splitter API rejects CORS/auth/size/network from server, implement a local dev-only manifest adapter with the same field names discovered from OpenAPI plus browser-side scene estimates, but label it as fallback and keep UI status explicit.

---

## Task 2: Add scene-split types to SVS Studio

**Objective:** Represent detected scenes separately from uploaded source clips.

**Files:**
- Modify: `src/components/studio/types.ts`

**Implementation sketch:**
Add:
```ts
export type SceneSplitStatus = "idle" | "uploading" | "detecting" | "ready" | "failed" | "fallback";

export interface SceneSplitAsset {
  path?: string;
  url?: string;
}

export interface DetectedSceneSegment {
  id: number;
  sourceClipId: number;
  label: string;
  start: number;
  end: number;
  duration: number;
  thumbnailUrl?: string;
  clipUrl?: string;
  assetPath?: string;
  detector?: "pyscenedetect-adaptive" | "browser-fallback";
  confidence?: number | null;
}

export interface UploadedVideoSource {
  id: number;
  name: string;
  duration: number;
  size: number;
  thumbnailUrl: string;
  videoUrl: string;
  scenes?: DetectedSceneSegment[];
  sceneStatus?: SceneSplitStatus;
  sceneJobId?: string;
  sceneError?: string | null;
}
```

**Validation:**
Run:
```bash
bun run typecheck
```
Expected: type errors only where new fields need integration, then fix in later tasks.

---

## Task 3: Create Splitter API adapter

**Objective:** Provide a single function that uploads a video File to Splitter Pro 2, polls, fetches the manifest, and returns normalized `DetectedSceneSegment[]`.

**Files:**
- Create: `src/components/studio/sceneSplit.ts`
- Test: `tests/unit/sceneSplit.test.ts`

**Core functions:**
```ts
export const SPLITTER_API_BASE_URL = "https://splitter.serving.cloud";

export async function detectScenesWithSplitter(file: File, sourceClipId: number): Promise<DetectedSceneSegment[]>;
export function normalizeSplitterManifest(manifest: unknown, sourceClipId: number, baseUrl?: string): DetectedSceneSegment[];
export function buildFallbackSceneSegments(source: UploadedVideoSource): DetectedSceneSegment[];
```

**Important behavior:**
- `detectScenesWithSplitter` should:
  - `POST /api/jobs` with the file
  - poll `GET /api/jobs/{job_id}` until completed/failed
  - fetch `GET /api/jobs/{job_id}/result`
  - normalize manifest
- Use a maximum wait and clear error message; do not hang the UI.
- `normalizeSplitterManifest` must be permissive because manifest field names may vary. It should look for arrays like `segments`, `scenes`, `clips`, `shots`, or `manifest.segments`.
- Build asset URLs as:
  - `${baseUrl}/api/jobs/${jobId}/assets/${assetPath}` where manifest provides asset paths

**Tests:**
- Given a sample manifest shape from Task 1, returns normalized scene segments.
- Falls back if manifest has no scene array.
- Preserves source clip id.

**Run:**
```bash
bun test tests/unit/sceneSplit.test.ts
bun run typecheck
```

---

## Task 4: Integrate scene detection into video ingestion

**Objective:** When user uploads video files, each source clip should run scene detection and store scenes on the source.

**Files:**
- Modify: `src/components/studio/mediaUpload.ts`
- Modify: `src/components/StudioApp.tsx`

**Approach:**
1. Keep current `prepareVideoSources(files)` for metadata and thumbnail.
2. After metadata is ready, call scene detection per source/file.
3. Update UI status progressively:
   - `Processing 3 video clips...`
   - `Detecting scenes with Splitter Pro 2 · clip 1/3...`
   - `Scene split ready · 3 clips · 27 scenes.`
4. If Splitter fails for a clip:
   - keep that source loaded
   - set `sceneStatus: "fallback"`
   - populate fallback scene segments based on duration, e.g. 2-4s chunks or current source clip as one segment
   - show warning, not a fatal upload failure

**Acceptance:**
Uploading videos should not leave the UI empty if Splitter fails. It should either show real PySceneDetect scenes or explicit fallback scenes.

---

## Task 5: Make Standard Split use detected scene segments

**Objective:** Standard Split should show real scene cuts instead of fixed `clipDur` slicing when scenes exist.

**Files:**
- Modify: `src/components/studio/sourceTimeline.ts`
- Modify: `src/components/StudioApp.tsx`
- Test: likely extend existing unit tests or create `tests/unit/sourceTimeline.test.ts`

**Implementation idea:**
Add a function:
```ts
export function buildSceneSplitSegments(sources: UploadedVideoSource[]): SourceTimelineSegment[];
```

Mapping rules:
- Each detected scene becomes a `SourceTimelineSegment`.
- Global timeline start/end should include the source clip offset, so three 15s videos become a continuous ~45s timeline.
- `sourceClipIds` should be `[source.id]` for normal scenes.
- Preserve `sceneId`/thumbnail if the current type supports it, or add optional fields.

**Acceptance:**
On Standard Split with 3 uploaded clips, the UI should show scene count from Splitter/fallback instead of arbitrary fixed-size chunks.

---

## Task 6: Make Beat Split respect scenes without destroying musical timing

**Objective:** Beat Split remains music-driven, but uses scene boundaries as source units and thumbnails/previews.

**Files:**
- Modify: `src/components/studio/sourceTimeline.ts`
- Modify: `src/components/StudioApp.tsx`

**Approach:**
- Keep `buildAudioDrivenSegments` for beat/onset duration pattern.
- Improve mapping from global segment time to source scene:
  - If a beat segment falls inside a detected scene, source thumbnail should come from that scene.
  - Avoid segments crossing too many scene boundaries where possible.
  - If beat boundary is within a small tolerance of a scene cut, snap to the scene cut.
- Do not overfit. Initial acceptance is: detected scene thumbnails/labels are visible and segment metadata uses scene-derived source refs.

**Acceptance:**
Beat Split with the 133 BPM track + 3 clips should still produce beat-synced segments, but previews should be anchored to detected scenes instead of generic source clip thumbnails.

---

## Task 7: Add visible UI status for scene split provenance

**Objective:** The user should be able to see whether results came from Splitter Pro 2 or fallback.

**Files:**
- Modify likely: `src/components/studio/BeatSplitTab.tsx` or whichever tab component renders `A/V SOURCE` and uploaded sources.
- Possibly modify: `src/components/studio/SplitTab.tsx`

**UI copy:**
- Real Splitter result:
  - `A/V SOURCE · 3 CLIPS · 27 DETECTED SCENES · PYSCENEDETECT`
- Fallback result:
  - `A/V SOURCE · 3 CLIPS · FALLBACK SCENES · SPLITTER UNREACHABLE`
- Per source card:
  - `S1 · 8 scenes · PySceneDetect`
  - or `S1 · fallback · 4 slices`

**Acceptance:**
No hidden magic. If the real API is not used, the UI says so.

---

## Task 8: Browser QA with real assets before user checks

**Objective:** Verify the full real-asset workflow visually and interactively.

**Files:**
- No code changes unless bugs found.

**Browser script for upload:**
Use the existing Browser tool on `http://127.0.0.1:3000/?scene-split-qa=1`.

Upload audio + videos by injecting files from local public URLs:
```js
(async()=>{
  async function fileFromUrl(url,name,type){
    const r=await fetch(url);
    if(!r.ok) throw new Error(url+' '+r.status);
    const b=await r.blob();
    return new File([b],name,{type:type||b.type});
  }
  const audioInput=document.querySelector('input[accept="audio/*"]');
  const videoInput=document.querySelector('input[accept="video/*"]');
  const audio=await fileFromUrl('/qa-media/audio.mp3','clean_seedance_instrumental_133bpm_14_95s.mp3','audio/mpeg');
  let dt=new DataTransfer();
  dt.items.add(audio);
  Object.defineProperty(audioInput,'files',{configurable:true,value:dt.files});
  audioInput.dispatchEvent(new Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,3500));
  const videos=await Promise.all(['/qa-media/clip-1.mp4','/qa-media/clip-2.mp4','/qa-media/clip-3.mp4'].map((u,i)=>fileFromUrl(u,`hf-clip-${i+1}.mp4`,'video/mp4')));
  dt=new DataTransfer();
  videos.forEach(f=>dt.items.add(f));
  Object.defineProperty(videoInput,'files',{configurable:true,value:dt.files});
  videoInput.dispatchEvent(new Event('change',{bubbles:true}));
  return {audio:audio.size, videos:videos.map(v=>v.size)};
})()
```

**Click-through checklist:**
1. Open `http://127.0.0.1:3000/?scene-split-qa=1`.
2. Click `Beat Split`.
3. Upload real audio and videos using the script above.
4. Wait until scene detection completes or fallback is displayed.
5. Confirm audio lane:
   - Shows `clean_seedance_instrumental_133bpm_14_95s.mp3`
   - BPM around 133
   - duration around 14.95s
   - audio element loaded and playable
6. Confirm video lane:
   - Shows 3 uploaded clips
   - Shows detected scene count or fallback scene count
   - Shows provenance: `PYSCENEDETECT` or `FALLBACK`
7. Click `Standard Split`.
   - Confirm split cards align to detected scenes.
8. Click `Beat Split`.
   - Confirm beat/onset segment list appears.
   - Confirm thumbnails/source refs use scene-aware data.
9. Click `COMMIT BEAT SPLIT`.
   - Confirm Shuffle/Join/Beat Join unlock.
10. Click `Shuffle`, `Join`, `Beat Join`.
    - Confirm no JS errors and preview data carries over.
11. Use browser visual screenshot/vision check.
12. Read browser console:
    - no uncaught JS errors
    - warnings allowed only if Splitter/Essentia fallback is explicit and UI reflects it.

**Commands:**
```bash
bun test
bun run typecheck
bun run build
```

**Expected:**
- Tests pass.
- Build passes.
- Browser UI works with real samples.
- No uncaught JS errors.

---

## Task 9: Reopen on the M3 Mac and ask user to verify

**Objective:** Put the verified app in front of the user only after our own browser QA passes.

**Command:**
```bash
ssh -o BatchMode=yes -o ConnectTimeout=8 robertspaniolo@m3 \
  '/usr/bin/open -a "Google Chrome" http://100.94.7.10:3000?scene-split-ready=1 && echo opened_chrome'
```

**Final user handoff should include:**
- What was implemented.
- Whether real Splitter Pro 2 or fallback was used during our verification.
- Exact browser QA results.
- Any limitations still present.
- Ask the user to click through the visible UI on the M3 and report visual issues.

---

## Risks / Open Questions

1. **Manifest field uncertainty:** Need one real Splitter result before writing the normalizer.
2. **Splitter processing latency:** Browser UI must show progress and not freeze.
3. **Cross-origin asset URLs:** Asset previews may need proxying if Splitter asset URLs block direct browser use.
4. **Large files:** Use the small recent clips already copied first; later optimize for large local videos.
5. **Fallback honesty:** If Splitter is unavailable, the UI must say fallback rather than pretending PySceneDetect ran.
6. **Beat vs scene conflict:** Beat Split should stay music-first. Scene cuts should inform source previews/boundaries but not wreck BPM sync.

---

## Definition of Done

- Real audio and 3 real Downloads clips load into the UI.
- Standard Split is scene-aware.
- Beat Split still follows the audio track and displays scene-aware video segment previews.
- Splitter provenance is visible.
- Tests/typecheck/build pass.
- Browser visual QA passes with uploaded samples and click-through across Beat Split, Standard Split, Shuffle, Join, Beat Join.
- Chrome is opened on the M3 Mac for user verification.
