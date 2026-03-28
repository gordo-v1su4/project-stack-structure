export function getClipPalette(idx: number): string[] {
  const palettes = [
    ["#c94a2a", "#e07030", "#d4a050", "#8a3020"],
    ["#2a4a8a", "#3060b0", "#1a8090", "#204060"],
    ["#3a8a3a", "#60a840", "#2a6020", "#80c060"],
    ["#8a2a6a", "#b04080", "#602050", "#d060a0"],
    ["#8a7020", "#c0a030", "#604010", "#e0c050"],
    ["#2a6a7a", "#40a0b0", "#1a4050", "#60c0d0"],
    ["#6a3a1a", "#a06030", "#402010", "#c08050"],
    ["#4a2a8a", "#7040c0", "#301060", "#9060e0"],
    ["#7a2a2a", "#b04040", "#501010", "#e06060"],
    ["#2a5a2a", "#409040", "#1a3010", "#60b060"],
    ["#5a4a1a", "#907830", "#3a2a08", "#c0a850"],
    ["#1a4a6a", "#2870a0", "#0a2030", "#4090c0"],
  ];
  return palettes[idx % palettes.length];
}

export function getMotionDir(idx: number): { dir: string; angle: number; label: string } {
  const dirs = [
    { dir: "→", angle: 0, label: "PAN R" },
    { dir: "←", angle: 180, label: "PAN L" },
    { dir: "↑", angle: 270, label: "TILT U" },
    { dir: "↓", angle: 90, label: "TILT D" },
    { dir: "↗", angle: 315, label: "DIAG UR" },
    { dir: "↙", angle: 135, label: "DIAG DL" },
    { dir: "↘", angle: 45, label: "DIAG DR" },
    { dir: "↖", angle: 225, label: "DIAG UL" },
    { dir: "⟳", angle: -1, label: "ROTATE" },
    { dir: "⤢", angle: -2, label: "ZOOM IN" },
    { dir: "⤡", angle: -3, label: "ZOOM OUT" },
    { dir: "⊕", angle: -4, label: "STATIC" },
  ];
  return dirs[idx % dirs.length];
}
