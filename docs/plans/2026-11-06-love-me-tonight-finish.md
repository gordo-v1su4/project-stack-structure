# Finish the existing Love Me Tonight film

Status: source-based finishing plan; no project edits or renders performed by this audit.
Evidence: fresh public-app project snapshot `.tmp/completion-source-project.json`, saved `2026-11-06T05:50:46.789Z`. Follow [the completion workflow](../../workflows/finish-music-video.md). This document contains shot-development briefs, not executable H3 prompts; compile and lint the final bound prompts before rendering.

## Preserve the production already started

Finish `Assembly recovery · 2026-09-08`, source project `5fc48d59-01e4-4bfb-90c1-e054a0307575`. Keep the original recoverable and continue in its finishing revision/copy. Do not start another story or generate a zero-footage replacement for this film.

- Master: `Love me tonight (fullsong).wav`, **246.69995464852607 seconds**, analyzed BPM **131.94125366210938**. The four-minute song, current section/lyric analysis, and ten approved narrative windows remain authoritative.
- Existing assets: **11 videos, 57 captioned scenes**, about **176.458 seconds** of distinct scene intervals. This is a searchable source library, not 176 seconds of automatically acceptable story coverage.
- Named references: **Diego**, **Valentina**, **Underground Latin Club**. Retain identity, wardrobe, scene-world, and continuity authority. Attach the identities actually visible in each new shot; environment-only shots need no invented lead.
- Approved story: **Love Me Tonight (Faithful)**. Diego enters an underground dance contest, searches for a partner, meets Valentina, dances with Valentina, then escapes with Valentina as the club collapses. Preserve the ten-moment order below. No betrayal, new antagonist, reordered meeting, or alternate ending.
- Existing generated asset: one queued Nano Banana storyboard image. It contributes **no completed video coverage**.

The current cut has 35 placement records: 13 source placements occupying **36.827 seconds** and 22 gap records occupying **209.873 seconds**. The earlier visible UI counted 21 windows; the extra stored record is a roughly **45-microsecond** unassigned rounding tail. Three other stored gaps are only **20 milliseconds** at section boundaries. These are timing reconciliation cases, not four useful video-generation jobs. The current naive H3 subdivision produces 32 windows; that is not the creative shot count or final rendering budget.

Important correction: labels such as `loop 2` and `loop 6` in this saved cut are misleading. The actual source intervals progress without repeating frames. The jungle sequence spends source 6 from 0 to 7.732 once, and the fracture sequence spends source 8 from 0 to 13.375 once. Preserve these useful frames. Conversely, dividing a continuous source into several metadata placements does not create several visibly different shots.

## Fixed story map and exact outstanding coverage

Times are song seconds. Source IDs below are zero-based saved IDs; the UI may display them as `S1` through `S11`.

| # | Approved moment / song interval | Existing accepted placement | Outstanding interval before additional source review |
| --- | --- | --- | --- |
| 1 | Jungle and Cave Entrance · **0–14.770** | Source 6, physical frames **0–7.732**, placed at song **0–7.732** | **7.732–14.770**, 7.038s; includes the 20ms section seam at 14.750 |
| 2 | Diego Enters Alone · **14.770–29.280** | None | **14.770–29.280**, 14.510s |
| 3 | Valentina Appears Separately · **29.280–36.600** | None | **29.280–36.600**, 7.320s; includes the 20ms seam at 29.300 |
| 4 | Glance Across the Room · **36.600–43.820** | None | **36.600–43.820**, 7.220s |
| 5 | Diego Walks Through Tunnel Hallways · **43.820–60.200** | None | **43.820–60.200**, 16.380s; includes the 20ms seam at 43.840 |
| 6 | Diego Approaches Valentina · **60.200–74.740** | None | **60.200–74.740**, 14.540s |
| 7 | Connection and Dancing · **74.740–151.730** | Source 1 **8.917–10.917** at **74.740–76.740**; source 2 **1.833–13.886** at **89.290–101.343** | **76.740–89.290** and **101.343–151.730**, total 62.937s |
| 8 | The Fracture and Panic · **151.730–189.750** | Source 8 **0–13.375** at **151.730–165.105** | **165.105–189.750**, 24.645s |
| 9 | Escape Through Corridors · **189.750–227.710** | Source 5 **26.583–28.250** at **189.750–191.417** | **191.417–227.710**, 36.293s |
| 10 | Together After Escape · **227.710–246.69995465** | None | **227.710–246.69995465**, 18.990s |

Do not generate all 209.873 seconds immediately. First audition unused, caption-supported footage in the correct narrative windows. Even if every distinct existing scene second proved usable, the song exceeds the entire source library by roughly **70.242 seconds**. Actual new coverage will be greater because some scenes have unsuitable action, identity, wardrobe, microphone performance, damage state, or insufficient usable handles. Record the real remaining ledger after source review rather than promising a guessed job count.

Resolve the three 20ms seams with adjacent, story-consistent frame-grid trims in the finishing plan. The final 45µs tail should resolve at output-frame precision, while preserving the complete master audio duration. Do not create black flashes, an invented eleventh moment, or minimum-length GPU renders for these records. Any merge/rebinding must produce a new current plan signature and exact target identities before dispatch.

## Reclaim the existing library first

Caption evidence identifies candidates; it does not certify likeness, wardrobe, eyeline, or physical-state continuity. Review actual first/middle/last frames and playback before inserting these ranges. Preserve already accepted source use and never spend the same physical source interval twice under faithful coverage.

| Saved source / filename suffix | Caption-supported material to audition | Appropriate use / restriction |
| --- | --- | --- |
| **0** · `…f2ede14fceb7.mp4` | Scene 1 **1.083–2.292** faces close; scene 2 **2.292–3.500** footwork; scene 3 **3.500–4.833** handstand; scenes 4–6 **4.833–12.833** pair movement/dance | Meeting aftermath or dance progression. A close pair does not prove a glance across the room or a solo arrival. Singing scene 7 is not required for this scope. |
| **1** · `…6f97ceb6c389.mp4` | Scene 0 **0–8.917** pair through crowd; scene 2 **10.917–15.042** intimate dance | Use after the meeting. Scene 0's caption says shirtless Diego: compare the reference and accepted wardrobe before using it. Keep the already used **8.917–10.917** interval spent. |
| **2** · `…d051a451d4d8.mp4` | Scene 0 **0–1.833** pair walking; scene 2 **13.917–15.042** dance | Pair movement after meeting. Preserve the accepted **1.833–13.886** dance take. Its long hold may be punctuated with other viewpoints; do not restart that same action from its beginning. |
| **3** · `…d5108f2d3cfa.mp4` | Scene 1 **1.375–8.542** dance; scene 3 **10.500–15.042** intimate dance | Useful dance variety only if background/floor and wardrobe agree. Scene 0 already shows a chasm: never place it before the fracture. Scene 2's unnamed singer is not automatically Valentina. |
| **4** · `…ed40cef45b5a.mp4` | Scene 0 **0–6.000** running among concrete blocks; scenes 2–3 **8.000–15.042** synchronized movement and a lift | Running belongs after the fracture. Dance/lift may support the dance phase only if the floor is still intact in the actual frames. Do not import microphone performance as presumed accurate lip-sync. |
| **5** · `…9923-68e941fd72bc.mp4` | Scene 3 **4.417–7.625** Diego in corridor; scene 7 **11.542–12.625** red door; scene 14 **19.667–21.000** Diego close-up; scenes 0/4/5/15/17 **0–1.583, 7.625–10.458, 21.000–22.917, 24.833–26.583** boots/running/pair sprint | Calm corridor material can develop moment 5 only if movement is not panicked. Running inserts develop moment 9. Keep the used **26.583–28.250** pair interval spent. Generic silhouettes remain anonymous; the floating earring is not necessary story coverage. |
| **5**, door actions | Scene 10 **14.667–15.667** palm prepares push; scene 9 **13.708–14.667** door pushed open | An escape payoff is possible only if the actual door/hand states match. Preparation must precede the completed opening, despite reversed source numbering. Otherwise select one action; never reopen an already opened door. The wall punch is optional and should not create an unrelated subplot. |
| **6** · `…aa81337c129c.mp4` | Scene 2 **7.958–10.667** people inside rocky passage; scene 3 **10.667–12.042** corridor groups | Can extend the established cave-world opening without inventing a new location. People are not identified as Diego by these captions. The **7.732–7.958** source tail may extend a neighboring shot; it is too short to become a separate Fast shot. |
| **7** · `…04ccaafe4b39.mp4` | Scene 1 **5.958–15.042** crowded floor breaks into a widening hole | Later fracture/panic coverage after initial damage. Trim into the already developing damage, if continuity permits, rather than replaying a first crack from an intact floor. Singer-led scene 0 is not a mandatory performance beat. |
| **8** · `…1a47dcd70fcc.mp4` | Scene 1 **13.375–15.042** boot on glowing wet floor beside a fallen figure | Possible late fracture/escape insert after visual review. Scene 0 is already entirely spent in the accepted sequence; a second use would repeat its physical action. |
| **9** · `…9c9e36afdce9.mp4` | Scene 0 **0–1.875** red corridor; scene 2 **6.583–10.083** Diego from behind in corridor; scene 1 **1.875–6.583** pair under water spray | Corridor geography and solo movement can support moment 5 if the motion reads as exploration. Pair belongs after meeting. The climbing woman in scene 3 is not established as Valentina by the caption. |
| **10** · `…1f90077e6b37.mp4` | Scene 3 **12.125–15.042** Valentina dancing alone; scene 0 **0–4.667** pair/crowd; scene 1 **4.667–12.125** Diego running past rails and wall lights | Valentina's solo shot is a strong audition for moment 3. Pair material belongs after meeting; running belongs during escape. A solo escape insert must not imply Diego has abandoned Valentina. |

Short, usable 1–3 second scenes matter here. The former universal four-second source filter discarded boots, face reactions, door details, and other rhythmic inserts even when they were present. The Fast pacing change below makes these eligible; it does not grant them approval or silently rewrite the saved film.

## Shot variety and physical progression for remaining generation

### First visual audit, 2026-11-06

The public app now has a separate saved finishing revision, `75101b25-fea6-42b1-b2c6-85a9d1deb8eb` (**Love Me Tonight · Finishing revision · 2026-11-06**). The original remains saved independently. The finishing revision retains all 11 sources and the approved story. This is preservation evidence, not a completed cut.

Actual reference sheets and first/middle/last scene boards were inspected, rather than relying on caption labels. The currently uploaded Diego and Valentina sheets contain named multi-angle facial views; the location sheet establishes the circular concrete chamber, balcony, wet floor, cage lamps and red corridor. Retain these packets.

The visual audit changes several candidate decisions above:

- **Source 10 scene 3 is unsuitable for Valentina's introduction.** The floor is already broken and the action belongs to the escape. Generate a genuinely separate pre-fracture introduction instead.
- **Sources 3 and 4 show the chasm, rubble and damaged room during the proposed dance intervals.** Reserve these shots for the fracture/escape phase. Their captions must not authorize an intact-floor dance insertion.
- **Source 9 scene 2 shows urgent corridor movement**, with severe motion blur and a low travelling viewpoint. Reserve it for escape, not calm exploration.
- **Source 5 has useful running details and lead reactions.** Its solo corridor close-up must be checked in motion before treating it as exploration. The door detail may foreshadow the route, but the adjacent door actions need a playback review before reordering.
- **Sources 0, 1 and 2 provide usable pre-fracture dance imagery**, with recognizable leads and substantially compatible wardrobe/world. Avoid the unnamed singer inserts when claiming lead coverage. Source 0 scene 1 includes foreground occlusion and a different male performer in one sampled view; select only a verified lead interval rather than accepting the whole captioned scene.
- **Source 6's unused passage views are anonymous crowd geography**, suitable for developing the cave opening. Do not label a foreground stranger as Diego.

Scene boards establish visible states at sampled frames only. Playback, exact handles and identity through motion remain required before inserting new source ranges. Local audit sheets are under `.tmp/film-audit/`; they are working evidence, not conditioning authorities or delivered film footage.

Use existing footage whenever the action and state actually fit. Generate complementary views and missing actions for the remaining timed windows. Each row is an editorial development brief; turn it into separately bound single-shot jobs. Do not submit a whole row as one overloaded prompt or repeat the complete action in every angle.

| Moment | Recommended shot progression | Continuity boundary |
| --- | --- | --- |
| 1 · cave/world | Existing jungle wide → nearer cave-mouth/light detail → movement toward the wet threshold → rocky interior geography. Use source 6 frames as the cave continuity reference when needed. | No named lead is required in every establishing view. Keep the same cave, wetness, red glow, and time of day. |
| 2 · solo arrival | Follow Diego through the threshold → waist-up Diego scanning the crowd → Diego's viewpoint across available floor space → a purposeful forward step. Vary rear tracking, medium profile, and closer reaction. | Diego arrives alone once. Do not show Valentina already accompanying Diego, a paired dance, or collapsed-floor panic. |
| 3 · separate Valentina | Audition the existing Valentina solo shot, then a complementary medium/close view and a motivated look toward the other side of the room. | Establish Valentina's separate position; do not pre-stage the meeting. |
| 4 · glance | Diego looks along a clear eyeline → Valentina's matching reverse → a wider spatial connector if needed. | Preserve screen direction and room geography. A face-to-face pair close-up cannot substitute for distance. |
| 5 · tunnels | Corridor establishing insert → Diego walking and looking into a side passage → close reaction/turn → movement back toward the contest floor. The closed red door may foreshadow the later route. | Exploration precedes the meeting and fracture. No repeated entry, running escape, or already opened door. |
| 6 · approach/meeting | Diego begins crossing the remaining distance → Valentina waits/reacts → a lateral closing-distance view → the first face-to-face two-shot. | Complete the approach once. Later shots begin from the established proximity, not from the far side of the room again. |
| 7 · dance development | Alternate footwork, face/reaction, hand connection, full-body pair movement, a distinct spin/handstand/lift, and a broader crowd/contest view. Build two or three musical phrases with different movement vocabulary instead of one repeated dance action. | The floor stays intact until 151.730. Preserve wardrobe, hand positions, dance direction, and landings. Do not replay a completed lift or reset its landing in the next shot. |
| 8 · fracture/panic | Preserve the accepted first cracking sequence → wider damage already spreading → feet finding intact ground → crowd reacting/moving → Diego and Valentina committing to the escape route. | Damage grows monotonically. No intact-floor reset or repeated first fracture; show a usable route through the same geography. |
| 9 · escape | Preserve the accepted pair sprint → boots and matching individual reactions → pair crossing successive corridor landmarks → the door/threshold obstacle → moving through the exit. Use forward progress and changing distance, not repeated generic running in place. | Consistent travel direction, red corridor, moisture/dust, and paired escape. Open a given door once; once a landmark is passed it stays behind the pair. |
| 10 · safe together | Pair clears the threshold → a release of tension in a medium/close view → a small shared gesture on the last musical lift → a wider closing image outside danger. | Diego and Valentina are safely together. Keep sweat/dirt/wardrobe and the established cave/club world; do not return to an intact busy club or introduce an unrelated ending. |

Keep an actual variety ledger for each phrase: shot size, viewpoint, movement direction, action start/end state, and source interval. A change in metadata ID is not visual variety. Favor motivated motion matches and reactions; reserve whip/impact cuts for real musical accents rather than using them to hide identity drift or broken anatomy.

## Fast pacing without destroying the saved arrangement

The film's requested direction is high-energy, narrative-driven fast cutting. The saved `cutDensity: 0.65` is the earlier balanced default, not the requested final treatment.

Implementation decision: **Fast begins at density 0.8** (the existing Fast button selects 0.82). It permits usable one-second source shots, aims for roughly 1–3 second cue-aligned cuts, and uses available beat cues when sparse onset clusters would otherwise strand a long hold. Balanced/Relaxed retain the four-second minimum. The default density stays unchanged globally.

Existing placements remain frozen until an explicit arrangement decision is made. A changed setting invalidates the old plan for preview/generation rather than silently reranking it. Apply Fast to this film's finishing revision while preserving accepted source identity, physical ranges, and the ten narrative windows. Punctuate a long accepted take with complementary inserts or a deliberate trim revision; do not replace all the existing source footage simply to obtain more cut boundaries.

At approximately 132 BPM, one beat is about 0.455 seconds. Useful editing phrases include two-beat accents around 0.91 seconds when a deliberate boundary permits, three-to-six-beat shots around 1.36–2.73 seconds, and occasional longer establishing/closing holds. The implemented Fast floor is **1 second**, so its automatic shots will not manufacture 0.91-second clips; shorter accents require a separately reviewed editorial exception. The final film should be predominantly brisk during dance and escape, with readable setup, approach, and resolution. Do not force every cut to the same duration.

H3's generated source duration/handles and the song's selected edit duration are separate. A usable 5–8 second generated take can provide a 1–3 second editorial excerpt, but unselected handles are not additional song coverage. Generate genuinely different movement/viewpoint options when a long requirement needs variety. Keep action budgets realistic for a single shot.

## Execution order on the existing app/production path

1. Preserve the source project JSON and current accepted playback. Continue its named finishing revision in the public app; do not launch a new creative production.
2. Audition the existing candidates above, check identity/wardrobe/physical state, and spend unique source intervals in the proper narrative windows. Keep rejected or uncertain fits visible rather than filling them with a convenient dance clip.
3. Reconcile frame-level seams and the sub-frame terminal tail. Preserve all ten story boundaries and exact master duration; save the new current target bindings.
4. Prepare the purposeful Fast arrangement and audit source consumption. Record each remaining genuine window with story requirement, interval, references, visible action, and previous/next state.
5. Prove one reference-conditioned complementary shot through the existing public route → production Trigger → SwarmUI → durable storage. Inspect the actual result before starting the remaining bounded batches.
6. Generate only the real remaining windows. A failure affects that shot; continue independent jobs. Reconcile uncertain submissions and storage failures without blind duplicate rendering.
7. Assemble pending candidates into the labeled draft, review the whole film, revise targeted failures, and approve exactly the viewed trims/selection. Reload and verify the same arrangement before export.
8. Export the full master song through production, verify durable bytes, download, and watch the entire result. Retain editable project/job/reference lineage for another pass.

## Acceptance for this film

- Original footage, analyzed song, captions, references, approved ten-moment story, and source project remain recoverable. New work demonstrably finishes that production.
- All 246.7 seconds are intentionally covered; no black holes, sub-frame queue artifacts, accidental still placeholders, or source loops masquerade as coverage. Source-audio remnants do not fight the master.
- The actual film reads as a contest/partner/connection/damage/escape/resolution progression. Diego enters alone, Valentina appears separately, the pair meets before dancing, the fracture happens once, and the pair reaches safety together.
- Dance and escape have real shot/action/viewpoint variety and predominantly fast musical pacing. Review the rendered film, not only the number of timeline records. Repetition or confusing spatial jumps must be repaired.
- Generated clips preserve the named identities, wardrobe, environment, screen direction, action continuity, and usable timing. Reject likeness drift, broken hands, impossible footfalls, background resets, and resumed completed actions.
- The approved current selection survives hard refresh/reopen; rejected/stale/short candidates do not clear unrelated windows. One controlled failure/retry proves recoverability and no duplicated logical jobs.
- The durable downloadable full-song MP4 plays with the correct master audio, complete duration, intended edits, and compatible decoding. Confirm browser playback and the downloaded artifact independently of task success and metadata probes.

Do not close the goal on this plan, a successful job, a clean build, or a technical rough-cut export. Completion requires the finished film itself.
