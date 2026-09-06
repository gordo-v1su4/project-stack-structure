# Studio UI todo — deferred until technical E2E is complete

Captured from the user's nine production-browser comments on 2026-09-06.
Finish the six-video walkthrough and technical repairs before implementing
these changes. Keep this list open as further stages are reviewed.

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

Validate these changes against DESIGN.md and the actual populated project.
Preserve musical alignment, readable status, keyboard access, and the ability
to inspect errors. Do not substitute visual polish for verified pipeline work.
