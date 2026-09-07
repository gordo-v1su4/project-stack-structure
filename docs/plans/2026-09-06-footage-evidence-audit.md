# Footage and music evidence audit — September 6, 2026

Reviewed the saved six-source, 42-scene ingest baseline at
`.tmp/e2e-validation/studio-browser-20260906/ingest-complete-project.json`.
The test oracle is `tests/fixtures/story-evidence/six-video-review.json`.
Source checksums are included. Exactly 126 frames were extracted from the original
six local videos at the stored first/middle/last timestamps and visually inspected.
The seven labeled review sheets and extraction script are in
`.tmp/e2e-validation/story-evidence-audit/`.

This is a frame-sampled audit, not proof that every temporal action in every
scene was watched in full. Question marks in the oracle mean identity is uncertain.
No user captions or project state were overwritten. This is evidence for regression
cases and targeted correction, not a fabricated model response.

## Findings that change matching behavior

- Source 1, scene 3: the handstand performer wears black and is a different
  foreground dancer. Diego remains farther back. The stored caption assigns the
  handstand to Diego incorrectly.
- Source 1, scene 7 and source 5, scene 1: the metallic-red-dress singer is a
  separate performer, not the Valentina reference. The latter scene also cuts to
  Diego and Valentina; a single caption merges distinct people/actions.
- Source 4, scene 0 visibly has a fractured floor and concrete debris. Its caption
  describes only dynamic dancing. Sources 4 and 5 have several performance captions
  that omit this physical state. Such material cannot silently cover an intact
  club opening, but could serve an intentionally chosen disaster cold open.
- Source 6, scene 12 is a close shoulder/ear/jewelry crop. It does not establish
  Valentina's back or dancing, despite the stored caption. Source 6, scene 16
  cuts from jewelry macro to a crowd; it is not one image of a floating earring
  over the crowd. Door seam details are a red riveted door, not a concrete wall.
- Source 3, scene 0 and an early portion of source 2 show a focal man moving
  through the crowd. This supports some arrival-like editorial possibilities,
  but not an exterior threshold, a jungle location, or an intent to search.
- No sampled scene supplies the requested jungle/cave exterior establishing image.
  This remains a genuine missing shot; the generator must receive that request
  without an arbitrary disaster composition frame.
- Detected scenes can span multiple edits: source 1 scenes 4/6, source 3 scene 1,
  source 4 scenes 1/2, source 6 scenes 15/16. Scene-level labels do not prove every
  action over the entire duration. Precise placement needs an inspected sub-range
  or further shot segmentation; repeating a mixed scene is not valid coverage.

## Caption request audit and implemented repair

Initial upload uses a prepared first/middle/last storyboard from the scene worker.
The browser rerun also uses that storyboard where available, with a source-frame
fallback. The old smart prompt inherited “single video frame” wording and forbidden
uncertainty from the fast model prompt. The new prompt states the actual input
kind and timestamps, asks for factual structured evidence, and retains unknowns.

The gateway source `proxmox-home/infra/rustfs/caption-gateway/app.py` discarded all
but legacy caption fields. The app's Trigger batch merge also ignored gateway
`meta` and attempted to parse the already-clean natural-language text as JSON.
Both adapters now preserve structured evidence. Source ranges and durable frame
storage references are attached by the application; the model cannot invent them.
Previous captions remain in history on successful recaption. Legacy captions remain
readable, with no silent promotion to verified structured observations.

Queued recaption accepts an authoritative `isCurrent` callback. Changed source or
visual-reference revisions suppress the old callback and stop later persistence
dispatch; story prose alone does not demand re-captioning source observations.
The revision guard accepts its own detection updates so new scene intervals do not
invalidate the running pipeline. The Studio integration supplies current state,
not a captured stale value. An upload already in flight may still finish, but its
stale callback is rejected; Trigger caption artifacts use revision-specific keys.

## Music labels: actual algorithm found

The local `essentia-endpoint/services/analysis.py` computes MFCCs and tries SBic
boundary detection. If no usable boundary is found, `generate_fallback_boundaries`
uses a 15-second intro cap, a 20-second outro cap, and equally divided middle
sections based on roughly 30 seconds each. The saved baseline boundaries exactly
match that fallback formula for a 246.69995-second song.

The naming code uses location in the song and mean energy: more than 1.1 times
average is labeled chorus; most other material becomes verse, with a middle-song
bridge heuristic. It does not establish verse/chorus recurrence from musical or
lyrical repetition. The four-verses/three-choruses pattern is therefore provisional
heuristic labeling. This audit does not invent the correct replacement form.
The app now retains editable boundaries and labels these as estimates. Section
provenance survives Trigger and browser normalization. Explicit service fallback
metadata is distinguished from a boundary-pattern inference; a matching pattern
does not claim proof of the remote algorithm. Legacy projects receive the same
honest estimated notice when the section editor opens. Missing section analysis
creates a neutral editable “Section”, rather than an invented intro.
The remote deployed Essentia source has not been compared in this audit.

## Scoped checks

- Caption/evidence/recovery/server/batch/rerun tests: 35 passed before the final
  revision-guard additions; focused evidence/music/audio tests then passed 22/22,
  including owned-detection publication, changed-reference rejection, baseline
  fallback fingerprint, nested metadata, and missing-analysis behavior.
- Gateway parser tests: 3 passed without importing or invoking GPU services.
- Targeted ESLint passed for caption changes and the music provenance changes.
- The machine-readable review records all 42 saved scene intervals and their
  three inspected source timestamps. Its observations are human review labels,
  not claimed results from the upgraded model.

## Remaining live gates

- Compare/deploy the scoped gateway parser change and app/Trigger adapters.
  Runtime overrides of `QWEN_MAX_TOKENS=320` need at least 900 to fit evidence JSON.
- Run a targeted three-reference scene request and inspect evidence in persisted
  results. No complete six-video recaption was run by this audit.
- Recheck uncertain identities/actions against full local video before treating
  them as approved source requirements or approving mixed-scene intervals.
- Validate the same missing opening and contradicted-action cases in the actual
  visible Studio flow, including reload and delayed-result handling.
