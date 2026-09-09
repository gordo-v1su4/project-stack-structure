import { reviewedEvidence } from "../helpers/storyEvidence";
import { describe, expect, test } from "bun:test";
import { prepareApprovedPlacements, buildEditPlanPreviewSegments, isPlacementPlanCurrent, type MusicVideoProject } from "@/components/studio/musicVideoProject";
import { mapStoryToMusic, suggestStoryMomentWindows } from "@/components/studio/storyMusicPlacement";
import { BrowserPreviewPlayer, getMasterAudioTimeForPosition } from "@/components/studio/previewPlayer";
import type { UploadedVideoSource } from "@/components/studio/types";
import type { StoryTreatment } from "@/components/studio/storyTreatments";

const sources = [{ id: 0, videoUrl: "https://media.example/dance.mp4", duration: 4, name: "dance" }] as UploadedVideoSource[];
function project(): MusicVideoProject {
  return { id: "test", duration: 10, song: { sourceLabel: "song", duration: 10, audioUrl: "", waveform: [], energy: [], beats: [0,2,4,6,8], onsets: [], sections: [{label:"Intro",start:0,end:10}] }, lyricChunks: [], reviewFindings: [],
    videoMoments: [{ id: "dance", sourceClipId: 0, label: "dance", caption: "A couple dancing together", mediaEvidence: reviewedEvidence({ focalSubjectCount: 2, actions: ["dancing"] }), start: 0, end: 4, duration: 4 }],
    storySections: [{ id: "intro", label: "Intro", prompt: "A couple dancing together", start: 0, end: 10, source: "manual", lyricChunkIds: [], videoMomentIds: ["dance"] }],
    editPlan: { id: "edit", createdAt: "fixed", timelineItems: [{ id: "item", sectionId: "intro", lyricChunkIds: [], videoMomentId: "dance", start: 0, end: 10, label: "Intro", prompt: "A couple dancing together" }] } };
}
describe("approved story placements", () => {
  test("nearby story and section boundaries retain every interval through playback", () => {
    const treatment = { anchors: [
      { id: "opening", songWindow: { start: 0, end: 4.02 } },
      { id: "arrival", songWindow: { start: 4.02, end: 9.99 } },
    ] } as StoryTreatment;
    const p = project();
    p.storySections = [
      { ...p.storySections[0]!, id: "intro", start: 0, end: 4 },
      { ...p.storySections[0]!, id: "verse", start: 4, end: 10 },
    ];
    const mapped = mapStoryToMusic(treatment, p.storySections, 10);
    expect(mapped.map(m => [m.start, m.end])).toEqual([[0, 4], [4, 4.02], [4.02, 9.99], [9.99, 10]]);
    p.editPlan.timelineItems = mapped.map(m => ({ id: m.id, sectionId: m.sectionId, start: m.start, end: m.end, label: m.momentId, prompt: "", lyricChunkIds: [], videoMomentId: null }));
    const prepared = prepareApprovedPlacements({ project: p, videoSources: sources });
    const cuts = buildEditPlanPreviewSegments({ project: prepared, videoSources: sources });
    expect(cuts.map(c => [c.musicStart, c.musicEnd])).toEqual(mapped.map(m => [m.start, m.end]));
    const player = new BrowserPreviewPlayer({ warmSourceLimit: 0 });
    player.load(cuts);
    expect(player.getState().totalDuration).toBe(10);
    expect(cuts.every(c => c.kind === "gap")).toBe(true);
  });
  test("suggested moment boundaries snap to nearby music cues", () => {
    const treatment = { anchors: [{id:"a"}, {id:"b"}] } as StoryTreatment;
    expect(suggestStoryMomentWindows(treatment, 20, [10.2])[0]!.end).toBe(10.2);
  });
  test("sparse cues cannot consume a following short story moment", () => {
    const treatment = { anchors: [1, 1, 98].map((durationSeconds, index) => ({ id: `m${index}`, requirements: [{id: `r${index}`, durationSeconds}] })) } as StoryTreatment;
    const windows = suggestStoryMomentWindows(treatment, 100, [2.5]);
    expect(windows.map(({start,end}) => [start,end])).toEqual([[0,1],[1,2.5],[2.5,100]]);
    const mapped = mapStoryToMusic(treatment, [{id:'song',label:'Song',prompt:'',start:0,end:100}], 100, [2.5]);
    expect(mapped).toHaveLength(3);
    expect(mapped.every(placement => placement.end > placement.start)).toBe(true);
  });
  test("automatic moments fit between fixed windows without shifting later story timing", () => {
    const treatment = { anchors: [{ id: "opening", songWindow: { start: 0, end: 2 } }, { id: "arrival" }, { id: "dance" }, { id: "escape", songWindow: { start: 8, end: 10 } }] } as StoryTreatment;
    const windows = suggestStoryMomentWindows(treatment, 10);
    expect(windows.map(({start,end}) => [start,end])).toEqual([[0,2],[2,5],[5,8],[8,10]]);
  });
  test("faithful edit consumes real source once and preserves uncovered song duration", () => {
    const prepared = prepareApprovedPlacements({project: project(), videoSources:sources});
    const cuts = buildEditPlanPreviewSegments({project: prepared, videoSources:sources});
    expect(cuts.reduce((sum,cut)=>sum+cut.musicEnd-cut.musicStart,0)).toBe(10);
    expect(cuts.filter(cut=>cut.kind==='source').reduce((sum,cut)=>sum+cut.endTime-cut.startTime,0)).toBe(4);
    expect(cuts.filter(cut=>cut.kind==='gap').reduce((sum,cut)=>sum+cut.musicEnd-cut.musicStart,0)).toBe(6);
    expect(isPlacementPlanCurrent(prepared)).toBe(true);
  });
  test("stale story cannot rerank on playback and returns timed review gaps", () => {
    const prepared = prepareApprovedPlacements({project: project(), videoSources:sources});
    prepared.storySections[0]!.prompt = "Diego arrives alone";
    expect(isPlacementPlanCurrent(prepared)).toBe(false);
    expect(buildEditPlanPreviewSegments({project:prepared,videoSources:sources}).every(cut=>cut.kind==='gap')).toBe(true);
  });
  test("explicit best effort permits repetition while faithful original stays unchanged", () => {
    const original = prepareApprovedPlacements({project:project(),videoSources:sources});
    const repeated = prepareApprovedPlacements({project:original,videoSources:sources,policy:'best-effort'});
    expect(original.placementPlan!.policy).toBe('faithful');
    expect(repeated.placementPlan!.placements.some(cut=>cut.kind==='gap')).toBe(false);
    expect(original.placementPlan!.placements.some(cut=>cut.kind==='gap')).toBe(true);
  });
  test("browser keeps gap entries and master-song offsets", () => {
    const prepared = prepareApprovedPlacements({project:project(),videoSources:sources});
    const cuts = buildEditPlanPreviewSegments({project:prepared,videoSources:sources});
    const player = new BrowserPreviewPlayer({warmSourceLimit:0});
    player.load(cuts);
    expect(player.getState().totalDuration).toBe(10);
    expect(player.getState().segmentCount).toBe(cuts.length);
    const gap = cuts.findIndex(cut=>cut.kind==='gap');
    expect(getMasterAudioTimeForPosition(cuts,gap,1)).toBe(cuts[gap]!.musicStart+1);
  });
  test("explicit narrative windows support multiple moments per section and spanning sections", () => {
    const treatment = { anchors: [{id:'opening',songWindow:{start:0,end:3}}, {id:'dance',songWindow:{start:3,end:12}}] } as StoryTreatment;
    const mapped = mapStoryToMusic(treatment,[{id:'verse',label:'Verse',prompt:'',start:0,end:6},{id:'chorus',label:'Chorus',prompt:'',start:6,end:12}],12);
    expect(mapped.map(p=>[p.momentId,p.sectionId,p.start,p.end])).toEqual([['opening','verse',0,3],['dance','verse',3,6],['dance','chorus',6,12]]);
  });
});
