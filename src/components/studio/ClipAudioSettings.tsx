"use client";
import { clipAudioKey, type ClipAudioSettings as Settings } from "./clipAudio";
import type { UploadedVideoSource } from "./types";

export function ClipAudioSettings({ value, sources, disabled, onChange }: {
  value: Settings; sources: UploadedVideoSource[]; disabled: boolean; onChange: (value: Settings) => void;
}) {
  return <details className="rounded-md border border-line bg-ink-1 px-3 py-2 text-sm">
    <summary className="cursor-pointer">Audio · Use clip audio: {value.useClipAudio ? "On" : "Off"}</summary>
    <fieldset disabled={disabled} className="mt-3 space-y-3">
      <label className="flex items-center gap-2"><input type="checkbox" checked={value.useClipAudio}
        onChange={event => onChange({ ...value, useClipAudio: event.target.checked })} />Use clip audio</label>
      <p className="text-xs text-fg-3">The master song plays throughout the edit. Enable clip audio to mix source sound with the song. Original uploads are preserved.</p>
      {sources.map(source => { const key = clipAudioKey(source); return <label key={key} className="flex items-center justify-between gap-3">
        <span className="truncate text-xs" title={source.name}>{source.name}</span>
        <select aria-label={`Clip audio for ${source.name}`} className="rounded border border-line bg-ink-2 px-2 py-1"
          value={Object.hasOwn(value.overrides, key) ? value.overrides[key] ? "on" : "off" : "inherit"}
          onChange={event => { const overrides = { ...value.overrides }; if (event.target.value === "inherit") delete overrides[key]; else overrides[key] = event.target.value === "on"; onChange({ ...value, overrides }); }}>
          <option value="inherit">Project ({value.useClipAudio ? "On" : "Off"})</option><option value="on">On</option><option value="off">Off</option>
        </select>
      </label>; })}
    </fieldset>
  </details>;
}
