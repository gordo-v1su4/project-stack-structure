# Canonical Higgsfield / Nano Banana reference-continuity protocol

**Status:** canonical as of 2026-09-01. Use this document for all still-image
prompting and reference-package decisions. Older plans and provider runbooks may
describe routing, billing, or UI operations, but they must link here rather than
repeat a competing creative formula.

This protocol is based on a live review of successful and failed Nano Banana Pro
outputs in the signed-in Higgsfield history. The central finding is that source
asset quality and unambiguous reference roles matter more than prompt density or
raw reference count.

## Acceptance priorities

Judge a conditioning still in this order:

1. The named character is unmistakably the same person and the source detail is
   sharp enough to survive video generation.
2. The environment belongs to the same club and preserves the correct material,
   lighting and spatial language.
3. Wardrobe and character-specific details remain locked.
4. Motion cues are useful but localized; faces, wardrobe and structural anchors
   remain readable.
5. The exact composition or whether a first/last conditioning frame appears in
   the final edit is secondary.

A plausible side room, tunnel or lateral area may expand the club. It must still
feel connected to the same underground industrial venue. A generic restaurant,
clean commercial nightclub or unrelated cave is continuity failure.

## Required starting assets

### Named identity authority

Build one high-quality identity sheet per lead before generating story frames.

- Print the character's canonical name clearly on the sheet. Use that exact name
  in every later prompt; reject spelling or alias drift before submission.
- Prioritize multiple sharp facial views over a large full-body layout: front,
  three-quarter and profile views with visible skin texture, consistent hair,
  neutral expressions and clean lighting.
- Include one useful upper-body wardrobe view. A full-body view is optional and
  supports proportions or wardrobe only; it is not the main likeness source.
- Keep the sheet internally consistent. Avoid motion blur, tiny faces, duplicate
  near-identical panels, conflicting outfits and unrelated props.
- Do not assume a single headshot is sufficient merely because provider guidance
  says it can be. Validate the accepted sheet across close, medium and dynamic
  shots before declaring the identity locked.

### Environment authorities

Maintain separate, named location plates for the main chamber and legitimate
secondary zones such as a side room, entry tunnel or balcony.

- A low-resolution video grab may control blocking or geometry, but it must not
  control texture, sharpness or final image quality.
- Pre-build clean, sharp plates for recurring zones. Preserve concrete and wet
  stone, industrial columns, metal railings, the oculus/ring-light language,
  red/amber practical light, haze and crowd density as appropriate to the zone.
- Do not describe a wholly natural cave when the visual authority shows a built
  circular concrete chamber. Text must not fight the reference.

### Optional supporting authorities

- Grade/lens/atmosphere: one to three sharp references, explicitly restricted to
  optical character, color, haze and contrast. They do not control people,
  props, architecture or composition.
- Crowd: dedicated sheets may control diversity, wardrobe range and energy. They
  do not control the room geometry or lead identity.
- Composition: a storyboard panel or video still may control blocking only. It
  must never be the texture or likeness authority when it is soft.

Use the smallest reference packet that completely defines the shot. There is no
absolute three-reference rule: a five-reference packet succeeded when every
asset had a clear, non-overlapping role. Every extra asset still adds drift risk.

## Preflight manifest gate

Before every submission, inspect the actual Higgsfield input tray in its current
order and write a fresh role manifest. Adding, deleting or reordering an image
invalidates copied numeric references.

```text
Image 1 = LA_CASA_ROJA_MAIN_CHAMBER; geometry and location only.
Image 2 = OPTICAL_ANCHOR_A; grade, lens response and atmosphere only.
Image 3 = OPTICAL_ANCHOR_B; grade, lens response and atmosphere only.
Image 4 = CROWD_STYLE; crowd diversity and wardrobe range only.
Image 5 = DIEGO; exact identity and wardrobe lock.
```

Preflight must fail if:

- any prompt number does not map to the currently attached asset;
- the canonical character name is misspelled or replaced by another alias;
- two assets claim the same primary authority without an explicit hierarchy;
- a low-resolution image is allowed to control final texture or sharpness;
- the prompt re-describes a locked wardrobe instead of referring to the sheet;
- a copied prompt still contains roles from an earlier attachment packet.

After the manifest, refer to the character by name rather than by pronoun or
image number.

## Prompt pattern

Keep image prompts short and conversational. The user refined this template
on 2026-09-06; it applies to Nano Banana image generation, not Seedance video
prompts.

- Write `Image 1`, never `Image_1`. Declare each attachment's role once, in the
  actual attachment order. Use ordinary sentences without parenthetical role
  labels or technical qualifiers such as "authoritative high-resolution".
- Character sheets lock the named character's exact identity and wardrobe.
  After that declaration, use canonical names rather than pronouns or generic
  lead labels. Name the location when referring to it.
- A source frame controls character blocking and placement in the environment
  only. Explicitly exclude its texture, image quality and facial detail.
- Ask for a `3x3 cinematic anamorphic grid of shots`. Avoid "storyboard" and
  "contact sheet" in model-facing image text. Describe the overall action and
  mood in a short paragraph; do not prescribe nine individual panels.
- Keep resolution, aspect ratio, song placement, section labels, panel indices,
  attachment URLs and billing in the job metadata/API settings. Do not repeat
  them inside the prompt. Omit timecodes, reading order and video edit handles.
- Avoid extra negative instructions by default. Add a narrow correction, such
  as "no borders", only if an actual result needs it.

Example for the current three canonical references plus a source frame:

```text
Image 1 is the character sheet for Diego. Use the exact identity and wardrobe lock.
Image 2 is the character sheet for Valentina. Use the exact identity and wardrobe lock.
Image 3 is the master location reference for Underground Latin Club.
Image 4 guides character blocking and placement in the environment only. Do not copy texture, image quality or facial detail.

Create a new 3x3 cinematic anamorphic grid of shots. Diego and Valentina dance together in the crowded Underground Latin Club. Dark red and amber light, a little darker and hazy. Capture the sequence with dynamic camera movement and varied compositions.
```

For a fresh standalone frame, retain the same role declarations and ask for one
new cinematic photograph from the composition reference, with sharp character
detail and natural lighting. Do not upscale the reference. Keep its parent grid
and panel identity in metadata rather than in the prompt.

Lens and camera language is optional, never boilerplate. Prefer describing the
optical result, such as "cinematic anamorphic", for the default template. The
previous ARRI wording produced a visible camera/operator in one result; inspect
outputs if a more specific camera description is deliberately requested.

## Generation and editing loop

For continuity-critical frames, generate one standalone 2K image at a time.
Contact sheets may be used for rough composition exploration, but their tiny
panels are not final likeness or texture references.

1. Lock the reference packet and canonical names.
2. Generate one shot with one clear action.
3. Compare identity, skin texture, wardrobe, zone continuity and sharpness.
4. If one defect exists, edit the strongest accepted output with one narrow
   instruction. Do not rebuild the whole scene.
5. Keep identity and location authorities stable while changing only shot size,
   viewpoint, action or motion treatment.
6. Promote an accepted frame to a benchmark only after it works at full size.

Nano Banana Pro is strongest here as an editor. A narrow instruction such as
`remove the lead couple and preserve everything else` retained the location
better than reconstructing the room from a dense, conflicting prompt.

## Video-conditioning handoff

A still is conditioning material, not an editorial promise. A first/last-frame
pair can drive a 15-second generation even when neither endpoint is used in the
finished cut; audition the useful middle section. The non-negotiables are sharp
identity, consistent wardrobe and believable location membership.

Motion blur is desirable when it communicates dancing, but it must be selective:
hair, arms and nearby bodies may blur while the lead face, wardrobe, important
background faces and structural anchors remain readable. Reject global softness.

Before MiniMax handoff, require:

- stable lead identity across the chosen frames;
- the same named zone, or an intentional transition between named zones;
- no camera/operator or production-equipment artifacts;
- plausible hands, limbs, occlusion and crowd depth;
- no duplicate lead;
- readable red/amber palette and underground industrial material language;
- enough localized motion to suggest action without erasing source detail.

All local video workflow/API execution goes through SwarmUI as the app-facing
surface with its managed ComfyUI backend. Do not call the raw ComfyUI port as a
separate provider.

## Accepted evidence assets

### Secondary-zone crowd-motion benchmark

[Open the full 2K plate](../assets/higgsfield-benchmarks/2026-09-01-side-room-crowd-motion-benchmark.png)

This is not the main circular-chamber geometry authority. It is an accepted
side-room/lateral-club plate because the crowd energy, red/amber atmosphere,
materials and localized motion belong to the same venue.

### Dynamic identity-lock benchmark

[Open the full 2K frame](../assets/higgsfield-benchmarks/2026-09-01-tbd-dynamic-identity-lock-benchmark.png)

The named identity remains sharp while nearby bodies carry strong motion. This
is the preferred pattern for action-oriented video seeds.

### Medium identity-lock benchmark

[Open the full 2K frame](../assets/higgsfield-benchmarks/2026-09-01-tbd-medium-identity-lock-benchmark.png)

The face, hair, earring, skin texture and burgundy wardrobe remain consistent at
a wider scale. Use this with the dynamic frame to test cross-shot identity.

## Current fixture audit

As inspected on 2026-09-01, `.local-fixtures/media/reference-sheets/character-1.png`
and `character-2.png` are provisional rebuild inputs, not accepted final identity
authorities. Both are sharp and contain a useful frontal face plus front/back
wardrobe information, but neither prints the character's canonical name and
neither supplies multiple facial angles. Preserve them as source material for
the next named, face-led sheet; do not silently treat their filenames or prior
checksums as proof that the identity package is ready.

## Observed history that established the rules

- 10:08 PM: a narrow environment edit removed the couple while preserving most
  of the club, confirming the value of one-change editing.
- 10:19 PM: a side-angle crowd frame achieved the best motion/clarity balance,
  but it created a plausible secondary zone rather than matching the main room.
- 10:21 PM: camera terminology literalized an ARRI camera/operator in-frame.
- 10:24 PM: `use @Image 5` without a semantic identity lock drifted.
- 10:28-10:34 PM: `Image 5, named TBD, exact look and wardrobe lock` restored
  likeness across close, medium and dynamic shots. The accidental `TDB` typo did
  not break every output, but future preflight must reject alias mismatches.

## Human judgment remains required

Automation can validate manifest order, canonical names, reference-role overlap,
resolution, stale ordinals and forbidden production-equipment terms. A person
must still judge whether likeness feels correct across angles, the environment
belongs to the same venue, motion blur feels intentional, the crowd has credible
variation, and a style reference is leaking unwanted content.
