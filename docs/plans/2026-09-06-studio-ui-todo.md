# Studio UI todo — deferred until technical E2E is complete

Captured from the user's nine production-browser comments on 2026-09-06.
Finish the six-video walkthrough and technical repairs before implementing
these changes. Keep this list open as further stages are reviewed.

**Preserve the expandable library upload section.** The user explicitly likes
it. Removing the crowd references from this test is a content-selection change,
not a request to remove the library or its expand/collapse interaction.

- [ ] **1 · Beat spine:** restore the waveform gradient; inspect the previous
  implementation and match the intended visual treatment.
- [ ] **2 · Ingest feedback:** remove the cluttered checklist from the main
  canvas. Put readiness, current activity, and actionable errors in the right
  panel with a more restrained presentation.
- [ ] **3 · Master song:** greatly reduce the completed upload card's height
  and remove explanations of backend analysis that users do not need.
- [ ] **4 · Reference identity:** align image cards and have Qwen VL read names
  from reference sheets when present. Keep the detected name editable and make
  uncertainty explicit; do not hardcode Diego or infer names without evidence.
  The Diego field in this E2E draft was manually entered by the assistant.
- [ ] **5 · Reference headings:** remove repeated requirements, descriptions,
  and nested headings in the References section.
- [ ] **6 · Reference alignment:** use single-line descriptions or a consistent
  fixed header height so all image top edges align across the row.
- [ ] **7 · Reference controls:** make the cards and name/kind/prompt controls
  more compact and visually polished, with secondary controls disclosed only
  when needed.
- [ ] **8 · Audio layout:** place the vocal stem beside the master-song upload
  as a coherent audio section, with an appropriate stacked small-screen layout.
- [ ] **9 · Right drawer:** clarify its role throughout import and subsequent
  stages. Show live Trigger.dev job status and useful errors; let the drawer
  collapse toward the right edge and reopen predictably.
  The user requested immediate restoration of the existing live feed during
  the technical walkthrough; that wiring repair proceeds now. Drawer redesign
  and the remaining visual changes stay deferred.
- [ ] **10 · Reference image preparation (later):** automatically resize and
  standardize reference-sheet dimensions and delivery formats. Preserve the
  uploaded originals; create derivatives appropriate for display and each
  analysis/generation provider. Preserve aspect ratio without cropping sheet
  panels, and keep names, faces, identity details, and environment labels
  readable. Define pixel and byte limits from provider contracts, validate the
  prepared output before dispatch, and show a concise preparation status.
  This follows the observed 25 MiB Qwen limit; final standard sizes still need
  to be chosen against the actual sheets and provider requirements.

- [ ] **11 · Source preview player (later):** replace generic browser controls,
  the harsh white seek bar, and native volume icons with restrained controls
  matching the studio. Remove repetitive timecode displays. Keep one clear
  readout in seconds plus frame position and FPS; use the actual source frame
  rate rather than the current hardcoded 24 fps. Preserve seeking, volume,
  fullscreen, keyboard access, and visible playback errors. The popup's
  viewport-centering bug is repaired during technical E2E; player styling is
  explicitly deferred at the user's request.

- [ ] **12 · Scene/caption layout (later):** simplify the busy per-video cut
  groups in `#ingest-step-captions`. Reduce nested borders, repeated filenames,
  status labels, model names, and competing frame thumbnails. Make source groups
  and individual cuts easy to scan; disclose technical details and secondary
  actions on demand while preserving caption editing, search, frame inspection,
  and merge controls. Captured from the S1 group in the six-video walkthrough.

- [ ] **13 · Captioning speed options (later):** review ways to reduce captioning
  time on the home server after the technical walkthrough. Measure queue time
  and processing time before comparing batching, concurrency, model choices,
  caching, and optional alternative compute. Explain quality, resource, and cost
  tradeoffs before selecting changes. The current speed is acceptable for now;
  keep the current server and captioning setup for this walkthrough.

- [ ] **14 · Section-focused timeline zoom (later):** the full-song cut strip is
  too dense and confusing with 113 cuts. Add a clear way to zoom into one song
  section, move between sections, and return to the full-song overview. Keep
  cut selection and playback position consistent across zoom levels.
- [ ] **15 · Collapsible program monitor (promoted to immediate fix):** restore a compact drawer or
  footer presentation when the monitor is unused, with an explicit expand/focus
  action. Its current location is acceptable, but the large empty black region
  should not occupy the workspace. Preserve playback state when minimizing and
  restoring; make idle, preparing, ready, and failed states understandable.
  Implemented compact-by-default monitor with Show preview, Collapse preview,
  and existing Focus/Dock controls. Player stays mounted while collapsed.
  Production interaction verification pending.

- [ ] **16 · Split → Match → Generate → Join flow (later):** review the sequence
  as one user journey. The current transitions feel awkward and the overall UI
  is confusing. Clarify each step's purpose, what changes automatically, what
  needs a user decision, and what happens next. Reduce repeated controls and
  competing timelines; make optional generation and the approved edit's handoff
  into Join easy to understand. Consider simplifying or combining surfaces
  while preserving source inspection, musical alignment, and explicit approval
  of generated footage before it enters the edit.

Validate these changes against DESIGN.md and the actual populated project.
Preserve musical alignment, readable status, keyboard access, and the ability
to inspect errors. Do not substitute visual polish for verified pipeline work.


- [ ] **17 · Image prompt consistency and provider comparison (later):** revisit
  reference-packet design and concise prose versus structured JSON prompting.
  Compare the user-supplied Nano Banana/ChatGPT examples for identity, red haze,
  contrast and blotchiness. Preserve the current application prompt template
  during the technical walkthrough. The exact successful five-reference prompt,
  supplied outputs, provenance limits and import-layout issue are recorded in
  [the image prompt review](2026-09-06-image-prompt-review.md).
