import { isPlacementPlanCurrent, type ApprovedPlacement, type MusicVideoProject } from "./musicVideoProject";
import type { SongRange } from "./reviewSelection";

export interface PacingProposal {
  snapshot: string;
  context: string;
  cues: number[];
  protectedRanges: SongRange[];
  placements: ApprovedPlacement[];
  conflicts: string[];
  gaps: string[];
  changed: boolean;
}

/** Conservative pacing: retained footage and manually opened holes are immutable.
 * Only unbound empty windows get a new cue map; replacement remains a review action. */
export function preparePacingProposal(project: MusicVideoProject, cues: number[], protectedRanges: SongRange[], context: string): PacingProposal {
  if (!project.placementPlan || !isPlacementPlanCurrent(project)) throw new Error("The current cut needs reconciliation before preparing pacing.");
  const plan = project.placementPlan;
  const conflicts: string[] = [];
  const gaps: string[] = [];
  const placements: ApprovedPlacement[] = [];
  const reserved = new Set(plan.placements.map(p => p.id));
  const ordered = [...plan.placements].sort((a, b) => a.songStart - b.songStart);
  const protectedPlacement = (p: ApprovedPlacement) => p.kind === "source" || p.origin === "manual-match"
    || protectedRanges.some(r => r.start < p.songEnd && r.end > p.songStart);
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i];
    const label = `${p.label} · ${p.songStart.toFixed(3)}–${p.songEnd.toFixed(3)}s`;
    if (protectedPlacement(p)) {
      placements.push(structuredClone(p));
      const inside = cues.filter(t => t > p.songStart + 0.001 && t < p.songEnd - 0.001);
      if (inside.length) conflicts.push(`${label}: ${inside.length} suggested boundaries conflict with a retained take, trim or shot binding; kept unchanged.`);
      if (p.kind === "gap") gaps.push(`${label}: ${p.reason ?? "No selected footage"}. Shot binding retained; review targeted replacement.`);
      continue;
    }
    let end = p.songEnd;
    while (i + 1 < ordered.length) {
      const next = ordered[i + 1];
      if (protectedPlacement(next) || next.timelineItemId !== p.timelineItemId || Math.abs(next.songStart - end) > 0.001) break;
      end = next.songEnd;
      i++;
    }
    const boundaries = [...new Set(cues.filter(Number.isFinite))].sort((a, b) => a - b)
      .filter(t => t >= p.songStart + 1 && t <= end - 1)
      .reduce<number[]>((all, t) => !all.length || t - all.at(-1)! >= 1 ? [...all, t] : all, []);
    let start = p.songStart;
    for (const [index, stop] of [...boundaries, end].entries()) {
      let id = `${p.id}:pace:${plan.revision + 1}:${index}`;
      while (reserved.has(id)) id += ":new";
      reserved.add(id);
      placements.push({ ...p, id, songStart: start, songEnd: stop, sourceStart: 0, sourceEnd: stop - start });
      gaps.push(`${p.label} · ${start.toFixed(3)}–${stop.toFixed(3)}s: ${p.reason ?? "No suitable selected footage"}. Review targeted replacement.`);
      start = stop;
    }
  }
  // Keep exact IDs when the proposed boundaries have not changed.
  const timing = (rows: ApprovedPlacement[]) => rows.map(row => ({ ...row, id: undefined }));
  const changed = JSON.stringify(timing(placements)) !== JSON.stringify(timing(ordered));
  return { snapshot: JSON.stringify(project), context, cues: [...cues], protectedRanges: structuredClone(protectedRanges),
    placements: changed ? placements : structuredClone(ordered), conflicts, gaps, changed };
}

export function applyPacingProposal(project: MusicVideoProject, proposal: PacingProposal, context: string): MusicVideoProject {
  if (JSON.stringify(project) !== proposal.snapshot || context !== proposal.context) throw new Error("The cut, take selection or references changed. Prepare a new pacing proposal.");
  const checked = preparePacingProposal(project, proposal.cues, proposal.protectedRanges, context);
  if (JSON.stringify(checked) !== JSON.stringify(proposal)) throw new Error("The pacing proposal changed. Prepare it again.");
  if (!checked.changed) return project;
  return { ...project, generationScope: undefined, faithfulPlacementPlan: undefined,
    placementPlan: { ...project.placementPlan!, revision: project.placementPlan!.revision + 1, placements: checked.placements } };
}
