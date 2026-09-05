"use client";

import { useMemo, useState } from "react";

import { createMusicVideoProject } from "@/components/studio/musicVideoProject";
import {
  createDefaultStoryTabState,
  StoryTab,
  type StoryTabState,
} from "@/components/studio/panels/StoryTab";

const LOVE_ME_TONIGHT_STORY_SEED = "Diego and Valentina are strangers moving independently through a hidden underground maze of tunnels, dance rooms, and increasingly dangerous chambers. Each is casually looking for someone capable of matching them. They pass unexpectedly, both realize too late that the other may be the one, and begin searching through the shifting complex until they almost back into one another. They finally dance together in the central arena while floors split, rooms collapse, and dancers continue until they fall. Only near the end may the audience realize this is a last-dancer-standing simulation or game.";
import { hydrateTreatmentCoverage, parseGeneratedTreatments } from "@/components/studio/storyTreatments";
import type { BeatJoinAnalysis, UploadedVideoSource } from "@/components/studio/types";

const analysis: BeatJoinAnalysis = {
  sourceLabel: "Love Me Tonight.wav",
  audioUrl: "",
  waveform: [],
  energy: [0.2, 0.45, 0.75, 0.95],
  beats: Array.from({ length: 32 }, (_, index) => index * 2),
  onsets: Array.from({ length: 48 }, (_, index) => index * 1.25),
  sections: [
    { label: "Intro", start: 0, end: 10, energy: 0.2 },
    { label: "Verse", start: 10, end: 22, energy: 0.45 },
    { label: "Pre-Chorus", start: 22, end: 30, energy: 0.65 },
    { label: "Chorus", start: 30, end: 44, energy: 0.9 },
    { label: "Bridge", start: 44, end: 54, energy: 0.75 },
    { label: "Outro", start: 54, end: 64, energy: 1 },
  ],
  duration: 64,
};

const captions = [
  "Diego dances alone in a crowded underground room, scanning the other dancers.",
  "Valentina crosses behind a male dancer; both look back after passing without stopping.",
  "A woman searches through a narrow industrial corridor between separate dance rooms.",
  "Two dancers nearly collide back to back, turn, and recognize one another.",
  "The couple dances in a central arena while the cracked floor splits around the crowd.",
  "Dancers keep moving as pieces of the room collapse into a dark void.",
];

const videoSources: UploadedVideoSource[] = captions.map((caption, index) => ({
  id: index,
  name: `fixture-${index + 1}.mp4`,
  duration: 6,
  size: 1_000,
  thumbnailUrl: "",
  videoUrl: "",
  storageProvider: "rustfs",
  storageBucket: "fixture",
  storagePath: `fixture/${index + 1}.mp4`,
  storageStatus: "uploaded",
  sceneStatus: "ready",
  captionStatus: "ready",
  scenes: [{
    id: index + 1,
    sourceClipId: index,
    label: `Scene ${index + 1}`,
    start: 0,
    end: 6,
    duration: 6,
    detector: "pyscenedetect-adaptive",
    caption,
    captionMeta: { caption, action: caption, setting: "underground dance complex", subjects: index >= 3 ? ["Diego", "Valentina", "dancers"] : ["dancer"] },
  }],
}));

const transcriptSummary = {
  provider: "deepgram" as const,
  model: "nova-3",
  duration: 64,
  confidence: 0.94,
  transcript: "Love me tonight, find me in the light, keep moving until the room falls away.",
  wordCount: 15,
  chunks: [
    { index: 1, start: 0, end: 22, text: "Love me tonight" },
    { index: 2, start: 22, end: 44, text: "Find me in the light" },
    { index: 3, start: 44, end: 64, text: "Keep moving until the room falls away" },
  ],
  srt: "",
  summary: "A plea to find and hold onto someone through one dangerous night.",
  topics: [],
  intents: [],
  sentiments: null,
  averageSentiment: null,
  entities: [],
  warnings: [],
};

const generatedTreatments = parseGeneratedTreatments({
  treatments: [
    treatment("faithful", "The One Across the Maze", "Two strangers pass inside a maze of underground dance rooms, search for one another, and reunite in a collapsing central arena.", "They turn back-to-back at the final possible moment, then the arena reveals itself as a last-dancer-standing simulation."),
    treatment("bold", "Rooms That Choose", "An underground club rearranges its rooms around two strangers whose movement suggests they could become an unbeatable pair.", "The architecture opens only when they dance in sync, revealing that the maze—not the crowd—has been judging them."),
    treatment("wildcard", "Last Dance Protocol", "A missed connection becomes a survival chase through an underground dance tournament whose rules remain invisible until the floor begins taking dancers.", "Valentina faces the final choice: pull Diego up from the ledge or become the sole winner."),
  ],
});

export function StoryDevelopmentFixture() {
  const fixtureProject = useMemo(() => createMusicVideoProject({
    analysis,
    duration: analysis.duration,
    lyricChunks: transcriptSummary.chunks,
    storyDrafts: createDefaultStoryTabState().storyBeats,
    videoSources,
    segmentPreviews: [],
  }), []);
  const [state, setState] = useState<StoryTabState>(() => ({
    ...createDefaultStoryTabState(),
    vocalStemName: "Love Me Tonight - vocals.wav",
    transcriptSummary,
    brief: { text: LOVE_ME_TONIGHT_STORY_SEED },
    treatments: hydrateTreatmentCoverage(generatedTreatments, fixtureProject.videoMoments),
    generationMeta: { model: "gpt-5.4-mini", generatedAt: "2026-09-02T12:00:00.000Z" },
  }));
  return (
    <main className="min-h-screen bg-black p-4 text-zinc-200">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-3 border border-[#283024] bg-[#071007] px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-[#79c779]">Development-only Story verification · synthetic captions · no API call or paid generation</div>
        <StoryTab analysis={analysis} audioStatus="Ready" videoSources={videoSources} segmentPreviews={[]} state={state} onStateChange={setState} />
      </div>
    </main>
  );
}

function treatment(kind: "faithful" | "bold" | "wildcard", title: string, logline: string, endingHook: string) {
  const anchorCopy = [
    ["Arrival below", "Diego and Valentina independently descend from the surface into a hidden maze of tunnels and dance rooms."],
    ["Separate rooms", "They move through different crowded rooms, each casually assessing who might be able to match their movement."],
    ["The missed pass", "They pass unexpectedly, keep walking, then look back too late and lose one another in the crowd."],
    ["Search pressure", "Their casual search becomes desperate as corridors narrow and the underground rooms begin to shift and fail."],
    ["Back-to-back", "They nearly back into one another in the central chamber and finally turn into the same dance."],
    ["The floor gives way", "They dance together while the arena fractures, dancers fall, and the true survival stakes emerge."],
  ];
  return {
    id: kind,
    kind,
    title,
    logline,
    synopsis: `${logline} The sequence stays performance-led, using the maze as a clear visual progression rather than a dialogue-heavy plot.`,
    visualThesis: "Hard pools of amber light separate dancers by room until the final arena unifies movement and destruction.",
    endingHook,
    expectedReusePercent: 78,
    expectedGenerationPercent: 22,
    anchors: anchorCopy.map(([anchorTitle, description], index) => ({
      id: `${kind}-${index + 1}`,
      title: anchorTitle,
      description,
      purpose: index === 0 ? "Establish the hidden world and its maze geography." : "Advance the stranger search through movement and escalating danger.",
      generationPrompt: `${description} Cinematic 16:9 music-video frame, underground practical lighting, performance-first staging.`,
    })),
  };
}
