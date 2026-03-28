"use client";

import { useEffect, useMemo, useState } from "react";
import { NAV } from "./studio/constants";
import { ProcessActionBar } from "./studio/ProcessActionBar";
import { buildReadout } from "./studio/readout";
import { BeatJoinTab } from "./studio/panels/BeatJoinTab";
import { BeatSplitTab } from "./studio/panels/BeatSplitTab";
import { JoinTab } from "./studio/panels/JoinTab";
import { RampTab } from "./studio/panels/RampTab";
import { ShuffleTab } from "./studio/panels/ShuffleTab";
import { SplitTab } from "./studio/panels/SplitTab";
import { StudioHeader } from "./studio/StudioHeader";
import { StudioRightPanel } from "./studio/StudioRightPanel";
import { StudioSidebar } from "./studio/StudioSidebar";
import { StudioStatusBar } from "./studio/StudioStatusBar";
import type { ColorGradient, JoinClip, RampPreset, ShuffleMode, Tab } from "./studio/types";

export default function StudioApp() {
  const [tab, setTab] = useState<Tab>("split");
  const [playhead, setPlayhead] = useState(0.08);
  const [activeClip, setActiveClip] = useState(2);

  const [gpu, setGpu] = useState(24);
  const [cpu, setCpu] = useState(11);
  const [vram, setVram] = useState(7.8);

  const [clipDur, setClipDur] = useState(5);
  const [barsPerSeg, setBarsPerSeg] = useState(2);
  const [bpm] = useState(130);
  const [sensitivity, setSensitivity] = useState(68);

  const [shuffleMode, setShuffleMode] = useState<ShuffleMode>("color");
  const [minScore, setMinScore] = useState(0.5);
  const [lookahead, setLookahead] = useState(3);
  const [keepPct, setKeepPct] = useState(70);
  const [colorGradient, setColorGradient] = useState<ColorGradient>("Sunset");

  const [joinClips, setJoinClips] = useState<JoinClip[]>(() =>
    Array.from({ length: 12 }, (_, i) => ({ id: i, on: true }))
  );

  const [minDur, setMinDur] = useState(0.12);
  const [maxDur, setMaxDur] = useState(0.8);
  const [energyResp, setEnergyResp] = useState(1.5);
  const [chaos, setChaos] = useState(0.35);
  const [onsetBoost, setOnsetBoost] = useState(0.6);
  const [energyReactive, setEnergyReactive] = useState(true);
  const [lowEnergyRange, setLowEnergyRange] = useState(0.36);
  const [highEnergyRange, setHighEnergyRange] = useState(0.68);

  const [rampPreset, setRampPreset] = useState<RampPreset>("dynamic");
  const [minSpeed, setMinSpeed] = useState(0.5);
  const [maxSpeed, setMaxSpeed] = useState(2.0);
  const [rampDur, setRampDur] = useState(0.5);
  const [energyThresh, setEnergyThresh] = useState(0.4);
  const [buildBoost, setBuildBoost] = useState(1.3);
  const [dropSlowdown, setDropSlowdown] = useState(0.6);

  const [progress, setProgress] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setPlayhead((p) => (p >= 0.97 ? 0.02 : p + 0.003)), 80);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setGpu((g) => Math.max(10, Math.min(48, g + (Math.random() - 0.5) * 3)));
      setCpu((c) => Math.max(5, Math.min(28, c + (Math.random() - 0.5) * 2)));
      setVram((v) => Math.max(5, Math.min(14, v + (Math.random() - 0.5) * 0.15)));
    }, 1400);
    return () => clearInterval(id);
  }, []);

  function runProcess() {
    if (isRunning) return;
    setIsRunning(true);
    setDone(false);
    setProgress(0);
    let p = 0;
    const id = setInterval(() => {
      p += Math.random() * 7 + 2;
      setProgress(Math.min(p, 100));
      if (p >= 100) {
        clearInterval(id);
        setIsRunning(false);
        setDone(true);
      }
    }, 160);
  }

  const readout = useMemo(
    () =>
      buildReadout({
        tab,
        clipDur,
        gpu,
        bpm,
        barsPerSeg,
        shuffleMode,
        minScore,
        lookahead,
        joinClips,
        minDur,
        maxDur,
        lowEnergyRange,
        highEnergyRange,
        chaos,
        onsetBoost,
        rampPreset,
        minSpeed,
        maxSpeed,
        rampDur,
      }),
    [
      tab,
      clipDur,
      gpu,
      bpm,
      barsPerSeg,
      shuffleMode,
      minScore,
      lookahead,
      joinClips,
      minDur,
      maxDur,
      lowEnergyRange,
      highEnergyRange,
      chaos,
      onsetBoost,
      rampPreset,
      minSpeed,
      maxSpeed,
      rampDur,
    ]
  );

  const tabLabel = NAV.find((n) => n.key === tab)?.label ?? "";
  const tabSub = NAV.find((n) => n.key === tab)?.sub ?? "";

  function handleSelectTab(t: Tab) {
    setTab(t);
    setDone(false);
    setProgress(0);
  }

  return (
    <div
      className="flex h-screen overflow-hidden bg-[#0a0a0a] text-[#c0c0c0] antialiased select-none"
      style={{ fontFamily: "'Inter','SF Pro Display',system-ui,sans-serif" }}
    >
      <StudioSidebar tab={tab} gpu={gpu} cpu={cpu} vram={vram} onSelectTab={handleSelectTab} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <StudioHeader tabLabel={tabLabel} tabSub={tabSub} playhead={playhead} bpm={bpm} />

        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto p-4 space-y-3">
            {tab === "split" && (
              <SplitTab
                playhead={playhead}
                bpm={bpm}
                clipDur={clipDur}
                activeClip={activeClip}
                onClipDur={setClipDur}
                onActiveClip={setActiveClip}
              />
            )}

            {tab === "beatsplit" && (
              <BeatSplitTab
                playhead={playhead}
                bpm={bpm}
                barsPerSeg={barsPerSeg}
                sensitivity={sensitivity}
                activeClip={activeClip}
                onBarsPerSeg={setBarsPerSeg}
                onSensitivity={setSensitivity}
                onActiveClip={setActiveClip}
              />
            )}

            {tab === "shuffle" && (
              <ShuffleTab
                playhead={playhead}
                bpm={bpm}
                shuffleMode={shuffleMode}
                minScore={minScore}
                lookahead={lookahead}
                keepPct={keepPct}
                colorGradient={colorGradient}
                activeClip={activeClip}
                onShuffleMode={setShuffleMode}
                onMinScore={setMinScore}
                onLookahead={setLookahead}
                onKeepPct={setKeepPct}
                onColorGradient={setColorGradient}
                onActiveClip={setActiveClip}
              />
            )}

            {tab === "join" && (
              <JoinTab
                playhead={playhead}
                bpm={bpm}
                joinClips={joinClips}
                activeClip={activeClip}
                onJoinClips={setJoinClips}
                onActiveClip={setActiveClip}
              />
            )}

            {tab === "beatjoin" && (
              <BeatJoinTab
                playhead={playhead}
                bpm={bpm}
                minDur={minDur}
                maxDur={maxDur}
                energyResp={energyResp}
                chaos={chaos}
                onsetBoost={onsetBoost}
                energyReactive={energyReactive}
                lowEnergyRange={lowEnergyRange}
                highEnergyRange={highEnergyRange}
                activeClip={activeClip}
                onMinDur={setMinDur}
                onMaxDur={setMaxDur}
                onEnergyResp={setEnergyResp}
                onChaos={setChaos}
                onOnsetBoost={setOnsetBoost}
                onEnergyReactive={setEnergyReactive}
                onLowEnergyRange={(value) => setLowEnergyRange(Math.min(value, highEnergyRange - 0.05))}
                onHighEnergyRange={(value) => setHighEnergyRange(Math.max(value, lowEnergyRange + 0.05))}
                onActiveClip={setActiveClip}
              />
            )}

            {tab === "ramp" && (
              <RampTab
                playhead={playhead}
                bpm={bpm}
                rampPreset={rampPreset}
                minSpeed={minSpeed}
                maxSpeed={maxSpeed}
                rampDur={rampDur}
                energyThresh={energyThresh}
                buildBoost={buildBoost}
                dropSlowdown={dropSlowdown}
                onRampPreset={setRampPreset}
                onMinSpeed={setMinSpeed}
                onMaxSpeed={setMaxSpeed}
                onRampDur={setRampDur}
                onEnergyThresh={setEnergyThresh}
                onBuildBoost={setBuildBoost}
                onDropSlowdown={setDropSlowdown}
              />
            )}

            <ProcessActionBar
              tab={tab}
              done={done}
              isRunning={isRunning}
              progress={progress}
              onRun={runProcess}
              onResetDone={() => setDone(false)}
            />
          </main>

          <StudioRightPanel readout={readout} tab={tab} shuffleMode={shuffleMode} />
        </div>

        <StudioStatusBar gpu={gpu} />
      </div>
    </div>
  );
}
