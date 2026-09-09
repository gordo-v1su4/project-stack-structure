# Footage matching review — September 8, 2026

## State and scope

Project: `Assembly recovery · 2026-09-08` (`5fc48d59-01e4-4bfb-90c1-e054a0307575`). Only the Diego story is confirmed. Existing exact source matches and the 29-placement arrangement remain provisional. This review does not apply new selections, approve trims, or rebuild the saved cut.

The current library contains 11 uploads and 57 detected scenes. Local source files were located in the canonical checkout's `.local-fixtures/media`; their names and byte sizes match the saved source metadata. Local SHA-256 values are recorded, but were not compared against remote object hashes. Originals were not modified. Scene first/middle/last triplets were extracted at 10%, 50% and 90% of each interval and all ten sheets were inspected during this task. These samples establish useful candidate roles, not exact action continuity or every internal cut.

Local evidence in the 632b checkout: `.tmp/matching-review/fixture-manifest.json`, `scene-index.json`, `sheet-01.jpg` through `sheet-10.jpg`, and `contact-sheets.py`. These ignored artifacts do not travel with Git. Source and scene numbers below use the UI's one-based labels; persisted scene IDs can contain gaps.

## Candidate roles and observations

| Role | Available candidates | Review needed before placement |
| --- | --- | --- |
| Establishing | S7 scenes 1–4: sunset jungle/cave, people approaching the entrance, passage and interior crowd | Review movement between the wider cave and advancing crowd. Do not assume those people establish Diego arriving alone. |
| Solo arrival / inserts | Early S2 scene 1 and S3 scene 1 show the lead man moving through a crowd before the pair appears. S6 scene 4 has corridor detail followed by a solo man; scene 5 isolates the woman. | Determine exact source windows. Whole scenes can include a second person or an internal cut, so a scene-wide caption does not prove a solo trim. |
| Meeting / connection | S2 scene 2 (8.917–10.917s), scene 3 (10.917–15.042s); S3 scenes 2–3; selected parts of S1 | Compare the actual performances and internal cuts. The saved two-second S2 selection is not the only option. |
| Performance / crowd / inserts | S1 feet, group dancing and separate singer; S8 scene 1 and the beginning of scene 2; S6 footwear, chain, door and crowd details | Keep the singer unnamed. Performance can support the edit without being labeled Valentina or evidence of a story event. |
| Fracture / destruction | S4 has broken floor and the pair moving across it; S5 has running/leaping around debris; S8 scene 2 changes from singer to floor collapse; S9 shows spreading cracks; S10 shows floor buckling and fleeing people | Existing captions understate damage in S4. Inspect the singer-to-collapse transition in S8 to find the usable earthquake interval the user identified. |
| Escape | S5 scene 4 ends with travel toward a red exit; S6 corridor, door, running feet and pair-running shots, especially scenes 18 and 20; S10 scenes 3–4; S11 scenes 1–2 and 4 | Review subject travel and camera movement at the actual joins. S11's corridor running and falling debris are poorly represented by captions describing dancing or celebrating. |
| Ending | S6 scene 21 offers a warm crowd/performance view | This does not establish the pair together safely after escape. A genuine ending hole may remain; do not call unrelated performance proof of the aftermath. |

Other caption discrepancies: S1 scene 4 shows a background dancer's handstand with the lead pair elsewhere in the frame. S1 scene 8 and parts of S5 scene 2 feature the separate singer. S1 scene 2 changes appearance/composition within the detected scene. Several longer detected scenes contain internal cuts, so preserving the 57-scene inventory does not mean every scene is one continuous take.

## Matching implications

The current holes are a mixture of deliberate choices, unreviewed alternatives and insufficient placed duration. They are not proof that the library lacks every required broad role. Review the candidate pool before deciding coverage is missing. Repeats remain permitted for this practice project, but are not permission to pad every window.

The app should propose musical trims automatically, with compatible motion guiding joins and loose semantics guiding the story role. Review actual cut pairs before accepting motion continuity. Current worker flow is averaged across a scene, with low coherence in many busy scenes; it does not separately track camera and subjects or measure each new trim boundary.

## Evidence display repair

The Match cards previously inferred screen direction from caption words, inferred entry/exit edges from aggregate flow, inverted vertical image coordinates, generated synthetic palettes when analysis was missing, and repeated a thumbnail as temporal evidence. The repair removes those fallbacks, shows unknown measurements explicitly, retains uncropped frames, and labels selections and scores as provisional advice. Neutral motion/color ranking defaults are not displayed as measured match scores. This is a presentation repair, not completion of boundary analysis or matching acceptance.

## Remaining acceptance

Review exact candidate intervals, resolve the misleading captions relevant to selected material, and make the automatically proposed cut reviewable. Then apply reviewed decisions, rebuild with the deployed meeting-shot boundary fix, inspect whole-song and section playback with master audio, verify edit/remove/undo and save/reload persistence, and retain genuine and deliberate holes. Effects/export follow rough-cut review. No story or media generation is authorized for this continuation.
